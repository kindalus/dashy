/**
 * Browser-safe series analytics for charts: reference values, linear trends and
 * client-side forecasts over regular date periods. Pure functions; no DOM.
 */

export type Granularity = "day" | "week" | "month" | "quarter" | "year";
export interface Periods {
  granularity: Granularity;
  /** The next `n` labels after the last one, in the same format. */
  next(n: number): string[];
}

const DAY = 86_400_000;
const pad = (n: number, width = 2) => String(n).padStart(width, "0");
const isoDate = (time: number) => new Date(time).toISOString().slice(0, 10);
const utc = (label: string) => Date.parse(`${label}T00:00:00Z`);
const monthIndex = (year: number, month: number) => year * 12 + month - 1;
const year = (value: number) => pad(value, 4);
const monthLabel = (index: number) => `${year(Math.floor(index / 12))}-${pad((index % 12) + 1)}`;

/**
 * Recognises evenly spaced period labels: YYYY, YYYY-MM, YYYY-Qn, or YYYY-MM-DD
 * one day, one week, one month (same day of month), a quarter or a year apart.
 * Returns an error message for anything else, so no forecast is drawn over gaps.
 */
export function detectPeriods(labels: readonly string[]): Periods | { error: string } {
  if (labels.length < 2) return { error: "needs at least two periods" };
  const irregular = { error: "periods must be evenly spaced dates (YYYY, YYYY-MM, YYYY-Qn or YYYY-MM-DD)" };
  const every = (pattern: RegExp) => labels.every((label) => pattern.test(label));
  const steps = (values: number[], step: number) => values.every((value, i) => i === 0 || value - values[i - 1]! === step);
  if (every(/^\d{4}$/)) {
    const years = labels.map(Number);
    if (!steps(years, 1)) return irregular;
    return { granularity: "year", next: (n) => Array.from({ length: n }, (_, i) => year(years.at(-1)! + i + 1)) };
  }
  if (every(/^\d{4}-(0[1-9]|1[0-2])$/)) {
    const months = labels.map((label) => monthIndex(Number(label.slice(0, 4)), Number(label.slice(5))));
    if (!steps(months, 1)) return irregular;
    return { granularity: "month", next: (n) => Array.from({ length: n }, (_, i) => monthLabel(months.at(-1)! + i + 1)) };
  }
  if (every(/^\d{4}-Q[1-4]$/)) {
    const quarters = labels.map((label) => Number(label.slice(0, 4)) * 4 + Number(label.slice(6)) - 1);
    if (!steps(quarters, 1)) return irregular;
    return {
      granularity: "quarter",
      next: (n) => Array.from({ length: n }, (_, i) => {
        const q = quarters.at(-1)! + i + 1;
        return `${year(Math.floor(q / 4))}-Q${(q % 4) + 1}`;
      }),
    };
  }
  if (!every(/^\d{4}-\d{2}-\d{2}$/)) return irregular;
  const times = labels.map(utc);
  if (times.some((time, i) => !Number.isFinite(time) || isoDate(time) !== labels[i])) return irregular;
  for (const [granularity, step] of [["day", DAY], ["week", 7 * DAY]] as const)
    if (steps(times, step)) {
      const last = times.at(-1)!;
      return { granularity, next: (n) => Array.from({ length: n }, (_, i) => isoDate(last + (i + 1) * step)) };
    }
  // Month, quarter and year steps keep the day of month, which must exist in every month (1–28).
  const day = labels[0]!.slice(8);
  if (Number(day) > 28 || labels.some((label) => label.slice(8) !== day)) return irregular;
  const months = labels.map((label) => monthIndex(Number(label.slice(0, 4)), Number(label.slice(5, 7))));
  for (const [granularity, step] of [["month", 1], ["quarter", 3], ["year", 12]] as const)
    if (steps(months, step))
      return {
        granularity,
        next: (n) => Array.from({ length: n }, (_, i) => `${monthLabel(months.at(-1)! + (i + 1) * step)}-${day}`),
      };
  return irregular;
}

/** Least-squares line through (x, y) points. Undefined with fewer than two distinct x values. */
export function linearFit(xs: readonly number[], ys: readonly number[]): { slope: number; intercept: number } | undefined {
  const n = xs.length;
  if (n < 2 || ys.length !== n) return undefined;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i]! - meanX) ** 2;
    sxy += (xs[i]! - meanX) * (ys[i]! - meanY);
  }
  if (sxx === 0) return undefined;
  const slope = sxy / sxx;
  return { slope, intercept: meanY - slope * meanX };
}

export type ReferenceKind = "average" | "median" | "min" | "max" | "constant";
/** Value of a reference line over the finite values, or undefined when there are none. */
export function referenceValue(kind: ReferenceKind, values: readonly number[], constant?: number): number | undefined {
  if (kind === "constant") return Number.isFinite(constant) ? constant : undefined;
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return undefined;
  switch (kind) {
    case "average": return finite.reduce((s, v) => s + v, 0) / finite.length;
    case "min": return finite.reduce((a, b) => Math.min(a, b));
    case "max": return finite.reduce((a, b) => Math.max(a, b));
    case "median": {
      const sorted = [...finite].sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
    }
  }
}

export type ForecastMethod = "linear" | "holt" | "seasonal";
export interface Forecast {
  values: number[];
  /**
   * Approximate 95% interval. Linear: the regression prediction interval,
   * ±1.96 · s · √(1 + 1/n + (x − x̄)²/Sxx). Holt and seasonal: ±1.96 × one-step
   * RMSE × √horizon.
   */
  lower: number[];
  upper: number[];
}
export const minimumPoints = (method: ForecastMethod, season = 0) =>
  method === "linear" ? 3 : method === "holt" ? 4 : 2 * season;

const GRID = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
function interval(values: number[], spread: (h: number) => number): Forecast {
  return { values, lower: values.map((v, h) => v - spread(h)), upper: values.map((v, h) => v + spread(h)) };
}
const widening = (rmse: number) => (h: number) => 1.96 * rmse * Math.sqrt(h + 1);
const rmseOf = (errors: number[]) => errors.length ? Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length) : 0;

/** Holt's linear trend; returns one-step errors and the final level and trend. */
function holt(series: readonly number[], alpha: number, beta: number) {
  let level = series[0]!;
  let trend = series[1]! - series[0]!;
  const errors: number[] = [];
  for (let t = 1; t < series.length; t++) {
    // The initial trend is y1 − y0, so the first error is 0 by construction; skip it.
    if (t > 1) errors.push(series[t]! - (level + trend));
    const previous = level;
    level = alpha * series[t]! + (1 - alpha) * (level + trend);
    trend = beta * (level - previous) + (1 - beta) * trend;
  }
  return { errors, level, trend };
}
/** Additive Holt-Winters with season length `m`, initialised from the first two seasons. */
function holtWinters(series: readonly number[], m: number, alpha: number, beta: number, gamma: number) {
  const first = series.slice(0, m);
  const second = series.slice(m, 2 * m);
  const mean = (list: readonly number[]) => list.reduce((s, v) => s + v, 0) / list.length;
  let level = mean(first);
  let trend = (mean(second) - mean(first)) / m;
  const seasonal = first.map((v) => v - level);
  const errors: number[] = [];
  for (let t = m; t < series.length; t++) {
    const s = seasonal[t % m]!;
    errors.push(series[t]! - (level + trend + s));
    const previous = level;
    level = alpha * (series[t]! - s) + (1 - alpha) * (level + trend);
    trend = beta * (level - previous) + (1 - beta) * trend;
    seasonal[t % m] = gamma * (series[t]! - level) + (1 - gamma) * s;
  }
  return { errors, level, trend, seasonal, length: series.length };
}

/**
 * Forecasts `periods` values after a complete series (no gaps). Smoothing
 * parameters are chosen by grid search on one-step-ahead squared error.
 * Undefined when the series is too short for the method.
 */
export function forecastSeries(
  series: readonly number[], method: ForecastMethod, periods: number, season = 0,
): Forecast | undefined {
  if (!Number.isInteger(periods) || periods < 1 || series.length < minimumPoints(method, season) || !series.every(Number.isFinite))
    return undefined;
  const horizon = Array.from({ length: periods }, (_, h) => h + 1);
  if (method === "linear") {
    const n = series.length;
    const fit = linearFit(series.map((_, i) => i), series)!;
    const sse = series.reduce((sum, y, i) => sum + (y - (fit.intercept + fit.slope * i)) ** 2, 0);
    const s = Math.sqrt(sse / (n - 2));
    const mean = (n - 1) / 2;
    const sxx = series.reduce((sum, _, i) => sum + (i - mean) ** 2, 0);
    return interval(
      horizon.map((h) => fit.intercept + fit.slope * (n - 1 + h)),
      (h) => 1.96 * s * Math.sqrt(1 + 1 / n + (n + h - mean) ** 2 / sxx),
    );
  }
  if (method === "holt") {
    let best: ReturnType<typeof holt> | undefined;
    let bestError = Infinity;
    for (const alpha of GRID) for (const beta of GRID) {
      const fit = holt(series, alpha, beta);
      const error = rmseOf(fit.errors);
      if (error < bestError) { best = fit; bestError = error; }
    }
    return interval(horizon.map((h) => best!.level + h * best!.trend), widening(bestError));
  }
  if (!Number.isInteger(season) || season < 2) return undefined;
  let best: ReturnType<typeof holtWinters> | undefined;
  let bestError = Infinity;
  for (const alpha of GRID) for (const beta of GRID) for (const gamma of GRID) {
    const fit = holtWinters(series, season, alpha, beta, gamma);
    const error = rmseOf(fit.errors);
    if (error < bestError) { best = fit; bestError = error; }
  }
  const fit = best!;
  return interval(horizon.map((h) => fit.level + h * fit.trend + fit.seasonal[(fit.length + h - 1) % season]!), widening(bestError));
}
