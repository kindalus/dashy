import { describe, expect, test } from "bun:test";
import { previousRange, relativeDefaultError, resolveDefault, resolveRelativeDate, resolveRelativeRange, todayIn } from "../core/dates";
import { sql } from "../core/sql";
import { parseParams, readParams, reservedParams } from "../core/params";
import type { ParamDefinition } from "../core/types";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("relative dates", () => {
  test("today follows the project timezone, not the host", () => {
    // 23:30 UTC on 31 Dec is already 1 Jan in Luanda (UTC+1).
    const now = new Date("2026-12-31T23:30:00Z");
    expect(todayIn("UTC", now).toISOString().slice(0, 10)).toBe("2026-12-31");
    expect(todayIn("Africa/Luanda", now).toISOString().slice(0, 10)).toBe("2027-01-01");
  });
  test("anchors, offsets and output representations", () => {
    const today = day("2026-03-31");
    expect(resolveRelativeDate({ relative: "today" }, today)).toBe("2026-03-31");
    expect(resolveRelativeDate({ relative: "yesterday" }, today)).toBe("2026-03-30");
    expect(resolveRelativeDate({ relative: "start-of-year" }, today)).toBe("2026-01-01");
    expect(resolveRelativeDate({ relative: "end-of-last-month" }, today)).toBe("2026-02-28");
    expect(resolveRelativeDate({ relative: "today", days: 90 }, today)).toBe("2026-06-29");
    // Month offsets clamp to the last day of the target month.
    expect(resolveRelativeDate({ relative: "today", months: -1 }, today)).toBe("2026-02-28");
    expect(resolveRelativeDate({ relative: "end-of-last-month", as: "month" }, today)).toBe("2026-02");
    expect(resolveRelativeDate({ relative: "end-of-last-month", as: "month-number" }, today)).toBe(2);
    expect(resolveRelativeDate({ relative: "end-of-last-year", as: "year" }, day("2026-01-15"))).toBe(2025);
  });
  test("range presets", () => {
    const today = day("2026-11-08");
    expect(resolveRelativeRange({ relative: "ytd" }, today)).toEqual({ from: "2026-01-01", until: "2026-11-08" });
    expect(resolveRelativeRange({ relative: "mtd" }, today)).toEqual({ from: "2026-11-01", until: "2026-11-08" });
    expect(resolveRelativeRange({ relative: "last-closed-month" }, today)).toEqual({ from: "2026-10-01", until: "2026-10-31" });
    expect(resolveRelativeRange({ relative: "last-closed-year" }, today)).toEqual({ from: "2025-01-01", until: "2025-12-31" });
    expect(resolveRelativeRange({ relative: "last-days", days: 30 }, today)).toEqual({ from: "2026-10-10", until: "2026-11-08" });
    expect(resolveRelativeRange({ relative: "next-days", days: 90 }, today)).toEqual({ from: "2026-11-08", until: "2027-02-06" });
    expect(resolveRelativeRange({ relative: "last-months", months: 12 }, today)).toEqual({ from: "2025-11-08", until: "2026-11-08" });
    expect(resolveRelativeRange({ from: { relative: "start-of-month", months: -2 }, until: { relative: "today" } }, today))
      .toEqual({ from: "2026-09-01", until: "2026-11-08" });
  });
  test("plain defaults pass through unchanged", () => {
    expect(resolveDefault(5, day("2026-01-01"))).toBe(5);
    expect(resolveDefault({ from: "2020-01-01", until: "2020-12-31" }, day("2026-01-01"))).toEqual({ from: "2020-01-01", until: "2020-12-31" });
  });
  test("validation rejects relative values the parameter cannot hold", () => {
    const range: ParamDefinition = { label: "Period", type: "range", valueType: "date" };
    const number: ParamDefinition = { label: "Year", type: "number" };
    expect(relativeDefaultError(range, { relative: "ytd" })).toBeUndefined();
    expect(relativeDefaultError(number, { relative: "ytd" })).toContain("date range");
    expect(relativeDefaultError(number, { relative: "today" })).toContain("as: year");
    expect(relativeDefaultError(number, { relative: "today", as: "year" })).toBeUndefined();
    expect(relativeDefaultError(range, { relative: "last-days", days: 0 })).toContain("positive");
    expect(relativeDefaultError(range, { relative: "bogus" } as never)).toContain("unknown relative default");
  });
});

describe("parameters", () => {
  const definitions: Record<string, ParamDefinition> = {
    period: { label: "Period", type: "range", valueType: "date", default: { relative: "ytd" } },
    year: { label: "Year", type: "number", default: { relative: "today", as: "year" } },
    tags: { label: "Tags", type: "array", options: [{ label: "A", value: "a" }, { label: "B", value: "b" }] },
    client: { label: "Client", type: "string", options: { query: "clients", value: "id", search: true } },
    kind: { label: "Kind", type: "select", options: { query: "kinds", value: "id" } },
  };
  test("relative defaults resolve per call", () => {
    const params = parseParams(definitions, ["period", "year"], {}, {}, day("2026-05-20"));
    expect(params).toEqual({ period: { from: "2026-01-01", until: "2026-05-20" }, year: 2026 });
    const later = parseParams(definitions, ["period"], {}, {}, day("2027-02-01"));
    expect(later.period).toEqual({ from: "2027-01-01", until: "2027-02-01" });
    // Dashboard defaults override parameter defaults and may be relative too.
    expect(parseParams(definitions, ["period"], {}, { period: { relative: "mtd" } }, day("2026-05-20")).period)
      .toEqual({ from: "2026-05-01", until: "2026-05-20" });
  });
  test("static array options are enforced; query options validate by type", () => {
    expect(parseParams(definitions, ["tags"], { tags: ["a", "b"] }).tags).toEqual(["a", "b"]);
    expect(() => parseParams(definitions, ["tags"], { tags: ["c"] })).toThrow("Invalid option for tags");
    expect(parseParams(definitions, ["client", "kind"], { client: "500123", kind: "any" })).toEqual({ client: "500123", kind: "any" });
  });
  test("reserved query keys never reach parameter validation", () => {
    expect(reservedParams).toEqual(["api_key", "refresh", "_from", "_xf", "_dd", "_format", "_sort", "_top"]);
    const raw = readParams(new URLSearchParams("api_key=secret&refresh=true&_from=/dashboards/a&_xf=b:c&_dd=b:2024&year=2026"), definitions);
    expect(raw).toEqual({ year: "2026" });
    expect(parseParams(definitions, ["year"], raw)).toEqual({ year: 2026 });
  });
});

describe("previous ranges", () => {
  test("period is the same number of days immediately before; year shifts the dates", () => {
    // Whole calendar months compare with the same number of months before.
    expect(previousRange({ from: "2026-03-01", until: "2026-03-31" })).toEqual({ from: "2026-02-01", until: "2026-02-28" });
    expect(previousRange({ from: "2020-01-01", until: "2020-12-31" })).toEqual({ from: "2019-01-01", until: "2019-12-31" });
    expect(previousRange({ from: "2026-04-01", until: "2026-06-30" })).toEqual({ from: "2026-01-01", until: "2026-03-31" });
    expect(previousRange({ from: "2026-01-01", until: "2026-01-31" })).toEqual({ from: "2025-12-01", until: "2025-12-31" });
    // Other ranges compare with the same number of days before.
    expect(previousRange({ from: "2026-03-10", until: "2026-03-31" })).toEqual({ from: "2026-02-16", until: "2026-03-09" });
    expect(previousRange({ from: "2026-03-01", until: "2026-03-15" })).toEqual({ from: "2026-02-14", until: "2026-02-28" });
    expect(previousRange({ from: "2026-01-01", until: "2026-01-01" })).toEqual({ from: "2025-12-31", until: "2025-12-31" });
    expect(previousRange({ from: "2024-02-01", until: "2024-02-29" }, "year")).toEqual({ from: "2023-02-01", until: "2023-02-28" });
    expect(sql.previousRange({ from: "2026-01-01", until: "2026-12-31" }, "year")).toEqual({ from: "2025-01-01", until: "2025-12-31" });
  });
  test("missing, non-date, invalid or reversed ranges have none", () => {
    expect(previousRange(undefined)).toBeUndefined();
    expect(previousRange({ from: 1, until: 5 })).toBeUndefined();
    expect(previousRange({ from: "2026-02-30", until: "2026-03-01" })).toBeUndefined();
    expect(previousRange({ from: "2026-03-02", until: "2026-03-01" })).toBeUndefined();
  });
});
