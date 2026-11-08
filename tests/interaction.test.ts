import { describe, expect, test } from "bun:test";
import { DashyEngine, readCrossFilters } from "../core/engine";
import { createApiHandler } from "../core/http";
import { mountRows } from "../core/sources";
import type { ProjectDefinition } from "../core/types";

const sales = [
  { client: "C1", name: "Clínica Talatona", category: "Food", amount: 10 },
  { client: "C1", name: "Clínica Talatona", category: "Toys", amount: 5 },
  { client: "C2", name: "Vet Viana", category: "Food", amount: 7 },
  { client: "C3", name: "50% Pets_Lda", category: "Toys", amount: 3 },
];
const where = (params: Record<string, unknown>, sql: typeof import("../core/sql").sql) => sql.where(
  sql.eq("client", params.client as string | undefined),
  sql.in("category", (params.category as string[] | undefined) ?? []),
);
function project(): ProjectDefinition {
  return {
    name: "Interaction",
    params: {
      client: { label: "Client", type: "string", options: { query: "clients", value: "client", label: "name", search: true } },
      category: { label: "Category", type: "array", options: { query: "categories", value: "category" } },
      strictClient: { label: "Client (strict)", type: "string", strict: true, options: { query: "clients", value: "client", label: "name" } },
    },
    sources: { sales: { type: "memory", path: "" } },
    queries: {
      clients: { label: "Clients", sources: ["sales"], params: ["category"], build: ({ source, params, sql }) => {
        const w = sql.where(sql.in("category", (params.category as string[] | undefined) ?? []));
        return { text: `SELECT DISTINCT client, name FROM ${source("sales")} ${w.text} ORDER BY client`, values: w.values };
      } },
      categories: { label: "Categories", sources: ["sales"], build: ({ source }) => ({ text: `SELECT DISTINCT category FROM ${source("sales")} ORDER BY 1`, values: [] }) },
      by_client: { label: "By client", sources: ["sales"], params: ["client", "category"], build: ({ source, params, sql }) => {
        const w = where(params, sql);
        return { text: `SELECT client, name, SUM(amount) AS amount FROM ${source("sales")} ${w.text} GROUP BY 1, 2 ORDER BY 1`, values: w.values };
      } },
      by_category: { label: "By category", sources: ["sales"], params: ["client", "category"], build: ({ source, params, sql }) => {
        const w = where(params, sql);
        return { text: `SELECT category, SUM(amount) AS amount FROM ${source("sales")} ${w.text} GROUP BY 1 ORDER BY 1`, values: w.values };
      } },
      total: { label: "Total", sources: ["sales"], params: ["client", "category"], build: ({ source, params, sql }) => {
        const w = where(params, sql);
        return { text: `SELECT COALESCE(SUM(amount), 0) AS amount FROM ${source("sales")} ${w.text}`, values: w.values };
      } },
      strict_total: { label: "Strict total", sources: ["sales"], params: ["strictClient"], build: ({ source, params, sql }) => {
        const w = sql.where(sql.eq("client", params.strictClient as string | undefined));
        return { text: `SELECT COALESCE(SUM(amount), 0) AS amount FROM ${source("sales")} ${w.text}`, values: w.values };
      } },
    },
    metrics: { total: { label: "Total", query: "total", column: "amount" } },
    datasets: {
      by_client: { label: "By client", query: "by_client", columns: [{ key: "name", label: "Client", param: { name: "client", from: "client" } }, { key: "amount", label: "Amount" }] },
      by_category: { label: "By category", query: "by_category", columns: [{ key: "category", label: "Category", param: "category" }, { key: "amount", label: "Amount" }] },
    },
    dashboards: {
      overview: {
        label: "Overview", params: ["category"],
        blocks: [
          { id: "total", type: "metric", metric: "total" },
          { id: "categories", type: "dataset", dataset: "by_category" },
          { id: "clients", type: "dataset", dataset: "by_client" },
        ],
      },
      client: {
        label: "Client 360", params: ["client", "category"], required: ["client"], drillthrough: { param: "client" },
        blocks: [{ id: "total", type: "metric", metric: "total" }, { id: "categories", type: "dataset", dataset: "by_category" }],
      },
    },
  };
}
const engine = new DashyEngine(project(), {
  memory: async ({ connection, name }) => mountRows(connection, name, sales, Object.keys(sales[0]!)),
});
const api = createApiHandler(engine);
const get = async (path: string) => {
  const response = await api(new Request(`http://localhost${path}`));
  return { status: response.status, body: await response.json() };
};

describe("query-backed parameter options", () => {
  test("lists, searches with escaped wildcards and resolves labels", async () => {
    expect((await engine.paramOptions("client")).options).toEqual([
      { value: "C1", label: "Clínica Talatona" }, { value: "C2", label: "Vet Viana" }, { value: "C3", label: "50% Pets_Lda" },
    ]);
    expect((await engine.paramOptions("client", {}, { search: "viana" })).options).toEqual([{ value: "C2", label: "Vet Viana" }]);
    // % and _ are literal characters, not LIKE wildcards.
    expect((await engine.paramOptions("client", {}, { search: "0%" })).options.map((o) => o.value)).toEqual(["C3"]);
    expect((await engine.paramOptions("client", {}, { search: "t_l" })).options).toEqual([]);
    expect((await engine.paramOptions("client", {}, { values: ["C3", "C1"] })).options.map((o) => o.label).sort())
      .toEqual(["50% Pets_Lda", "Clínica Talatona"]);
    expect((await engine.paramOptions("client", {}, { limit: 2 })).truncated).toBe(true);
  });
  test("options follow other filters the options query accepts and ignore the rest", async () => {
    const options = await engine.paramOptions("client", { category: ["Toys"], unrelated: "x" });
    expect(options.options.map((o) => o.value)).toEqual(["C1", "C3"]);
  });
  test("search is refused when the parameter does not enable it", async () => {
    await expect(engine.paramOptions("category", {}, { search: "fo" })).rejects.toThrow("does not support search");
  });
  test("HTTP endpoint uses underscore keys and validates", async () => {
    const result = await get("/api/params/client/options?_q=tal&category=Food&category=Toys");
    expect(result).toEqual({ status: 200, body: { options: [{ value: "C1", label: "Clínica Talatona" }], truncated: false } });
    expect((await get("/api/params/client/options?_value=C2")).body.options).toEqual([{ value: "C2", label: "Vet Viana" }]);
    expect((await get("/api/params/client/options?_limit=x")).status).toBe(400);
    expect((await get("/api/params/nope/options")).status).toBe(404);
  });
  test("strict parameters reject unknown values before running data queries", async () => {
    expect(Number((await engine.query("strict_total", { strictClient: "C2" })).rows[0]!.amount)).toBe(7);
    await expect(engine.query("strict_total", { strictClient: "C9" })).rejects.toThrow("Invalid option for strictClient");
  });
});

describe("required parameters", () => {
  test("a dashboard without its required value runs no queries", async () => {
    const shell = engine.dashboardShell("client");
    expect(shell.missing).toEqual(["client"]);
    expect(shell.requests).toEqual([]);
    expect((await engine.dashboard("client")).blocks).toEqual([]);
    expect((await get("/api/dashboard-data/client/total")).status).toBe(400);
    const loaded = await engine.dashboard("client", { client: "C1" });
    expect(loaded.blocks[0]).toMatchObject({ type: "metric", value: 15 });
  });
});

describe("cross-filters", () => {
  test("origins are parsed from repeated _xf keys and validated against the dashboard", () => {
    expect(readCrossFilters(new URLSearchParams("_xf=a:b&_xf=bad&_xf=c:d:e"))).toEqual([{ block: "a", param: "b" }]);
    const valid = engine.dashboardShell("overview", { category: ["Food"] }, undefined, {
      crossFilters: [{ block: "categories", param: "category" }, { block: "total", param: "category" }, { block: "clients", param: "category" }],
    });
    // Metrics and datasets without an annotated column cannot originate a cross-filter.
    expect(valid.crossFilters).toEqual([{ block: "categories", param: "category" }]);
    // Without a value the origin is meaningless and is dropped.
    expect(engine.dashboardShell("overview", {}, undefined, { crossFilters: [{ block: "categories", param: "category" }] }).crossFilters).toEqual([]);
  });
  test("the origin block keeps its own selection visible while the rest is filtered", async () => {
    const options = { crossFilters: [{ block: "categories", param: "category" }] };
    const shell = engine.dashboardShell("overview", { category: ["Food"] }, undefined, options);
    expect(shell.requests).toEqual([
      { id: "total", blockIds: ["total"] },
      { id: "categories", blockIds: ["categories"] },
      { id: "clients", blockIds: ["clients"] },
    ]);
    const result = await engine.dashboard("overview", { category: ["Food"] }, undefined, undefined, options);
    const block = (id: string) => result.blocks.find((b) => b.id === id)!;
    expect(block("total")).toMatchObject({ value: 17 });
    const categories = block("categories");
    expect(categories.type === "dataset" && categories.result.rows.map((r) => r.category)).toEqual(["Food", "Toys"]);
    const clients = block("clients");
    expect(clients.type === "dataset" && clients.result.rows.map((r) => r.client)).toEqual(["C1", "C2"]);
  });
  test("the shell endpoint recomputes requests from the URL", async () => {
    const { body } = await get("/api/dashboard-shell/overview?category=Food&_xf=categories:category");
    expect(body.crossFilters).toEqual([{ block: "categories", param: "category" }]);
    expect(body.requests.map((r: { id: string }) => r.id)).toEqual(["total", "categories", "clients"]);
    const data = await get("/api/dashboard-data/overview/categories?category=Food&_xf=categories:category");
    expect(data.body.blocks[0].result.rows.length).toBe(2);
  });
});

describe("catalog", () => {
  test("exposes readable datasets with accepted parameters and column annotations", () => {
    const catalog = engine.catalog();
    expect(catalog.timezone).toBe("UTC");
    expect(catalog.datasets.by_client).toEqual({
      label: "By client",
      params: ["client", "category"],
      columns: [{ key: "name", label: "Client", param: { name: "client", from: "client" } }, { key: "amount", label: "Amount" }],
    });
    expect("build" in (catalog.datasets.by_client as object)).toBe(false);
  });
});
