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
