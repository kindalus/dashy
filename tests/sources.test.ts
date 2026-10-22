import { expect, test } from "bun:test";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { mountRows } from "../core/sources";
import type { Row, SourceDefinition } from "../core/types";

async function withConnection(
  run: (connection: DuckDBConnection) => Promise<void>,
) {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  try {
    await run(connection);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

test("imports multiple batches and their remainder with exact types, nulls and bound text", async () => {
  await withConnection(async (connection) => {
    const rows: Row[] = Array.from({ length: 601 }, (_, id) => ({
      id,
      amount: id / 4,
      enabled: id % 2 === 0,
      date: "2026-02-15",
      timestamp: "2026-02-15T12:34:56Z",
      large: "9007199254740993",
      label: id % 2 ? `row '${id}'; DROP TABLE data; --` : null,
      mixed: id % 2 ? "text" : 3,
    }));
    await mountRows(connection, "data", rows, Object.keys(rows[0]!), {
      id: "BIGINT",
      date: "DATE",
      timestamp: "TIMESTAMP",
      large: "BIGINT",
    });
    const result = (
      await connection.runAndReadAll(
        "SELECT *, typeof(date) AS date_type, typeof(timestamp) AS time_type FROM data ORDER BY id",
      )
    ).getRowObjectsJson();
    expect(result).toHaveLength(601);
    for (let i = 0; i < rows.length; i++) {
      expect(result[i]).toMatchObject({
        id: String(i),
        amount: i / 4,
        enabled: i % 2 === 0,
        date: "2026-02-15",
        large: "9007199254740993",
        label: rows[i]!.label,
        mixed: i % 2 ? "text" : "3",
        date_type: "DATE",
        time_type: "TIMESTAMP",
      });
    }
  });
});

test("empty imports retain columns and reject invalid column declarations", async () => {
  await withConnection(async (connection) => {
    await mountRows(connection, "empty", [], ["value"], { value: "DOUBLE" });
    const result = await connection.runAndReadAll("SELECT * FROM empty");
    expect(result.columnNames()).toEqual(["value"]);
    expect(result.getRowObjectsJson()).toEqual([]);
    await expect(mountRows(connection, "bad", [], ["x", "x"])).rejects.toThrow(
      "unique",
    );
    await expect(
      mountRows(connection, "bad", [], ["x"], {
        x: "SQL",
      } as unknown as SourceDefinition["columns"]),
    ).rejects.toThrow("Unsupported column type");
  });
});

test("column names can match Object prototype properties without inheriting values or types", async () => {
  await withConnection(async (connection) => {
    await mountRows(
      connection,
      "names",
      [{ constructor: "explicit" }, {}] as Row[],
      ["constructor", "toString"],
    );
    const rows = (
      await connection.runAndReadAll(
        'SELECT "constructor", "toString" FROM names',
      )
    ).getRowObjectsJson();
    expect(rows).toEqual([
      { constructor: "explicit", toString: null },
      { constructor: null, toString: null },
    ]);
  });
});
