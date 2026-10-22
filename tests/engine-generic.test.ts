import { describe, expect, test } from "bun:test";
import { DashyEngine } from "../core/engine";
import { defineProject } from "../core/project";
import { parseParams, readParams } from "../core/params";
import { mountRows } from "../core/sources";
import type { ProjectDefinition } from "../core/types";
import project from "../samples/source-examples/dashy.config";

const engine = new DashyEngine(project);
describe("generic engine with real source files", () => {
  for (const source of [
    "orders",
    "json_orders",
    "sqlite_orders",
    "duckdb_orders",
    "parquet_orders",
  ]) {
    test(`queries ${source}`, async () => {
      const result = await engine.query(`preview_${source}`);
      expect(result.columns).toEqual([
        "date",
        "region",
        "product",
        "units",
        "revenue",
      ]);
      expect(result.rows).toHaveLength(12);
      expect(Number(result.rows[0]!.revenue)).toBe(240);
      expect(result.truncated).toBe(false);
    });
  }
  test("dashboard filters reach all blocks and shared queries execute once", async () => {
    let count = 0;
    const counting = new DashyEngine(project, {
      csv: async (context) => {
        count++;
        const { builtInAdapters } = await import("../core/sources");
        await builtInAdapters.csv!(context);
      },
    });
    const result = await counting.dashboard("overview", {
      region: "North",
      period: { from: "2026-01-01", until: "2026-02-28" },
    });
    expect(result.blocks.filter((b) => b.type === "error")).toHaveLength(0);
    const revenue = result.blocks.find((b) => b.id === "revenue")!;
    expect(revenue.type === "metric" && Number(revenue.value)).toBe(640);
    expect(count).toBe(3);
  });
  test("supports custom adapters without changing the engine", async () => {
    const custom: ProjectDefinition = {
      name: "Custom",
      params: {},
      sources: { data: { type: "memory", path: "" } },
      queries: {
        sum: {
          label: "Sum",
          sources: ["data"],
          build: ({ source }) => ({
            text: `SELECT SUM(amount) AS total FROM ${source("data")}`,
            values: [],
          }),
        },
      },
      datasets: {},
      dashboards: {},
      metrics: { total: { label: "Total", query: "sum", column: "total" } },
    };
    const engine = new DashyEngine(custom, {
      memory: async ({ connection, name }) =>
        mountRows(connection, name, [{ amount: 2 }, { amount: 3 }], ["amount"]),
    });
    expect(Number(await engine.metric("total"))).toBe(5);
  });
  test("rejects unknown names and parameters", async () => {
    await expect(engine.query("constructor")).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      engine.query("summary", { injected: "x" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      engine.dashboard("overview", { region: "North' OR TRUE --" }),
    ).rejects.toThrow("Invalid option");
  });
  test("caps results and reports truncation", async () => {
    const limited = new DashyEngine({
      ...project,
      queries: {
        ...project.queries,
        preview_orders: {
          ...(project as ProjectDefinition).queries.preview_orders!,
          maxRows: 2,
        },
      },
    });
    expect(await limited.query("preview_orders")).toMatchObject({
      truncated: true,
      rows: [{ date: "2026-01-10" }, { date: "2026-01-18" }],
    });
  });
  test("enforces query roles even through a public dashboard", async () => {
    const restricted = new DashyEngine({
      ...project,
      queries: {
        ...project.queries,
        summary: { ...project.queries.summary, roles: ["analyst"] },
      },
    });
    await expect(restricted.metric("revenue")).rejects.toMatchObject({
      status: 403,
    });
    expect(
      Number(await restricted.metric("revenue", {}, { roles: ["analyst"] })),
    ).toBe(6420);
    const result = await restricted.dashboard("overview");
    expect(result.blocks[0]).toMatchObject({
      type: "error",
      message: "Access denied",
    });
  });
  test("validates registry references before serving", () => {
    expect(() =>
      defineProject({
        ...project,
        metrics: { broken: { label: "Broken", query: "missing", column: "x" } },
      }),
    ).toThrow("unknown query");
  });
});
describe("parameter contract", () => {
  test("validates dates rather than accepting impossible calendar days", () => {
    expect(() =>
      parseParams({ date: { label: "Date", type: "date" } }, ["date"], {
        date: "2026-02-30",
      }),
    ).toThrow("valid YYYY-MM-DD");
  });
  test("compares numeric ranges numerically", () => {
    expect(
      parseParams(
        { band: { label: "Band", type: "range", valueType: "number" } },
        ["band"],
        { band: { from: 2, until: 10 } },
      ),
    ).toEqual({ band: { from: 2, until: 10 } });
  });
  test("validates defaults as well as explicit inputs", () => {
    expect(() =>
      parseParams(
        { limit: { label: "Limit", type: "number", min: 1, default: -1 } },
        ["limit"],
        {},
      ),
    ).toThrow("allowed range");
    expect(() =>
      parseParams(
        { id: { label: "ID", type: "string", required: true } },
        ["id"],
        {},
      ),
    ).toThrow("required");
  });
  test("parses URL ranges and repeated keys without prototype pollution", () => {
    expect(
      readParams(
        new URLSearchParams(
          "period.from=2026-01-01&period.until=2026-02-01&tag=a&tag=b",
        ),
      ),
    ).toEqual({
      period: { from: "2026-01-01", until: "2026-02-01" },
      tag: ["a", "b"],
    });
    expect(() =>
      readParams(new URLSearchParams("period=x&period.from=y")),
    ).toThrow("range");
  });
});

test("binds arbitrary string values without treating them as SQL", async () => {
  const app: ProjectDefinition = {
    name: "Bound parameters",
    params: { search: { label: "Search", type: "string" } },
    sources: {},
    queries: {
      echo: {
        label: "Echo",
        sources: [],
        params: ["search"],
        build: ({ params }) => ({
          text: "SELECT ? AS value",
          values: [params.search as string],
        }),
      },
    },
    metrics: {},
    datasets: {},
    dashboards: {},
  };
  const payload = "x'; DROP TABLE orders; --";
  const result = await new DashyEngine(app).query("echo", { search: payload });
  expect(result.rows[0]!.value).toBe(payload);
});
test("joins sources of different formats in one query", async () => {
  const app: ProjectDefinition = {
    ...project,
    queries: {
      ...project.queries,
      joined: {
        label: "Join",
        sources: ["sqlite_orders", "json_orders"],
        build: ({ source }) => ({
          text: `SELECT COUNT(*) AS total FROM ${source("sqlite_orders")} a JOIN ${source("json_orders")} b ON a.date = b.date`,
          values: [],
        }),
      },
    },
  };
  expect(
    Number((await new DashyEngine(app).query("joined")).rows[0]!.total),
  ).toBe(12);
});
test("joins two sources from the same DuckDB file", async () => {
  const app: ProjectDefinition = {
    ...project,
    sources: {
      ...project.sources,
      other_orders: { ...project.sources.duckdb_orders! },
    },
    queries: {
      ...project.queries,
      same_file: {
        label: "Same database",
        sources: ["duckdb_orders", "other_orders"],
        build: ({ source }) => ({
          text: `SELECT COUNT(*) AS total FROM ${source("duckdb_orders")} a JOIN ${source("other_orders")} b ON a.date = b.date`,
          values: [],
        }),
      },
    },
  };
  expect(
    Number((await new DashyEngine(app).query("same_file")).rows[0]!.total),
  ).toBe(12);
});
test("keeps numeric nulls distinct from zero and retains columns for empty results", async () => {
  const app: ProjectDefinition = {
    name: "Empty data",
    params: {},
    sources: {},
    queries: {
      empty: {
        label: "Empty",
        sources: [],
        build: () => ({
          text: "SELECT CAST(NULL AS DOUBLE) AS value WHERE false",
          values: [],
        }),
      },
    },
    metrics: { total: { label: "Total", query: "empty", column: "value" } },
    datasets: {},
    dashboards: {},
  };
  const engine = new DashyEngine(app);
  expect(await engine.metric("total")).toBeNull();
  expect(await engine.query("empty")).toMatchObject({
    columns: ["value"],
    rows: [],
    truncated: false,
  });
});
test("rejects a blank required string after trimming whitespace", () => {
  expect(() =>
    parseParams(
      { id: { label: "ID", type: "string", required: true } },
      ["id"],
      { id: "  " },
    ),
  ).toThrow("required");
});

test("clearing a dashboard filter does not reapply its default inside queries", async () => {
  const configured: ProjectDefinition = {
    ...project,
    params: {
      ...project.params,
      region: { ...project.params.region, default: "North" },
    },
  };
  const engine = new DashyEngine(configured);
  const defaultResult = await engine.dashboard("overview");
  const clearedResult = await engine.dashboard("overview", { region: "" });
  expect(defaultResult.params.region).toBe("North");
  expect(clearedResult.params.region).toBeUndefined();
  expect(defaultResult.blocks[0]).toMatchObject({
    type: "metric",
    value: "3160",
  });
  expect(clearedResult.blocks[0]).toMatchObject({
    type: "metric",
    value: "6420",
  });
});

test("a truncated multirow query cannot masquerade as a scalar metric", async () => {
  const app: ProjectDefinition = {
    name: "Invalid metric",
    params: {},
    sources: {},
    queries: {
      rows: {
        label: "Rows",
        sources: [],
        maxRows: 1,
        build: () => ({
          text: "SELECT 1 AS value UNION ALL SELECT 2 AS value",
          values: [],
        }),
      },
    },
    metrics: { total: { label: "Total", query: "rows", column: "value" } },
    datasets: {},
    dashboards: {},
  };
  await expect(new DashyEngine(app).metric("total")).rejects.toThrow(
    "at most one row",
  );
});
