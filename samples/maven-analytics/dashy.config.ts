import { defineProject } from "../../core/project";
import type {
  DashboardBlock,
  Format,
  MetricDefinition,
} from "../../core/types";
import { filters, queries } from "./queries";

const usd: Format = { style: "currency", currency: "USD", decimals: 0 };
const percent: Format = { style: "percent", decimals: 1 };
const revenue = { key: "revenue", label: "Revenue (USD)", format: usd };
const profit = { key: "profit", label: "Gross profit (USD)", format: usd };
// Columns declare which parameter their values belong to; dashboards decide what a click does.
const category = { key: "category", label: "Category", param: "category" };
const brand = { key: "brand", label: "Brand", param: "brand" };
const metric = (id: string): DashboardBlock => ({
  id,
  type: "metric",
  metric: id,
  width: 3,
});
const dataset = (
  id: string,
  width = 12,
  view: "chart" | "table" = "chart",
): DashboardBlock => ({ id, type: "dataset", dataset: id, width, view });
const choices = (values: string[]) =>
  values.map((value) => ({ label: value, value }));
const metrics: Record<string, MetricDefinition> = Object.fromEntries(
  (
    [
      ["revenue", "Revenue", usd],
      ["profit", "Gross profit", usd],
      ["orders", "Orders", { decimals: 0 }],
      ["units", "Units sold", { decimals: 0 }],
      ["customers", "Customers", { decimals: 0 }],
      ["average_order", "Average order", usd],
      ["margin", "Gross margin", percent],
    ] satisfies [string, string, Format][]
  ).map(([column, label, format]) => [
    column,
    { label, query: "summary", column, format },
  ]),
);

export default defineProject({
  name: "Maven Electronics",
  description: "Global electronics retailer · sample data",
  dataDir: "./data",
  params: {
    period: {
      label: "Period",
      type: "range",
      valueType: "date",
      default: { from: "2016-01-01", until: "2021-02-20" },
    },
    country: {
      label: "Customer country",
      type: "select",
      options: choices([
        "Australia",
        "Canada",
        "France",
        "Germany",
        "Italy",
        "Netherlands",
        "United Kingdom",
        "United States",
      ]),
    },
    category: {
      label: "Category",
      type: "select",
      options: choices([
        "Audio",
        "Cameras and camcorders",
        "Cell phones",
        "Computers",
        "Games and Toys",
        "Home Appliances",
        "Music, Movies and Audio Books",
        "TV and Video",
      ]),
    },
    channel: {
      label: "Channel",
      type: "select",
      options: choices(["Online", "Store"]),
    },
    brand: {
      label: "Brand",
      type: "array",
      options: { query: "brand_options", value: "brand" },
    },
    productName: {
      label: "Product",
      type: "string",
      placeholder: "Search products",
      options: { query: "product_options", value: "product", search: true },
    },
    product: { label: "Product contains", type: "string" },
    minQuantity: {
      label: "Minimum quantity",
      type: "number",
      integer: true,
      min: 1,
    },
    delivered: { label: "Has delivery date", type: "boolean" },
  },
  sources: {
    sales: { type: "csv", path: "Sales.csv" },
    products: { type: "csv", path: "Products.csv" },
    customers: { type: "csv", path: "Customers.csv" },
    stores: { type: "csv", path: "Stores.csv" },
    exchange_rates: { type: "csv", path: "Exchange_Rates.csv" },
  },
  queries,
  metrics: {
    ...metrics,
    catalogue: { label: "Products in catalogue", query: "catalogue", column: "products", format: { decimals: 0 } },
  },
  datasets: {
    monthly: {
      label: "Sales over time",
      description: "Revenue in USD by channel (stacked) and orders on the right axis.",
      query: "monthly",
      columns: [
        { key: "month", label: "Month" },
        { key: "online", label: "Online", format: usd },
        { key: "store", label: "In store", format: usd },
        { key: "orders", label: "Orders", format: { decimals: 0 } },
      ],
      chart: {
        type: "cartesian",
        x: "month",
        series: [
          { key: "online", label: "Online", format: usd, as: "area", stack: "revenue" },
          { key: "store", label: "In store", format: usd, as: "area", stack: "revenue" },
          { key: "orders", label: "Orders", format: { decimals: 0 }, as: "line", axis: "right" },
        ],
      },
    },
    categories: {
      label: "Sales by category",
      description: "Click a category to filter the dashboard.",
      query: "categories",
      columns: [category, revenue, profit, { key: "units", label: "Units" }],
      chart: { type: "bar", x: "category", series: [revenue, profit] },
    },
    category_mix: {
      label: "Category mix",
      query: "categories",
      columns: [category, revenue],
      chart: { type: "pie", category: "category", value: "revenue", donut: true, format: usd },
    },
    brands: {
      label: "Revenue by brand",
      query: "brands",
      columns: [brand, revenue],
      chart: { type: "funnel", category: "brand", value: "revenue", format: usd },
    },
    category_brands: {
      label: "Categories and brands",
      description: "Treemap: click a brand or a category.",
      query: "category_brands",
      columns: [category, brand, revenue],
      chart: { type: "treemap", path: ["category", "brand"], value: "revenue", format: usd },
    },
    category_brands_sunburst: {
      label: "Categories and brands (sunburst)",
      query: "category_brands",
      columns: [category, brand, revenue],
      chart: { type: "sunburst", path: ["category", "brand"], value: "revenue", format: usd },
    },
    seasonality: {
      label: "Orders by weekday and month",
      query: "seasonality",
      columns: [
        { key: "month", label: "Month" },
        { key: "weekday", label: "Weekday" },
        { key: "orders", label: "Orders", format: { decimals: 0 } },
      ],
      chart: { type: "heatmap", x: "month", y: "weekday", value: "orders", format: { decimals: 0 } },
    },
    margin_gauge: {
      label: "Gross margin",
      query: "summary",
      columns: [{ key: "margin", label: "Margin", format: percent }],
      chart: {
        type: "gauge", value: "margin", min: 0, max: 1, format: percent,
        bands: [{ until: 0.5, tone: "danger" }, { until: 0.56, tone: "warning" }, { until: 1, tone: "success" }],
      },
    },
    category_channels: {
      label: "Category profile by channel",
      query: "category_channels",
      columns: [
        category,
        { key: "online", label: "Online", format: usd },
        { key: "store", label: "In store", format: usd },
      ],
      chart: {
        type: "radar", category: "category",
        series: [{ key: "online", label: "Online", format: usd }, { key: "store", label: "In store", format: usd }],
      },
    },
    channel_categories: {
      label: "From channel to category",
      query: "channel_categories",
      columns: [{ key: "channel", label: "Channel", param: "channel" }, category, revenue],
      chart: { type: "sankey", source: "channel", target: "category", value: "revenue", format: usd },
    },
    monthly_distribution: {
      label: "Monthly revenue per country",
      description: "Distribution of monthly revenue per customer country.",
      query: "monthly_distribution",
      columns: [category, { key: "month", label: "Month" }, { key: "country", label: "Country" }, revenue],
      chart: { type: "boxplot", category: "category", value: "revenue", format: usd },
    },
    product_scatter: {
      label: "Units and revenue of top products",
      query: "products",
      columns: [{ key: "product", label: "Product", param: "productName" }, { key: "units", label: "Units" }, revenue],
      chart: {
        type: "cartesian", x: "units", xType: "value",
        series: [{ key: "revenue", label: "Revenue (USD)", format: usd, as: "scatter" }],
      },
    },
    products: {
      label: "Top 25 products",
      description: "Ranked by revenue at the published USD list price.",
      query: "products",
      columns: [
        { key: "product", label: "Product", param: "productName" },
        brand,
        category,
        { key: "units", label: "Units" },
        revenue,
        profit,
        { key: "margin", label: "Margin", format: percent },
      ],
    },
    countries: {
      label: "Sales by customer country",
      query: "countries",
      columns: [
        { key: "country", label: "Country", param: "country" },
        { key: "customers", label: "Customers" },
        { key: "orders", label: "Orders" },
        revenue,
      ],
      chart: { type: "bar", x: "country", orientation: "horizontal", series: [revenue] },
    },
    stores: {
      label: "Store performance",
      query: "stores",
      columns: [
        { key: "store_id", label: "Store ID" },
        { key: "store_country", label: "Country" },
        { key: "store_state", label: "State" },
        { key: "channel", label: "Channel", param: "channel" },
        { key: "orders", label: "Orders" },
        revenue,
        profit,
      ],
    },
    orders: {
      label: "Order lines",
      description:
        "Up to 1,000 lines. Use filters to narrow the selection. Local revenue uses the order currency and daily exchange rate.",
      query: "orders",
      columns: [
        { key: "order_number", label: "Order" },
        { key: "line_item", label: "Line" },
        { key: "order_date", label: "Order date", format: { style: "date" } },
        {
          key: "delivery_date",
          label: "Delivery date",
          format: { style: "date" },
        },
        { key: "customer", label: "Customer" },
        { key: "country", label: "Country", param: "country" },
        { key: "product", label: "Product", param: "productName" },
        { key: "channel", label: "Channel", param: "channel" },
        { key: "quantity", label: "Quantity" },
        revenue,
        { key: "currency", label: "Currency" },
        {
          key: "exchange_rate",
          label: "USD exchange rate",
          format: { decimals: 4 },
        },
        {
          key: "local_revenue",
          label: "Revenue (local currency)",
          format: { decimals: 2 },
        },
      ],
    },
  },
  pages: {
    "product-explorer": {
      label: "Product explorer",
      description: "Best-selling products, units and gross margins at a glance.",
      group: "Custom pages",
      icon: "package",
      params: ["period", "country", "category", "channel"],
      component: "pages/products.tsx",
    },
    "market-explorer": {
      label: "Market explorer",
      description: "Compare customer countries and explore their orders.",
      group: "Custom pages",
      icon: "users",
      params: ["period", "category", "channel"],
      component: "pages/markets.tsx",
    },
  },
  dashboards: {
    overview: {
      icon: "layout-dashboard",
      group: "Dashboards",
      label: "Overview",
      description:
        "Fictitious retail sales, January 2016 to February 2021. Amounts use product list prices in USD.",
      params: filters,
      // The catalogue count describes all products; it is intentionally not filtered.
      unfiltered: { catalogue: filters },
      blocks: [
        metric("revenue"),
        metric("profit"),
        metric("orders"),
        metric("catalogue"),
        dataset("monthly"),
        dataset("categories", 8),
        dataset("category_mix", 4),
      ],
    },
    products: {
      icon: "package",
      group: "Analysis",
      label: "Products",
      description: "Categories, best sellers and gross margins.",
      params: filters,
      blocks: [
        metric("revenue"),
        metric("profit"),
        metric("units"),
        metric("margin"),
        dataset("categories", 6),
        dataset("category_brands", 6),
        dataset("products", 12, "table"),
      ],
    },
    "product-detail": {
      icon: "boxes",
      group: "Details",
      label: "Product detail",
      description: "Sales of one product. Open it from any product in a table or chart.",
      params: ["period", "country", "channel", "productName"],
      required: ["productName"],
      drillthrough: { param: "productName" },
      blocks: [
        metric("revenue"),
        metric("profit"),
        metric("units"),
        metric("orders"),
        dataset("monthly"),
        dataset("countries"),
      ],
    },
    gallery: {
      icon: "chart-pie",
      group: "Examples",
      label: "Chart gallery",
      description: "Every chart type. Click marks to cross-filter or open product detail.",
      params: filters,
      blocks: [
        dataset("margin_gauge", 4),
        dataset("category_mix", 4),
        dataset("brands", 4),
        dataset("category_brands", 6),
        dataset("category_brands_sunburst", 6),
        dataset("seasonality", 6),
        dataset("category_channels", 6),
        dataset("channel_categories", 6),
        dataset("monthly_distribution", 6),
        dataset("product_scatter", 12),
      ],
    },
    customers: {
      icon: "users",
      group: "Analysis",
      label: "Customers",
      description: "Customer countries and order values.",
      params: filters,
      blocks: [
        metric("customers"),
        metric("orders"),
        metric("revenue"),
        metric("average_order"),
        dataset("countries"),
      ],
    },
    stores: {
      icon: "store",
      group: "Analysis",
      label: "Stores",
      description:
        "Online and physical store performance. Store 0 represents online sales.",
      params: filters,
      blocks: [
        metric("revenue"),
        metric("profit"),
        metric("orders"),
        metric("units"),
        dataset("monthly"),
        dataset("stores", 12, "table"),
      ],
    },
    orders: {
      icon: "shopping-cart",
      group: "Details",
      label: "Order detail",
      description:
        "Browse individual order lines and their original currencies.",
      params: [...filters, "productName", "product", "minQuantity", "delivered"],
      blocks: [dataset("orders", 12, "table")],
    },
  },
});
