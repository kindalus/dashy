import { expect, test } from "bun:test";
import { DashyEngine } from "../core/engine";
import { createApiHandler } from "../core/http";
import project from "../samples/source-examples/dashy.config";
const handler = createApiHandler(new DashyEngine(project));
const request = (path: string, options?: RequestInit) =>
  new Request(`http://localhost${path}`, options);
test("catalog includes presentation definitions and excludes SQL and file paths", async () => {
  const response = await handler(request("/api/catalog"));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.dashboards.overview.label).toBe("Overview");
  expect(body.sources).toBeUndefined();
  expect(body.queries).toBeUndefined();
  expect(response.headers.get("cache-control")).toBe("no-store");
});
test("dashboard HTTP filters change calculated values", async () => {
  const response = await handler(
    request(
      "/api/dashboards/overview?region=North&period.from=2026-01-01&period.until=2026-02-28",
    ),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(Number(body.blocks[0].value)).toBe(640);
});
test("HTTP rejects unregistered endpoints, invalid values and mutations", async () => {
  expect((await handler(request("/api/queries/unknown"))).status).toBe(404);
  expect(
    (await handler(request("/api/dashboards/overview?period.from=2026-01-01")))
      .status,
  ).toBe(400);
  const response = await handler(
    request("/api/queries/summary", {
      method: "POST",
      body: '{"sql":"DROP TABLE orders"}',
    }),
  );
  expect(response.status).toBe(405);
  expect(response.headers.get("allow")).toBe("GET");
});
test("application authentication protects the catalog and every query", async () => {
  const protectedHandler = createApiHandler(
    new DashyEngine({
      ...project,
      authenticate: (req) =>
        req.headers.get("authorization") === "Bearer test-token"
          ? { roles: ["analyst"] }
          : null,
    }),
  );
  expect((await protectedHandler(request("/api/catalog"))).status).toBe(401);
  expect((await protectedHandler(request("/api/queries/summary"))).status).toBe(
    401,
  );
  expect(
    (
      await protectedHandler(
        request("/api/catalog", {
          headers: { authorization: "Bearer test-token" },
        }),
      )
    ).status,
  ).toBe(200);
});

test("single and empty array filters keep their declared meaning over HTTP", async () => {
  const { default: example } =
    await import("../samples/source-examples/dashy.config");
  const arrayHandler = createApiHandler(
    new DashyEngine({
      ...example,
      params: { tags: { label: "Tags", type: "array", default: ["default"] } },
      queries: {
        selected: {
          label: "Selected tags",
          sources: [],
          params: ["tags"],
          build: ({ params }) => ({
            text: "SELECT ? AS selection",
            values: [JSON.stringify(params.tags ?? [])],
          }),
        },
      },
      metrics: {},
      datasets: {},
      dashboards: {},
    }),
  );
  for (const [search, expected] of [
    ["", ["default"]],
    ["?tags=one", ["one"]],
    ["?tags=one&tags=two", ["one", "two"]],
    ["?tags=", []],
  ] as const) {
    const response = await arrayHandler(
      request(`/api/queries/selected${search}`),
    );
    expect(response.status).toBe(200);
    expect(JSON.parse((await response.json()).rows[0].selection)).toEqual(
      expected,
    );
  }
});
