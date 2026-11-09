import type { DateGrain, Format, Scalar } from "../core/types";

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

// Reuse expensive Intl instances across cells and chart ticks. Bound both caches
// because a long-running server can render many projects/locales.
function cached<T>(cache: Map<string, T>, key: string, create: () => T): T {
  const existing = cache.get(key);
  if (existing) return existing;
  const value = create();
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
  return value;
}
export function formatValue(
  value: Scalar | undefined,
  format: Format = {},
  locale = "pt",
): string {
  if (value === null || value === undefined) return "—";
  if (format.style === "text" || typeof value === "boolean")
    return String(value);
  if (format.style === "date" && format.grain) return formatPeriod(value, format.grain, locale);
  if (format.style === "date") {
    const date = new Date(String(value));
    return Number.isFinite(date.valueOf())
      ? cached(
          dateFormats,
          locale,
          () =>
            new Intl.DateTimeFormat(locale, {
              dateStyle: "medium",
              timeZone: "UTC",
            }),
        ).format(date)
      : String(value);
  }
  if (typeof value === "string" && !value.trim()) return value;
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  const style =
    format.style === "currency"
      ? "currency"
      : format.style === "percent"
        ? "percent"
        : "decimal";
  const currency = style === "currency" ? format.currency || "USD" : undefined;
  if (format.compact && style !== "percent")
    return cached(numberFormats, JSON.stringify([locale, style, currency, "compact"]), () =>
      new Intl.NumberFormat(locale, { style, currency, notation: "compact", maximumSignificantDigits: 3 }),
    ).format(number);
  const minimumFractionDigits = format.decimals ?? 0;
  const maximumFractionDigits = format.decimals ?? 2;
  const key = JSON.stringify([
    locale,
    style,
    currency,
    minimumFractionDigits,
    maximumFractionDigits,
  ]);
  return cached(
    numberFormats,
    key,
    () =>
      new Intl.NumberFormat(locale, {
        style,
        currency,
        minimumFractionDigits,
        maximumFractionDigits,
      }),
  ).format(number);
}

/** A period from its start date: 2024, Q1 2024 (T1 in Portuguese), Jan 2024 or a medium date. */
export function formatPeriod(value: Scalar, grain: DateGrain, locale = "pt"): string {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(String(value));
  if (!match) return String(value);
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : 1;
  if (grain === "year") return match[1]!;
  if (grain === "quarter") return `${locale.toLowerCase().startsWith("pt") ? "T" : "Q"}${Math.floor((month - 1) / 3) + 1} ${year}`;
  const date = new Date(Date.UTC(year, month - 1, match[3] ? Number(match[3]) : 1));
  const options: Intl.DateTimeFormatOptions = grain === "month"
    ? { month: "short", year: "numeric", timeZone: "UTC" }
    : { dateStyle: "medium", timeZone: "UTC" };
  return cached(dateFormats, `${locale}:${grain}`, () => new Intl.DateTimeFormat(locale, options)).format(date);
}

/**
 * A metric card's value: compact from one million unless the format says
 * otherwise, so long values never wrap. `full` is always the exact value.
 */
export function formatMetric(value: Scalar | undefined, format: Format = {}, locale = "pt"): { text: string; full: string } {
  const full = formatValue(value, format, locale);
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  const compact = format.compact ?? (Number.isFinite(number) && Math.abs(number) >= 1_000_000);
  return { text: compact ? formatValue(value, { ...format, compact: true }, locale) : full, full };
}
