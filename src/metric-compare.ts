/** Comparison, target and sparkline text for metric cards. Pure; no DOM. */
import { numericValue } from "../core/tables";
import type { Format, MetricDefinition, Scalar } from "../core/types";
import { formatValue } from "./format";

export interface Comparison {
  /** Signed change text, e.g. "+12.3%" or "−US$ 1.200". */
  change: string;
  label: string;
  direction: "up" | "down" | "flat";
  /** good/bad follow `better`; neutral when unchanged. */
  tone: "good" | "bad" | "neutral";
  /** Full sentence for assistive technology, e.g. "Up 12.3% vs previous period". */
  description: string;
}

const MINUS = "\u2212";

/** Change from the comparison value, or undefined when either value is missing (or zero for percent). */
export function compareMetric(definition: MetricDefinition, value: Scalar, compare: Scalar | undefined, locale: string): Comparison | undefined {
  const spec = definition.compare;
  if (!spec) return undefined;
  const current = numericValue(value ?? null);
  const previous = numericValue(compare ?? null);
  if (current === null || previous === null) return undefined;
  const percent = (spec.as ?? "percent") === "percent";
  if (percent && previous === 0) return undefined;
  const amount = percent ? (current - previous) / Math.abs(previous) : current - previous;
  // A difference of two percentages is in percentage points, not a relative change.
  const points = !percent && definition.format?.style === "percent";
  const shown = points ? Math.abs(amount) * 100 : Math.abs(amount);
  const text = percent ? formatValue(shown, { style: "percent", decimals: 1 }, locale)
    : points ? `${formatValue(shown, { decimals: 1 }, locale)} pp`
    : formatValue(shown, definition.format, locale);
  // Decide at the displayed precision, so a change shown as 0.0% reads as unchanged
  // (on the number, not the text: some locales use non-Latin digits).
  const digits = percent ? 3 : points ? 1 : definition.format?.decimals ?? 2;
  const direction = Math.round(shown * 10 ** digits) === 0 ? "flat" : amount > 0 ? "up" : "down";
  const label = spec.label ?? "vs previous";
  const good = (direction === "up") === ((spec.better ?? "higher") === "higher");
  return {
    change: direction === "up" ? `+${text}` : direction === "down" ? `${MINUS}${text}` : text,
    label,
    direction,
    tone: direction === "flat" ? "neutral" : good ? "good" : "bad",
    description: `${direction === "flat" ? "Unchanged" : direction === "up" ? "Up" : "Down"} ${text} ${label}`,
  };
}

export interface TargetProgress {
  label: string;
  /** Target in the metric's format. */
  target: string;
  /** Value as a fraction of the target, for the progress bar (0–1 clamped) and its text. */
  ratio: number;
  percent: string;
}
export function targetProgress(definition: MetricDefinition, value: Scalar, target: Scalar | undefined, locale: string): TargetProgress | undefined {
  const spec = definition.target;
  if (!spec) return undefined;
  const goal = spec.value ?? numericValue(target ?? null);
  const current = numericValue(value ?? null);
  if (goal === null || goal === undefined || current === null || goal === 0) return undefined;
  const ratio = current / goal;
  return {
    label: spec.label ?? "Target",
    target: formatValue(goal, definition.format as Format | undefined, locale),
    ratio: Math.max(0, Math.min(1, ratio)),
    percent: formatValue(ratio, { style: "percent", decimals: 0 }, locale),
  };
}

/** SVG polyline points for a sparkline in a width × height box; gaps split the line. */
export function sparklinePaths(values: readonly (number | null)[], width: number, height: number, pad = 2): string[] {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (finite.length < 2) return [];
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const step = values.length > 1 ? (width - 2 * pad) / (values.length - 1) : 0;
  const paths: string[] = [];
  let current: string[] = [];
  // A point between gaps becomes a zero-length segment, drawn as a dot by round caps.
  const close = () => {
    if (current.length === 1) current.push(current[0]!);
    if (current.length) paths.push(current.join(" "));
    current = [];
  };
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) return close();
    const x = pad + i * step;
    const y = height - pad - ((v - min) / span) * (height - 2 * pad);
    current.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  close();
  return paths;
}
