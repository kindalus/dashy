import type { Format, Scalar } from "../core/types";

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
