import { expect, test } from "bun:test";
import { DashboardLoader, dashboardSearchParams } from "../src/dashboard-loader";
import type { DashboardShell } from "../core/types";

const shell: DashboardShell = {
  id: "overview",
  definition: { label: "Overview", blocks: [] },
  params: {}, labels: {}, missing: [], crossFilters: [], drilldowns: {},
  requests: [
    { id: "shared", blockIds: ["metric", "chart", "table"] },
    { id: "other", blockIds: ["other"] },
  ],
};
function harness() {
  const calls: { url: string; signal: AbortSignal; resolve: (response: Response) => void }[] = [];
  const request = ((url: string, init: RequestInit) => new Promise<Response>((resolve) => {
    calls.push({ url, signal: init.signal!, resolve });
  })) as unknown as typeof fetch;
  const loader = new DashboardLoader(shell, () => {}, request);
  return { loader, calls };
}
const response = (value: number) => Response.json({
  blocks: [{ id: "metric", type: "metric", value }],
  generatedAt: "2026-10-22T12:00:00.000Z",
});

test("initial requests include parsed defaults, ranges, repeated arrays, zero, false and explicit clears", () => {
  const query = dashboardSearchParams({
    ...shell,
    definition: { ...shell.definition, params: ["period", "tags", "minimum", "active", "country", "empty"] },
    params: {
      period: { from: "2026-01-01", until: "2026-02-01" },
      tags: ["a,b", "c"], minimum: 0, active: false, empty: [],
    },
  });
  expect(query.get("period.from")).toBe("2026-01-01");
  expect(query.get("period.until")).toBe("2026-02-01");
  expect(query.getAll("tags")).toEqual(["a,b", "c"]);
  expect(query.get("minimum")).toBe("0");
  expect(query.get("active")).toBe("false");
  expect(query.get("country")).toBe("");
  expect(query.get("empty")).toBe("");
});

test("shared blocks make one request with all parameters; independent results appear before slower requests", async () => {
  const { loader, calls } = harness();
  const loading = loader.load(new URLSearchParams("country=Canada&tags=a&tags=b&empty="));
  expect(calls).toHaveLength(2);
  for (const call of calls) {
    expect(call.url).toContain("country=Canada&tags=a&tags=b&empty=");
    expect(call.signal.aborted).toBe(false);
  }
  calls[0]!.resolve(response(42));
  // Drain the response body promises without completing the slow request.
  await Bun.sleep(0);
  expect(loader.state.shared!.loading).toBe(false);
  expect(loader.state.shared!.data!.blocks[0]).toMatchObject({ value: 42 });
  expect(loader.state.other!.loading).toBe(true);
  calls[1]!.resolve(response(99));
  await loading;
  expect(loader.state.other!.loading).toBe(false);
});

test("failure affects only its group; repeated retry clicks share one request and keep the same filters", async () => {
  const { loader, calls } = harness();
  const loading = loader.load(new URLSearchParams("country=Canada"));
  calls[0]!.resolve(response(42));
  calls[1]!.resolve(Response.json({ error: "Unavailable" }, { status: 503 }));
  await loading;
  expect(loader.state.shared!.error).toBe("");
  expect(loader.state.other!.error).toBe("Unavailable");
  const retry = loader.retry("other");
  void loader.retry("other");
  expect(calls).toHaveLength(3);
  expect(calls[2]!.url).toBe("/api/dashboard-data/overview/other?country=Canada");
  expect(loader.state.shared!.loading).toBe(false);
  calls[2]!.resolve(response(100));
  await retry;
  expect(loader.state.other!.error).toBe("");
});

test("new filters abort old requests and ignore late responses even when the transport ignores abort", async () => {
  const { loader, calls } = harness();
  const old = loader.load(new URLSearchParams("country=Canada"));
  const current = loader.load(new URLSearchParams("country=France"));
  expect(calls[0]!.signal.aborted).toBe(true);
  expect(calls[1]!.signal.aborted).toBe(true);
  expect(calls[2]!.url).toContain("country=France");
  calls[2]!.resolve(response(200));
  calls[3]!.resolve(response(300));
  await current;
  calls[0]!.resolve(response(1));
  calls[1]!.resolve(Response.json({ error: "Old error" }, { status: 500 }));
  await old;
  expect(loader.state.shared!.data!.blocks[0]).toMatchObject({ value: 200 });
  expect(loader.state.other!.error).toBe("");
});

test("refresh keeps existing data; disposal prevents late results from publishing", async () => {
  const { loader, calls } = harness();
  const initial = loader.load(new URLSearchParams());
  calls[0]!.resolve(response(42)); calls[1]!.resolve(response(99));
  await initial;
  const refresh = loader.load(new URLSearchParams());
  expect(loader.state.shared!.loading).toBe(true);
  expect(loader.state.shared!.data!.blocks[0]).toMatchObject({ value: 42 });
  loader.dispose();
  expect(calls[2]!.signal.aborted).toBe(true);
  calls[2]!.resolve(response(400)); calls[3]!.resolve(response(500));
  await refresh;
  expect(loader.state.shared!.data!.blocks[0]).toMatchObject({ value: 42 });
});
