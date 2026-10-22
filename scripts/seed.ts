import { DuckDBInstance } from "@duckdb/node-api";
import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { literal } from "../core/sql";

const dir = resolve("samples/source-examples/data");
await mkdir(dir, { recursive: true });
const db = await DuckDBInstance.create(":memory:");
const connection = await db.connect();
try {
  await connection.run(
    `CREATE TABLE orders AS SELECT * FROM read_csv(${literal(`${dir}/orders.csv`)}, header = true)`,
  );
  const rows = (
    await connection.runAndReadAll("SELECT * FROM orders")
  ).getRowObjectsJson() as Record<string, any>[];
  await Bun.write(`${dir}/orders.json`, JSON.stringify(rows, null, 2) + "\n");
  const sqlite = new Database(`${dir}/orders.sqlite`);
  try {
    sqlite.run("DROP TABLE IF EXISTS orders");
    sqlite.run(
      "CREATE TABLE orders (date TEXT, region TEXT, product TEXT, units INTEGER, revenue REAL)",
    );
    const insert = sqlite.prepare("INSERT INTO orders VALUES (?, ?, ?, ?, ?)");
    sqlite.transaction(() =>
      rows.forEach((row) =>
        insert.run(row.date, row.region, row.product, row.units, row.revenue),
      ),
    )();
  } finally {
    sqlite.close();
  }
  await connection.run(
    `COPY orders TO ${literal(`${dir}/orders.parquet`)} (FORMAT PARQUET)`,
  );
  await connection.run(`ATTACH ${literal(`${dir}/orders.duckdb`)} AS sample`);
  await connection.run(
    "CREATE OR REPLACE TABLE sample.orders AS SELECT * FROM orders",
  );
  await connection.run("DETACH sample");
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Orders");
  sheet.addRow(["date", "region", "product", "units", "revenue"]);
  rows.forEach((row) =>
    sheet.addRow([row.date, row.region, row.product, row.units, row.revenue]),
  );
  await book.xlsx.writeFile(`${dir}/orders.xlsx`);
  console.log(
    "Created sample JSON, SQLite, Parquet, DuckDB and Excel sources.",
  );
} finally {
  connection.closeSync();
  db.closeSync();
}
