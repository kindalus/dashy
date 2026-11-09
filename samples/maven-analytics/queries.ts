import type { QueryContext, QueryDefinition } from "../../core/types";

export const filters = ["period", "country", "category", "channel", "brand"] as const;
const sourceNames = [
  "sales",
  "products",
  "customers",
  "stores",
  "exchange_rates",
];

/** One row per order line. USD list prices avoid adding unlike currencies. */
function sales(context: QueryContext) {
  const { source, params, sql } = context;
  const where = sql.where(
    sql.range(
      "order_date",
      params.period as { from: string; until: string } | undefined,
    ),
    sql.eq("country", params.country as string | undefined),
    sql.eq("category", params.category as string | undefined),
    sql.eq("channel", params.channel as string | undefined),
    sql.in("brand", (params.brand as string[] | undefined) ?? []),
    sql.eq("product", params.productName as string | undefined),
    params.product
      ? sql.fragment("product ILIKE ?", [`%${params.product}%`])
      : sql.fragment(""),
    params.minQuantity !== undefined
      ? sql.fragment("quantity >= ?", [Number(params.minQuantity)])
      : sql.fragment(""),
    params.delivered === undefined
      ? sql.fragment("")
      : sql.fragment(
          params.delivered
            ? "delivery_date IS NOT NULL"
            : "delivery_date IS NULL",
        ),
  );
  const money = (column: string) =>
    `CAST(regexp_replace(p."${column}", '[^0-9.]', '', 'g') AS DECIMAL(18, 2))`;
  return {
    text: `WITH enriched AS (
      SELECT s."Order Number" AS order_number, s."Line Item" AS line_item,
        CAST(s."Order Date" AS DATE) AS order_date, CAST(s."Delivery Date" AS DATE) AS delivery_date,
        s.CustomerKey AS customer_id, c.Name AS customer, c.Country AS country,
        s.StoreKey AS store_id, st.Country AS store_country, st.State AS store_state,
        CASE WHEN s.StoreKey = 0 THEN 'Online' ELSE 'Store' END AS channel,
        p."Product Name" AS product, p.Category AS category, p.Brand AS brand,
        s.Quantity AS quantity, s.Quantity * ${money("Unit Price USD")} AS revenue,
        s.Quantity * ${money("Unit Cost USD")} AS cost,
        s."Currency Code" AS currency, fx.Exchange AS exchange_rate
      FROM ${source("sales")} s
      JOIN ${source("products")} p ON p.ProductKey = s.ProductKey
      JOIN ${source("customers")} c ON c.CustomerKey = s.CustomerKey
      JOIN ${source("stores")} st ON st.StoreKey = s.StoreKey
      LEFT JOIN ${source("exchange_rates")} fx
        ON CAST(fx.Date AS DATE) = CAST(s."Order Date" AS DATE) AND fx.Currency = s."Currency Code"
    ), filtered AS (SELECT * FROM enriched ${where.text})`,
    values: where.values,
  };
}

function query(label: string, select: string, detail = false): QueryDefinition {
  return {
    label,
    sources: sourceNames,
    // Every sales query accepts every dashboard filter, plus the product drillthrough.
    params: detail
      ? [...filters, "productName", "product", "minQuantity", "delivered"]
      : [...filters, "productName"],
    maxRows: detail ? 1000 : 10000,
    build(context) {
      const base = sales(context);
      return { text: `${base.text} ${select}`, values: base.values };
    },
  };
}

const summarySelect = `SELECT COALESCE(SUM(revenue), 0) AS revenue,
    COALESCE(SUM(revenue - cost), 0) AS profit, COALESCE(SUM(quantity), 0) AS units,
    COUNT(DISTINCT order_number) AS orders, COUNT(DISTINCT customer_id) AS customers,
    COALESCE(SUM(revenue) / NULLIF(COUNT(DISTINCT order_number), 0), 0) AS average_order,
    COALESCE(SUM(revenue - cost) / NULLIF(SUM(revenue), 0), 0) AS margin FROM filtered`;

/**
 * Totals for the selected period plus the same totals for the period just before
 * it (sql.previousRange), so metrics can show the change. Without a period, or
 * without sales in the previous period, the previous columns are NULL.
 */
function summary(): QueryDefinition {
  const base = query("Sales summary", summarySelect);
  return {
    ...base,
    build(context) {
      const current = sales(context);
      const period = context.params.period as { from: string; until: string } | undefined;
      const previous = context.sql.previousRange(period);
      if (!previous)
        return {
          text: `SELECT *, CAST(NULL AS DOUBLE) AS previous_revenue, CAST(NULL AS DOUBLE) AS previous_profit,
            CAST(NULL AS BIGINT) AS previous_orders FROM (${current.text} ${summarySelect})`,
          values: current.values,
        };
      const prior = sales({ ...context, params: { ...context.params, period: previous } });
      return {
        text: `SELECT cur.*, prev.revenue AS previous_revenue, prev.profit AS previous_profit, prev.orders AS previous_orders
          FROM (${current.text} ${summarySelect}) cur
          CROSS JOIN (${prior.text} SELECT SUM(revenue) AS revenue, SUM(revenue - cost) AS profit,
            NULLIF(COUNT(DISTINCT order_number), 0) AS orders FROM filtered) prev`,
        values: [...current.values, ...prior.values],
      };
    },
  };
}

/**
 * Monthly revenue without an incomplete last month, which would drag forecasts
 * down: a month counts only when it ends by both the selected period's end and
 * the last day in the data.
 */
function monthlyComplete(): QueryDefinition {
  const base = query("Monthly revenue, complete months", "");
  return {
    ...base,
    build(context) {
      const current = sales(context);
      const until = (context.params.period as { until?: string } | undefined)?.until;
      const ends = [
        "date_trunc('month', (SELECT MAX(order_date) FROM enriched) + INTERVAL 1 DAY)",
        ...(until ? ["date_trunc('month', CAST(? AS DATE) + INTERVAL 1 DAY)"] : []),
      ];
      return {
        text: `${current.text} SELECT strftime(order_date, '%Y-%m') AS month, SUM(revenue) AS revenue FROM filtered
          WHERE order_date < LEAST(${ends.join(", ")}) GROUP BY 1 ORDER BY 1`,
        values: [...current.values, ...(until ? [until] : [])],
      };
    },
  };
}

export const queries = {
  summary: summary(),
  // A metric with a tone, a note and a fallback, all from one row (see product_margin).
  product_margin: query(
    "Product margin",
    `SELECT SUM(revenue - cost) / NULLIF(SUM(revenue), 0) AS margin,
      CASE WHEN COALESCE(SUM(revenue), 0) = 0 THEN 'No sales' END AS no_sales,
      CASE WHEN COALESCE(SUM(revenue), 0) = 0 THEN 'neutral'
        WHEN SUM(revenue - cost) / SUM(revenue) >= 0.6 THEN 'success'
        WHEN SUM(revenue - cost) / SUM(revenue) >= 0.5 THEN 'warning'
        ELSE 'danger' END AS tone,
      CASE WHEN COUNT(DISTINCT order_number) BETWEEN 1 AND 9
        THEN CONCAT(COUNT(DISTINCT order_number), ' orders') END AS note
    FROM filtered`,
  ),
  monthly: query(
    "Monthly sales by channel",
    `SELECT strftime(order_date, '%Y-%m') AS month,
    SUM(CASE WHEN channel = 'Online' THEN revenue ELSE 0 END) AS online,
    SUM(CASE WHEN channel = 'Store' THEN revenue ELSE 0 END) AS store,
    SUM(revenue) AS revenue,
    COUNT(DISTINCT order_number) AS orders
    FROM filtered GROUP BY 1 ORDER BY 1`,
  ),
  monthly_complete: monthlyComplete(),
  brands: query(
    "Revenue by brand",
    `SELECT brand, SUM(revenue) AS revenue FROM filtered GROUP BY 1 ORDER BY revenue DESC`,
  ),
  category_brands: query(
    "Revenue by category and brand",
    `SELECT category, brand, SUM(revenue) AS revenue FROM filtered GROUP BY 1, 2 ORDER BY 1, revenue DESC`,
  ),
  seasonality: query(
    "Orders by weekday and month",
    `SELECT strftime(order_date, '%m') AS month, dayname(order_date) AS weekday, isodow(order_date) AS weekday_number,
    COUNT(DISTINCT order_number) AS orders FROM filtered GROUP BY 1, 2, 3 ORDER BY weekday_number, month`,
  ),
  channel_categories: query(
    "Revenue from channel to category",
    `SELECT channel, category, SUM(revenue) AS revenue FROM filtered GROUP BY 1, 2 ORDER BY revenue DESC`,
  ),
  category_channels: query(
    "Category revenue by channel",
    `SELECT category,
    SUM(CASE WHEN channel = 'Online' THEN revenue ELSE 0 END) AS online,
    SUM(CASE WHEN channel = 'Store' THEN revenue ELSE 0 END) AS store
    FROM filtered GROUP BY 1 ORDER BY 1`,
  ),
  monthly_distribution: query(
    "Monthly revenue per country by category",
    `SELECT category, strftime(order_date, '%Y-%m') AS month, country, SUM(revenue) AS revenue
    FROM filtered GROUP BY 1, 2, 3 ORDER BY 1`,
  ),
  categories: query(
    "Category performance",
    `SELECT category, SUM(revenue) AS revenue,
    SUM(revenue - cost) AS profit, SUM(quantity) AS units,
    SUM(revenue - cost) / NULLIF(SUM(revenue), 0) AS margin,
    SUM(revenue) / NULLIF(SUM(SUM(revenue)) OVER (), 0) AS share
    FROM filtered GROUP BY 1 ORDER BY revenue DESC`,
  ),
  products: query(
    "Top 25 products",
    `SELECT product, brand, category, SUM(quantity) AS units,
    SUM(revenue) AS revenue, SUM(revenue - cost) AS profit,
    SUM(revenue - cost) / NULLIF(SUM(revenue), 0) AS margin
    FROM filtered GROUP BY 1, 2, 3 ORDER BY revenue DESC, product LIMIT 25`,
  ),
  countries: query(
    "Customers by country",
    `SELECT country, COUNT(DISTINCT customer_id) AS customers,
    COUNT(DISTINCT order_number) AS orders, SUM(revenue) AS revenue
    FROM filtered GROUP BY 1 ORDER BY revenue DESC`,
  ),
  stores: query(
    "Store performance",
    `SELECT store_id, store_country, store_state, channel,
    COUNT(DISTINCT order_number) AS orders, SUM(revenue) AS revenue,
    SUM(revenue - cost) AS profit FROM filtered GROUP BY 1, 2, 3, 4 ORDER BY revenue DESC`,
  ),
  orders: query(
    "Order lines",
    `SELECT order_number, line_item, order_date, delivery_date,
    customer, country, product, channel, quantity, revenue, currency, exchange_rate,
    ROUND(revenue * exchange_rate, 2) AS local_revenue
    FROM filtered ORDER BY order_date DESC, order_number DESC, line_item`,
    true,
  ),
  /** Revenue per period start; the drill-down level fixes the grain. */
  sales_by_period: {
    label: "Revenue by period",
    sources: sourceNames,
    params: [...filters, "productName", "grain"],
    build(context) {
      const base = sales(context);
      // The grain is a bound value, never SQL text; the parameter accepts only listed options.
      return {
        text: `${base.text} SELECT CAST(date_trunc(?, order_date) AS DATE) AS period, SUM(revenue) AS revenue,
        COUNT(DISTINCT order_number) AS orders FROM filtered GROUP BY 1 ORDER BY 1`,
        values: [...base.values, (context.params.grain as string | undefined) ?? "month"],
      };
    },
  } satisfies QueryDefinition,
  /** Options for the brand filter; they follow the selected category. */
  brand_options: {
    label: "Brands",
    sources: ["products"],
    params: ["category"],
    build: ({ source, params, sql }) => {
      const where = sql.where(sql.eq("Category", params.category as string | undefined));
      return { text: `SELECT DISTINCT Brand AS brand FROM ${source("products")} ${where.text} ORDER BY 1`, values: where.values };
    },
  } satisfies QueryDefinition,
  /** Searchable product names for the product drillthrough. */
  product_options: {
    label: "Products",
    sources: ["products"],
    build: ({ source }) => ({ text: `SELECT DISTINCT "Product Name" AS product FROM ${source("products")} ORDER BY 1`, values: [] }),
  } satisfies QueryDefinition,
  catalogue: {
    label: "Catalogue size",
    sources: ["products"],
    build: ({ source }) => ({ text: `SELECT COUNT(*) AS products FROM ${source("products")}`, values: [] }),
  } satisfies QueryDefinition,
};
