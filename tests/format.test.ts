import { expect, test } from "bun:test";
import { formatValue } from "../src/format";
test("formats scalar metrics without hiding zero or null", () => {
  expect(formatValue(null)).toBe("—");
  expect(formatValue(0)).toBe("0");
  expect(
    formatValue(
      "6420",
      { style: "currency", currency: "EUR", decimals: 0 },
      "en-GB",
    ),
  ).toBe("€6,420");
  expect(formatValue(0.25, { style: "percent" })).toBe("25%");
  expect(formatValue("001", { style: "text" })).toBe("001");
});

test("format reuse preserves locale, style, currency and precision across many combinations", () => {
  for (let repeat = 0; repeat < 2; repeat++)
    for (const locale of ["en-GB", "pt-PT", "de-DE", "ja-JP"])
      for (const currency of ["EUR", "USD", "AOA"])
        for (let decimals = 0; decimals <= 8; decimals++) {
          const options = {
            style: "currency" as const,
            currency,
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
          };
          expect(
            formatValue(
              "1234.567",
              { style: "currency", currency, decimals },
              locale,
            ),
          ).toBe(new Intl.NumberFormat(locale, options).format(1234.567));
        }
  expect(formatValue(0.25, { style: "percent", decimals: 1 })).toBe("25,0%");
  expect(formatValue(12.5, { style: "currency" })).toBe("US$\u00a012,5");
  expect(formatValue(1234.56)).toBe("1.234,56");
  expect(formatValue(1234.56, {}, "en")).toBe("1,234.56");
  expect(formatValue(12.5, { decimals: 0 })).toBe("13");
});

test("date formatting remains UTC and preserves invalid, empty and textual values", () => {
  for (const locale of ["en-GB", "pt-PT", "ja-JP"])
    expect(
      formatValue("2026-01-15T23:30:00-02:00", { style: "date" }, locale),
    ).toBe(
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(new Date("2026-01-16T01:30:00Z")),
    );
  expect(formatValue("not a date", { style: "date" })).toBe("not a date");
  expect(formatValue("   ")).toBe("   ");
  expect(formatValue(false)).toBe("false");
  expect(formatValue(undefined)).toBe("—");
  expect(() => formatValue(1, { decimals: -1 })).toThrow(RangeError);
});
