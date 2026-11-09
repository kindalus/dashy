import { describe, expect, test } from "bun:test";
import ExcelJS from "exceljs";
import { DashyEngine } from "../core/engine";
import { exportFile, readExportOptions, toCsv, toXlsx, type ExportInput } from "../core/export";
import { createApiHandler } from "../core/http";
import { mountRows } from "../core/sources";
import type { DatasetDefinition, ProjectDefinition, QueryResult } from "../core/types";

const definition: DatasetDefinition = {
  label: "Sales: by [brand]",
  query: "q",
  columns: [
    { key: "category", label: "Category" },
    { key: "brand", label: "Brand, name" },
    { key: "revenue", label: "Revenue", format: { style: "currency", currency: "EUR", decimals: 0 }, aggregate: "sum" },
    { key: "margin", label: "Margin", format: { style: "percent" }, aggregate: { ratio: ["profit", "revenue"] } },
    { key: "profit", label: "Profit", aggregate: "sum" },
    { key: "day", label: "Day", format: { style: "date" } },
  ],
  subtotals: ["category"],
  totals: true,
};
const rows = [
  { category: "Toys", brand: "=HYPERLINK(\"x\")", revenue: "100", margin: 0.5, profit: 50, day: "2026-01-02" },
  { category: "Food", brand: "Say \"hi\"\nthere", revenue: 300, margin: 0.1, profit: 30, day: null },
  { category: "Toys", brand: "-5", revenue: 50, margin: 0.8, profit: 40, day: "2026-01-03" },
];
const result = (extra: Partial<QueryResult> = {}): QueryResult => ({ columns: Object.keys(rows[0]!), rows, truncated: false, durationMs: 1, ...extra });
const input = (extra: Partial<ExportInput> = {}): ExportInput => ({
  dashboardId: "sales", dashboardLabel: "Sales", blockId: "brands", definition, result: result(),
  filters: { region: ["North", "South"], period: { from: "2026-01-01", until: "2026-01-31" }, online: true, store: null },
  filterNames: ["region", "period", "online", "store", "channel"],
  ignored: ["channel"],
  params: {
    region: { label: "Region", type: "array", options: [{ label: "North", value: "North" }, { label: "South", value: "South" }] },
    period: { label: "Period", type: "range", valueType: "date" },
    online: { label: "Online", type: "boolean" },
    store: { label: "Store", type: "string" },
    channel: { label: "Channel", type: "string" },
  },
  generatedAt: new Date("2026-11-09T10:00:00Z"),
  locale: "en",
  options: { format: "csv" },
  ...extra,
});

describe("export options", () => {
  const read = (query: string, dataset: DatasetDefinition = definition) => readExportOptions(new URLSearchParams(query), dataset);
  test("reads format, sort and Top N", () => {
    expect(read("")).toEqual({ format: "csv" });
    expect(read("_format=xlsx&_sort=revenue:desc")).toEqual({ format: "xlsx", sort: { column: "revenue", direction: "desc" } });
    const topN = { ...definition, subtotals: undefined, topN: { by: "revenue", options: [2, 5] } };
    expect(read("_top=2", topN)).toEqual({ format: "csv", top: 2 });
    expect(read("_top=0", topN)).toEqual({ format: "csv", top: 0 });
  });
  test.each([
    ["_format=pdf", "_format must be csv or xlsx"],
    ["_sort=revenue", "_sort must be"],
    ["_sort=missing:asc", "_sort must be"],
    ["_sort=revenue:up", "_sort must be"],
    ["_top=5", "_top requires a dataset with topN"],
  ])("rejects %s", (query, message) => {
    expect(() => read(query)).toThrow(message);
  });
  test("rejects Top N choices the dataset does not offer", () => {
    expect(() => read("_top=3", { ...definition, subtotals: undefined, topN: { by: "revenue", options: [2, 5] } })).toThrow("_top must be 0");
  });
});

describe("CSV", () => {
  test("has a BOM, label header, raw values, RFC 4180 quoting and formula guards, without summary rows", () => {
    const csv = toCsv(input());
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual([
      'Category,"Brand, name",Revenue,Margin,Profit,Day',
      `Toys,"'=HYPERLINK(""x"")",100,0.5,50,2026-01-02`,
      "Toys,-5,50,0.8,40,2026-01-03",
      'Food,"Say ""hi""\nthere",300,0.1,30,',
      "",
    ]);
  });
  test("follows the requested sort and Top N choice", () => {
    const flat = { ...definition, subtotals: undefined, totals: undefined, topN: { by: "revenue", options: [1, 2], other: true } };
    const csv = toCsv(input({ definition: flat, options: { format: "csv", top: 1, sort: { column: "revenue", direction: "asc" } } }));
    // Top 1 keeps Food (300); the rest becomes Other, which stays last whatever the sort.
    expect(csv.slice(1).split("\r\n").slice(1, 3)).toEqual(['Food,"Say ""hi""\nthere",300,0.1,30,', "Other,,150,0.6,90,"]);
  });
});

describe("Excel", () => {
  const load = async (data: Uint8Array) => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(data.buffer as ArrayBuffer);
    return workbook;
  };
  test("writes typed, formatted cells with subtotal and total rows and a Filters sheet", async () => {
    const workbook = await load(await toXlsx(input({ options: { format: "xlsx", sort: { column: "revenue", direction: "desc" } } })));
    expect(workbook.worksheets.map((s) => s.name)).toEqual(["Sales  by  brand", "Filters"]);
    const sheet = workbook.worksheets[0]!;
    const row = (n: number) => (sheet.getRow(n).values as unknown[]).slice(1);
    expect(row(1)).toEqual(["Category", "Brand, name", "Revenue", "Margin", "Profit", "Day"]);
    expect(sheet.getRow(1).font?.bold).toBe(true);
    // Groups sort by subtotal (Food 300 before Toys 150); the formula text stays a string.
    expect(["A2", "B2", "C2", "D2", "E2", "F2"].map((cell) => sheet.getCell(cell).value))
      .toEqual(["Food", "Say \"hi\"\nthere", 300, 0.1, 30, null]);
    expect(["A3", "B3", "C3", "E3"].map((cell) => sheet.getCell(cell).value)).toEqual(["Food total", null, 300, 30]);
    expect(sheet.getRow(3).font?.bold).toBe(true);
    expect(sheet.getCell("B4").value).toBe("=HYPERLINK(\"x\")");
    expect(sheet.getCell("C4").value).toBe(100);
    expect(sheet.getCell("F4").value).toEqual(new Date("2026-01-02T00:00:00Z"));
    expect(sheet.getCell("A6").value).toBe("Toys total");
    expect(sheet.getCell("A7").value).toBe("Total");
    expect(sheet.getCell("C7").value).toBe(450);
    expect(sheet.getCell("D7").value).toBeCloseTo(120 / 450, 10);
    expect(sheet.getCell("C2").numFmt).toBe("[$EUR] #,##0");
    expect(sheet.getCell("D2").numFmt).toBe("0.0#%");
    expect(sheet.getCell("F4").numFmt).toBe("yyyy-mm-dd");
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    const filters = workbook.getWorksheet("Filters")!;
    const values = filters.getSheetValues().slice(2).map((r) => (r as unknown[]).slice(1));
    expect(values).toEqual([
      ["Dashboard", "Sales"],
      ["Block", "Sales: by [brand]"],
      ["Region", "North, South"],
      ["Period", "2026-01-01 – 2026-01-31"],
      ["Online", "Yes"],
      ["Store", "All"],
      ["Channel", "Not applied to this block"],
      ["Sorted by", "Revenue (descending)"],
      ["Generated", "2026-11-09T10:00:00.000Z"],
    ]);
  });
  test("numeric strings become numbers unless they are text, zero-padded or beyond 2^53; local timestamps are UTC", async () => {
    const typed: DatasetDefinition = {
      label: "Filters", query: "q",
      columns: [
        { key: "count", label: "Count" }, { key: "code", label: "Code" }, { key: "big", label: "Big" },
        { key: "id", label: "Id", format: { style: "text" } }, { key: "at", label: "At", format: { style: "date" } },
        { key: "huge", label: "Huge", aggregate: "sum" },
      ],
    };
    const data = [{ count: "5706", code: "00123", big: "12345678901234567890", id: "42", at: "2024-01-05 00:30:00", huge: "1e400" },
      { count: "5414149.80", code: "+244923456789", big: "1e5", id: "1.10", at: null, huge: "7" }];
    const workbook = await load(await toXlsx(input({ definition: typed, result: result({ rows: data }), options: { format: "xlsx" } })));
    // A dataset named like the info sheet (or History) gets a safe name.
    expect(workbook.worksheets.map((s) => s.name)).toEqual(["Data", "Filters"]);
    const sheet = workbook.worksheets[0]!;
    expect(["A2", "B2", "C2", "D2", "F2"].map((c) => sheet.getCell(c).value)).toEqual([5706, "00123", "12345678901234567890", "42", "1e400"]);
    expect(sheet.getCell("E2").value).toEqual(new Date("2024-01-05T00:30:00Z"));
    expect(["A3", "B3", "C3", "D3", "F3"].map((c) => sheet.getCell(c).value)).toEqual([5414149.8, "+244923456789", "1e5", "1.10", 7]);
    expect((await load(await toXlsx(input({ definition: { ...typed, label: "history" }, result: result({ rows: data }), options: { format: "xlsx" } })))).worksheets[0]!.name).toBe("Data");
  });
  test("CSV rounds float noise in computed values", () => {
    const flat: DatasetDefinition = { label: "T", query: "q", columns: [{ key: "k", label: "K" }, { key: "v", label: "V", aggregate: "sum" }], topN: { by: "v", options: [1], other: true } };
    const data = [{ k: "a", v: 5 }, { k: "b", v: 0.1 }, { k: "c", v: 0.2 }];
    expect(toCsv(input({ definition: flat, result: result({ rows: data }) })).slice(1).split("\r\n").slice(1, 3)).toEqual(["a,5", "Other,0.3"]);
    // Query values are written exactly.
    const exact = [{ k: "a", v: 1234567890123456 }, { k: "b", v: 0.6686790505675955 }];
    expect(toCsv(input({ definition: { ...flat, topN: undefined }, result: result({ rows: exact }) })).slice(1).split("\r\n").slice(1, 3))
      .toEqual(["a,1234567890123456", "b,0.6686790505675955"]);
  });
  test("incomplete results have no totals and say so", async () => {
    const workbook = await load(await toXlsx(input({ result: result({ truncated: true }), options: { format: "xlsx" } })));
    const sheet = workbook.worksheets[0]!;
    expect(sheet.rowCount).toBe(4);
    const info = workbook.getWorksheet("Filters")!.getSheetValues().slice(2).map((r) => (r as unknown[]).slice(1));
    expect(info.at(-1)).toEqual(["Note", "Row limit reached: the data is incomplete, so totals, subtotals and Top N were skipped."]);
  });
  test("files are named after the dashboard, block and date", async () => {
    const file = await exportFile(input({ dashboardId: "Vendas Março", blockId: "top/brands" }));
    expect(file.filename).toBe("vendas-marco-top-brands-2026-11-09.csv");
    expect(file.contentType).toBe("text/csv; charset=utf-8");
    expect((await exportFile(input({ options: { format: "xlsx" } }))).contentType).toContain("spreadsheetml");
  });
});

describe("export endpoint", () => {
  const sales = [
    { region: "North", brand: "A", amount: 10 },
    { region: "North", brand: "B", amount: 5 },
    { region: "South", brand: "C", amount: 7 },
  ];
  const project: ProjectDefinition = {
    name: "Export",
    params: { region: { label: "Region", type: "array", options: [{ label: "North", value: "North" }, { label: "South", value: "South" }] } },
    sources: { sales: { type: "memory", path: "" } },
    queries: {
      by_brand: { label: "By brand", sources: ["sales"], params: ["region"], build: ({ source, params, sql }) => {
        const w = sql.where(sql.in("region", (params.region as string[] | undefined) ?? []));
        return { text: `SELECT region, brand, SUM(amount) AS amount FROM ${source("sales")} ${w.text} GROUP BY 1, 2 ORDER BY 2`, values: w.values };
      } },
      total: { label: "Total", sources: ["sales"], params: ["region"], build: ({ source, params, sql }) => {
        const w = sql.where(sql.in("region", (params.region as string[] | undefined) ?? []));
        return { text: `SELECT SUM(amount) AS amount FROM ${source("sales")} ${w.text}`, values: w.values };
      } },
    },
    metrics: { total: { label: "Total", query: "total", column: "amount" } },
    datasets: {
      by_brand: {
        label: "By brand", query: "by_brand",
        columns: [{ key: "region", label: "Region", param: "region" }, { key: "brand", label: "Brand" }, { key: "amount", label: "Amount", aggregate: "sum" }],
        topN: { by: "amount", options: [1, 2], other: true },
      },
      sorted: {
        label: "Sorted", query: "by_brand", defaultSort: { column: "amount", direction: "desc" },
        columns: [{ key: "brand", label: "Brand" }, { key: "amount", label: "Amount" }],
      },
      secret: { label: "Secret", query: "by_brand", roles: ["admin"], columns: [{ key: "brand", label: "Brand" }] },
    },
    dashboards: {
      overview: {
        label: "Overview", params: ["region"],
        blocks: [
          { id: "total", type: "metric", metric: "total" }, { id: "brands", type: "dataset", dataset: "by_brand" },
          { id: "sorted", type: "dataset", dataset: "sorted" }, { id: "secret", type: "dataset", dataset: "secret" },
        ],
      },
      locked: { label: "Locked", roles: ["admin"], params: [], blocks: [{ id: "brands", type: "dataset", dataset: "by_brand" }] },
    },
  };
  const engine = new DashyEngine(project, {
    memory: async ({ connection, name }) => mountRows(connection, name, sales, Object.keys(sales[0]!)),
  });
  const api = createApiHandler(engine);
  const get = (path: string) => api(new Request(`http://localhost${path}`));

  test("downloads the block with filters, cross-filter exclusions, Top N and sort", async () => {
    const response = await get("/api/dashboard-export/overview/brands?region=North&_top=2&_sort=amount:asc");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="overview-brands-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await response.text()).slice(1).split("\r\n")).toEqual(["Region,Brand,Amount", "North,B,5", "North,A,10", ""]);
    // The origin block of a cross-filter keeps all its rows, as on screen.
    const origin = await get("/api/dashboard-export/overview/brands?region=North&_xf=brands:region&_top=0");
    expect((await origin.text()).split("\r\n")).toHaveLength(5);
    const top = await get("/api/dashboard-export/overview/brands?_top=1");
    expect((await top.text()).slice(1).split("\r\n").slice(1, 3)).toEqual(["North,A,10", "Other,,12"]);
  });
  test("serves Excel", async () => {
    const response = await get("/api/dashboard-export/overview/brands?_format=xlsx");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("spreadsheetml");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b]);
  });
  test("rejects metric blocks, unknown blocks, bad options and unreadable dashboards", async () => {
    expect((await get("/api/dashboard-export/overview/total")).status).toBe(404);
    expect((await get("/api/dashboard-export/overview/missing")).status).toBe(404);
    expect((await get("/api/dashboard-export/overview/brands?_format=pdf")).status).toBe(400);
    expect((await get("/api/dashboard-export/overview/brands?_top=7")).status).toBe(400);
    expect((await get("/api/dashboard-export/overview/brands?_unknown=1")).status).toBe(400);
    expect((await get("/api/dashboard-export/locked/brands")).status).toBe(403);
    // A dataset's own roles keep their status rather than becoming a generic failure.
    expect((await get("/api/dashboard-export/overview/secret")).status).toBe(403);
    // Access is checked before options, so bad options cannot probe a restricted dataset.
    expect((await get("/api/dashboard-export/overview/secret?_sort=nosuch:asc")).status).toBe(403);
  });
  test("without _sort the dataset's defaultSort applies; an empty _sort keeps the query order", async () => {
    const lines = async (query: string) => (await (await get(`/api/dashboard-export/overview/sorted${query}`)).text()).slice(1).split("\r\n").slice(1, 4);
    expect(await lines("")).toEqual(["A,10", "C,7", "B,5"]);
    expect(await lines("?_sort=")).toEqual(["A,10", "B,5", "C,7"]);
  });
});
