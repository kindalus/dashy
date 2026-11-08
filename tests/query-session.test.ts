import { expect, spyOn, test } from "bun:test";
import { DashyEngine } from "../core/engine";
import { createApiHandler } from "../core/http";
import { QuerySession } from "../core/query-session";
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
      unfiltered: { count: ["minimum"] },
      blocks: [
        { id: "sum", type: "metric", metric: "sum" },
        { id: "count", type: "metric", metric: "count" },
      ],
    },
  },
};

test("every data endpoint rejects an already cancelled request without mounting sources", async () => {
  let mounts = 0;
  const engine = new DashyEngine({
    ...project,
    datasets: { values: { label: "Values", query: "sum", columns: [{ key: "value", label: "Value" }] } },
  }, { memory: async () => { mounts++; } });
  const api = createApiHandler(engine);
  for (const endpoint of ["queries/sum", "metrics/sum", "datasets/values",
    "dashboards/overview", "dashboard-data/overview/sum"]) {
    const response = await api(new Request(`http://localhost/api/${endpoint}`, {
      signal: AbortSignal.abort(new Error("private cancellation reason")),
    }));
    expect(response.status).toBe(499);
    expect(await response.json()).toEqual({ error: "Request cancelled" });
  }
  expect(mounts).toBe(0);
});

test("cancelling during an uncooperative adapter prevents SQL and later source mounts", async () => {
  const controller = new AbortController();
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let laterMounts = 0;
  let adapterSignal: AbortSignal | undefined;
  let reads: ReturnType<typeof spyOn> | undefined;
  const session = new QuerySession({
    ...project, sources: { first: { type: "slow", path: "" }, second: { type: "later", path: "" } },
  }, {
    slow: async ({ connection, signal }) => {
      adapterSignal = signal;
      reads = spyOn(connection, "runAndReadAll");
      entered();
      await gate;
    },
    later: async () => { laterMounts++; },
  }, controller.signal);
  try {
    const result = session.run(["first", "second"], { text: "SELECT 42", values: [] }, 10)
      .catch((error) => error);
    await started;
    controller.abort();
    expect(adapterSignal?.aborted).toBe(true);
    release();
    expect(await result).toMatchObject({ status: 499, message: "Request cancelled" });
    expect(laterMounts).toBe(0);
    expect(reads).not.toHaveBeenCalled();
  } finally {
    release();
    reads?.mockRestore();
    await session.close();
  }
});

test("cancelling a running DuckDB query interrupts only its own session", async () => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let interrupts: ReturnType<typeof spyOn> | undefined;
  const session = new QuerySession(project, {
    memory: async ({ connection }) => {
      interrupts = spyOn(connection, "interrupt");
      timer = setTimeout(() => controller.abort(), 50);
    },
  }, controller.signal);
  const independent = new QuerySession(project, {});
  try {
    const cancelled = session.run(["data"], {
      text: "SELECT SUM(i) FROM range(10000000000) t(i)", values: [],
    }, 10).catch((error) => error);
    const result = await independent.run([], { text: "SELECT 42 AS value", values: [] }, 10);
    expect(result.rows).toEqual([{ value: 42 }]);
    expect(await cancelled).toMatchObject({ status: 499 });
    expect(interrupts).toHaveBeenCalledTimes(1);
  } finally {
    clearTimeout(timer);
    interrupts?.mockRestore();
    await session.close();
    await independent.close();
  }
});

test("completed queries remove cancellation listeners before their connection closes", async () => {
  const controller = new AbortController();
  let interrupts: ReturnType<typeof spyOn> | undefined;
  const session = new QuerySession(project, {
    memory: async ({ connection }) => { interrupts = spyOn(connection, "interrupt"); },
  }, controller.signal);
  try {
    await session.run(["data"], { text: "SELECT 1", values: [] }, 10);
    await session.close();
    controller.abort();
    expect(interrupts).not.toHaveBeenCalled();
  } finally {
    interrupts?.mockRestore();
  }
});

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
