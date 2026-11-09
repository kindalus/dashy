import { describe, expect, test } from "bun:test";
import { actionsFor, applyAction, backLink, drillthroughHref, drillthroughTargets, selectionFor, type ActionContext } from "../src/actions";
import { buildChart, type ChartTheme } from "../src/chart-options";
import { boxplotStats, chartKeyColumns } from "../core/charts";
import type { Catalog, ChartDefinition, DatasetDefinition, QueryResult } from "../core/types";

const catalog = {
  name: "Test", locale: "en", timezone: "UTC", theme: { name: "excel", corners: { inputs: "none", buttons: "none", panels: "none" } },
  params: {
    period: { label: "Period", type: "range", valueType: "date" },
    client: { label: "Client", type: "string" },
    category: { label: "Category", type: "array" },
  },
  datasets: {},
  dashboards: {
    sales: { label: "Sales", params: ["period", "category"], blocks: [] },
    client360: { label: "Client 360", params: ["period", "client", "category"], drillthrough: { param: "client" }, blocks: [] },
    credit: { label: "Credit", params: ["client"], drillthrough: { param: "client", keepFilters: false }, blocks: [] },
  },
} as unknown as Catalog;
const context = (dashboard = "sales", extra: Partial<ActionContext> = {}): ActionContext => ({
  catalog, dashboardId: dashboard, dashboard: catalog.dashboards[dashboard]!,
  params: { period: { from: "2026-01-01", until: "2026-06-30" }, category: [] }, crossFilters: [],
  location: "/dashboards/sales?category=", ...extra,
});
const clientColumn = { key: "name", label: "Client", param: { name: "client", from: "id" } };
const categoryColumn = { key: "category", label: "Category", param: "category" };

describe("click actions", () => {
  test("drillthrough destinations come from destination dashboards, not datasets", () => {
    expect(drillthroughTargets(context(), "client")).toEqual(["client360", "credit"]);
    // A dashboard is never its own destination.
    expect(drillthroughTargets(context("client360"), "client")).toEqual(["credit"]);
    const restricted = { ...context(), dashboard: { ...catalog.dashboards.sales!, drillthroughTargets: { client: "credit" } } };
    expect(drillthroughTargets(restricted, "client")).toEqual(["credit"]);
    const disabled = { ...context(), dashboard: { ...catalog.dashboards.sales!, drillthroughTargets: { client: false as const } } };
    expect(drillthroughTargets(disabled, "client")).toEqual([]);
    // Unreadable dashboards are absent from the catalog and never offered.
    const hidden = { ...context(), catalog: { ...catalog, dashboards: { sales: catalog.dashboards.sales! } } };
    expect(drillthroughTargets(hidden, "client")).toEqual([]);
  });
  test("drillthrough links carry the value, accepted filters and the origin", () => {
    const href = new URL(drillthroughHref(context(), "client360", "client", "C1"), "http://x");
    expect(href.pathname).toBe("/dashboards/client360");
    expect(href.searchParams.get("client")).toBe("C1");
    expect(href.searchParams.get("period.from")).toBe("2026-01-01");
    expect(href.searchParams.get("_from")).toBe("/dashboards/sales?category=");
    const plain = new URL(drillthroughHref(context(), "credit", "client", "C1"), "http://x");
    expect([...plain.searchParams.keys()]).toEqual(["client", "_from"]);
  });
  test("a value offers cross-filter first, then destinations; selected origins offer clear", () => {
    const row = { id: "C1", name: "Clínica", category: "Food" };
    expect(actionsFor(context(), "b", clientColumn, row, "Clínica").map((a) => a.kind + (a.kind === "open" ? `:${a.dashboard}` : "")))
      .toEqual(["open:client360", "open:credit"]);
    expect(actionsFor(context(), "b", categoryColumn, row, "Food")).toEqual([
      { kind: "filter", param: "category", label: "Category", value: "Food", display: "Food" },
    ]);
    const selected = context("sales", { params: { category: ["Food"] }, crossFilters: [{ block: "b", param: "category" }] });
    expect(actionsFor(selected, "b", categoryColumn, row, "Food")[0]!.kind).toBe("clear");
    // The same value from another block filters again rather than clearing.
    expect(actionsFor(selected, "other", categoryColumn, row, "Food")[0]!.kind).toBe("filter");
    expect(actionsFor(context(), "b", clientColumn, { id: null, name: "?" }, "?")).toEqual([]);
  });
  test("applying a cross-filter replaces the parameter and its origin", () => {
    const first = applyAction({ category: [] }, [], catalog, "chart", { kind: "filter", param: "category", label: "", value: "Food", display: "" });
    expect(first).toEqual({ params: { category: ["Food"] }, crossFilters: [{ block: "chart", param: "category" }] });
    const second = applyAction(first.params, first.crossFilters, catalog, "table", { kind: "filter", param: "category", label: "", value: "Toys", display: "" });
    expect(second).toEqual({ params: { category: ["Toys"] }, crossFilters: [{ block: "table", param: "category" }] });
    expect(applyAction(second.params, second.crossFilters, catalog, "table", { kind: "clear", param: "category", label: "", display: "" }))
      .toEqual({ params: { category: [] }, crossFilters: [] });
  });
  test("a block that originates several cross-filters selects rows matching all of them", () => {
    const columns = [clientColumn, categoryColumn, { key: "units", label: "Units" }];
    const params = { client: "C1", category: ["Food"] };
    const both = [{ block: "table", param: "client" }, { block: "table", param: "category" }];
    const selected = selectionFor(params, both, "table", columns)!;
    expect(selected({ id: "C1", name: "One", category: "Food" })).toBe(true);
    // Matching the first origin alone is not enough.
    expect(selected({ id: "C1", name: "One", category: "Toys" })).toBe(false);
    expect(selected({ id: "C2", name: "Two", category: "Food" })).toBe(false);
    // Origins of other blocks never select rows here.
    const one = selectionFor(params, [{ block: "chart", param: "category" }, { block: "table", param: "client" }], "table", columns)!;
    expect(one({ id: "C1", name: "One", category: "Toys" })).toBe(true);
    expect(selectionFor(params, [{ block: "chart", param: "category" }], "table", columns)).toBeUndefined();
  });
  test("back links accept only same-site dashboard and page paths", () => {
    expect(backLink(catalog, "/dashboards/sales?category=Food")).toEqual({ href: "/dashboards/sales?category=Food", label: "Sales" });
    for (const value of ["https://evil.example/dashboards/sales", "//evil", "/dashboards/missing", "/api/catalog", null])
      expect(backLink(catalog, value)).toBeUndefined();
  });
});

const theme: ChartTheme = {
  palette: ["#111", "#222", "#333"], text: "#000", muted: "#666", border: "#ccc", grid: "#eee",
  surface: "#fff", font: "sans-serif", danger: "#d00", warning: "#c80", success: "#080",
};
const rows = [
  { category: "Food", brand: "A", month: "01", weekday: "Mon", channel: "Online", online: 10, store: 20, units: 3, revenue: 30 },
  { category: "Food", brand: "B", month: "02", weekday: "Tue", channel: "Store", online: 5, store: 15, units: 2, revenue: 20 },
  { category: "Toys", brand: "C", month: "01", weekday: "Tue", channel: "Store", online: 1, store: 2, units: 1, revenue: 3 },
];
const result: QueryResult = { columns: Object.keys(rows[0]!), rows, truncated: false, durationMs: 1 };
const dataset = (chart: ChartDefinition): DatasetDefinition => ({ label: "Chart", query: "q", columns: [], chart });
const build = (chart: ChartDefinition, selected?: (row: Record<string, unknown>) => boolean) =>
  buildChart(dataset(chart), result, "en", theme, selected as never);

describe("chart options", () => {
  test("cartesian: stacked areas, dual axis and legacy shorthands", () => {
    const built = build({ type: "cartesian", x: "category", series: [
      { key: "online", label: "Online", as: "area", stack: "total" },
      { key: "store", label: "Store", as: "bar", stack: "total" },
      { key: "units", label: "Units", axis: "right" },
    ] });
    expect(built.modules.sort()).toEqual(["bar", "line"]);
    const option = built.option as { yAxis: unknown[]; series: Record<string, unknown>[] };
    expect(option.yAxis).toHaveLength(2);
    expect(option.series.map((s) => [s.type, s.stack ?? null, s.yAxisIndex])).toEqual([["line", "total", 0], ["bar", "total", 0], ["line", null, 1]]);
    expect(option.series[0]!.areaStyle).toBeDefined();
    expect(build({ type: "bar", x: "category", series: [{ key: "revenue", label: "R" }] }).modules).toEqual(["bar"]);
  });
  test("horizontal bars swap axes; scatter uses value pairs", () => {
    const horizontal = build({ type: "bar", x: "category", orientation: "horizontal", series: [{ key: "revenue", label: "R" }] }).option as Record<string, { type: string }>;
    expect(horizontal.yAxis!.type).toBe("category");
    expect(horizontal.xAxis!.type).toBe("value");
    const scatter = build({ type: "cartesian", x: "units", xType: "value", series: [{ key: "revenue", label: "R", as: "scatter" }] });
    expect((scatter.option as { series: { data: unknown[] }[] }).series[0]!.data[0]).toEqual([3, 30]);
    expect(scatter.modules).toEqual(["scatter"]);
  });
  test("a cross-filter dims unselected items and clicks recover rows", () => {
    const built = build({ type: "pie", category: "category", value: "revenue", donut: true }, (row) => row.brand === "A");
    const data = (built.option as { series: { data: { itemStyle: { opacity?: number } }[] }[] }).series[0]!.data;
    expect(data.map((d) => d.itemStyle.opacity ?? 1)).toEqual([1, 0.3, 0.3]);
    expect(built.rowAt({ dataIndex: 2 })).toBe(rows[2]);
  });
  test("hierarchies keep partial rows for parent nodes", () => {
    const built = build({ type: "treemap", path: ["category", "brand"], value: "revenue" });
    const roots = (built.option as { series: { data: { name: string; value: number; dashyRow: object; children: { dashyRow: object }[] }[] }[] }).series[0]!.data;
    expect(roots.map((r) => [r.name, r.value])).toEqual([["Food", 50], ["Toys", 3]]);
    expect(built.rowAt({ data: roots[0] })).toEqual({ category: "Food" });
    expect(built.rowAt({ data: roots[0]!.children[1] })).toBe(rows[1]);
  });
  test("heatmap, gauge, radar, sankey, funnel and boxplot", () => {
    const heatmap = build({ type: "heatmap", x: "month", y: "weekday", value: "revenue" });
    expect(heatmap.modules).toEqual(["heatmap", "visualMap"]);
    expect((heatmap.option as { series: { data: unknown[] }[] }).series[0]!.data).toEqual([[0, 0, 30], [1, 1, 20], [0, 1, 3]]);
    const gauge = build({ type: "gauge", value: "revenue", max: 50, bands: [{ until: 25, tone: "danger" }] });
    const axis = (gauge.option as { series: { axisLine: { lineStyle: { color: unknown[] } } }[] }).series[0]!.axisLine.lineStyle.color;
    expect(axis).toEqual([[0.5, "#d00"], [1, "#111"]]);
    const radar = build({ type: "radar", category: "category", series: [{ key: "online", label: "Online" }] });
    expect(radar.rowAt({ dataIndex: 0 })).toBeUndefined();
    const sankey = build({ type: "sankey", source: "channel", target: "category", value: "revenue" });
    expect(sankey.rowAt({ dataType: "node", name: "Store" })).toBe(rows[1]);
    expect(sankey.rowAt({ dataType: "node", name: "Toys" })).toBe(rows[2]);
    expect(build({ type: "funnel", category: "brand", value: "revenue" }).modules).toEqual(["funnel"]);
    const box = build({ type: "boxplot", category: "category", value: "revenue" });
    expect((box.option as { series: { data: unknown[] }[] }).series[0]!.data[0]).toEqual([20, 22.5, 25, 27.5, 30]);
    expect(boxplotStats([1, 2, 3, 4])).toEqual([1, 1.75, 2.5, 3.25, 4]);
  });
  test("charts expose the columns a click identifies", () => {
    expect(chartKeyColumns({ type: "treemap", path: ["category", "brand"], value: "v" })).toEqual(["category", "brand"]);
    expect(chartKeyColumns({ type: "gauge", value: "v" })).toEqual([]);
  });
});
