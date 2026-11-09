/** Browser-safe chart contract helpers shared by validation and rendering. */
import type { CartesianSeries, ChartDefinition, SeriesKind } from "./types.ts";

export const chartTypes = [
  "cartesian", "line", "bar", "area", "pie", "funnel", "treemap", "sunburst",
  "heatmap", "gauge", "radar", "sankey", "boxplot",
] as const;
const seriesKinds: readonly SeriesKind[] = ["line", "bar", "area", "scatter"];

type Cartesian = Extract<ChartDefinition, { x: string; series: readonly CartesianSeries[] }>;
export const isCartesian = (chart: ChartDefinition): chart is Cartesian =>
  chart.type === "cartesian" || chart.type === "line" || chart.type === "bar" || chart.type === "area";

/** Series kind after applying the legacy line/bar/area shorthand. */
export function seriesKind(chart: Cartesian, series: CartesianSeries): SeriesKind {
  return series.as ?? (chart.type === "cartesian" ? "line" : chart.type);
}

/** Columns a click on a chart element can identify. */
export function chartKeyColumns(chart: ChartDefinition): string[] {
  if (isCartesian(chart)) return [chart.x];
  switch (chart.type) {
    case "pie": case "funnel": case "radar": case "boxplot": return [chart.category];
    case "treemap": case "sunburst": return [...chart.path];
    case "heatmap": return [chart.x, chart.y];
    case "sankey": return [chart.source, chart.target];
    case "gauge": return [];
  }
}

const REFERENCE_KINDS = ["average", "median", "min", "max", "constant"];
const FORECAST_METHODS = ["linear", "holt", "seasonal"];
/** Reference lines, trend and forecast options of one cartesian series. */
function validateAnalytics(chart: Cartesian, series: CartesianSeries): string | undefined {
  const reference: unknown = series.reference;
  if (reference !== undefined) {
    if (!Array.isArray(reference)) return "reference must be a list of { kind, value?, label? }";
    for (const line of reference as unknown[]) {
      const item = (typeof line === "object" && line !== null ? line : {}) as Record<string, unknown>;
      if (!REFERENCE_KINDS.includes(item.kind as string)) return "reference kind must be average, median, min, max or constant";
      if (item.kind === "constant" && !Number.isFinite(item.value)) return "constant reference requires a finite value";
      if (item.label !== undefined && (typeof item.label !== "string" || !item.label.trim())) return "reference label must be a non-empty string";
    }
  }
  if (series.reference !== undefined && series.stack) return "reference cannot be used on a stacked series";
  if (series.trend !== undefined && series.trend !== "linear") return "trend must be linear";
  if (series.trend && series.stack) return "trend cannot be used on a stacked series";
  const forecast: unknown = series.forecast;
  if (forecast === undefined) return undefined;
  if (typeof forecast !== "object" || forecast === null) return "forecast must be { periods, method?, season? }";
  const { periods, method = "linear", season } = forecast as Record<string, unknown>;
  if (!Number.isInteger(periods) || (periods as number) < 1 || (periods as number) > 120) return "forecast periods must be an integer from 1 to 120";
  if (!FORECAST_METHODS.includes(method as string)) return "forecast method must be linear, holt or seasonal";
  if (method === "seasonal" && (!Number.isInteger(season) || (season as number) < 2 || (season as number) > 366))
    return "seasonal forecast requires a season of 2 to 366 periods";
  if (method !== "seasonal" && season !== undefined) return "forecast season applies only to the seasonal method";
  if (series.stack) return "forecast cannot be used on a stacked series";
  if (chart.orientation === "horizontal") return "forecast requires a vertical chart";
  if (chart.xType === "value") return "forecast requires a category or time x axis of dates";
  return undefined;
}

/** Returns an error message, or undefined when the chart matches its columns. */
export function validateChart(chart: ChartDefinition, columns: readonly string[]): string | undefined {
  if (!chart || !(chartTypes as readonly string[]).includes(chart.type)) return `type must be one of ${chartTypes.join(", ")}`;
  const has = (column: unknown, role: string) =>
    typeof column === "string" && columns.includes(column) ? undefined : `has unknown ${role} column ${String(column)}`;
  const first = (...errors: (string | undefined)[]) => errors.find(Boolean);
  if (isCartesian(chart)) {
    if (!Array.isArray(chart.series) || !chart.series.length) return "requires at least one series";
    if (chart.xType !== undefined && !["category", "time", "value"].includes(chart.xType)) return "xType must be category, time or value";
    if (chart.orientation !== undefined && !["vertical", "horizontal"].includes(chart.orientation)) return "orientation must be vertical or horizontal";
    for (const series of chart.series) {
      if (!columns.includes(series.key)) return `has unknown series ${series.key}`;
      if (series.as !== undefined && !seriesKinds.includes(series.as)) return `series ${series.key} as must be line, bar, area or scatter`;
      if (series.axis !== undefined && !["left", "right"].includes(series.axis)) return `series ${series.key} axis must be left or right`;
      if (series.stack !== undefined && (typeof series.stack !== "string" || !series.stack)) return `series ${series.key} stack must be a name`;
      const error = validateAnalytics(chart, series);
      if (error) return `series ${series.key} ${error}`;
    }
    if (chart.orientation === "horizontal" && chart.series.some((s) => s.axis === "right"))
      return "horizontal charts support only the left value axis";
    return has(chart.x, "x");
  }
  switch (chart.type) {
    case "pie": case "funnel": case "boxplot":
      return first(has(chart.category, "category"), has(chart.value, "value"));
    case "treemap": case "sunburst":
      if (!Array.isArray(chart.path) || !chart.path.length) return "path requires at least one column";
      return first(...chart.path.map((column) => has(column, "path")), has(chart.value, "value"));
    case "heatmap":
      return first(has(chart.x, "x"), has(chart.y, "y"), has(chart.value, "value"));
    case "gauge": {
      const min = chart.min ?? 0;
      const max = chart.max ?? 100;
      if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return "min must be below max";
      let previous = min;
      for (const band of chart.bands ?? []) {
        if (!Number.isFinite(band.until) || band.until <= previous || band.until > max) return "bands must ascend within min and max";
        if (!["danger", "warning", "success", "neutral"].includes(band.tone)) return "band tone must be danger, warning, success or neutral";
        previous = band.until;
      }
      return has(chart.value, "value");
    }
    case "radar":
      if (!Array.isArray(chart.series) || !chart.series.length) return "requires at least one series";
      if (chart.max !== undefined && (!Number.isFinite(chart.max) || chart.max <= 0)) return "max must be positive";
      return first(has(chart.category, "category"), ...chart.series.map((s) => has(s.key, "series")));
    case "sankey":
      return first(has(chart.source, "source"), has(chart.target, "target"), has(chart.value, "value"));
  }
}

/** Five-number summary using linear interpolation (the same as DuckDB quantile_cont). */
export function boxplotStats(values: number[]): [number, number, number, number, number] {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const q = (p: number) => {
    if (!sorted.length) return Number.NaN;
    const position = (sorted.length - 1) * p;
    const lower = Math.floor(position);
    const fraction = position - lower;
    return sorted[lower]! + (sorted[Math.min(lower + 1, sorted.length - 1)]! - sorted[lower]!) * fraction;
  };
  return [q(0), q(0.25), q(0.5), q(0.75), q(1)];
}
