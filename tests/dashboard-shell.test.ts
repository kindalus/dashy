import { expect, test } from "bun:test";
import { DashyEngine } from "../core/engine";
import { createApiHandler } from "../core/http";
import { mountRows } from "../core/sources";
import empty from "../dashy.config";
import type { ProjectDefinition } from "../core/types";

function fixture() {
  let builds = 0;
  let mounts = 0;
  const project: ProjectDefinition = {
    ...empty,
    params: { minimum: { label: "Minimum", type: "number", default: 1 } },
    sources: { data: { type: "memory", path: "private-source" } },
    adapters: {
      memory: async ({ connection, name }) => {
        mounts++;
        await mountRows(connection, name, [{ value: 42 }], ["value"]);
      },
    },
    queries: {
      values: {
        label: "Private query",
        sources: ["data"],
        params: ["minimum"],
        build: ({ source, params }) => {
          builds++;
          return {
            text: `SELECT value FROM ${source("data")} WHERE value >= ?`,
            values: [Number(params.minimum ?? 0)],
          };
        },
      },
    },
    metrics: { total: { label: "Total", query: "values", column: "value" } },
    datasets: {
      rows: {
        label: "Rows",
        query: "values",
        columns: [{ key: "value", label: "Value" }],
      },
    },
    dashboards: {
      overview: {
        label: "Overview",
        params: ["minimum"],
        defaults: { minimum: 2 },
        blocks: [
          { id: "total", type: "metric", metric: "total" },
          { id: "rows", type: "dataset", dataset: "rows" },
        ],
      },
    },
  };
  return { project, counts: () => ({ builds, mounts }) };
}

test("the initial shell supplies layout, labels and filters without executing queries or mounting sources", async () => {
  const { project, counts } = fixture();
  const engine = new DashyEngine(project);
  const shell = engine.dashboardShell("overview", { minimum: "3" });
  expect(shell.params).toEqual({ minimum: 3 });
  expect(shell.definition.blocks).toHaveLength(2);
  expect(shell.labels).toEqual({ total: "Total", rows: "Rows" });
  expect(shell.requests).toEqual([{ id: "total", blockIds: ["total", "rows"] }]);
  expect(shell).not.toHaveProperty("blocks");
  expect(shell).not.toHaveProperty("generatedAt");
  expect(JSON.stringify(shell)).not.toContain("private-source");
  expect(counts()).toEqual({ builds: 0, mounts: 0 });
  expect(engine.dashboardShell("overview").params.minimum).toBe(2);
  expect(engine.dashboardShell("overview", { minimum: "" }).params).toEqual({});
  const result = await engine.dashboard("overview", { minimum: "3" });
  expect(result.blocks).toMatchObject([
    { value: 42 },
    { result: { rows: [{ value: 42 }] } },
  ]);
  expect(counts()).toEqual({ builds: 1, mounts: 1 });
});

test("independent data requests execute only their shared query, preserving dashboard defaults and cleared filters", async () => {
  const { project, counts } = fixture();
  project.dashboards.overview!.defaults = { minimum: 100 };
  project.queries.other = {
    label: "Other", sources: [],
    build: () => { throw new Error("Unrelated queries must not run"); },
  };
  project.metrics.other = { label: "Other", query: "other", column: "value" };
  project.dashboards.overview!.blocks = [
    ...project.dashboards.overview!.blocks,
    { id: "repeat", type: "dataset", dataset: "rows" },
    { id: "other", type: "metric", metric: "other" },
  ];
  const engine = new DashyEngine(project);
  expect(engine.dashboardShell("overview").requests).toEqual([
    { id: "total", blockIds: ["total", "rows", "repeat"] },
    { id: "other", blockIds: ["other"] },
  ]);
  const handler = createApiHandler(engine);
  const request = (path: string) => handler(new Request(`http://localhost${path}`));
  const first = await request("/api/dashboard-data/overview/total");
  expect(first.status).toBe(200);
  expect((await first.json()).blocks).toMatchObject([
    { id: "total", value: null }, { id: "rows", result: { rows: [] } }, { id: "repeat", result: { rows: [] } },
  ]);
  expect(counts()).toEqual({ builds: 1, mounts: 1 });
  const cleared = await request("/api/dashboard-data/overview/total?minimum=");
  expect((await cleared.json()).blocks[0].value).toBe(42);
  expect(counts()).toEqual({ builds: 2, mounts: 2 });
  expect((await request("/api/dashboard-data/overview/missing")).status).toBe(404);
  expect((await request("/api/dashboard-data/overview/%ZZ")).status).toBe(400);
  expect((await request("/api/dashboard-data/overview/total?minimum=bad")).status).toBe(400);
  project.metrics.total!.roles = ["reader"];
  const protectedBlock = await request("/api/dashboard-data/overview/total?minimum=");
  expect((await protectedBlock.json()).blocks).toMatchObject([
    { type: "error", message: "Access denied" }, { type: "dataset" }, { type: "dataset" },
  ]);
  project.dashboards.overview!.roles = ["reader"];
  expect((await request("/api/dashboard-data/overview/total")).status).toBe(403);
  project.authenticate = () => null;
  expect((await request("/api/dashboard-data/overview/total")).status).toBe(401);
});

test("shell requests enforce dashboard access, names and parameter validation", () => {
  const { project, counts } = fixture();
  project.dashboards.overview!.roles = ["reader"];
  const engine = new DashyEngine(project);
  expect(() => engine.dashboardShell("overview")).toThrow("Access denied");
  expect(() => engine.dashboardShell("missing")).toThrow("Dashboard not found");
  expect(() => engine.dashboardShell("constructor")).toThrow(
    "Dashboard not found",
  );
  expect(() => engine.dashboardShell(
    "overview", { minimum: "invalid" }, { roles: ["reader"] },
  )).toThrow();
  expect(engine.dashboardShell("overview", {}, { roles: ["reader"] }).id)
    .toBe("overview");
  expect(counts()).toEqual({ builds: 0, mounts: 0 });
});

test("shell labels respect both block and underlying query permissions", () => {
  const { project } = fixture();
  project.metrics.total!.roles = ["reader"];
  const engine = new DashyEngine(project);
  expect(engine.dashboardShell("overview").labels).toEqual({
    total: "Block unavailable", rows: "Rows",
  });
  project.queries.values!.roles = ["reader"];
  expect(engine.dashboardShell("overview").labels).toEqual({
    total: "Block unavailable", rows: "Block unavailable",
  });
  expect(engine.dashboardShell("overview", {}, { roles: ["reader"] }).labels)
    .toEqual({ total: "Total", rows: "Rows" });
});
