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
const category = { key: "category", label: "Category" };
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
  metrics,
  datasets: {
    monthly: {
      label: "Sales over time",
      description: "Revenue in USD, grouped by month and channel.",
      query: "monthly",
      columns: [
        { key: "month", label: "Month" },
        { key: "online", label: "Online", format: usd },
        { key: "store", label: "In store", format: usd },
      ],
      chart: {
        type: "line",
        x: "month",
        series: [
          { key: "online", label: "Online", format: usd },
          { key: "store", label: "In store", format: usd },
        ],
      },
    },
    categories: {
      label: "Sales by category",
      query: "categories",
      columns: [category, revenue, profit, { key: "units", label: "Units" }],
      chart: { type: "bar", x: "category", series: [revenue, profit] },
    },
    products: {
      label: "Top 25 products",
      description: "Ranked by revenue at the published USD list price.",
      query: "products",
      columns: [
        { key: "product", label: "Product" },
        { key: "brand", label: "Brand" },
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
        { key: "country", label: "Country" },
        { key: "customers", label: "Customers" },
        { key: "orders", label: "Orders" },
        revenue,
      ],
      chart: { type: "bar", x: "country", series: [revenue] },
    },
    stores: {
      label: "Store performance",
      query: "stores",
      columns: [
        { key: "store_id", label: "Store ID" },
        { key: "store_country", label: "Country" },
        { key: "store_state", label: "State" },
        { key: "channel", label: "Channel" },
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
        { key: "country", label: "Country" },
        { key: "product", label: "Product" },
        { key: "channel", label: "Channel" },
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
      params: filters,
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
      blocks: [
        metric("revenue"),
        metric("profit"),
        metric("orders"),
        metric("average_order"),
        dataset("monthly"),
        dataset("categories"),
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
        dataset("categories"),
        dataset("products", 12, "table"),
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
      params: [...filters, "product", "minQuantity", "delivered"],
      blocks: [dataset("orders", 12, "table")],
    },
  },
});
