import { afterAll, beforeAll, expect, test } from "bun:test";
import ExcelJS from "exceljs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DashyEngine } from "../core/engine";
import type { ProjectDefinition } from "../core/types";
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "dashy-excel-"));
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sales");
  sheet.addRow(["date", "amount", "label"]);
  sheet.addRow([new Date("2026-01-01T00:00:00Z"), 10, "First"]);
  sheet.addRow([
    new Date("2026-01-02T00:00:00Z"),
    { formula: "B2*2", result: 20 },
    "Second",
  ]);
  await workbook.xlsx.writeFile(join(dir, "sales.xlsx"));
});
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});
function project(sheet = "Sales"): ProjectDefinition {
  return {
    name: "Excel test",
    dataDir: dir,
    params: {},
    sources: { sales: { type: "excel", path: "sales.xlsx", sheet } },
    queries: {
      total: {
        label: "Total",
        sources: ["sales"],
        build: ({ source }) => ({
          text: `SELECT SUM(amount) AS amount FROM ${source("sales")}`,
          values: [],
        }),
      },
    },
    metrics: { total: { label: "Total", query: "total", column: "amount" } },
    datasets: {},
    dashboards: {},
  };
}
test("reads numeric Excel cells and cached formula values", async () => {
  expect(Number(await new DashyEngine(project()).metric("total"))).toBe(30);
});
test("reports a missing worksheet rather than using another sheet", async () => {
  await expect(
    new DashyEngine(project("Missing")).metric("total"),
  ).rejects.toThrow("Worksheet not found");
});

test("the bundled Excel sample matches the other source formats", async () => {
  const { default: sample } =
    await import("../samples/source-examples/dashy.config");
  const result = await new DashyEngine(sample).query("preview_excel_orders");
  expect(result.rows).toHaveLength(12);
  expect(Number(result.rows[0]!.revenue)).toBe(240);
});
