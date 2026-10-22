import type { ArtifactRegistries } from "dashy";

export default {
  params: { customer: { label: "Customer", type: "number", integer: true, min: 1, default: 1 } },
  sources: { orders: { type: "csv", path: "orders.csv" } },
  queries: {
    customer_orders: {
      label: "Customer orders", sources: ["orders"], params: ["customer"],
      build: ({ sql, source, params }) => sql.fragment(`SELECT product, amount FROM ${source("orders")} WHERE customer = ?`, [params.customer as number]),
    },
    customer_total: {
      label: "Customer total", sources: ["orders"], params: ["customer"],
      build: ({ sql, source, params }) => sql.fragment(`SELECT sum(amount) AS total FROM ${source("orders")} WHERE customer = ?`, [params.customer as number]),
    },
  },
  datasets: { customer_orders: { label: "Orders", query: "customer_orders", columns: [
    { key: "product", label: "Product" }, { key: "amount", label: "Amount", format: { style: "currency", currency: "EUR" } },
  ] } },
  metrics: { customer_total: { label: "Total", query: "customer_total", column: "total", format: { style: "currency", currency: "EUR" } } },
  dashboards: { sales: { label: "Sales", icon: "chart-no-axes-combined", group: "Customers", params: ["customer"], blocks: [
    { id: "total", type: "metric", metric: "customer_total" },
    { id: "orders", type: "dataset", dataset: "customer_orders", view: "table", width: 9 },
  ] } },
} satisfies ArtifactRegistries;
