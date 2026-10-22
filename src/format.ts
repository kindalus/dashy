import type { Format, Scalar } from "../core/types";
export function formatValue(
  value: Scalar | undefined,
  format: Format = {},
  locale = "en-GB",
): string {
  if (value === null || value === undefined) return "—";
  if (format.style === "text" || typeof value === "boolean")
    return String(value);
  if (format.style === "date") {
    const date = new Date(String(value));
    return Number.isFinite(date.valueOf())
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeZone: "UTC",
        }).format(date)
      : String(value);
  }
  if (typeof value === "string" && !value.trim()) return value;
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return new Intl.NumberFormat(locale, {
    style:
      format.style === "currency"
        ? "currency"
        : format.style === "percent"
          ? "percent"
          : "decimal",
    ...(format.style === "currency"
      ? { currency: format.currency || "USD" }
      : {}),
    minimumFractionDigits: format.decimals ?? 0,
    maximumFractionDigits: format.decimals ?? 2,
  }).format(number);
}
