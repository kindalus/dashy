import { describe, expect, test } from "bun:test";
import { buildChart, type ChartTheme } from "../src/chart-options";
import type { CartesianSeries, DatasetDefinition, QueryResult, Row } from "../core/types";

const theme: ChartTheme = {
  palette: ["#111", "#222", "#333"], text: "#000", muted: "#666", border: "#ccc", grid: "#eee",
  surface: "#fff", font: "sans-serif", danger: "#d00", warning: "#c80", success: "#080",
};
const months = ["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06"];
const rows: Row[] = months.map((month, i) => ({ month, revenue: 10 + 2 * i, orders: 5 }));
const result = (list: Row[] = rows): QueryResult => ({ columns: ["month", "revenue", "orders"], rows: list, truncated: false, durationMs: 1 });
const build = (series: Partial<CartesianSeries>, extra: Record<string, unknown> = {}, list = rows) => {
  const definition = {
    label: "Revenue", query: "q", columns: [{ key: "month", label: "Month" }, { key: "revenue", label: "Revenue" }],
    chart: { type: "cartesian", x: "month", series: [{ key: "revenue", label: "Revenue", ...series }], ...extra },
  } as DatasetDefinition;
  return buildChart(definition, result(list), "en", theme);
};
type Series = { name: string; data: unknown[]; markLine?: { data: Record<string, unknown>[] }; stack?: string; tooltip?: { show?: boolean } };
const seriesOf = (built: ReturnType<typeof build>) => built.option.series as Series[];

describe("reference lines", () => {
  test("mark the series statistic or a constant, with formatted labels, loading the markLine module", () => {
    const built = build({ reference: [{ kind: "average" }, { kind: "max", label: "Peak" }, { kind: "constant", value: 30 }] });
    const lines = seriesOf(built)[0]!.markLine!.data;
    expect(lines.map((l) => [l.name, l.yAxis])).toEqual([["Average", 15], ["Peak", 20], ["Target", 30]]);
    expect((lines[0]!.label as { formatter: string }).formatter).toBe("Average: 15");
    expect(built.modules).toContain("markLine");
    expect(build({}).modules).not.toContain("markLine");
  });
  test("horizontal charts mark the value (x) axis", () => {
    const built = build({ reference: [{ kind: "min" }] }, { orientation: "horizontal" });
    expect(seriesOf(built)[0]!.markLine!.data[0]).toMatchObject({ xAxis: 10 });
  });
});

describe("trend", () => {
  test("adds a dashed least-squares series that clicks never select", () => {
    const built = build({ trend: "linear" });
    const series = seriesOf(built);
    expect(series.map((s) => s.name)).toEqual(["Revenue", "Revenue trend"]);
    expect(series[1]!.data).toEqual([10, 12, 14, 16, 18, 20]);
    expect(built.rowAt({ seriesIndex: 1, dataIndex: 2 })).toBeUndefined();
    expect(built.rowAt({ seriesIndex: 0, dataIndex: 2 })).toBe(rows[2]);
    expect((built.option.legend as { show: boolean }).show).toBe(true);
  });
  test("value axes fit against the x values", () => {
    const points = [{ month: 1, revenue: 3 }, { month: 3, revenue: 7 }, { month: 2, revenue: 5 }] as unknown as Row[];
    const series = seriesOf(build({ trend: "linear", as: "scatter" }, { xType: "value" }, points));
    expect(series[1]!.data).toEqual([[1, 3], [3, 7], [2, 5]]);
  });
});

describe("forecast", () => {
  test("extends the category axis and continues from the last actual value with an interval band", () => {
    const built = build({ forecast: { periods: 2 } });
    expect((built.option.xAxis as { data: string[] }).data.slice(-3)).toEqual(["2025-06", "2025-07", "2025-08"]);
    const [, line, lower, band] = seriesOf(built);
    expect(line!.name).toBe("Revenue forecast");
    // Points are placed by label, with no placeholders for past periods.
    expect(line!.data).toEqual([["2025-06", 20], ["2025-07", 22], ["2025-08", 24]]);
    // An exact line has a zero-width band; both band series share a stack and hide from tooltips.
    expect(lower!.data).toEqual([["2025-06", 20], ["2025-07", 22], ["2025-08", 24]]);
    expect(band!.data).toEqual([["2025-06", 0], ["2025-07", 0], ["2025-08", 0]]);
    expect(lower!.stack).toBe(band!.stack);
    expect(band!.tooltip?.show).toBe(false);
    expect(built.notes).toEqual([]);
  });
  test("time axes use [date, value] pairs", () => {
    const built = build({ forecast: { periods: 1 } }, { xType: "time" });
    const line = seriesOf(built)[1]!;
    expect(line.data).toEqual([["2025-06", 20], ["2025-07", 22]]);
  });
  test("explains why a forecast cannot be drawn", () => {
    const gaps = rows.filter((_, i) => i !== 2);
    expect(build({ forecast: { periods: 2 } }, {}, gaps).notes).toEqual([
      "Forecast unavailable: periods must be evenly spaced dates (YYYY, YYYY-MM, YYYY-Qn or YYYY-MM-DD).",
    ]);
    const missing = rows.map((row, i) => (i === 1 ? { ...row, revenue: null } : row));
    expect(build({ forecast: { periods: 2 } }, {}, missing).notes).toEqual(["Revenue forecast unavailable: every period needs a value."]);
    expect(build({ forecast: { periods: 2, method: "seasonal", season: 12 } }).notes)
      .toEqual(["Revenue forecast unavailable: needs at least 24 periods."]);
    expect(seriesOf(build({ forecast: { periods: 2 } }, {}, gaps))).toHaveLength(1);
    // A forecast that cannot be drawn adds no empty future periods to the axis.
    expect((build({ forecast: { periods: 2 } }, {}, missing).option.xAxis as { data: string[] }).data).toEqual(months);
  });
});

describe("forecast floor", () => {
  test("a non-negative series is never projected below zero", () => {
    const falling = months.map((month, i) => ({ month, revenue: 50 - 10 * i, orders: 1 }));
    const [, line, lower, band] = seriesOf(build({ forecast: { periods: 3 } }, {}, falling));
    const value = (data: unknown[]) => data.slice(-3).map((point) => (point as [string, number])[1]);
    expect(value(line!.data)).toEqual([0, 0, 0]);
    expect(value(lower!.data)).toEqual([0, 0, 0]);
    expect(value(band!.data)).toEqual([0, 0, 0]);
    const signed = months.map((month, i) => ({ month, revenue: 10 - 10 * i, orders: 1 }));
    expect(seriesOf(build({ forecast: { periods: 1 } }, {}, signed))[1]!.data.at(-1)).toEqual(["2025-07", -50]);
  });
  test("Top N's Other row is not a data point for references or trends", async () => {
    const { applyTopN } = await import("../core/tables");
    const definition = {
      label: "Brands", query: "q", columns: [{ key: "month", label: "Brand" }, { key: "revenue", label: "Revenue", aggregate: "sum" }],
      chart: { type: "bar", x: "month", series: [{ key: "revenue", label: "Revenue", reference: [{ kind: "average" }, { kind: "min" }] }] },
      topN: { by: "revenue", other: true },
    } as DatasetDefinition;
    const list = [10, 9, 1, 1, 1, 1].map((revenue, i) => ({ month: `B${i}`, revenue }));
    const shown = applyTopN(list, definition, 2, true).rows as Row[];
    const lines = (buildChart(definition, result(shown), "en", theme).option.series as Series[])[0]!.markLine!.data;
    expect(lines.map((l) => l.yAxis)).toEqual([9.5, 9]);
  });
});
