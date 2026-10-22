import type { QueryContext, QueryDefinition } from "../../core/types";

export const filters = ["period", "country", "category", "channel"] as const;
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
    params: detail
      ? [...filters, "product", "minQuantity", "delivered"]
      : filters,
    maxRows: detail ? 1000 : 10000,
    build(context) {
      const base = sales(context);
      return { text: `${base.text} ${select}`, values: base.values };
    },
  };
}

export const queries = {
  summary: query(
    "Sales summary",
    `SELECT COALESCE(SUM(revenue), 0) AS revenue,
    COALESCE(SUM(revenue - cost), 0) AS profit, COALESCE(SUM(quantity), 0) AS units,
    COUNT(DISTINCT order_number) AS orders, COUNT(DISTINCT customer_id) AS customers,
    COALESCE(SUM(revenue) / NULLIF(COUNT(DISTINCT order_number), 0), 0) AS average_order,
    COALESCE(SUM(revenue - cost) / NULLIF(SUM(revenue), 0), 0) AS margin FROM filtered`,
  ),
  monthly: query(
    "Monthly sales by channel",
    `SELECT strftime(order_date, '%Y-%m') AS month,
    SUM(CASE WHEN channel = 'Online' THEN revenue ELSE 0 END) AS online,
    SUM(CASE WHEN channel = 'Store' THEN revenue ELSE 0 END) AS store
    FROM filtered GROUP BY 1 ORDER BY 1`,
  ),
  categories: query(
    "Category performance",
    `SELECT category, SUM(revenue) AS revenue,
    SUM(revenue - cost) AS profit, SUM(quantity) AS units FROM filtered GROUP BY 1 ORDER BY revenue DESC`,
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
};
