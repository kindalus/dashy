import { fileURLToPath } from "node:url";
import { defineProject } from "../../core/project";
import type { QueryDefinition, SourceDefinition } from "../../core/types";

const sources: Record<string, SourceDefinition> = {
  orders: { type: "csv", path: "orders.csv", label: "Orders CSV" },
  json_orders: { type: "json", path: "orders.json", label: "Orders JSON" },
  sqlite_orders: {
    type: "sqlite",
    path: "orders.sqlite",
    table: "orders",
    label: "Orders SQLite",
  },
  excel_orders: {
    type: "excel",
    path: "orders.xlsx",
    sheet: "Orders",
    label: "Orders Excel",
  },
  duckdb_orders: {
    type: "duckdb",
    path: "orders.duckdb",
    table: "orders",
    label: "Orders DuckDB",
  },
  parquet_orders: {
    type: "parquet",
    path: "orders.parquet",
    label: "Orders Parquet",
  },
};
const sourceQueries = Object.fromEntries(
  Object.keys(sources).map((name) => [
    `preview_${name}`,
    {
      label: `Preview ${sources[name]!.label}`,
      sources: [name],
      maxRows: 100,
      build: ({ source }) => ({
        text: `SELECT * FROM ${source(name)} ORDER BY date`,
        values: [],
      }),
    } satisfies QueryDefinition,
  ]),
);
const sourceDatasets = Object.fromEntries(
  Object.keys(sources).map((name) => [
    name,
    {
      label: sources[name]!.label!,
      query: `preview_${name}`,
      columns: [
        { key: "date", label: "Date", format: { style: "date" as const } },
        { key: "region", label: "Region" },
        { key: "product", label: "Product" },
        { key: "units", label: "Units" },
        {
          key: "revenue",
          label: "Revenue",
          format: { style: "currency" as const, currency: "EUR" },
        },
      ],
    },
  ]),
);
export default defineProject({
  name: "Source examples",
  description: "A workspace for your data",
  locale: "en-GB",
  dataDir: fileURLToPath(new URL("./data", import.meta.url)),
  params: {
    period: {
      label: "Period",
      type: "range",
      valueType: "date",
      default: { from: "2026-01-01", until: "2026-06-30" },
    },
    region: {
      label: "Region",
      type: "select",
      options: [
        { label: "North", value: "North" },
        { label: "South", value: "South" },
      ],
    },
  },
  sources,
  queries: {
    ...sourceQueries,
    summary: {
      label: "Order totals",
      sources: ["orders"],
      params: ["period", "region"],
      build: ({ source, params, sql }) => {
        const where = sql.where(
          sql.range(
            "date",
            params.period as { from: string; until: string } | undefined,
          ),
          sql.eq("region", params.region as string | undefined),
        );
        return {
          text: `SELECT COALESCE(SUM(revenue), 0) AS revenue, COALESCE(SUM(units), 0) AS units, COUNT(*) AS orders, COALESCE(AVG(revenue), 0) AS average FROM ${source("orders")} ${where.text}`,
          values: where.values,
        };
      },
    },
    monthly: {
      label: "Monthly revenue",
      sources: ["orders"],
      params: ["period", "region"],
      build: ({ source, params, sql }) => {
        const where = sql.where(
          sql.range(
            "date",
            params.period as { from: string; until: string } | undefined,
          ),
          sql.eq("region", params.region as string | undefined),
        );
        return {
          text: `SELECT strftime(CAST(date AS DATE), '%Y-%m') AS month, SUM(revenue) AS revenue FROM ${source("orders")} ${where.text} GROUP BY 1 ORDER BY 1`,
          values: where.values,
        };
      },
    },
    products: {
      label: "Revenue by product",
      sources: ["orders"],
      params: ["period", "region"],
      build: ({ source, params, sql }) => {
        const where = sql.where(
          sql.range(
            "date",
            params.period as { from: string; until: string } | undefined,
          ),
          sql.eq("region", params.region as string | undefined),
        );
        return {
          text: `SELECT product, SUM(revenue) AS revenue, SUM(units) AS units FROM ${source("orders")} ${where.text} GROUP BY 1 ORDER BY revenue DESC`,
          values: where.values,
        };
      },
    },
  },
  metrics: {
    revenue: {
      label: "Revenue",
      description: "Total sales in the selected period",
      query: "summary",
      column: "revenue",
      format: { style: "currency", currency: "EUR", decimals: 0 },
    },
    units: {
      label: "Units sold",
      query: "summary",
      column: "units",
      format: { decimals: 0 },
    },
    orders: {
      label: "Orders",
      query: "summary",
      column: "orders",
      format: { decimals: 0 },
    },
    average: {
      label: "Average order",
      query: "summary",
      column: "average",
      format: { style: "currency", currency: "EUR", decimals: 2 },
    },
  },
  datasets: {
    ...sourceDatasets,
    monthly: {
      label: "Revenue over time",
      description: "Monthly sales for the selected period",
      query: "monthly",
      columns: [
        { key: "month", label: "Month" },
        {
          key: "revenue",
          label: "Revenue",
          format: { style: "currency", currency: "EUR" },
        },
      ],
      chart: {
        type: "line",
        x: "month",
        series: [
          {
            key: "revenue",
            label: "Revenue",
            format: { style: "currency", currency: "EUR" },
          },
        ],
      },
    },
    products: {
      label: "Product performance",
      query: "products",
      columns: [
        { key: "product", label: "Product" },
        {
          key: "revenue",
          label: "Revenue",
          format: { style: "currency", currency: "EUR" },
        },
        { key: "units", label: "Units sold" },
      ],
      chart: {
        type: "bar",
        x: "product",
        series: [
          {
            key: "revenue",
            label: "Revenue",
            format: { style: "currency", currency: "EUR" },
          },
        ],
      },
    },
  },
  dashboards: {
    overview: {
      icon: "chart-no-axes-combined",
      group: "Dashboards",
      label: "Overview",
      description: "Sales, orders and product performance.",
      params: ["period", "region"],
      blocks: [
        { id: "revenue", type: "metric", metric: "revenue", width: 3 },
        { id: "units", type: "metric", metric: "units", width: 3 },
        { id: "orders", type: "metric", metric: "orders", width: 3 },
        { id: "average", type: "metric", metric: "average", width: 3 },
        { id: "monthly", type: "dataset", dataset: "monthly", width: 8 },
        { id: "products", type: "dataset", dataset: "products", width: 4 },
        {
          id: "product-table",
          type: "dataset",
          dataset: "products",
          view: "table",
          width: 12,
        },
      ],
    },
    sources: {
      icon: "database",
      group: "Examples",
      label: "Source examples",
      description: "The same sample orders read from six file formats.",
      blocks: Object.keys(sources).map((name) => ({
        id: name,
        type: "dataset" as const,
        dataset: name,
        view: "table" as const,
        width: 6,
      })),
    },
  },
});
