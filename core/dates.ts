/** Browser-safe relative date resolution. Calendar arithmetic uses UTC dates
 * derived from the project's timezone, so "today" never depends on the host. */
import type {
  ParamDefault,
  ParamDefinition,
  ParamValue,
  RelativeDate,
  RelativeDateAnchor,
  RelativeRange,
} from "./types.ts";

export const relativeAnchors: readonly RelativeDateAnchor[] = [
  "today", "yesterday", "start-of-month", "start-of-year",
  "start-of-last-month", "end-of-last-month", "start-of-last-year", "end-of-last-year",
];
export const rangePresets = ["ytd", "mtd", "last-closed-month", "last-closed-year"] as const;

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Today's calendar date in timezone, as a UTC midnight Date. */
export function todayIn(timezone = "UTC", now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
}

const iso = (date: Date) => date.toISOString().slice(0, 10);
const utc = (year: number, month: number, day: number) => new Date(Date.UTC(year, month, day));

function anchor(name: RelativeDateAnchor, today: Date): Date {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  switch (name) {
    case "today": return today;
    case "yesterday": return utc(y, m, today.getUTCDate() - 1);
    case "start-of-month": return utc(y, m, 1);
    case "start-of-year": return utc(y, 0, 1);
    case "start-of-last-month": return utc(y, m - 1, 1);
    case "end-of-last-month": return utc(y, m, 0);
    case "start-of-last-year": return utc(y - 1, 0, 1);
    case "end-of-last-year": return utc(y - 1, 11, 31);
  }
}

/** Month offsets clamp to the target month's last day (31 Jan + 1 month = 28/29 Feb). */
function shift(date: Date, years = 0, months = 0, days = 0): Date {
  const totalMonths = date.getUTCFullYear() * 12 + date.getUTCMonth() + years * 12 + months;
  const year = Math.floor(totalMonths / 12);
  const month = totalMonths - year * 12;
  const last = utc(year, month + 1, 0).getUTCDate();
  return utc(year, month, Math.min(date.getUTCDate(), last) + days);
}

export function isRelativeDate(value: unknown): value is RelativeDate {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && typeof (value as RelativeDate).relative === "string"
    && relativeAnchors.includes((value as RelativeDate).relative);
}
export function isRelativeRange(value: unknown): value is RelativeRange {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.relative === "string")
    return (rangePresets as readonly string[]).includes(v.relative)
      || ["last-days", "next-days", "last-months"].includes(v.relative);
  return "from" in v && "until" in v && (isRelativeDate(v.from) || isRelativeDate(v.until));
}

export function resolveRelativeDate(value: RelativeDate, today: Date): string | number {
  const date = shift(anchor(value.relative, today), value.years, value.months, value.days);
  switch (value.as ?? "date") {
    case "month": return iso(date).slice(0, 7);
    case "year": return date.getUTCFullYear();
    case "month-number": return date.getUTCMonth() + 1;
    default: return iso(date);
  }
}

export function resolveRelativeRange(value: RelativeRange, today: Date): { from: string | number; until: string | number } {
  const end = (d: RelativeDate | string | number) => typeof d === "object" ? resolveRelativeDate(d, today) : d;
  if ("from" in value) return { from: end(value.from), until: end(value.until) };
  const t = iso(today);
  switch (value.relative) {
    case "ytd": return { from: iso(anchor("start-of-year", today)), until: t };
    case "mtd": return { from: iso(anchor("start-of-month", today)), until: t };
    case "last-closed-month": return { from: iso(anchor("start-of-last-month", today)), until: iso(anchor("end-of-last-month", today)) };
    case "last-closed-year": return { from: iso(anchor("start-of-last-year", today)), until: iso(anchor("end-of-last-year", today)) };
    case "last-days": return { from: iso(shift(today, 0, 0, -(value.days - 1))), until: t };
    case "next-days": return { from: t, until: iso(shift(today, 0, 0, value.days)) };
    case "last-months": return { from: iso(shift(today, 0, -value.months)), until: t };
  }
}

/** Resolve a declared default for one request; plain values pass through. */
export function resolveDefault(value: ParamDefault | undefined, today: Date): ParamValue | undefined {
  if (isRelativeDate(value)) return resolveRelativeDate(value, today);
  if (isRelativeRange(value)) return resolveRelativeRange(value, today);
  return value as ParamValue | undefined;
}

/** Validation used by defineProject; returns an error message or undefined. */
export function relativeDefaultError(def: ParamDefinition, value: ParamDefault): string | undefined {
  const offsets = (d: RelativeDate) =>
    ["years", "months", "days"].every((k) => d[k as keyof RelativeDate] === undefined || Number.isInteger(d[k as keyof RelativeDate]));
  if (isRelativeDate(value)) {
    if (!offsets(value)) return "relative offsets must be integers";
    const as = value.as ?? "date";
    if (def.type === "date" && as !== "date") return "date parameters require as: date";
    if (def.type === "string" && !["date", "month"].includes(as)) return "string parameters accept as: date or month";
    if (def.type === "number" && !["year", "month-number"].includes(as)) return "number parameters require as: year or month-number";
    if (!["date", "string", "number"].includes(def.type)) return `${def.type} parameters cannot use a relative date`;
    return undefined;
  }
  if (isRelativeRange(value)) {
    if (def.type !== "range" || def.valueType !== "date") return "relative ranges require a date range parameter";
    if ("from" in value) {
      for (const end of [value.from, value.until])
        if (isRelativeDate(end) && (!offsets(end) || (end.as ?? "date") !== "date")) return "relative range ends must be dates with integer offsets";
      return undefined;
    }
    const n = "days" in value ? value.days : "months" in value ? value.months : 1;
    if (!Number.isInteger(n) || n < 1 || n > 36_500) return "relative range length must be a positive integer";
    return undefined;
  }
  if (value && typeof value === "object" && !Array.isArray(value) && "relative" in value)
    return `unknown relative default ${(value as { relative: unknown }).relative}`;
  return undefined;
}
