import { resolve } from "node:path";
import { stat } from "node:fs/promises";
import type { DuckDBConnection } from "@duckdb/node-api";
import { setImmediate } from "node:timers/promises";
import type { SourceDefinition, Row } from "./types";
import { identifier, literal } from "./sql";

export interface AdapterContext {
  connection: DuckDBConnection;
  source: SourceDefinition;
  name: string;
  path: string;
  signal?: AbortSignal;
}
/** Register another format by mounting a view/table named context.name. */
export type SourceAdapter = (context: AdapterContext) => Promise<void>;
const MAX_IMPORTED_ROWS = 100_000;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const cellValue = (row: Row, column: string) =>
  Object.hasOwn(row, column) ? (row[column] ?? null) : null;

export async function mountRows(
  connection: DuckDBConnection,
  name: string,
  rows: Row[],
  columns: string[],
  types: SourceDefinition["columns"] = {},
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (
    !columns.length ||
    new Set(columns).size !== columns.length ||
    columns.some((c) => !c)
  )
    throw new Error(`Source ${name} must have unique, non-empty columns`);
  if (rows.length > MAX_IMPORTED_ROWS)
    throw new Error(
      `Source ${name} exceeds ${MAX_IMPORTED_ROWS} imported rows; use CSV, Parquet or DuckDB for larger sources`,
    );
  const resolvedTypes = columns.map((column) => {
    if (Object.hasOwn(types, column) && types[column]) return types[column];
    const values = rows
      .map((row) => cellValue(row, column))
      .filter((value) => value !== null && value !== undefined);
    if (values.length && values.every((value) => typeof value === "number"))
      return "DOUBLE";
    if (values.length && values.every((value) => typeof value === "boolean"))
      return "BOOLEAN";
    return "VARCHAR";
  });
  const allowed = new Set([
    "VARCHAR",
    "DOUBLE",
    "BIGINT",
    "BOOLEAN",
    "DATE",
    "TIMESTAMP",
  ]);
  if (resolvedTypes.some((type) => !allowed.has(type)))
    throw new Error("Unsupported column type");
  await connection.run(
    `CREATE TEMP TABLE ${identifier(name)} (${columns.map((column, i) => `${identifier(column)} ${resolvedTypes[i]}`).join(", ")})`,
  );
  // The native appender retains DuckDB's casts without preparing INSERT SQL.
  const appender = await connection.createAppender(name);
  try {
    signal?.throwIfAborted();
    for (let offset = 0; offset < rows.length; offset++) {
      const row = rows[offset]!;
      for (let i = 0; i < columns.length; i++) {
        const value = cellValue(row, columns[i]!);
        if (value === null) appender.appendNull();
        else if (resolvedTypes[i] === "VARCHAR") appender.appendVarchar(String(value));
        else if (typeof value === "number") appender.appendDouble(value);
        else if (typeof value === "boolean") appender.appendBoolean(value);
        else appender.appendVarchar(value);
      }
      appender.endRow();
      // Keep imports cooperative with HTTP requests and query timeouts.
      if ((offset + 1) % 2048 === 0) {
        await setImmediate();
        signal?.throwIfAborted();
      }
    }
  } finally {
    appender.closeSync();
  }
}
const fileView =
  (reader: string, options = ""): SourceAdapter =>
  async ({ connection, name, path }) => {
    await connection.run(
      `CREATE TEMP VIEW ${identifier(name)} AS SELECT * FROM ${reader}(${literal(path)}${options})`,
    );
  };
export const builtInAdapters: Record<string, SourceAdapter> = {
  csv: async (context) => {
    const delimiter = context.source.delimiter;
    await fileView(
      "read_csv",
      `, header = true${delimiter ? `, delim = ${literal(delimiter)}` : ""}`,
    )(context);
  },
  json: fileView("read_json_auto"),
  parquet: fileView("read_parquet", ", hive_partitioning = true"),
  duckdb: async ({ connection, name, source, path }) => {
    if (!source.table) throw new Error(`DuckDB source ${name} requires table`);
    const catalog = identifier(`db_${name}`);
    await connection.run(`ATTACH ${literal(path)} AS ${catalog} (READ_ONLY)`);
    await connection.run(
      `CREATE TEMP VIEW ${identifier(name)} AS SELECT * FROM ${catalog}.${identifier(source.schema || "main")}.${identifier(source.table)}`,
    );
  },
  sqlite: async ({ connection, name, source, path, signal }) => {
    if (!source.table) throw new Error(`SQLite source ${name} requires table`);
    // https://bun.sh/docs/runtime/sqlite#readonly-mode
    const { Database } = await import("bun:sqlite");
    const db = new Database(path, {
      readonly: true,
      strict: true,
      safeIntegers: true,
    });
    try {
      const statement = db.query(
        `SELECT * FROM ${identifier(source.table)} LIMIT ${MAX_IMPORTED_ROWS + 1}`,
      );
      const raw = statement.all() as Record<string, unknown>[];
      const rows = raw.map(
        (row) =>
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => {
              if (typeof value === "bigint")
                return [
                  key,
                  value <= BigInt(Number.MAX_SAFE_INTEGER) &&
                  value >= BigInt(Number.MIN_SAFE_INTEGER)
                    ? Number(value)
                    : String(value),
                ];
              if (value instanceof Uint8Array)
                throw new Error(
                  `SQLite BLOB column ${key} requires a custom adapter`,
                );
              return [key, value];
            }),
          ) as Row,
      );
      await mountRows(
        connection,
        name,
        rows,
        statement.columnNames,
        source.columns,
        signal,
      );
    } finally {
      db.close();
    }
  },
  excel: async ({ connection, name, source, path, signal }) => {
    if ((await stat(path)).size > MAX_FILE_BYTES)
      throw new Error("Excel file exceeds 100 MB");
    // https://github.com/exceljs/exceljs#reading-xlsx
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path);
    signal?.throwIfAborted();
    const sheet = source.sheet
      ? workbook.getWorksheet(source.sheet)
      : workbook.worksheets[0];
    if (!sheet) throw new Error(`Worksheet not found in source ${name}`);
    const headerRow = source.headerRow ?? 1;
    const columns: string[] = [];
    sheet
      .getRow(headerRow)
      .eachCell({ includeEmpty: true }, (cell) =>
        columns.push(cell.text.trim()),
      );
    const rows: Row[] = [];
    sheet.eachRow((row, index) => {
      if (index <= headerRow) return;
      if (rows.length >= MAX_IMPORTED_ROWS)
        throw new Error(`Excel source exceeds ${MAX_IMPORTED_ROWS} rows`);
      const result: Row = Object.create(null);
      columns.forEach((column, i) => {
        const cell = row.getCell(i + 1);
        const value =
          cell.type === ExcelJS.ValueType.Formula ? cell.result : cell.value;
        if (cell.type === ExcelJS.ValueType.Formula && value === undefined)
          throw new Error(
            `Formula ${cell.address} has no cached result; recalculate the workbook before importing`,
          );
        if (value && typeof value === "object" && "error" in value)
          throw new Error(`Excel error in ${cell.address}`);
        result[column] =
          value instanceof Date
            ? value.toISOString()
            : value === null || value === undefined
              ? null
              : typeof value === "object"
                ? cell.text
                : (value as string | number | boolean);
      });
      rows.push(result);
    });
    await mountRows(connection, name, rows, columns, source.columns, signal);
  },
};
export async function mountSource(
  connection: DuckDBConnection,
  name: string,
  source: SourceDefinition,
  dataDir: string,
  adapters: Record<string, SourceAdapter>,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const adapter = adapters[source.type];
  if (!adapter)
    throw new Error(`No adapter registered for source type: ${source.type}`);
  const path = resolve(dataDir, source.path);
  await adapter({ connection, source, name, path, signal });
}
