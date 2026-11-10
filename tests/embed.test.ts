import { describe, expect, test } from "bun:test";
import { SignJWT } from "jose";
import { DashyEngine } from "../core/engine";
import { createApiHandler, embedErrorPage, embedPageHeaders } from "../core/http";
import { defineProject } from "../core/project";
import { frameAncestors, resolveEmbed } from "../core/embed-config";
import { embedAllows, type EmbedClaims } from "../core/embed";
import { DashyError, readParams } from "../core/params";
import { themeTokenMap } from "../core/theme-tokens";
import { formatValue } from "../src/format";
import { createAuth } from "../core/auth";
import type { Principal, ProjectDefinition, QueryDefinition } from "../core/types";

const secret = "e".repeat(40);
const rows = `SELECT * FROM (VALUES
  ('North', 'Laptop', DATE '2026-01-10', 1200.0), ('North', 'Phone', DATE '2026-02-11', 800.0),
  ('South', 'Laptop', DATE '2026-01-20', 300.0), ('South', '<b>Tablet</b>', DATE '2026-03-05', 450.0)
) AS t(region, product, day, revenue)`;
const filtered = (columns: string, group = ""): QueryDefinition => ({
  label: "Sales",
  sources: [],
  params: ["region", "product"],
  build: ({ params, sql }) => {
    const where = sql.where(sql.eq("region", params.region as string | undefined), sql.eq("product", params.product as string | undefined));
    return { text: `SELECT ${columns} FROM (${rows}) ${where.text} ${group}`, values: where.values };
  },
});
const revenue = { key: "revenue", label: "Revenue", format: { style: "currency", currency: "EUR", decimals: 0 }, aggregate: "sum" } as const;

/** API keys, sessions and OIDC sessions from headers, like a project's own hook would set them. */
function hook(request: Request): Principal | null {
  if (request.headers.get("x-api-key") === "key-1") return { roles: ["analyst"], subject: "key-1", via: "api-key" };
  if (request.headers.get("x-api-key") === "key-finance") return { roles: ["analyst", "finance"], via: "api-key" };
  if (request.headers.get("cookie") === "session=1") return { roles: ["analyst"], via: "session" };
  if (request.headers.get("cookie") === "session=oidc") return { roles: ["analyst"], via: "oidc" };
  return null;
}

const project: ProjectDefinition = {
  name: "Embed test",
  locale: "en",
  languages: ["en", "pt"],
  theme: { name: "zafir", selectable: ["zafir", "excel"] },
  params: {
    region: { label: "Region", type: "select", options: [{ label: "North", value: "North" }, { label: "South", value: "South" }] },
    product: { label: "Product", type: "string" },
  },
  sources: {},
  queries: {
    total: filtered("SUM(revenue) AS revenue"),
    by_region: filtered("region, SUM(revenue) AS revenue", "GROUP BY 1 ORDER BY 1"),
    by_product: filtered("product, SUM(revenue) AS revenue", "GROUP BY 1 ORDER BY 2 DESC"),
    private: { ...filtered("SUM(revenue) AS revenue"), roles: ["finance"] },
  },
  metrics: { total: { label: "Total", query: "total", column: "revenue" } },
  datasets: {
    by_region: {
      label: "Revenue <by> region & more",
      query: "by_region",
      columns: [{ key: "region", label: "Region", param: "region" }, revenue],
      chart: { type: "bar", x: "region", series: [revenue] },
    },
    by_product: {
      label: "Revenue by product",
      query: "by_product",
      columns: [{ key: "product", label: "Product", param: "product" }, revenue],
      chart: { type: "pie", category: "product", value: "revenue" },
    },
    drill: {
      label: "Drill",
      query: "by_region",
      columns: [{ key: "region", label: "Region", param: "region" }, revenue],
      chart: { type: "bar", x: "region", series: [revenue] },
      drilldown: [
        { column: "region", param: "region" },
        {
          query: "by_product", column: "product", columns: [{ key: "product", label: "Product" }, revenue],
          chart: { type: "bar", x: "product", series: [revenue] },
        },
      ],
    },
    table_only: { label: "Table", query: "by_region", columns: [{ key: "region", label: "Region" }, revenue] },
    secret_ds: { label: "Secret", query: "private", columns: [revenue], roles: ["finance"] },
  },
  dashboards: {
    sales: {
      label: "Sales",
      params: ["region", "product"],
      blocks: [
        { id: "total", type: "metric", metric: "total" },
        { id: "regions", type: "dataset", dataset: "by_region" },
        { id: "products", type: "dataset", dataset: "by_product" },
        { id: "drill", type: "dataset", dataset: "drill" },
        { id: "table", type: "dataset", dataset: "table_only" },
      ],
    },
    other: { label: "Other", params: ["region", "product"], blocks: [{ id: "regions", type: "dataset", dataset: "by_region" }] },
    finance: { label: "Finance", roles: ["finance"], params: ["region", "product"], blocks: [{ id: "regions", type: "dataset", dataset: "by_region" }] },
    detail: { label: "Detail", params: ["region", "product"], required: ["product"], blocks: [{ id: "regions", type: "dataset", dataset: "by_region" }] },
  },
  api: { ping: { method: "GET", path: "/ping", handler: () => Response.json({ ok: true }) } },
  authenticate: hook,
  embed: { secret, origins: ["https://portal.example.com", "http://localhost:3731"], maxTtlSeconds: 3600 },
};
const engine = new DashyEngine(project);
const tokens = await themeTokenMap(project);
const api = createApiHandler(engine, { themeTokens: tokens });
const at = (path: string, init: RequestInit = {}) => api(new Request(`http://dashy.test${path}`, init));
const mint = (body: unknown, headers: Record<string, string> = { "x-api-key": "key-1" }) =>
  at("/api/embed", {
    method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-dashy-request": "1", ...headers },
  });
async function tokenFor(body: unknown, headers?: Record<string, string>): Promise<string> {
  const response = await mint(body, headers);
  expect(response.status).toBe(200);
  return (await response.json()).token;
}
const withToken = (path: string, token: string) => at(path, { headers: { "x-dashy-embed": token } });

describe("embed configuration", () => {
  test("is validated at startup with clear messages", () => {
    const invalid: unknown[] = [
      { secret: "short" },
      { secret, origins: ["https://portal.example.com/app"] },
      { secret, origins: ["https://portal.example.com/"] },
      { secret, origins: ["http://portal.example.com"] },
      { secret, origins: ["*"] },
      { secret, origins: "https://portal.example.com" },
      { secret, maxTtlSeconds: 0 },
      { secret, maxTtlSeconds: 1.5 },
      { secret, maxTtlSeconds: 31 * 86_400 },
      { secret, extra: true },
      "secret",
    ];
    for (const embed of invalid)
      expect(() => defineProject({ ...project, embed: embed as never })).toThrow("Invalid Dashy embed");
    expect(resolveEmbed({ secret })).toEqual({ secret, origins: [], maxTtlSeconds: 86_400 });
    expect(resolveEmbed({ secret, origins: ["http://127.0.0.1:3731", "https://a.example"], maxTtlSeconds: 30 * 86_400 }))
      .toEqual({ secret, origins: ["http://127.0.0.1:3731", "https://a.example"], maxTtlSeconds: 30 * 86_400 });
    expect(resolveEmbed(undefined)).toBeUndefined();
    expect(frameAncestors(project.embed)).toBe("https://portal.example.com http://localhost:3731");
    expect(frameAncestors({ secret })).toBe("'none'");
  });
  test("token and the new underscore keys are reserved", () => {
    expect(readParams(new URLSearchParams("token=x&_width=1&_height=2&_theme=excel&_lang=pt&region=North")))
      .toEqual({ region: "North" });
    expect(() => defineProject({ ...project, params: { ...project.params, token: { label: "Token", type: "string" } } }))
      .toThrow("parameter name 'token' is reserved");
  });
});

describe("minting", () => {
  test("an API key mints a token with iframe and SVG URLs", async () => {
    const before = Date.now();
    const response = await mint({ dashboard: "sales", params: { region: "North" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(typeof body.token).toBe("string");
    const expires = Date.parse(body.expiresAt);
    expect(expires).toBeGreaterThanOrEqual(before + 599_000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 601_000);
    expect(body.urls.iframe).toBe(`/embed/dashboards/sales?token=${body.token}`);
    // Charted datasets only, once each.
    expect(body.urls.svg).toEqual(["by_region", "by_product", "drill"].map((name) => `/api/datasets/${name}?_format=svg&token=${body.token}`));
    const dataset = await (await mint({ dataset: "by_product", ttlSeconds: 60, language: "pt", theme: "excel" })).json();
    expect(dataset.urls).toEqual({
      iframe: `/embed/datasets/by_product?token=${dataset.token}`,
      svg: [`/api/datasets/by_product?_format=svg&token=${dataset.token}`],
    });
    const claims = JSON.parse(Buffer.from(dataset.token.split(".")[1], "base64url").toString());
    expect(claims).toMatchObject({
      aud: "dashy-embed", sub: "key-1", resource: { kind: "dataset", name: "by_product" },
      params: {}, roles: ["analyst"], language: "pt", theme: "excel",
    });
    expect(claims.exp - claims.iat).toBe(60);
  });
  test("browser sessions, OIDC sessions, anonymous requests and embed tokens cannot mint", async () => {
    expect((await mint({ dashboard: "sales" }, { cookie: "session=1" })).status).toBe(403);
    expect((await mint({ dashboard: "sales" }, { cookie: "session=oidc" })).status).toBe(403);
    expect((await mint({ dashboard: "sales" }, {})).status).toBe(401);
    const token = await tokenFor({ dashboard: "sales" });
    expect((await mint({ dashboard: "sales" }, { "x-dashy-embed": token })).status).toBe(403);
    // The write-request header is required, as for every write.
    const plain = await at("/api/embed", {
      method: "POST", body: "{}", headers: { "content-type": "application/json", "x-api-key": "key-1" },
    });
    expect(plain.status).toBe(403);
    const crossSite = await mint({ dashboard: "sales" }, { "x-api-key": "key-1", origin: "https://evil.example" });
    expect(crossSite.status).toBe(403);
    expect((await at("/api/embed", { headers: { "x-api-key": "key-1" } })).status).toBe(405);
  });
  test("resources must exist and be readable at every level", async () => {
    expect((await mint({ dashboard: "missing" })).status).toBe(404);
    expect((await mint({ dataset: "missing" })).status).toBe(404);
    expect((await mint({ dashboard: "finance" })).status).toBe(403);
    expect((await mint({ dataset: "secret_ds" })).status).toBe(403);
    expect((await mint({ dataset: "secret_ds" }, { "x-api-key": "key-finance" })).status).toBe(200);
  });
  test("requests are validated: one resource, known parameters, valid values, TTL, language and theme", async () => {
    const error = async (body: unknown, status = 400) => {
      const response = await mint(body);
      expect({ body, status: response.status }).toEqual({ body, status });
      return (await response.json()).error as string;
    };
    expect(await error({})).toBe("Give exactly one of dashboard or dataset");
    expect(await error({ dashboard: "sales", dataset: "by_region" })).toBe("Give exactly one of dashboard or dataset");
    expect(await error({ dashboard: "sales", params: { region: "East" } })).toBe("Invalid option for region");
    expect(await error({ dashboard: "sales", params: { country: "AO" } })).toBe("Unknown parameter: country");
    expect(await error({ dashboard: "sales", params: "region=North" })).toContain("params");
    expect(await error({ dashboard: "sales", ttlSeconds: 3601 })).toBe("ttlSeconds must be at most 3600");
    expect(await error({ dashboard: "sales", ttlSeconds: 0 })).toBe("ttlSeconds must be a positive integer");
    expect(await error({ dashboard: "sales", language: "fr" })).toContain("language must be one the project offers");
    expect(await error({ dashboard: "sales", theme: "cognos" })).toContain("theme must be one the project offers");
    expect(await error({ dashboard: "sales", extra: 1 })).toBe("Unknown field: extra");
    expect(await error({ dashboard: "detail" })).toContain("Product is required");
    expect((await mint({ dashboard: "detail", params: { product: "Laptop" } })).status).toBe(200);
    const response = await at("/api/embed", {
      method: "POST", body: "{", headers: { "content-type": "application/json", "x-dashy-request": "1", "x-api-key": "key-1" },
    });
    expect(response.status).toBe(400);
  });
  test("without embed configuration the endpoint is 404 and tokens are ignored", async () => {
    const disabled = createApiHandler(new DashyEngine({ ...project, embed: undefined }));
    const token = await tokenFor({ dashboard: "sales" });
    expect((await disabled(new Request("http://dashy.test/api/embed", { method: "POST" }))).status).toBe(404);
    // The token is not a credential there: normal authentication applies.
    expect((await disabled(new Request(`http://dashy.test/api/datasets/by_region?token=${token}`))).status).toBe(401);
    expect((await disabled(new Request(`http://dashy.test/api/datasets/by_region?token=${token}`, { headers: { "x-api-key": "key-1" } }))).status).toBe(200);
  });
});

describe("token scope", () => {
  test("a dashboard token reads its own shell, data and datasets, nothing else", async () => {
    const token = await tokenFor({ dashboard: "sales" });
    const shell = await withToken("/api/embed/shell", token);
    expect(shell.status).toBe(200);
    const body = await shell.json();
    expect(body.id).toBe("sales");
    for (const group of body.requests) {
      const data = await withToken(`/api/embed/data/${group.id}`, token);
      expect(data.status).toBe(200);
      expect((await data.json()).blocks.every((block: { type: string }) => block.type !== "error")).toBe(true);
    }
    expect((await withToken("/api/dashboard-shell/sales", token)).status).toBe(200);
    expect((await withToken(`/api/dashboard-data/sales/${body.requests[0].id}`, token)).status).toBe(200);
    expect((await withToken("/api/datasets/by_region", token)).status).toBe(200);
    expect((await at(`/api/datasets/by_region?token=${token}`)).status).toBe(200);
    for (const path of [
      "/api/catalog", "/api/dashboard-shell/other", "/api/dashboard-data/other/regions", "/api/dashboards/sales",
      "/api/datasets/secret_ds", "/api/datasets/missing", "/api/queries/by_region", "/api/metrics/total",
      "/api/params/region/options", "/api/dashboard-export/sales/regions", "/api/custom/ping",
    ]) expect({ path, status: (await withToken(path, token)).status }).toEqual({ path, status: 403 });
  });
  test("a dataset token reads that dataset, as JSON, SVG or a one-block embed", async () => {
    const token = await tokenFor({ dataset: "by_region" });
    const shell = await (await withToken("/api/embed/shell", token)).json();
    expect(shell.definition.blocks).toEqual([{ id: "by_region", type: "dataset", dataset: "by_region", width: 12 }]);
    expect(shell.definition.params).toEqual(["region", "product"]);
    const data = await (await withToken(`/api/embed/data/${shell.requests[0].id}`, token)).json();
    expect(data.blocks[0].result.rows).toHaveLength(2);
    // Single datasets do not cross-filter.
    expect((await (await withToken("/api/embed/shell?region=North&_xf=by_region:region", token)).json()).crossFilters).toEqual([]);
    expect((await withToken("/api/datasets/by_region", token)).status).toBe(200);
    expect((await withToken("/api/datasets/by_product", token)).status).toBe(403);
    expect((await withToken("/api/dashboard-shell/sales", token)).status).toBe(403);
  });
  test("embed pages open only for their own resource", () => {
    const claims: EmbedClaims = {
      resource: { kind: "dashboard", name: "sales" }, params: {}, roles: [], language: "en", theme: "zafir", expiresAt: 0,
    };
    expect(embedAllows(engine, claims, "/embed/dashboards/sales")).toBe(true);
    expect(embedAllows(engine, claims, "/embed/dashboards/other")).toBe(false);
    expect(embedAllows(engine, claims, "/embed/datasets/sales")).toBe(false);
    expect(embedAllows(engine, claims, "/dashboards/sales")).toBe(false);
    expect(embedAllows(engine, claims, "/")).toBe(false);
    expect(embedAllows(engine, { ...claims, resource: { kind: "dataset", name: "by_region" } }, "/embed/datasets/by_region")).toBe(true);
  });
  test("/api/embed endpoints need a token", async () => {
    expect((await at("/api/embed/shell", { headers: { "x-api-key": "key-1" } })).status).toBe(401);
  });
});

describe("fixed parameters", () => {
  test("override request values, cross-filters and drill-down paths", async () => {
    const token = await tokenFor({ dashboard: "sales", params: { region: "North" } });
    const shell = await (await withToken("/api/embed/shell?region=South&_xf=regions:region&_dd=drill:South", token)).json();
    expect(shell.params.region).toBe("North");
    // A cross-filter would exclude its block from the fixed filter, so it is dropped.
    expect(shell.crossFilters).toEqual([]);
    const blocks = (await Promise.all(shell.requests.map(async (group: { id: string }) =>
      (await (await withToken(`/api/embed/data/${group.id}?region=South&_xf=regions:region&_dd=drill:South`, token)).json()).blocks))).flat();
    const byId: Record<string, any> = Object.fromEntries(blocks.map((block: { id: string }) => [block.id, block]));
    expect(Number(byId.total.value)).toBe(2000);
    expect(byId.regions.result.rows.map((row: { region: string }) => row.region)).toEqual(["North"]);
    // The crafted path drills into South, but the deeper level still receives North.
    expect(byId.drill.result.rows.map((row: { product: string }) => row.product).sort()).toEqual(["Laptop", "Phone"]);
    const dataset = await (await withToken("/api/datasets/by_product?region=South", token)).json();
    expect(dataset.rows.map((row: { product: string }) => row.product).sort()).toEqual(["Laptop", "Phone"]);
    // Free parameters still change through clicks.
    const free = await (await withToken(`/api/embed/data/${shell.requests[0].id}?product=Laptop`, token)).json();
    expect(free.blocks.length).toBeGreaterThan(0);
  });
  test("an empty value fixes the parameter as cleared", async () => {
    const token = await tokenFor({ dataset: "by_region", params: { region: "" } });
    const claims = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString());
    expect(claims.params).toEqual({ region: null });
    const shell = await (await withToken("/api/embed/shell?region=South", token)).json();
    expect(shell.params.region).toBeUndefined();
  });
});

describe("invalid tokens", () => {
  const sign = (claims: Record<string, unknown>, options: { audience?: string; expires?: number; key?: string } = {}) =>
    new SignJWT({ resource: { kind: "dashboard", name: "sales" }, params: {}, roles: ["analyst"], language: "en", theme: "zafir", ...claims })
      .setProtectedHeader({ alg: "HS256" }).setAudience(options.audience ?? "dashy-embed")
      .setIssuedAt().setExpirationTime(options.expires ?? Math.floor(Date.now() / 1000) + 60)
      .sign(new TextEncoder().encode(options.key ?? secret));
  test("expired, tampered, wrong-audience and malformed tokens are 401", async () => {
    expect((await withToken("/api/embed/shell", await sign({}))).status).toBe(200);
    const expired = await withToken("/api/embed/shell", await sign({}, { expires: Math.floor(Date.now() / 1000) - 10 }));
    expect(expired.status).toBe(401);
    expect((await expired.json()).error).toBe("Embed token expired");
    const good = await tokenFor({ dashboard: "sales", params: { region: "North" } });
    const [header, payload, signature] = good.split(".");
    const forged = Buffer.from(JSON.stringify({
      ...JSON.parse(Buffer.from(payload!, "base64url").toString()), params: {}, roles: ["finance"],
    })).toString("base64url");
    for (const token of [
      `${header}.${forged}.${signature}`,
      await sign({}, { audience: "other" }),
      await sign({}, { key: "x".repeat(40) }),
      await sign({ resource: "sales" }),
      "not-a-token",
    ]) {
      const response = await withToken("/api/embed/shell", token);
      expect(response.status).toBe(401);
      expect((await response.json()).error).toBe("Invalid embed token");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });
});

describe("SVG charts", () => {
  test("render a themed, titled chart with formatted values and strict headers", async () => {
    const token = await tokenFor({ dashboard: "sales", params: { region: "North" } });
    const response = await at(`/api/datasets/by_product?_format=svg&token=${token}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, max-age=0");
    const svg = await response.text();
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"')).toBe(true);
    expect(svg).toContain(">Revenue by product</text>");
    expect(svg).toContain(">Region: North</text>");
    // The zafir palette from the build's token map.
    expect(svg).toContain(tokens.zafir!["--chart-1"]!);
    expect(svg).not.toContain("South");
    expect(svg).not.toContain("<script");
  });
  test("the token's theme and language win; requested ones must be offered", async () => {
    const token = await tokenFor({ dataset: "by_region", theme: "excel", language: "pt" });
    const themed = await (await at(`/api/datasets/by_region?_format=svg&_theme=zafir&_lang=en&token=${token}`)).text();
    expect(themed).toContain(tokens.excel!["--chart-1"]!);
    // Values formatted in Portuguese, with the axis in compact notation.
    expect(themed).toContain(formatValue(1500, { compact: true }, "pt"));
    const plain = await at("/api/datasets/by_region?_format=svg&_theme=excel", { headers: { "x-api-key": "key-1" } });
    expect(plain.status).toBe(200);
    expect(await plain.text()).toContain(tokens.excel!["--chart-1"]!);
    expect((await at("/api/datasets/by_region?_format=svg&_theme=cognos", { headers: { "x-api-key": "key-1" } })).status).toBe(400);
    expect((await at("/api/datasets/by_region?_format=svg&_lang=fr", { headers: { "x-api-key": "key-1" } })).status).toBe(400);
  });
  test("escape text, clamp sizes and refuse datasets without a chart", async () => {
    const token = await tokenFor({ dashboard: "sales" });
    const svg = await (await at(`/api/datasets/by_region?_format=svg&_width=5000&_height=10&token=${token}`)).text();
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="150"')).toBe(true);
    expect(svg).toContain("Revenue &lt;by&gt; region &amp; more");
    const small = await (await at(`/api/datasets/by_product?_format=svg&_width=10&_height=99999&token=${token}`)).text();
    expect(small.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="1500"')).toBe(true);
    expect(small).not.toContain("<b>Tablet</b>");
    expect((await at(`/api/datasets/by_region?_format=svg&_width=wide&token=${token}`)).status).toBe(400);
    const table = await at(`/api/datasets/table_only?_format=svg&token=${token}`);
    expect(table.status).toBe(400);
    expect(table.headers.get("content-type")).toContain("application/json");
    expect((await at(`/api/datasets/by_region?_format=pdf&token=${token}`)).status).toBe(400);
  });
  test("cache for the result cache's lifetime, never past the token's expiry", async () => {
    const cached = createApiHandler(new DashyEngine({ ...project, cache: { ttlSeconds: 900 } }), { themeTokens: tokens });
    const token = await tokenFor({ dataset: "by_region", ttlSeconds: 120 });
    const response = await cached(new Request(`http://dashy.test/api/datasets/by_region?_format=svg&token=${token}`));
    const age = Number(/max-age=(\d+)/.exec(response.headers.get("cache-control") ?? "")?.[1]);
    expect(age).toBeGreaterThan(110);
    expect(age).toBeLessThanOrEqual(120);
    const keyed = await cached(new Request("http://dashy.test/api/datasets/by_region?_format=svg", { headers: { "x-api-key": "key-1" } }));
    expect(keyed.headers.get("cache-control")).toBe("private, max-age=900");
  });
});

describe("embed pages", () => {
  test("headers allow the configured origins to frame them and send no referrer", () => {
    const headers = embedPageHeaders(project.embed, "default-src 'self'");
    expect(headers.get("content-security-policy")).toBe("default-src 'self'; frame-ancestors https://portal.example.com http://localhost:3731");
    expect(headers.get("x-frame-options")).toBeNull();
    expect(headers.get("referrer-policy")).toBe("no-referrer");
    expect(embedPageHeaders({ secret }, "default-src 'self'").get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
  test("errors are short, translated and link nowhere", async () => {
    const page = embedErrorPage(new DashyError("Embed token expired", 401), project.embed, "pt");
    expect(page.status).toBe(401);
    const html = await page.text();
    expect(html).toContain('lang="pt"');
    expect(html).toContain("expirou");
    expect(html).not.toContain("href");
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors https://portal.example.com");
  });
});

test("dashy/auth marks API keys, sessions and OIDC sessions", async () => {
  const auth = createAuth({ session: { secret }, apiKeys: { keys: { "key-1": ["analyst"] } } });
  expect(await auth.authenticate(new Request("http://x/api/catalog", { headers: { "x-api-key": "key-1" } })))
    .toMatchObject({ roles: ["analyst"], via: "api-key" });
  const page = await auth.authenticate(new Request("http://x/dashboards/a?api_key=key-1")) as { headers: Headers };
  const cookie = page.headers.get("set-cookie")!.split(";")[0]!;
  // A key exchanged on a page becomes a browser session: it cannot mint.
  expect(await auth.authenticate(new Request("http://x/api/catalog", { headers: { cookie } })))
    .toMatchObject({ roles: ["analyst"], via: "session" });
});
