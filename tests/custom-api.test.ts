import { expect, test, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defineApiRoutes, defineConfig, DashyError, type ApiRoutes } from "../core/index";
import { DashyEngine } from "../core/engine";
import { createApiHandler } from "../core/http";

const request = (path: string, init?: RequestInit) => new Request(`http://localhost/api/custom${path}`, init);
const json = (body: string, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST", body, headers: { "content-type": "application/json", "x-dashy-request": "1", ...headers },
});
const response = () => Response.json({ ok: true });
function handler(api: ApiRoutes) { return createApiHandler(new DashyEngine(defineConfig({ name: "API", api }))); }

test("custom paths, static precedence, per-path methods, HEAD and OPTIONS", async () => {
  let cancelled = false;
  const api = handler(defineApiRoutes({
    dynamic: { method: "GET", path: "/customers/:id", handler: ({ pathParams }) => Response.json(pathParams) },
    fixed: { method: "POST", path: "/customers/new", handler: response },
    stream: { method: "GET", path: "/stream", handler: () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("data")); }, cancel() { cancelled = true; },
    }), { headers: { "content-type": "text/csv", "content-disposition": 'attachment; filename="data.csv"' } }) },
    root: { method: "GET", path: "/", handler: response },
  }));
  expect(await (await api(request("/customers/A%20B/"))).json()).toEqual({ id: "A B" });
  expect((await api(request(""))).status).toBe(200);
  expect((await api(request("/customers/new"))).status).toBe(405);
  const options = await api(request("/customers/new", { method: "OPTIONS" }));
  expect(options.status).toBe(204);
  expect(options.headers.get("allow")).toBe("OPTIONS, POST");
  const head = await api(request("/stream", { method: "HEAD" }));
  expect(await head.text()).toBe("");
  expect(cancelled).toBe(true);
  expect(head.headers.get("content-disposition")).toContain("data.csv");
  expect(head.headers.get("cache-control")).toBe("no-store");
  expect(head.headers.get("x-content-type-options")).toBe("nosniff");
  for (const path of ["/customers/%2f", "/customers/%5c", "/customers/%00", "/customers/%zz", "/customers//x"])
    expect((await api(request(path))).status).toBe(400);
  expect((await api(request("/missing"))).status).toBe(404);
  const missingHead = await api(request("/missing", { method: "HEAD" }));
  expect(missingHead.status).toBe(404);
  expect(await missingHead.text()).toBe("");
  expect((await api(new Request("http://localhost/api/customized"))).status).toBe(404);
});

test("route registries reject conflicting definitions at startup", () => {
  expect(() => defineApiRoutes({ a: { method: "GET", path: "/:id", handler: response }, b: { method: "GET", path: "/:name", handler: response } })).toThrow("duplicate");
  for (const extra of [{ method: "HEAD" }, { path: "/:id/:id" }, { path: "/a/" }, { path: "/a?x" }, { path: "/../a" }, { path: "/a/*" }, { path: 3 }, { roles: "admin" }, { params: [null] }, { maxBodyBytes: 0 }, { handler: "invalid" }])
    expect(() => defineApiRoutes({ a: { method: "GET", path: "/a", handler: response, ...extra } } as unknown as ApiRoutes)).toThrow();
  expect(() => new DashyEngine(defineConfig({ name: "Unknown", api: { a: { method: "GET", path: "/a", params: ["missing"], handler: response } } }))).toThrow("unknown parameter");
});

test("authenticate once, enforce route and underlying data roles, never expose handlers in catalog", async () => {
  let authentications = 0;
  const project = defineConfig({
    name: "Permissions", authenticate(req) { authentications++; return req.headers.has("role") ? { roles: [req.headers.get("role")!] } : null; },
    queries: { private: { label: "Private", sources: [], roles: ["admin"], build: () => ({ text: "SELECT 7 AS value", values: [] }) } },
    datasets: { private: { label: "Private", query: "private", columns: [{ key: "value", label: "Value" }] } },
    metrics: { private: { label: "Private", query: "private", column: "value" } },
    api: {
      restricted: { method: "GET", path: "/restricted", roles: ["admin"], handler: response },
      dataset: { method: "GET", path: "/dataset", handler: async ({ data }) => Response.json(await data.dataset("private")) },
      metric: { method: "GET", path: "/metric", handler: async ({ data }) => Response.json(await data.metric("private")) },
      query: { method: "GET", path: "/query", handler: async ({ data }) => Response.json(await data.query("private")) },
    },
  });
  const engine = new DashyEngine(project);
  expect(JSON.stringify(engine.catalog({ roles: ["admin"] }))).not.toContain("handler");
  expect(engine.catalog()).not.toHaveProperty("api");
  const api = createApiHandler(engine);
  expect((await api(request("/dataset"))).status).toBe(401);
  expect(authentications).toBe(1);
  for (const path of ["/restricted", "/dataset", "/metric", "/query"]) {
    expect((await api(request(path, { headers: { role: "viewer" } }))).status).toBe(403);
    expect((await api(request(path, { headers: { role: "admin" } }))).status).toBe(200);
  }
  expect((await api(request("/restricted", { method: "OPTIONS", headers: { role: "viewer" } }))).status).toBe(403);
  expect(authentications).toBe(10);
});

test("declared query validation preserves defaults, arrays and explicit clears when forwarded", async () => {
  const api = createApiHandler(new DashyEngine(defineConfig({
    name: "Params", params: { tags: { label: "Tags", type: "array", default: ["default"] } },
    queries: { tags: { label: "Tags", params: ["tags"], sources: [], build: ({ params }) => ({ text: "SELECT ? AS value", values: [JSON.stringify(params.tags ?? [])] }) } },
    api: { tags: { method: "GET", path: "/tags", params: ["tags"], handler: async ({ data, params }) => Response.json(await data.query("tags", params)) } },
  })));
  for (const [search, values] of [["", ["default"]], ["?tags=", []], ["?tags=a&tags=b", ["a", "b"]]] as const) {
    const result = await (await api(request(`/tags${search}`))).json();
    expect(JSON.parse(result.rows[0].value)).toEqual(values);
  }
  expect((await api(request("/tags?unknown=1"))).status).toBe(400);
});

test("mutations require a non-simple header and reject foreign origins before calling handlers", async () => {
  let calls = 0;
  const api = handler({ write: { method: "POST", path: "/write", handler: () => { calls++; return response(); } } });
  for (const init of [
    { method: "POST" },
    json("{}", { origin: "https://foreign.example" }),
    json("{}", { origin: "null" }),
    json("{}", { "sec-fetch-site": "cross-site" }),
    json("{}", { "sec-fetch-site": "same-site" }),
  ]) expect((await api(request("/write", init))).status).toBe(403);
  expect(calls).toBe(0);
  expect((await api(request("/write", json("{}", { origin: "http://localhost" })))).status).toBe(200);
  expect((await api(request("/write", json("{}")))).status).toBe(200);
  expect(calls).toBe(2);
});

test("bounded bodies reject malformed JSON, wrong content types and streamed overflow", async () => {
  let calls = 0;
  const api = handler({ body: { method: "POST", path: "/body", maxBodyBytes: 16, async handler({ readJson }) {
    calls++; return Response.json(await readJson());
  } } });
  expect(await (await api(request("/body", json('{"x":1}')))).json()).toEqual({ x: 1 });
  expect((await api(request("/body", json("{")))).status).toBe(400);
  expect((await api(request("/body", json("{}", { "content-type": "text/plain" })))).status).toBe(415);
  expect((await api(request("/body", json(" ".repeat(17))))).status).toBe(413);
  const before = calls;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(10)); }, cancel() { cancelled = true; } });
  expect((await api(request("/body", { ...json("{}"), body }))).status).toBe(413);
  expect(cancelled).toBe(true);
  expect(calls).toBe(before);
});

test("expected errors are public; unexpected errors remain server-only", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    const api = handler({ expected: { method: "GET", path: "/expected", handler() { throw new DashyError("Invalid order", 422); } }, unexpected: { method: "GET", path: "/unexpected", handler() { throw new Error("private connection details"); } }, forged: { method: "GET", path: "/forged", handler() { throw { name: "DashyError", message: "private message", status: 400 }; } } });
    expect((await api(request("/expected"))).status).toBe(422);
    const error = await api(request("/unexpected"));
    expect(error.status).toBe(500);
    expect(await error.text()).not.toContain("private connection");
    const forged = await api(request("/forged"));
    expect(forged.status).toBe(500);
    expect(await forged.text()).not.toContain("private message");
    expect(log).toHaveBeenCalledTimes(2);
  } finally { log.mockRestore(); }
});

test("request cancellation reaches data adapters through custom handlers", async () => {
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let aborted = false;
  const api = createApiHandler(new DashyEngine(defineConfig({
    name: "Cancel", sources: { slow: { type: "slow", path: "" } },
    queries: { slow: { label: "Slow", sources: ["slow"], build: () => ({ text: "SELECT 1", values: [] }) } },
    adapters: { slow: async ({ signal }) => { started(); await new Promise<void>(resolve => signal!.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true })); } },
    api: { slow: { method: "GET", path: "/slow", handler: async ({ data }) => Response.json(await data.query("slow")) } },
  })));
  const controller = new AbortController();
  const pending = api(request("/slow", { signal: controller.signal }));
  await ready;
  controller.abort();
  expect((await pending).status).toBe(499);
  expect(aborted).toBe(true);
});

test("public errors survive independently bundled server handlers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dashy-error-bundle-"));
  try {
    const bundle = await Bun.build({ entrypoints: [new URL("../core/params.ts", import.meta.url).pathname], target: "bun" });
    expect(bundle.success).toBe(true);
    const path = join(directory, "errors.mjs");
    await Bun.write(path, bundle.outputs[0]!);
    const module = await import(path);
    const error = new module.DashyError("Expected public validation error", 422);
    expect(error instanceof DashyError).toBe(false);
    const api = handler({ bundled: { method: "GET", path: "/bundled", handler() { throw error; } } });
    const result = await api(request("/bundled"));
    expect(result.status).toBe(422);
    expect(await result.json()).toEqual({ error: "Expected public validation error" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
