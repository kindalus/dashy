import { describe, expect, test } from "bun:test";
import { validateChart } from "../core/charts";
import { detectPeriods, forecastSeries, linearFit, minimumPoints, referenceValue } from "../core/series";

const next = (labels: string[], n = 3) => {
  const periods = detectPeriods(labels);
  if ("error" in periods) throw new Error(periods.error);
  return [periods.granularity, periods.next(n)];
};

describe("period detection", () => {
  test("recognises years, months, quarters, days, weeks and monthly dates", () => {
    expect(next(["2019", "2020"])).toEqual(["year", ["2021", "2022", "2023"]]);
    expect(next(["2020-11", "2020-12"])).toEqual(["month", ["2021-01", "2021-02", "2021-03"]]);
    expect(next(["2020-Q3", "2020-Q4"], 2)).toEqual(["quarter", ["2021-Q1", "2021-Q2"]]);
    expect(next(["2024-02-27", "2024-02-28"])).toEqual(["day", ["2024-02-29", "2024-03-01", "2024-03-02"]]);
    expect(next(["2026-01-05", "2026-01-12"], 1)).toEqual(["week", ["2026-01-19"]]);
    expect(next(["2025-11-15", "2025-12-15"], 2)).toEqual(["month", ["2026-01-15", "2026-02-15"]]);
    expect(next(["2025-07-01", "2025-10-01"], 1)).toEqual(["quarter", ["2026-01-01"]]);
    expect(next(["2024-03-01", "2025-03-01"], 1)).toEqual(["year", ["2026-03-01"]]);
    // Years before 1000 keep four digits.
    expect(next(["0998-11", "0998-12"], 1)).toEqual(["month", ["0999-01"]]);
    expect(next(["0005", "0006"], 1)).toEqual(["year", ["0007"]]);
    expect(next(["0099-Q4", "0100-Q1"], 1)).toEqual(["quarter", ["0100-Q2"]]);
  });
  test.each([
    [["2020-01", "2020-03"]],
    [["2020-01", "2020"]],
    [["Jan", "Feb"]],
    [["2020-02-30", "2020-03-01"]],
    [["2020-01-31", "2020-02-29"]],
    [["2020-01-01", "2020-01-03", "2020-01-04"]],
    [["2020"]],
  ])("rejects %o", (labels) => {
    expect("error" in detectPeriods(labels)).toBe(true);
  });
});

describe("statistics", () => {
  test("linear fit and reference values", () => {
    expect(linearFit([0, 1, 2], [1, 3, 5])).toEqual({ slope: 2, intercept: 1 });
    expect(linearFit([1, 1], [1, 2])).toBeUndefined();
    expect(linearFit([1], [1])).toBeUndefined();
    const values = [4, 1, Number.NaN, 3, 2];
    expect(referenceValue("average", values)).toBe(2.5);
    expect(referenceValue("median", values)).toBe(2.5);
    expect(referenceValue("median", [3, 1, 2])).toBe(2);
    expect(referenceValue("min", values)).toBe(1);
    expect(referenceValue("max", values)).toBe(4);
    expect(referenceValue("constant", values, 7)).toBe(7);
    expect(referenceValue("constant", values)).toBeUndefined();
    expect(referenceValue("average", [])).toBeUndefined();
  });
});

describe("forecasts", () => {
  test("linear extends an exact line with a zero-width interval", () => {
    const result = forecastSeries([1, 3, 5, 7], "linear", 2)!;
    expect(result.values).toEqual([9, 11]);
    expect(result.lower).toEqual([9, 11]);
    expect(result.upper).toEqual([9, 11]);
  });
  test("a linear prediction interval stays nearly constant near the data", () => {
    const noisy = [10, 13, 11, 15, 14, 17, 16, 19, 18, 21];
    const result = forecastSeries(noisy, "linear", 6)!;
    const width = (i: number) => result.upper[i]! - result.lower[i]!;
    expect(width(5)).toBeGreaterThan(width(0));
    expect(width(5) / width(0)).toBeLessThan(1.4);
  });
  test("Holt follows a trend and widens the interval with the horizon", () => {
    const series = [10, 12, 13, 15, 16, 18, 19, 21];
    const result = forecastSeries(series, "holt", 3)!;
    expect(result.values[0]).toBeGreaterThan(21);
    expect(result.values[2]).toBeGreaterThan(result.values[0]!);
    const width = (i: number) => result.upper[i]! - result.lower[i]!;
    expect(width(2)).toBeGreaterThan(width(0));
  });
  test("seasonal Holt-Winters repeats the season on top of the trend", () => {
    const season = [5, 1, 3, 7];
    const series = Array.from({ length: 16 }, (_, i) => 100 + 2 * i + season[i % 4]!);
    const result = forecastSeries(series, "seasonal", 4, 4)!;
    const expected = [16, 17, 18, 19].map((i) => 100 + 2 * i + season[i % 4]!);
    result.values.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 0));
  });
  test("short, incomplete or invalid inputs have no forecast", () => {
    expect(minimumPoints("seasonal", 12)).toBe(24);
    expect(forecastSeries([1, 2], "linear", 2)).toBeUndefined();
    expect(forecastSeries([1, 2, 3], "holt", 2)).toBeUndefined();
    expect(forecastSeries([1, 2, 3, 4, 5, 6, 7], "seasonal", 2, 4)).toBeUndefined();
    expect(forecastSeries([1, 2, 3, 4, 5, 6, 7, 8], "seasonal", 2, 1)).toBeUndefined();
    expect(forecastSeries([1, Number.NaN, 3, 4], "linear", 2)).toBeUndefined();
    expect(forecastSeries([1, 2, 3], "linear", 0)).toBeUndefined();
  });
});

describe("series analytics validation", () => {

  const chart = (series: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    validateChart({ type: "cartesian", x: "month", series: [{ key: "value", label: "Value", ...series }], ...extra } as never, ["month", "value"]);
  test("accepts references, trends and forecasts", () => {
    expect(chart({
      reference: [{ kind: "average" }, { kind: "constant", value: 10, label: "Target" }],
      trend: "linear",
      forecast: { periods: 6, method: "seasonal", season: 12 },
    })).toBeUndefined();
    expect(chart({ forecast: { periods: 1 } }, { xType: "time" })).toBeUndefined();
    expect(chart({ trend: "linear" }, { xType: "value" })).toBeUndefined();
  });
  test.each([
    [{ reference: { kind: "average" } }, {}, "reference must be a list of { kind, value?, label? }"],
    [{ reference: [{ kind: "mode" }] }, {}, "reference kind must be average, median, min, max or constant"],
    [{ reference: [{ kind: "constant" }] }, {}, "constant reference requires a finite value"],
    [{ reference: [{ kind: "max", label: "" }] }, {}, "reference label must be a non-empty string"],
    [{ trend: "poly" }, {}, "trend must be linear"],
    [{ reference: [{ kind: "average" }], stack: "s" }, {}, "reference cannot be used on a stacked series"],
    [{ trend: "linear", stack: "s" }, {}, "trend cannot be used on a stacked series"],
    [{ forecast: 6 }, {}, "forecast must be { periods, method?, season? }"],
    [{ forecast: { periods: 0 } }, {}, "forecast periods must be an integer from 1 to 120"],
    [{ forecast: { periods: 3, method: "arima" } }, {}, "forecast method must be linear, holt or seasonal"],
    [{ forecast: { periods: 3, method: "seasonal" } }, {}, "seasonal forecast requires a season of 2 to 366 periods"],
    [{ forecast: { periods: 3, season: 12 } }, {}, "forecast season applies only to the seasonal method"],
    [{ forecast: { periods: 3 }, stack: "s" }, {}, "forecast cannot be used on a stacked series"],
    [{ forecast: { periods: 3 } }, { orientation: "horizontal" }, "forecast requires a vertical chart"],
    [{ forecast: { periods: 3 } }, { xType: "value" }, "forecast requires a category or time x axis of dates"],
  ])("rejects %o", (series, extra, message) => {
    expect(chart(series, extra)).toBe(`series value ${message}`);
  });
});
