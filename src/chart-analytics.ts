/**
 * Reference lines, trends and forecasts for cartesian charts, as extra ECharts
 * series and mark lines. Pure: no DOM and no echarts import.
 */
import type { CartesianSeries, Format, ReferenceLine, Row, Scalar } from "../core/types";
import { detectPeriods, forecastSeries, linearFit, minimumPoints, referenceValue } from "../core/series";
import { formatValue } from "./format";
import { messages, textFor, type Messages } from "../core/i18n";

export interface AnalyticsInput {
  rows: readonly Row[];
  x: string;
  xType: "category" | "time" | "value";
  horizontal: boolean;
  series: readonly CartesianSeries[];
  colors: readonly string[];
  /** yAxisIndex per series when the chart has a right axis. */
  axisIndex: (series: CartesianSeries) => number | undefined;
  locale: string;
  muted: string;
}
export interface AnalyticsOutput {
  /** Mark lines to merge into each real series, by index. */
  markLines: (Record<string, unknown> | undefined)[];
  /** Derived series appended after the real ones; clicks on them select nothing. */
  extra: Record<string, unknown>[];
  /** Future x labels appended to a category axis. */
  future: string[];
  /** Explanations shown under the chart when an analysis cannot be drawn. */
  notes: string[];
}

const toNumber = (value: Scalar | undefined) =>
  value === null || value === undefined || value === "" ? null : Number(value);
const text = (value: Scalar | undefined) => (value === null || value === undefined ? "" : String(value));
const defaultLabel = (line: ReferenceLine, t: Messages) =>
  line.label ?? (line.kind === "constant" ? t.target : t[line.kind]);

export function buildAnalytics(input: AnalyticsInput): AnalyticsOutput {
  const { rows, x, xType, series } = input;
  const labels = rows.map((row) => text(row[x]));
  const format = (value: number, f?: Format) => formatValue(value, f, input.locale);
  const output: AnalyticsOutput = { markLines: [], extra: [], future: [], notes: [] };
  const t = textFor(input.locale);
  const periods = series.some((s) => s.forecast) ? detectPeriods(labels) : undefined;
  // detectPeriods explains in English; show its two reasons in the interface language.
  const reason = (error: string) =>
    error === messages.en.periodsTooFew ? t.periodsTooFew : error === messages.en.periodsIrregular ? t.periodsIrregular : error;
  if (periods && "error" in periods) output.notes.push(t.forecastUnavailable(reason(periods.error)));
  // Category axes index points by position; time and value axes need [x, y] pairs.
  const point = (index: number, value: number | null, label = labels[index]!) =>
    xType === "category" ? value : [xType === "value" ? toNumber(rows[index]?.[x]) : label, value];

  series.forEach((s, index) => {
    const color = input.colors[index]!;
    const values = rows.map((row) => toNumber(row[s.key]));
    const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
    const axis = input.axisIndex(s);
    const common = { ...(axis === undefined ? {} : { yAxisIndex: axis }), symbol: "none", silent: true, z: 1 };

    const lines = (s.reference ?? []).flatMap((line) => {
      const value = referenceValue(line.kind, finite, line.value);
      if (value === undefined) return [];
      const label = defaultLabel(line, t);
      return [{ name: label, [input.horizontal ? "xAxis" : "yAxis"]: value, label: { formatter: `${label}: ${format(value, s.format)}` } }];
    });
    output.markLines.push(lines.length ? {
      symbol: "none", silent: true,
      lineStyle: { type: "dashed", color: input.muted, width: 1 },
      // Labels sit at the start: the right end is where trends and forecasts continue.
      label: { color: input.muted, position: "insideStartTop" },
      data: lines,
    } : undefined);

    if (s.trend) {
      const xs = rows.map((row, i) => xType === "value" ? toNumber(row[x]) : xType === "time" ? Date.parse(text(row[x])) : i);
      const pairs = values.map((y, i) => [xs[i], y] as const)
        .filter((p): p is readonly [number, number] => p[0] !== null && Number.isFinite(p[0]) && p[1] !== null && Number.isFinite(p[1]));
      const fit = linearFit(pairs.map((p) => p[0]), pairs.map((p) => p[1]));
      if (!fit) output.notes.push(t.trendUnavailable(s.label));
      else
        output.extra.push({
          ...common,
          name: t.trendOf(s.label), type: "line",
          data: rows.map((_, i) => xs[i] === null || !Number.isFinite(xs[i]!) ? point(i, null) : point(i, fit.intercept + fit.slope * xs[i]!)),
          lineStyle: { type: "dashed", width: 1.5, color, opacity: 0.8 },
          itemStyle: { color },
          tooltip: { valueFormatter: (v: number) => format(v, s.format) },
        });
    }

    if (s.forecast && periods && !("error" in periods)) {
      const method = s.forecast.method ?? "linear";
      if (values.some((v) => v === null || !Number.isFinite(v))) {
        output.notes.push(t.forecastNeedsValues(s.label));
        return;
      }
      const raw = forecastSeries(values as number[], method, s.forecast.periods, s.forecast.season);
      if (!raw) {
        output.notes.push(t.forecastNeedsPeriods(s.label, minimumPoints(method, s.forecast.season)));
        return;
      }
      // A series that never goes below zero (revenue, counts) is not projected below zero.
      const floor = finite.every((v) => v >= 0) ? (v: number) => Math.max(0, v) : (v: number) => v;
      const result = { values: raw.values.map(floor), lower: raw.lower.map(floor), upper: raw.upper.map(floor) };
      const last = rows.length - 1;
      const future = periods.next(s.forecast.periods);
      if (future.length > output.future.length) output.future = future;
      // [label, value] pairs place points by name on category and time axes alike, so the
      // forecast has no placeholder points (which axis tooltips would list as empty rows).
      // Each line starts at the last actual value so it continues the series.
      const anchor = (value: number) => [labels[last]!, value];
      const at = (h: number, value: number) => [future[h]!, value];
      const name = t.forecastOf(s.label);
      const band = { ...common, name, type: "line", stack: `forecast-band-${index}`, stackStrategy: "all", tooltip: { show: false } };
      output.extra.push(
        {
          ...common, name, type: "line",
          data: [anchor(values[last]!), ...result.values.map((v, h) => at(h, v))],
          lineStyle: { type: "dashed", width: 2, color },
          itemStyle: { color },
          tooltip: {
            valueFormatter: (v: number, dataIndex: number) =>
              dataIndex === 0 ? format(v, s.format) : `${format(v, s.format)} ${t.forecastSuffix}`,
          },
        },
        // The 95% interval: an invisible lower edge plus the stacked width, shaded.
        { ...band, data: [anchor(values[last]!), ...result.lower.map((v, h) => at(h, v))], lineStyle: { opacity: 0 } },
        {
          ...band,
          data: [anchor(0), ...result.upper.map((v, h) => at(h, v - result.lower[h]!))],
          lineStyle: { opacity: 0 }, areaStyle: { color, opacity: 0.12 },
        },
      );
    }
  });
  return output;
}
