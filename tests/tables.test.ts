import { describe, expect, test } from "bun:test";
import {
  aggregateColumn, applyTopN, compareRows, isOtherRow, shapeTable, sortRows, topNChoices, topNLabelColumn, validateTable,
} from "../core/tables";
import type { DatasetColumn, DatasetDefinition, Row } from "../core/types";

const columns: DatasetColumn[] = [
  { key: "category", label: "Category" },
  { key: "brand", label: "Brand" },
  { key: "units", label: "Units", aggregate: "sum" },
  { key: "revenue", label: "Revenue", aggregate: "sum" },
  { key: "profit", label: "Profit", aggregate: "sum" },
  { key: "margin", label: "Margin", aggregate: { ratio: ["profit", "revenue"] } },
];
const rows: Row[] = [
  { category: "Toys", brand: "A", units: 1, revenue: 100, profit: 50, margin: 0.5 },
  { category: "Food", brand: "B", units: 4, revenue: 300, profit: 30, margin: 0.1 },
  { category: "Toys", brand: "C", units: 2, revenue: 50, profit: 40, margin: 0.8 },
  { category: "Food", brand: "D", units: 3, revenue: "1000", profit: "100", margin: 0.1 },
  { category: null, brand: "E", units: null, revenue: 10, profit: 1, margin: 0.1 },
];
const dataset = (extra: Partial<DatasetDefinition> = {}): DatasetDefinition => ({ label: "T", query: "q", columns, ...extra });
const keys = (list: readonly Row[], key = "brand") => list.map((row) => row[key]);

describe("sorting", () => {
  test("numbers, numeric strings and text sort naturally, with empty values last in both directions", () => {
    expect(keys(sortRows(rows, { column: "revenue", direction: "asc" }, "en"))).toEqual(["E", "C", "A", "B", "D"]);
    expect(keys(sortRows(rows, { column: "revenue", direction: "desc" }, "en"))).toEqual(["D", "B", "A", "C", "E"]);
    expect(keys(sortRows(rows, { column: "units", direction: "asc" }, "en"))).toEqual(["A", "C", "D", "B", "E"]);
    expect(keys(sortRows(rows, { column: "units", direction: "desc" }, "en"))).toEqual(["B", "D", "C", "A", "E"]);
    expect(keys(sortRows(rows, { column: "category", direction: "desc" }, "en"))).toEqual(["A", "C", "B", "D", "E"]);
  });
  test("sorting is stable, never mutates its input and uses locale collation", () => {
    const before = keys(rows);
    expect(keys(sortRows(rows, { column: "category", direction: "asc" }, "en"))).toEqual(["B", "D", "A", "C", "E"]);
    expect(keys(rows)).toEqual(before);
    expect(sortRows(rows, undefined, "en")).toEqual(rows);
    const words: Row[] = [{ w: "b" }, { w: "Á" }, { w: "a10" }, { w: "a9" }];
    expect(keys(sortRows(words, { column: "w", direction: "asc" }, "pt"), "w")).toEqual(["Á", "a9", "a10", "b"]);
    expect(compareRows({ column: "x", direction: "asc" }, "en")({ x: false }, { x: true })).toBeLessThan(0);
    // Integers beyond 2^53 arrive as strings and still sort exactly.
    const big: Row[] = [{ x: "9007199254740993" }, { x: "9007199254740992" }];
    expect(keys(sortRows(big, { column: "x", direction: "asc" }, "en"), "x")).toEqual(["9007199254740992", "9007199254740993"]);
  });
});

describe("aggregates", () => {
  test("sum, count, avg, min, max and ratio ignore empty values", () => {
    const column = (aggregate: DatasetColumn["aggregate"], key = "units") => ({ key, label: key, aggregate });
    expect(aggregateColumn(rows, column("sum"))).toBe(10);
    expect(aggregateColumn(rows, column("count"))).toBe(4);
    expect(aggregateColumn(rows, column("avg"))).toBe(2.5);
    expect(aggregateColumn(rows, column("min"))).toBe(1);
    expect(aggregateColumn(rows, column("max"))).toBe(4);
    expect(aggregateColumn(rows, column("count", "category"))).toBe(4);
    // A ratio divides sums; it never averages the row ratios.
    expect(aggregateColumn(rows, columns[5]!)).toBeCloseTo(221 / 1460, 10);
    expect(aggregateColumn(rows, { key: "brand", label: "Brand" })).toBeNull();
    expect(aggregateColumn([], column("sum"))).toBeNull();
    expect(aggregateColumn([{ profit: 1, revenue: 0 }], columns[5]!)).toBeNull();
  });
});

describe("Top N", () => {
  const topN = dataset({ topN: { by: "revenue", other: true } });
  test("keeps the N highest rows in their original order and folds the rest into Other", () => {
    const result = applyTopN(rows, topN, 2, true);
    expect(keys(result.rows)).toEqual(["B", "D", null]);
    const other = result.rows[2]!;
    expect(isOtherRow(other)).toBe(true);
    expect(isOtherRow(rows[0]!)).toBe(false);
    expect(other).toEqual({ category: "Other", brand: null, units: 3, revenue: 160, profit: 91, margin: 91 / 160 });
    expect(result.hidden).toBe(3);
    // Totals cover every source row when Other is shown.
    expect(result.members).toHaveLength(5);
  });
  test("without Other, totals cover only the kept rows; bottom keeps the lowest", () => {
    const plain = applyTopN(rows, dataset({ topN: { by: "revenue" } }), 2, true);
    expect(keys(plain.rows)).toEqual(["B", "D"]);
    expect(plain.members).toHaveLength(2);
    expect(keys(applyTopN(rows, dataset({ topN: { by: "revenue", order: "bottom" } }), 2, true).rows)).toEqual(["C", "E"]);
  });
  test("all rows, no Top N, or incomplete results never invent an Other row", () => {
    expect(applyTopN(rows, topN, 0, true).rows).toBe(rows);
    expect(applyTopN(rows, topN, 9, true).rows).toBe(rows);
    expect(applyTopN(rows, dataset(), 2, true).rows).toBe(rows);
    // Ranking only the rows within the limit could miss the true top, so nothing changes.
    expect(applyTopN(rows, topN, 2, false)).toEqual({ rows, members: rows, hidden: 0 });
  });
  test("rows without a ranking value are never kept, and an empty remainder adds no Other row", () => {
    const sparse: Row[] = [{ category: "A", revenue: null }, { category: "B", revenue: 5 }, { category: "C", revenue: 1 }, { category: "D", revenue: null }];
    const result = applyTopN(sparse, topN, 3, true);
    expect(keys(result.rows, "category")).toEqual(["B", "C"]);
    expect(result.hidden).toBe(2);
    // Fewer rows than N still drop the unrankable ones; with none rankable nothing changes.
    expect(keys(applyTopN(sparse, topN, 9, true).rows, "category")).toEqual(["B", "C"]);
    const empty: Row[] = [{ category: "A", revenue: null }, { category: "B", revenue: null }];
    expect(applyTopN(empty, topN, 1, true)).toEqual({ rows: empty, members: empty, hidden: 0 });
  });
  test("Other stays last whatever the table order", () => {
    const { rows: ranked, members } = applyTopN(rows, topN, 2, true);
    for (const sort of [{ column: "revenue", direction: "desc" }, { column: "category", direction: "asc" }] as const) {
      const table = shapeTable(ranked, topN, sort, "en", true, members);
      expect(isOtherRow(table.rows.at(-1)!.row)).toBe(true);
    }
  });
  test("the Other label goes to the chart key column, then the first column without an aggregate", () => {
    expect(topNLabelColumn(topN)).toBe("category");
    expect(topNLabelColumn(dataset({ topN: { by: "revenue", label: "brand" } }))).toBe("brand");
    expect(topNLabelColumn(dataset({ topN: { by: "revenue" }, chart: { type: "pie", category: "brand", value: "revenue" } }))).toBe("brand");
    expect(topNChoices(topN.topN!)).toEqual({ options: [5, 10, 25], initial: 5 });
    expect(topNChoices({ by: "revenue", options: [3, 7], default: 7 })).toEqual({ options: [3, 7], initial: 7 });
    expect(topNChoices({ by: "revenue", default: 0 }).initial).toBe(0);
  });
});

describe("table shape", () => {
  test("totals aggregate every row and are omitted for incomplete results", () => {
    const table = shapeTable(rows, dataset({ totals: true }), undefined, "en", true);
    expect(table.rows.map((r) => r.kind)).toEqual(["row", "row", "row", "row", "row"]);
    expect(table.totals).toEqual({ category: null, brand: null, units: 10, revenue: 1460, profit: 221, margin: 221 / 1460 });
    expect(shapeTable(rows, dataset({ totals: true }), undefined, "en", false).totals).toBeUndefined();
    expect(shapeTable(rows, dataset(), undefined, "en", true).totals).toBeUndefined();
  });
  test("subtotals group rows in first-appearance order with a subtotal after each group", () => {
    const table = shapeTable(rows, dataset({ subtotals: ["category"] }), undefined, "en", true);
    expect(table.rows.map((r) => r.kind === "row" ? r.row.brand : `Σ ${r.row.category}`))
      .toEqual(["A", "C", "Σ Toys", "B", "D", "Σ Food", "E", "Σ null"]);
    const toys = table.rows[2]!;
    expect(toys).toMatchObject({ kind: "subtotal", level: 0, column: "category" });
    expect(toys.row).toEqual({ category: "Toys", brand: null, units: 3, revenue: 150, profit: 90, margin: 0.6 });
  });
  test("sorting orders rows within groups and groups by their subtotal", () => {
    const table = shapeTable(rows, dataset({ subtotals: ["category"] }), { column: "revenue", direction: "desc" }, "en", true);
    expect(table.rows.map((r) => r.kind === "row" ? r.row.brand : `Σ ${r.row.category}`))
      .toEqual(["D", "B", "Σ Food", "A", "C", "Σ Toys", "E", "Σ null"]);
    const byName = shapeTable(rows, dataset({ subtotals: ["category"] }), { column: "category", direction: "asc" }, "en", true);
    expect(byName.rows.filter((r) => r.kind === "subtotal").map((r) => r.row.category)).toEqual(["Food", "Toys", null]);
  });
  test("nested subtotals carry outer group values; incomplete results skip subtotals", () => {
    const nested = shapeTable(rows.slice(0, 4), dataset({ subtotals: ["category", "brand"] }), undefined, "en", true);
    expect(nested.rows.map((r) => r.kind === "row" ? "row" : `${r.level}:${r.row.category}/${r.row.brand}`))
      .toEqual(["row", "1:Toys/A", "row", "1:Toys/C", "0:Toys/null", "row", "1:Food/B", "row", "1:Food/D", "0:Food/null"]);
    expect(shapeTable(rows, dataset({ subtotals: ["category"] }), undefined, "en", false).rows.every((r) => r.kind === "row")).toBe(true);
  });
});

describe("validation", () => {
  test("accepts complete definitions", () => {
    expect(validateTable(dataset({
      totals: true, subtotals: ["category"], defaultSort: { column: "revenue", direction: "desc" },
    }))).toBeUndefined();
    expect(validateTable(dataset({ topN: { by: "revenue", options: [3, 7], default: 7, other: true, otherLabel: "Rest" } }))).toBeUndefined();
  });
  test.each([
    [{ columns: [{ key: "a", label: "A", aggregate: "median" as never }] }, "column a aggregate must be sum, count, min, max, avg or { ratio: [numerator, denominator] }"],
    [{ columns: [{ key: "a", label: "A", aggregate: { ratio: ["b", "missing"] } as never }, { key: "b", label: "B" }] }, "column a ratio references unknown column missing"],
    [{ totals: true, columns: [{ key: "a", label: "A" }] }, "totals require at least one column aggregate"],
    [{ defaultSort: { column: "missing", direction: "asc" } }, "defaultSort references unknown column missing"],
    [{ defaultSort: { column: "units", direction: "up" as never } }, "defaultSort direction must be asc or desc"],
    [{ subtotals: [] }, "subtotals require at least one column"],
    [{ subtotals: ["units"] }, "subtotals column units cannot have an aggregate"],
    [{ subtotals: ["category", "category"] }, "subtotals has duplicate columns"],
    [{ subtotals: ["missing"] }, "subtotals references unknown column missing"],
    [{ subtotals: ["category"], topN: { by: "revenue" } }, "topN cannot be combined with subtotals"],
    [{ topN: { by: "missing" } }, "topN by references unknown column missing"],
    [{ topN: { by: "revenue", options: [0] } }, "topN options must be distinct positive integers up to 1000"],
    [{ topN: { by: "revenue", options: [5, 5] } }, "topN options must be distinct positive integers up to 1000"],
    [{ topN: { by: "revenue", default: 3 } }, "topN default must be 0 (all rows) or one of its options"],
    [{ columns: [{ key: "m", label: "M", aggregate: { ratio: ["m", "m"] } as never }] }, "column m ratio cannot reference itself"],
    [{ defaultSort: null as never }, "defaultSort must be { column, direction }"],
    [{ topN: null as never }, "topN must be { by, options?, default?, order?, other? }"],
    [{ columns: [{ key: "a", label: "A", aggregate: "sum" as const }], topN: { by: "a", other: true } }, "topN other requires a column without an aggregate to name the Other row"],
    [{ topN: { by: "revenue", other: true }, chart: { type: "treemap", path: ["category", "brand"], value: "revenue" } }, "topN other requires a pie, funnel, radar or category-axis cartesian chart, or no chart"],
    [{ topN: { by: "revenue", other: true }, chart: { type: "cartesian", x: "units", xType: "value", series: [{ key: "revenue", label: "R" }] } }, "topN other requires a pie, funnel, radar or category-axis cartesian chart, or no chart"],
    [{ topN: { by: "revenue", order: "high" as never } }, "topN order must be top or bottom"],
    [{ topN: { by: "brand", other: true } }, "topN other requires an aggregate on brand"],
    [{ topN: { by: "revenue", label: "units" } }, "topN label column units cannot have an aggregate"],
    [{ topN: { by: "revenue", otherLabel: "" } }, "topN otherLabel must be a non-empty string"],
  ] as const)("rejects %o", (extra, message) => {
    expect(validateTable(dataset(extra as Partial<DatasetDefinition>))).toBe(message);
  });
});
