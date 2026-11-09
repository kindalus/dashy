import { describe, expect, test } from "bun:test";
import { compareMetric, sparklinePaths, targetProgress } from "../src/metric-compare";
import type { MetricDefinition } from "../core/types";

const metric = (extra: Partial<MetricDefinition> = {}): MetricDefinition => ({
  label: "Revenue", query: "q", column: "revenue", format: { style: "currency", currency: "USD", decimals: 0 }, ...extra,
});

describe("comparison", () => {
  test("percent change with sign, direction and tone", () => {
    const up = compareMetric(metric({ compare: { column: "previous" } }), 112.3, "100", "en")!;
    expect(up).toEqual({ change: "+12.3%", label: "vs previous", direction: "up", tone: "good", description: "Up 12.3% vs previous" });
    const down = compareMetric(metric({ compare: { column: "previous", label: "vs 2025" } }), 80, 100, "en")!;
    expect(down).toMatchObject({ change: "−20.0%", direction: "down", tone: "bad", description: "Down 20.0% vs 2025" });
  });
  test("lower is better flips the tone; delta uses the metric format", () => {
    expect(compareMetric(metric({ compare: { column: "p", better: "lower" } }), 80, 100, "en")!.tone).toBe("good");
    expect(compareMetric(metric({ compare: { column: "p", as: "delta" } }), 1300, 100, "en")!.change).toBe("+$1,200");
    expect(compareMetric(metric({ compare: { column: "p", as: "delta" } }), -50, 100, "en")!.change).toBe("−$150");
  });
  test("changes that display as zero are unchanged; missing or zero bases have no comparison", () => {
    expect(compareMetric(metric({ compare: { column: "p" } }), 100.01, 100, "en")).toMatchObject({ change: "0.0%", direction: "flat", tone: "neutral" });
    expect(compareMetric(metric({ compare: { column: "p" } }), 5, 0, "en")).toBeUndefined();
    expect(compareMetric(metric({ compare: { column: "p", as: "delta" } }), 5, 0, "en")!.change).toBe("+$5");
    expect(compareMetric(metric({ compare: { column: "p" } }), null, 10, "en")).toBeUndefined();
    // Locales with other digits still see the direction.
    expect(compareMetric(metric({ compare: { column: "p" } }), 120, 100, "ar-EG")).toMatchObject({ direction: "up", tone: "good" });
    // A difference of percentages is in points.
    const margin = metric({ format: { style: "percent" }, compare: { column: "p", as: "delta" } });
    expect(compareMetric(margin, 0.65, 0.6, "en")!.change).toBe("+5.0 pp");
    expect(compareMetric(margin, 0.6, 0.6004, "en")).toMatchObject({ direction: "flat", change: "0.0 pp" });
    expect(compareMetric(metric({ compare: { column: "p" } }), 10, null, "en")).toBeUndefined();
    expect(compareMetric(metric(), 10, 5, "en")).toBeUndefined();
  });
});

describe("target", () => {
  test("progress against a column or constant, clamped for the bar", () => {
    expect(targetProgress(metric({ target: { value: 200 } }), 150, undefined, "en"))
      .toEqual({ label: "Target", target: "$200", ratio: 0.75, percent: "75%" });
    expect(targetProgress(metric({ target: { column: "goal", label: "Budget" } }), 300, "200", "en"))
      .toEqual({ label: "Budget", target: "$200", ratio: 1, percent: "150%" });
    expect(targetProgress(metric({ target: { column: "goal" } }), 300, null, "en")).toBeUndefined();
    expect(targetProgress(metric({ target: { value: 0 } }), 300, undefined, "en")).toBeUndefined();
  });
});

describe("sparkline", () => {
  test("scales points into the box and splits at gaps", () => {
    expect(sparklinePaths([0, 10], 104, 24)).toEqual(["2.0,22.0 102.0,2.0"]);
    expect(sparklinePaths([1, 2, null, 3, 4], 10, 10, 0)).toEqual(["0.0,10.0 2.5,6.7", "7.5,3.3 10.0,0.0"]);
    expect(sparklinePaths([5, 5], 10, 10, 0)).toEqual(["0.0,10.0 10.0,10.0"]);
    expect(sparklinePaths([1], 10, 10)).toEqual([]);
    // Isolated points between gaps become dots (zero-length segments).
    expect(sparklinePaths([1, null, 2, null, 3, 4], 10, 10, 0)).toEqual(["0.0,10.0 0.0,10.0", "4.0,6.7 4.0,6.7", "8.0,3.3 10.0,0.0"]);
  });
});

describe("metric blocks", async () => {
  const { DashyEngine } = await import("../core/engine");
  const { mountRows } = await import("../core/sources");
  const sales = [
    { day: "2026-01-10", amount: 10 }, { day: "2026-02-05", amount: 20 },
    { day: "2026-02-20", amount: 30 }, { day: "2026-03-03", amount: 40 },
  ];
  const engine = new DashyEngine({
    name: "Metrics",
    params: { period: { label: "Period", type: "range", valueType: "date" } },
    sources: { sales: { type: "memory", path: "" } },
    queries: {
      summary: { label: "Summary", sources: ["sales"], params: ["period"], build: ({ source, params, sql }) => {
        const period = params.period as { from: string; until: string } | undefined;
        const previous = sql.previousRange(period);
        const current = sql.where(sql.range("CAST(day AS DATE)", period));
        const prior = previous ? sql.where(sql.range("CAST(day AS DATE)", previous)) : sql.fragment("WHERE FALSE");
        return {
          text: `SELECT (SELECT SUM(amount) FROM ${source("sales")} ${current.text}) AS amount,
            (SELECT SUM(amount) FROM ${source("sales")} ${prior.text}) AS previous, 100 AS goal`,
          values: [...current.values, ...prior.values],
        };
      } },
      daily: { label: "Daily", sources: ["sales"], params: ["period"], build: ({ source, params, sql }) => {
        const w = sql.where(sql.range("CAST(day AS DATE)", params.period as { from: string; until: string } | undefined));
        return { text: `SELECT day, amount FROM ${source("sales")} ${w.text} ORDER BY day`, values: w.values };
      } },
    },
    metrics: {
      amount: {
        label: "Amount", query: "summary", column: "amount",
        compare: { column: "previous" }, target: { column: "goal" }, sparkline: { dataset: "daily", value: "amount" },
      },
      plain: { label: "Plain", query: "summary", column: "amount" },
    },
    datasets: {
      daily: { label: "Daily", query: "daily", columns: [{ key: "day", label: "Day" }, { key: "amount", label: "Amount" }] },
      hidden: { label: "Hidden", query: "daily", roles: ["admin"], columns: [{ key: "amount", label: "Amount" }] },
    },
    dashboards: {
      overview: { label: "Overview", params: ["period"], blocks: [
        { id: "amount", type: "metric", metric: "amount" }, { id: "plain", type: "metric", metric: "plain" },
      ] },
    },
  }, { memory: async ({ connection, name }) => mountRows(connection, name, sales, ["day", "amount"]) });

  test("carry the comparison, target and sparkline from the same filters", async () => {
    const result = await engine.dashboard("overview", { period: { from: "2026-02-01", until: "2026-02-28" } });
    const amount = result.blocks.find((b) => b.id === "amount")!;
    expect(amount).toMatchObject({ type: "metric", value: 50, compare: 10, target: 100, sparkline: [20, 30] });
    const plain = result.blocks.find((b) => b.id === "plain")!;
    expect(plain).toEqual({ id: "plain", type: "metric", definition: engine.project.metrics.plain!, value: 50 });
    // The plain metric API keeps its shape.
    expect(await engine.metric("amount", { period: { from: "2026-02-01", until: "2026-02-28" } })).toBe(50);
  });
  test("a failing sparkline is left out, and it ignores the block's unfiltered parameters", async () => {
    const broken = new DashyEngine({
      ...engine.project,
      datasets: { ...engine.project.datasets, daily: { ...engine.project.datasets.daily!, columns: [{ key: "missing", label: "M" }] } },
      metrics: { amount: { ...engine.project.metrics.amount!, sparkline: { dataset: "daily", value: "missing" } } },
      dashboards: { overview: { label: "Overview", params: ["period"], blocks: [{ id: "amount", type: "metric", metric: "amount" }] } },
    }, { memory: async ({ connection, name }) => mountRows(connection, name, sales, ["day", "amount"]) });
    const [failed] = (await broken.dashboard("overview")).blocks;
    expect(failed).toMatchObject({ type: "metric", value: 100 });
    expect(failed && "sparkline" in failed).toBe(false);
    const unfiltered = new DashyEngine({
      ...engine.project,
      queries: { ...engine.project.queries, total: { label: "Total", sources: ["sales"], build: ({ source }) => ({ text: `SELECT SUM(amount) AS amount FROM ${source("sales")}`, values: [] }) } },
      metrics: { amount: { label: "Amount", query: "total", column: "amount", sparkline: { dataset: "daily", value: "amount" } } },
      dashboards: { overview: { label: "Overview", params: ["period"], unfiltered: { amount: ["period"] }, blocks: [{ id: "amount", type: "metric", metric: "amount" }] } },
    }, { memory: async ({ connection, name }) => mountRows(connection, name, sales, ["day", "amount"]) });
    const [block] = (await unfiltered.dashboard("overview", { period: { from: "2026-02-01", until: "2026-02-28" } })).blocks;
    // The card says "Not filtered by Period", so its sparkline covers every day too.
    expect(block).toMatchObject({ type: "metric", value: 100, sparkline: [10, 20, 30, 40] });
  });
  test("an unreadable sparkline dataset is left out rather than failing the metric", async () => {
    const locked = new DashyEngine({
      ...engine.project,
      metrics: { amount: { ...engine.project.metrics.amount!, sparkline: { dataset: "hidden", value: "amount" } } },
      dashboards: { overview: { label: "Overview", params: ["period"], blocks: [{ id: "amount", type: "metric", metric: "amount" }] } },
    }, { memory: async ({ connection, name }) => mountRows(connection, name, sales, ["day", "amount"]) });
    const [block] = (await locked.dashboard("overview")).blocks;
    expect(block).toMatchObject({ type: "metric", value: 100 });
    expect(block && "sparkline" in block).toBe(false);
  });
});
