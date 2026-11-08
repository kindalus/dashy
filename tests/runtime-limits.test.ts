import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DuckDBInstance } from "@duckdb/node-api";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DashyEngine } from "../core/engine";
import { createApiHandler } from "../core/http";
import { DatabasePool, parseBytes } from "../core/pool";
import { QueryCache } from "../core/cache";
import { resolveSourcePath, sourceHasFiles } from "../core/sources";
import type { ProjectDefinition, QueryResult } from "../core/types";

let lake: string;
beforeAll(async () => {
  lake = await mkdtemp(join(tmpdir(), "dashy-lake-"));
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  for (const [year, month, amount] of [[2025, 12, 10], [2026, 1, 20], [2026, 2, 30]] as const) {
    const directory = join(lake, "gold/sales", `year=${year}`, `month=${String(month).padStart(2, "0")}`);
    await mkdir(directory, { recursive: true });
    await connection.run(`COPY (SELECT ${amount} AS amount, 'sku-${month}' AS sku) TO '${join(directory, "part-0.parquet")}' (FORMAT parquet)`);
  }
  // A later file with an extra column exercises union_by_name.
  const extra = join(lake, "gold/sales/year=2026/month=03");
  await mkdir(extra, { recursive: true });
  await connection.run(`COPY (SELECT 40 AS amount, 'sku-3' AS sku, 'promo' AS note) TO '${join(extra, "part-0.parquet")}' (FORMAT parquet)`);
  await mkdir(join(lake, "gold/empty"), { recursive: true });
  connection.closeSync();
  instance.closeSync();
});
afterAll(async () => { await rm(lake, { recursive: true, force: true }); });

function lakeProject(extra: Partial<ProjectDefinition> = {}): ProjectDefinition {
  return {
    name: "Lake",
    dataDir: lake,
    params: { year: { label: "Year", type: "number", integer: true } },
    sources: {
      sales: { type: "parquet", path: "gold/sales/**/*.parquet", hive: { types: { year: "INTEGER", month: "VARCHAR" } }, unionByName: true },
      empty: { type: "parquet", path: "gold/empty/**/*.parquet" },
    },
    queries: {
      totals: {
        label: "Totals", sources: ["sales"], params: ["year"],
        build: ({ source, params, sql }) => {
          const where = sql.where(sql.eq("year", params.year as number | undefined));
          return { text: `SELECT SUM(amount) AS total, COUNT(*) AS files, ANY_VALUE(typeof(month)) AS month_type, COUNT(note) AS notes FROM ${source("sales")} ${where.text}`, values: where.values };
        },
      },
      empty: { label: "Empty", sources: ["empty"], build: ({ source }) => ({ text: `SELECT COUNT(*) AS n FROM ${source("empty")}`, values: [] }) },
      slow: { label: "Slow", sources: [], build: () => ({ text: "SELECT SUM(i) AS n FROM range(300000000) t(i)", values: [] }) },
    },
    metrics: {}, datasets: {}, dashboards: {},
    ...extra,
  };
}

describe("parquet globs and hive partitions", () => {
  test("globs read partitioned files with declared hive types and union by name", async () => {
    const engine = new DashyEngine(lakeProject());
    const all = (await engine.query("totals")).rows[0]!;
    expect(Number(all.total)).toBe(100);
    expect(all.month_type).toBe("VARCHAR");
    expect(Number(all.notes)).toBe(1);
    expect(Number((await engine.query("totals", { year: 2026 })).rows[0]!.total)).toBe(90);
  });
  test("an empty glob answers 503 without revealing the path", async () => {
    const response = await createApiHandler(new DashyEngine(lakeProject()))(new Request("http://localhost/api/queries/empty"));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ error: "Data unavailable for source empty" });
    expect(JSON.stringify(body)).not.toContain(lake);
  });
  test("globs must stay inside dataDir", async () => {
    expect(() => resolveSourcePath(lake, "../other/**/*.parquet")).toThrow("relative to dataDir");
    expect(() => resolveSourcePath(lake, "/etc/**/*.parquet")).toThrow("relative to dataDir");
    expect(resolveSourcePath(lake, "/absolute/file.parquet")).toBe("/absolute/file.parquet");
    expect(await sourceHasFiles(join(lake, "gold/sales/**/*.parquet"))).toBe(true);
    expect(await sourceHasFiles(join(lake, "gold/empty/**/*.parquet"))).toBe(false);
    expect(await sourceHasFiles(join(lake, "missing/**/*.parquet"))).toBe(false);
  });
});

describe("process-wide limits", () => {
  test("byte sizes", () => {
    expect(parseBytes("512MB")).toBe(512e6);
    expect(parseBytes("1GiB")).toBe(1024 ** 3);
    expect(parseBytes(2048)).toBe(2048);
    expect(() => parseBytes("much")).toThrow();
  });
  test("one instance enforces the memory limit and the configured timezone", async () => {
    const engine = new DashyEngine({
      ...lakeProject({ limits: { memory: "256MiB", threads: 1 }, timezone: "Africa/Luanda" }),
      queries: { settings: { label: "Settings", sources: [], build: () => ({ text: "SELECT current_setting('memory_limit') AS memory, current_setting('threads') AS threads, current_setting('TimeZone') AS tz", values: [] }) } },
    });
    const row = (await engine.query("settings")).rows[0]!;
    expect(String(row.memory)).toBe("256.0 MiB");
    expect(Number(row.threads)).toBe(1);
    expect(row.tz).toBe("Africa/Luanda");
    // Even code with a raw connection cannot raise limits or change the timezone.
    const lease = await engine.pool.acquire();
    try {
      await expect(lease.connection.run("SET memory_limit = '8GB'")).rejects.toThrow("locked");
      await expect(lease.connection.run("SET TimeZone = 'UTC'")).rejects.toThrow("locked");
    } finally {
      await lease.release();
    }
  });
  test("excess sessions queue, then receive 503 with Retry-After", async () => {
    const engine = new DashyEngine(lakeProject({ limits: { maxConcurrentQueries: 1, maxQueuedQueries: 1, queueTimeoutMs: 20_000, queryTimeoutMs: 20_000 } }));
    const api = createApiHandler(engine);
    const controller = new AbortController();
    const running = api(new Request("http://localhost/api/queries/slow", { signal: controller.signal }));
    await Bun.sleep(50);
    const queued = api(new Request("http://localhost/api/queries/totals"));
    await Bun.sleep(20);
    expect(engine.pool.stats).toEqual({ active: 1, queued: 1 });
    const rejected = await api(new Request("http://localhost/api/queries/totals"));
    expect(rejected.status).toBe(503);
    expect(rejected.headers.get("Retry-After")).toBe("2");
    controller.abort();
    expect((await running).status).toBe(499);
    // The queued request inherits the freed slot.
    expect((await queued).status).toBe(200);
    expect(engine.pool.stats).toEqual({ active: 0, queued: 0 });
  });
  test("a queued request times out and cancelled waiters leave the queue", async () => {
    const pool = new DatabasePool({ maxConcurrentQueries: 1, maxQueuedQueries: 5, queueTimeoutMs: 50 });
    const lease = await pool.acquire();
    await expect(pool.acquire()).rejects.toMatchObject({ status: 503 });
    const controller = new AbortController();
    const waiting = pool.acquire(controller.signal);
    expect(pool.stats.queued).toBe(1);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ status: 499 });
    expect(pool.stats.queued).toBe(0);
    await lease.release();
    expect(pool.stats.active).toBe(0);
    await pool.close();
  });
  test("leases are isolated: temporary views and attachments end with the request", async () => {
    const pool = new DatabasePool({ maxConcurrentQueries: 2 });
    const first = await pool.acquire();
    await first.connection.run("CREATE TEMP VIEW leaked AS SELECT 1 AS x");
    const second = await pool.acquire();
    await expect(second.connection.run("SELECT * FROM leaked")).rejects.toThrow();
    await first.release();
    const third = await pool.acquire();
    await expect(third.connection.run("SELECT * FROM leaked")).rejects.toThrow();
    await second.release();
    await third.release();
    await pool.close();
  });
});

describe("result cache", () => {
  const result = (n: number): QueryResult => ({ columns: ["n"], rows: [{ n }], truncated: false, durationMs: 1 });
  test("TTL, refresh and LRU by bytes", async () => {
    let now = 0;
    const cache = new QueryCache({ ttlSeconds: 10, maxBytes: 2000 }, () => now);
    let runs = 0;
    const run = () => cache.fetch("k", async () => result(++runs));
    expect((await run()).rows[0]!.n).toBe(1);
    const hit = await run();
    expect(hit.rows[0]!.n).toBe(1);
    expect(hit.cached).toBe(true);
    expect((await cache.fetch("k", async () => result(++runs), { refresh: true })).rows[0]!.n).toBe(2);
    now = 11_000;
    expect((await run()).rows[0]!.n).toBe(3);
    for (let i = 0; i < 20; i++) await cache.fetch(`other-${i}`, async () => result(i));
    expect(cache.size.bytes).toBeLessThanOrEqual(2000);
  });
  test("concurrent misses share one execution and errors are not cached", async () => {
    const cache = new QueryCache({ ttlSeconds: 60 });
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow = async () => { runs++; await gate; return result(runs); };
    const all = Promise.all([cache.fetch("k", slow), cache.fetch("k", slow), cache.fetch("k", slow)]);
    release();
    expect((await all).map((r) => r.rows[0]!.n)).toEqual([1, 1, 1]);
    expect(runs).toBe(1);
    await expect(cache.fetch("bad", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect((await cache.fetch("bad", async () => result(7))).rows[0]!.n).toBe(7);
  });
  test("engine caching skips sources, honours refresh, query opt-out and roles", async () => {
    let mounts = 0;
    let value = 1;
    const project: ProjectDefinition = {
      name: "Cached",
      cache: { ttlSeconds: 60 },
      params: {},
      sources: { data: { type: "memory", path: "" } },
      queries: {
        cached: { label: "Cached", sources: ["data"], roles: ["reader"], build: ({ source }) => ({ text: `SELECT * FROM ${source("data")}`, values: [] }) },
        live: { label: "Live", sources: ["data"], cache: false, build: ({ source }) => ({ text: `SELECT * FROM ${source("data")}`, values: [] }) },
      },
      metrics: {}, datasets: {}, dashboards: {},
    };
    const engine = new DashyEngine(project, {
      memory: async ({ connection, name }) => {
        mounts++;
        await connection.run(`CREATE TEMP VIEW "${name}" AS SELECT ${value} AS n`);
      },
    });
    const reader = { roles: ["reader"] };
    expect((await engine.query("cached", {}, reader)).rows[0]!.n).toBe(1);
    value = 2;
    const second = await engine.query("cached", {}, reader);
    expect(second.rows[0]!.n).toBe(1);
    expect(second.cached).toBe(true);
    expect(mounts).toBe(1);
    await expect(engine.query("cached")).rejects.toMatchObject({ status: 403 });
    expect((await engine.query("cached", {}, reader, undefined, { refresh: true })).rows[0]!.n).toBe(2);
    expect((await engine.query("live")).rows[0]!.n).toBe(2);
    value = 3;
    expect((await engine.query("live")).rows[0]!.n).toBe(3);
    const api = createApiHandler(new DashyEngine({ ...project, authenticate: () => reader }, {
      memory: async ({ connection, name }) => { await connection.run(`CREATE TEMP VIEW "${name}" AS SELECT ${value} AS n`); },
    }));
    expect((await (await api(new Request("http://localhost/api/queries/cached"))).json()).rows[0].n).toBe(3);
    value = 4;
    expect((await (await api(new Request("http://localhost/api/queries/cached"))).json()).rows[0].n).toBe(3);
    expect((await (await api(new Request("http://localhost/api/queries/cached?refresh=true"))).json()).rows[0].n).toBe(4);
  });
});
