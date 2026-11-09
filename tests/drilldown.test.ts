import { describe, expect, test } from "bun:test";
import { DashyEngine } from "../core/engine";
import { createApiHandler } from "../core/http";
import { mountRows } from "../core/sources";
import { defineProject } from "../core/project";
import {
  appendDrilldowns, describeDrilldown, drillInputs, levelDefinition, levelLabel, periodRange, readDrilldowns,
} from "../core/drilldown";
import { drillAction, drillColumn, drillDown, drillTo } from "../src/actions";
import { formatPeriod } from "../src/format";
import type { DatasetDefinition, ProjectDefinition } from "../core/types";

const sales = [
  { day: "2023-11-02", category: "Food", brand: "Acme", amount: 4 },
  { day: "2024-02-10", category: "Food", brand: "Acme", amount: 10 },
  { day: "2024-02-20", category: "Food", brand: "Bolt", amount: 5 },
  { day: "2024-07-01", category: "Toys", brand: "Cubo", amount: 7 },
  { day: "2024-08-15", category: "Toys", brand: "Cubo", amount: 3 },
];
type Sql = typeof import("../core/sql").sql;
const where = (params: Record<string, unknown>, sql: Sql) => sql.where(
  sql.range("day", params.period as { from: string; until: string } | undefined),
  sql.in("category", (params.category as string[] | undefined) ?? []),
  sql.eq("brand", params.brand as string | undefined),
);
const accepts = ["period", "category", "brand"];
function project(): ProjectDefinition {
  return {
    name: "Drill",
    params: {
      period: { label: "Period", type: "range", valueType: "date" },
      category: { label: "Category", type: "array" },
      brand: { label: "Brand", type: "string" },
      grain: { label: "Granularity", type: "select", options: ["year", "quarter", "month", "day"].map((value) => ({ label: value, value })) },
    },
    sources: { sales: { type: "memory", path: "" } },
    queries: {
      by_category: { label: "By category", sources: ["sales"], params: accepts, build: ({ source, params, sql }) => {
        const w = where(params, sql);
        return { text: `SELECT category, SUM(amount) AS amount FROM ${source("sales")} ${w.text} GROUP BY 1 ORDER BY 1`, values: w.values };
      } },
      by_brand: { label: "By brand", sources: ["sales"], params: accepts, build: ({ source, params, sql }) => {
        const w = where(params, sql);
        return { text: `SELECT brand, SUM(amount) AS amount FROM ${source("sales")} ${w.text} GROUP BY 1 ORDER BY 1`, values: w.values };
      } },
      by_period: { label: "By period", sources: ["sales"], params: [...accepts, "grain"], build: ({ source, params, sql }) => {
        const w = where(params, sql);
        return {
          text: `SELECT CAST(date_trunc(?, day) AS DATE) AS period, SUM(amount) AS amount FROM ${source("sales")} ${w.text} GROUP BY 1 ORDER BY 1`,
          values: [(params.grain as string | undefined) ?? "month", ...w.values],
        };
      } },
    },
    metrics: {},
    datasets: {
      categories: {
        label: "Sales", query: "by_category",
        columns: [{ key: "category", label: "Category" }, { key: "amount", label: "Amount" }],
        chart: { type: "bar", x: "category", series: [{ key: "amount", label: "Amount" }] },
        drilldown: [
          { column: "category", param: "category" },
          {
            query: "by_brand", column: "brand", label: "Brand",
            columns: [{ key: "brand", label: "Brand" }, { key: "amount", label: "Amount" }],
            chart: { type: "bar", x: "brand", series: [{ key: "amount", label: "Amount" }] },
          },
        ],
      },
      periods: {
        label: "Over time", query: "by_period",
        columns: [{ key: "period", label: "Period" }, { key: "amount", label: "Amount" }],
        chart: { type: "bar", x: "period", series: [{ key: "amount", label: "Amount" }] },
        drilldown: [
          { column: "period", label: "Year", range: "period", grain: "year", set: { grain: "year" } },
          { column: "period", label: "Month", range: "period", grain: "month", set: { grain: "month" } },
          { column: "period", label: "Day", grain: "day", set: { grain: "day" } },
        ],
      },
    },
    dashboards: {
      sales: {
        label: "Sales", params: ["period"],
        defaults: { period: { from: "2024-01-01", until: "2024-12-31" } },
        blocks: [
          { id: "mix", type: "dataset", dataset: "categories" },
          { id: "mix2", type: "dataset", dataset: "categories" },
          { id: "time", type: "dataset", dataset: "periods" },
        ],
      },
    },
  };
}
const engine = new DashyEngine(project(), {
  memory: async ({ connection, name }) => mountRows(connection, name, sales, Object.keys(sales[0]!), { day: "DATE" }),
});
const api = createApiHandler(engine);
const dataset = (name: string) => project().datasets[name]!;

describe("periods and paths", () => {
  test("a period starts at its value and never spills into the next", () => {
    expect(periodRange("2024-01-01", "year")).toEqual({ from: "2024-01-01", until: "2024-12-31" });
    expect(periodRange("2024", "year")).toEqual({ from: "2024-01-01", until: "2024-12-31" });
    expect(periodRange("2024-05-17", "quarter")).toEqual({ from: "2024-04-01", until: "2024-06-30" });
    expect(periodRange("2024-02-01", "month")).toEqual({ from: "2024-02-01", until: "2024-02-29" });
    expect(periodRange("2024-02-01T00:00:00", "day")).toEqual({ from: "2024-02-01", until: "2024-02-01" });
    for (const [value, grain] of [["2024", "month"], ["2024-13", "month"], ["2024-02-30", "day"], ["abc", "year"], ["2024-02", "day"]] as const)
      expect(periodRange(value, grain)).toBeUndefined();
  });
  test("paths travel as ordered _dd keys and ignore malformed entries", () => {
    const search = new URLSearchParams("_dd=time:2024-01-01&_dd=mix:Food&_dd=time:2024-02-01&_dd=bad&_dd=:x&_dd=mix:a:b");
    expect(readDrilldowns(search)).toEqual({ time: ["2024-01-01", "2024-02-01"], mix: ["Food", "a:b"] });
    const out = new URLSearchParams();
    appendDrilldowns(out, { mix: ["Food"], time: ["2024-01-01"] });
    expect(out.toString()).toBe("_dd=mix%3AFood&_dd=time%3A2024-01-01");
  });
  test("deeper levels receive parameters, and periods intersect the dashboard range", () => {
    const definitions = project().params;
    expect(drillInputs(dataset("categories"), ["Food"], {}, definitions)).toEqual({ category: ["Food"] });
    const period = { from: "2024-03-15", until: "2024-12-31" };
    // The year 2024 inside a dashboard range that starts in March keeps March 15.
    expect(drillInputs(dataset("periods"), ["2024-01-01"], { period }, definitions))
      .toEqual({ period: { from: "2024-03-15", until: "2024-12-31" }, grain: "month" });
    expect(drillInputs(dataset("periods"), ["2024-01-01", "2024-07-01"], { period }, definitions))
      .toEqual({ period: { from: "2024-07-01", until: "2024-07-31" }, grain: "day" });
    expect(() => drillInputs(dataset("periods"), ["2023-01-01"], { period }, definitions)).toThrow("outside the Period filter");
    expect(() => drillInputs(dataset("periods"), ["soon"], {}, definitions)).toThrow("Invalid Year period");
    expect(() => drillInputs(dataset("periods"), ["2024", "2024-01", "2024-01-02"], {}, definitions)).toThrow("Too many drill-down levels");
  });
  test("each level shows its own columns, chart and period format, with named levels", () => {
    const brand = levelDefinition(dataset("categories"), 1);
    expect(brand.query).toBe("by_brand");
    expect(brand.columns.map((c) => c.key)).toEqual(["brand", "amount"]);
    expect(brand.drilldown!.map((level) => level.label)).toEqual(["Category", "Brand"]);
    expect(levelDefinition(dataset("periods"), 1).columns[0]!.format).toEqual({ style: "date", grain: "month" });
    expect(levelLabel(dataset("categories"), 0)).toBe("Category");
    expect(describeDrilldown(dataset("periods"), ["2024-01-01", "2024-07-01"], (v, d) => formatPeriod(v, d ? "month" : "year", "en")))
      .toBe("Year: 2024 › Month: Jul 2024");
    expect([formatPeriod("2024-05-01", "quarter", "en"), formatPeriod("2024-05-01", "quarter", "pt-AO")]).toEqual(["Q2 2024", "T2 2024"]);
  });
  test("browser actions drill one level down and back up", () => {
    const top = levelDefinition(dataset("categories"), 0);
    expect(drillColumn(top, 0)).toBe("category");
    expect(drillColumn(levelDefinition(dataset("categories"), 1), 1)).toBeUndefined();
    expect(drillAction(top, 0, { category: "Food", amount: 3 }, String)).toEqual({ kind: "drill", label: "Brand", value: "Food", display: "Food" });
    expect(drillAction(top, 0, { category: null, amount: 3 }, String)).toBeUndefined();
    const paths = drillDown(drillDown({}, "time", "2024-01-01"), "time", "2024-07-01");
    expect(paths).toEqual({ time: ["2024-01-01", "2024-07-01"] });
    expect(drillTo(paths, "time", 1)).toEqual({ time: ["2024-01-01"] });
    expect(drillTo(paths, "time", 0)).toEqual({});
  });
});

describe("validation", () => {
  const broken = (change: (p: ProjectDefinition) => void) => {
    const p = project();
    change(p);
    return () => defineProject(p);
  };
  const levels = (p: ProjectDefinition, name: string) => p.datasets[name]!.drilldown as DatasetDefinition["drilldown"] & object[];
  test("levels are checked at startup", () => {
    expect(broken((p) => { p.datasets.categories!.drilldown = [levels(p, "categories")[0]!]; })).toThrow("at least two levels");
    expect(broken((p) => { (levels(p, "categories")[1] as { column: string }).column = "missing"; })).toThrow("column missing is not one of its columns");
    expect(broken((p) => { delete (levels(p, "categories")[0] as { param?: string }).param; })).toThrow("needs a param or range");
    expect(broken((p) => { (levels(p, "categories")[1] as { param?: string }).param = "brand"; })).toThrow("last level");
    expect(broken((p) => { (levels(p, "periods")[0] as { grain?: string }).grain = undefined; })).toThrow("range requires a grain");
    expect(broken((p) => { (levels(p, "periods")[0] as { range?: string }).range = "brand"; })).toThrow("must be a date range parameter");
    expect(broken((p) => { (levels(p, "categories")[0] as { param?: string }).param = "period"; })).toThrow("is a range");
    expect(broken((p) => { (levels(p, "periods")[0] as { set?: object }).set = { grain: "week" }; })).toThrow("Invalid option for grain");
    expect(broken((p) => { (levels(p, "categories")[1] as { chart?: object }).chart = { type: "bar", x: "category", series: [{ key: "amount", label: "A" }] }; }))
      .toThrow("drilldown level 2 has unknown x column category");
    // Every deeper query must accept what an upper level passes down.
    expect(broken((p) => { p.queries.by_brand!.params = ["period", "brand"]; })).toThrow("level 2 query by_brand does not accept it");
  });
  test("dashboard filters must reach every level, and set parameters stay private", () => {
    expect(broken((p) => { p.queries.by_brand!.params = ["category", "brand"]; p.dashboards.sales!.unfiltered = {}; }))
      .toThrow("query by_brand does not accept dashboard parameter period");
    expect(broken((p) => {
      p.dashboards.sales!.params = ["period", "grain"];
      p.dashboards.sales!.blocks = [{ id: "time", type: "dataset", dataset: "periods" }];
    })).toThrow("drill-down sets grain");
  });
});

describe("engine and API", () => {
  test("the shell keeps valid paths, trims extra levels and separates drilled requests", () => {
    const shell = engine.dashboardShell("sales", {}, undefined, {
      drilldowns: { mix: ["Food", "Acme", "too-deep"], time: ["2024-01-01"], ghost: ["x"] },
    });
    expect(shell.drilldowns).toEqual({ mix: ["Food"], time: ["2024-01-01"] });
    // mix2 stays at the top level, so it no longer shares mix's request.
    expect(shell.requests.map((r) => r.blockIds)).toEqual([["mix"], ["mix2"], ["time"]]);
    expect(engine.dashboardShell("sales").requests.map((r) => r.blockIds)).toEqual([["mix", "mix2"], ["time"]]);
  });
  test("categorical levels filter the next query", async () => {
    const { blocks } = await engine.dashboard("sales", {}, undefined, undefined, { drilldowns: { mix: ["Food"] } });
    const mix = blocks.find((b) => b.id === "mix")!;
    expect(mix.type === "dataset" && mix.definition.columns.map((c) => c.key)).toEqual(["brand", "amount"]);
    expect(mix.type === "dataset" && mix.result.rows).toEqual([{ brand: "Acme", amount: 10 }, { brand: "Bolt", amount: 5 }]);
    const mix2 = blocks.find((b) => b.id === "mix2")!;
    expect(mix2.type === "dataset" && mix2.result.rows).toEqual([{ category: "Food", amount: 15 }, { category: "Toys", amount: 10 }]);
  });
  test("date levels narrow the range and change the grain, inside the dashboard filter", async () => {
    const top = await engine.dashboard("sales");
    const years = top.blocks.find((b) => b.id === "time")!;
    // The dashboard default is 2024, so November 2023 never appears.
    expect(years.type === "dataset" && years.result.rows).toEqual([{ period: "2024-01-01", amount: 25 }]);
    const months = await engine.dashboard("sales", {}, undefined, undefined, { drilldowns: { time: ["2024-01-01"] } });
    const monthBlock = months.blocks.find((b) => b.id === "time")!;
    expect(monthBlock.type === "dataset" && monthBlock.result.rows.map((r) => r.period)).toEqual(["2024-02-01", "2024-07-01", "2024-08-01"]);
    const days = await engine.dashboard("sales", {}, undefined, undefined, { drilldowns: { time: ["2024-01-01", "2024-02-01"] } });
    const dayBlock = days.blocks.find((b) => b.id === "time")!;
    expect(dayBlock.type === "dataset" && dayBlock.result.rows).toEqual([{ period: "2024-02-10", amount: 10 }, { period: "2024-02-20", amount: 5 }]);
    // A period outside the dashboard filter is an error for that block only.
    const outside = await engine.dashboard("sales", {}, undefined, undefined, { drilldowns: { time: ["2023-01-01"] } });
    expect(outside.blocks.find((b) => b.id === "time")).toMatchObject({ type: "error", message: "2023-01-01 is outside the Period filter" });
    expect(outside.blocks.find((b) => b.id === "mix")!.type).toBe("dataset");
  });
  test("HTTP reads _dd for shells, data and exports", async () => {
    const shell = await (await api(new Request("http://x/api/dashboard-shell/sales?_dd=mix:Toys"))).json();
    expect(shell.drilldowns).toEqual({ mix: ["Toys"] });
    const group = shell.requests.find((r: { blockIds: string[] }) => r.blockIds.includes("mix")).id;
    const data = await (await api(new Request(`http://x/api/dashboard-data/sales/${group}?_dd=mix:Toys`))).json();
    expect(data.blocks[0].result.rows).toEqual([{ brand: "Cubo", amount: 10 }]);
    const csv = await (await api(new Request("http://x/api/dashboard-export/sales/mix?_dd=mix:Toys"))).text();
    expect(csv.replace(/^﻿/, "").trim().split(/\r?\n/)).toEqual(["Brand,Amount", "Cubo,10"]);
    const xlsx = await api(new Request("http://x/api/dashboard-export/sales/mix?_dd=mix:Toys&_format=xlsx"));
    expect(xlsx.status).toBe(200);
  });
});
