import { expect, spyOn, test } from "bun:test";
import { DashyEngine } from "../core/engine";
import { mountRows } from "../core/sources";
import type { ProjectDefinition } from "../core/types";

const project: ProjectDefinition = {
  name: "Sessions",
  params: { minimum: { label: "Minimum", type: "number" } },
  sources: { data: { type: "memory", path: "" } },
  queries: {
    sum: {
      label: "Sum",
      sources: ["data"],
      params: ["minimum"],
      build: ({ source, params }) => ({
        text: `SELECT SUM(value) AS value FROM ${source("data")} WHERE value >= ?`,
        values: [Number(params.minimum ?? 0)],
      }),
    },
    count: {
      label: "Count",
      sources: ["data"],
      build: ({ source }) => ({
        text: `SELECT COUNT(*) AS value FROM ${source("data")}`,
        values: [],
      }),
    },
  },
  metrics: {
    sum: { label: "Sum", query: "sum", column: "value" },
    count: { label: "Count", query: "count", column: "value" },
  },
  datasets: {},
  dashboards: {
    overview: {
      label: "Overview",
      params: ["minimum"],
      blocks: [
        { id: "sum", type: "metric", metric: "sum" },
        { id: "count", type: "metric", metric: "count" },
      ],
    },
  },
};

test("request-local mounts are reused but concurrent requests and later refreshes stay isolated", async () => {
  const connections = new Set();
  let mounts = 0;
  let values = [1, 2, 3];
  const engine = new DashyEngine(project, {
    memory: async ({ connection, name }) => {
      mounts++;
      connections.add(connection);
      await mountRows(
        connection,
        name,
        values.map((value) => ({ value })),
        ["value"],
      );
    },
  });
  const results = await Promise.all([
    engine.dashboard("overview"),
    engine.dashboard("overview", { minimum: 3 }),
  ]);
  expect(results[0]!.blocks).toMatchObject([{ value: 6 }, { value: "3" }]);
  expect(results[1]!.blocks).toMatchObject([{ value: 3 }, { value: "3" }]);
  expect(mounts).toBe(2);
  expect(connections.size).toBe(2);
  values = [10];
  expect((await engine.dashboard("overview")).blocks).toMatchObject([
    { value: 10 },
    { value: "1" },
  ]);
  expect(mounts).toBe(3);
  expect(connections.size).toBe(3);
});

test("a failed query does not prevent a later independent block from executing", async () => {
  const errors = spyOn(console, "error").mockImplementation(() => {});
  try {
    const engine = new DashyEngine(
      {
        ...project,
        queries: {
          ...project.queries,
          sum: {
            ...project.queries.sum!,
            build: () => ({
              text: "SELECT missing_column FROM data",
              values: [],
            }),
          },
        },
      },
      {
        memory: async ({ connection, name }) =>
          mountRows(connection, name, [{ value: 3 }], ["value"]),
      },
    );
    expect((await engine.dashboard("overview")).blocks).toMatchObject([
      { type: "error" },
      { type: "metric", value: "1" },
    ]);
  } finally {
    errors.mockRestore();
  }
});

test("restricted queries are checked before mounting sources even in a shared session", async () => {
  let mounts = 0;
  const engine = new DashyEngine(
    {
      ...project,
      queries: Object.fromEntries(
        Object.entries(project.queries).map(([key, value]) => [
          key,
          { ...value, roles: ["reader"] },
        ]),
      ),
    },
    {
      memory: async ({ connection, name }) => {
        mounts++;
        await mountRows(connection, name, [{ value: 1 }], ["value"]);
      },
    },
  );
  expect((await engine.dashboard("overview")).blocks).toMatchObject([
    { type: "error", message: "Access denied" },
    { type: "error", message: "Access denied" },
  ]);
  expect(mounts).toBe(0);
  expect(
    (await engine.dashboard("overview", {}, { roles: ["reader"] })).blocks,
  ).toMatchObject([{ value: 1 }, { value: "1" }]);
  expect(mounts).toBe(1);
});
