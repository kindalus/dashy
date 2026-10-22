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

test("imports exact types, nulls and SQL-looking text as data", async () => {
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

test("native import crosses chunk boundaries and preserves numeric, text and timestamp values", async () => {
  await withConnection(async (connection) => {
    const rows = Array.from({ length: 4097 }, (_, id) => ({
      id,
      safe: Number.MAX_SAFE_INTEGER,
      precise: "-9223372036854775808",
      fraction: -1.5,
      label: "before\u0000after 🦆",
      flag: "true",
      timestamp: "2026-02-15 12:34:56.123456",
    }));
    await mountRows(connection, "chunks", rows, Object.keys(rows[0]!), {
      id: "BIGINT", safe: "BIGINT", precise: "BIGINT", fraction: "BIGINT",
      flag: "BOOLEAN", timestamp: "TIMESTAMP",
    });
    const result = (await connection.runAndReadAll(
      "SELECT *, count(*) OVER () AS total FROM chunks ORDER BY id DESC LIMIT 1",
    )).getRowObjectsJson();
    expect(result).toEqual([{
      id: "4096", total: "4097", safe: "9007199254740991",
      precise: "-9223372036854775808", fraction: "-2", flag: true,
      label: "before\u0000after 🦆", timestamp: "2026-02-15 12:34:56.123456",
    }]);
  });
});

test("failed native conversions reject and leave the connection usable", async () => {
  await withConnection(async (connection) => {
    for (const [name, value, type] of [
      ["bad_date", "not-a-date", "DATE"],
      ["bad_number", "9223372036854775808", "BIGINT"],
      ["bad_bool", "perhaps", "BOOLEAN"],
    ] as const) {
      await expect(mountRows(connection, name, [{ first: 1, value }],
        ["first", "value"], { value: type })).rejects.toThrow();
    }
    await mountRows(connection, "good", [{ value: 42 }], ["value"]);
    expect((await connection.runAndReadAll("SELECT * FROM good")).getRowObjectsJson())
      .toEqual([{ value: 42 }]);
  });
});

test("native import stops between chunks after cancellation", async () => {
  await withConnection(async (connection) => {
    const controller = new AbortController();
    let read = 0;
    const rows = Array.from({ length: 10000 }, () => ({
      get value() {
        if (++read === 2049) controller.abort();
        return read;
      },
    }));
    await expect(mountRows(connection, "cancelled", rows, ["value"],
      { value: "DOUBLE" }, controller.signal)).rejects.toThrow();
    expect(read).toBe(4096);
    expect((await connection.runAndReadAll("SELECT 1 AS value")).getRowObjectsJson())
      .toEqual([{ value: 1 }]);
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
