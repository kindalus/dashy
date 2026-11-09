import { describe, expect, test } from "bun:test";
import { defineProject } from "../core/project";
import type { ChartDefinition, ProjectDefinition } from "../core/types";

/** A small valid project; each test breaks one rule. */
function base(): ProjectDefinition {
  const build = () => ({ text: "SELECT 1 AS id, 'a' AS name, 2 AS value", values: [] });
  return {
    name: "Validation",
    params: {
      period: { label: "Period", type: "range", valueType: "date" },
      client: { label: "Client", type: "string", options: { query: "clients", value: "id", label: "name", search: true } },
    },
    sources: {},
    queries: {
      sales: { label: "Sales", sources: [], params: ["period", "client"], build },
      static: { label: "Static", sources: [], build },
      clients: { label: "Clients", sources: [], build },
    },
    metrics: { total: { label: "Total", query: "sales", column: "value" }, catalogue: { label: "Catalogue", query: "static", column: "value" } },
    datasets: {
      by_client: {
        label: "By client", query: "sales",
        columns: [{ key: "name", label: "Client", param: { name: "client", from: "id" } }, { key: "value", label: "Value" }],
        chart: { type: "bar", x: "name", series: [{ key: "value", label: "Value" }] },
      },
    },
    dashboards: {
      overview: {
        label: "Overview", params: ["period", "client"],
        blocks: [{ id: "total", type: "metric", metric: "total" }, { id: "clients", type: "dataset", dataset: "by_client" }],
      },
      client: {
        label: "Client", params: ["period", "client"], required: ["client"], drillthrough: { param: "client" },
        blocks: [{ id: "total", type: "metric", metric: "total" }],
      },
    },
  };
}
const invalid = (change: (project: ProjectDefinition) => void, message: string) => {
  const project = base();
  change(project);
  expect(() => defineProject(project)).toThrow(message);
};

describe("dashboard filters", () => {
  test("the base project is valid", () => {
    expect(defineProject(base()).name).toBe("Validation");
  });
  test("every block query must accept every dashboard parameter", () => {
    invalid((p) => { p.dashboards.overview!.blocks = [...p.dashboards.overview!.blocks, { id: "catalogue", type: "metric", metric: "catalogue" }]; },
      'query static does not accept dashboard parameter period. Add it to the query or declare unfiltered: { catalogue: ["period"] }');
  });
  test("unfiltered exceptions are explicit and checked", () => {
    const project = base();
    project.dashboards.overview!.blocks = [...project.dashboards.overview!.blocks, { id: "catalogue", type: "metric", metric: "catalogue" }];
    project.dashboards.overview!.unfiltered = { catalogue: ["period", "client"] };
    expect(() => defineProject(project)).not.toThrow();
    invalid((p) => { p.dashboards.overview!.unfiltered = { total: ["period"] }; }, "lists period as unfiltered, but query sales accepts it");
    invalid((p) => { p.dashboards.overview!.unfiltered = { missing: ["period"] }; }, "unfiltered references unknown block missing");
  });
  test("required parameters belong to the dashboard", () => {
    invalid((p) => { p.dashboards.overview!.required = ["other"]; }, "required other is not a dashboard parameter");
  });
});

describe("drillthrough and column parameters", () => {
  test("destinations must accept their parameter", () => {
    invalid((p) => { p.dashboards.client!.drillthrough = { param: "missing" }; }, "drillthrough parameter must be one of its parameters");
    invalid((p) => { p.dashboards.client!.drillthrough = { param: "period" }; }, "drillthrough cannot use a range parameter");
  });
  test("targets must be destinations for the same parameter", () => {
    invalid((p) => { p.dashboards.overview!.drillthroughTargets = { client: "overview" }; }, "dashboard overview is not a drillthrough destination for client");
    invalid((p) => { p.dashboards.overview!.drillthroughTargets = { client: "nowhere" }; }, "references unknown dashboard nowhere");
    const project = base();
    project.dashboards.overview!.drillthroughTargets = { client: ["client"], period: false };
    expect(() => defineProject(project)).not.toThrow();
  });
  test("column parameters must exist and cannot be ranges", () => {
    invalid((p) => { p.datasets.by_client!.columns = [{ key: "name", label: "Client", param: "nope" }, { key: "value", label: "Value" }]; },
      "column name references unknown parameter nope");
    invalid((p) => { p.datasets.by_client!.columns = [{ key: "name", label: "Client", param: "period" }, { key: "value", label: "Value" }]; },
      "cannot map to range parameter period");
  });
});

describe("parameters, sources, limits and charts", () => {
  test("parameter names, query options and relative defaults", () => {
    invalid((p) => { p.params.refresh = { label: "Refresh", type: "boolean" }; }, "parameter name 'refresh' is reserved");
    invalid((p) => { p.params.client!.options = { query: "missing", value: "id" }; }, "options reference unknown query missing");
    invalid((p) => { p.queries.clients!.params = ["client"]; }, "options query cannot depend on client itself");
    invalid((p) => { p.params.period!.strict = true; }, "strict requires query options");
    invalid((p) => { p.params.period!.default = { relative: "today" }; }, "range parameters cannot use a relative date");
    invalid((p) => { p.dashboards.overview!.defaults = { period: { relative: "last-days", days: -1 } }; }, "overview default for period");
  });
  test("parquet options, timezone, limits and cache", () => {
    invalid((p) => { p.sources.data = { type: "csv", path: "a.csv", hive: { types: { year: "INTEGER" } } }; }, "hive options require a parquet source");
    invalid((p) => { p.sources.data = { type: "parquet", path: "a/*.parquet", hive: { types: { year: "INT" as never } } }; }, "hive type for year");
    invalid((p) => { p.timezone = "Mars/Olympus"; }, "not an IANA timezone");
    invalid((p) => { p.limits = { memory: "lots" }; }, "limits.memory must look like 512MB");
    invalid((p) => { p.limits = { maxConcurrentQueries: 0 }; }, "limits.maxConcurrentQueries must be an integer of at least 1");
    invalid((p) => { p.cache = { ttlSeconds: -1 }; }, "cache.ttlSeconds must be zero or positive");
    invalid((p) => { p.queries.sales!.cache = { ttlSeconds: Number.NaN }; }, "sales cache must be false or { ttlSeconds }");
  });
  const chartCase = (chart: ChartDefinition, message: string) =>
    invalid((p) => { p.datasets.by_client!.chart = chart; }, message);
  test("each chart type checks its columns", () => {
    chartCase({ type: "pie", category: "name", value: "missing" }, "has unknown value column missing");
    chartCase({ type: "treemap", path: [], value: "value" }, "path requires at least one column");
    chartCase({ type: "heatmap", x: "name", y: "nope", value: "value" }, "has unknown y column nope");
    chartCase({ type: "gauge", value: "value", min: 10, max: 5 }, "min must be below max");
    chartCase({ type: "gauge", value: "value", bands: [{ until: 50, tone: "danger" }, { until: 40, tone: "success" }] }, "bands must ascend");
    chartCase({ type: "radar", category: "name", series: [] }, "requires at least one series");
    chartCase({ type: "sankey", source: "name", target: "value", value: "x" }, "has unknown value column x");
    chartCase({ type: "cartesian", x: "name", orientation: "horizontal", series: [{ key: "value", label: "V", axis: "right" }] },
      "horizontal charts support only the left value axis");
    chartCase({ type: "cartesian", x: "name", series: [{ key: "value", label: "V", as: "donut" as never }] }, "as must be line, bar, area or scatter");
    chartCase({ type: "spiral" } as never, "type must be one of");
  });
  test("table options are validated at startup with the dataset name", () => {
    invalid((p) => { p.datasets.by_client!.totals = true; }, "by_client totals require at least one column aggregate");
    invalid((p) => { p.datasets.by_client!.topN = { by: "missing" }; }, "by_client topN by references unknown column missing");
  });
});

describe("metric comparisons", () => {
  const metricCase = (extra: Record<string, unknown>, message: string) =>
    invalid((p) => { Object.assign(p.metrics.total!, extra); }, message);
  test("compare, target and sparkline are validated at startup", () => {
    metricCase({ compare: {} }, "total compare requires a column");
    metricCase({ compare: { column: "p", as: "ratio" } }, "total compare as must be percent or delta");
    metricCase({ compare: { column: "p", better: "more" } }, "total compare better must be higher or lower");
    metricCase({ target: {} }, "total target requires either a column or a value");
    metricCase({ target: { column: "g", value: 3 } }, "total target requires either a column or a value");
    metricCase({ target: { value: Number.NaN } }, "total target value must be a finite number");
    metricCase({ sparkline: { dataset: "nope", value: "x" } }, "total sparkline references unknown dataset nope");
    metricCase({ sparkline: { dataset: "by_client", value: "x" } }, "total sparkline value must be a column of by_client");
  });
  test("fallback, tone and note name other columns of the row", () => {
    for (const key of ["fallback", "tone", "note"]) {
      metricCase({ [key]: "" }, `total ${key} must be a column name`);
      metricCase({ [key]: 3 }, `total ${key} must be a column name`);
    }
    metricCase({ tone: "value" }, "total tone must be a column other than value");
  });
});
