import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuth, safeRedirect } from "../core/auth";
import { DashyEngine } from "../core/engine";
import { AuthRedirect, authenticate, createApiHandler } from "../core/http";
import type { ProjectDefinition } from "../core/types";

const secret = "s".repeat(40);
const cookieOf = (response: Response, name = "dashy_session") =>
  response.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(";")[0];

/** Minimal OpenID provider: discovery, JWKS and a token endpoint. */
let provider: ReturnType<typeof Bun.serve>;
let issuer: string;
let tokenResponse: (body: URLSearchParams, auth: string | null) => Promise<Record<string, unknown>>;
let privateKey: CryptoKey;
beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey as CryptoKey;
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  provider = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/.well-known/openid-configuration")
        return Response.json({
          issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
        });
      // An OpenAuth-style issuer under /openauth: no OpenID discovery, only OAuth server metadata.
      if (url.pathname === "/openauth/.well-known/oauth-authorization-server")
        return Response.json({
          issuer: `${issuer}/openauth`, authorization_endpoint: `${issuer}/openauth/authorize`,
          token_endpoint: `${issuer}/openauth/token`, jwks_uri: `${issuer}/jwks`,
        });
      if (url.pathname === "/jwks") return Response.json({ keys: [jwk] });
      if (url.pathname === "/token" && request.method === "POST")
        return Response.json(await tokenResponse(new URLSearchParams(await request.text()), request.headers.get("authorization")));
      return new Response("not found", { status: 404 });
    },
  });
  issuer = `http://127.0.0.1:${provider.port}`;
});
afterAll(() => provider.stop(true));

const sign = (claims: Record<string, unknown>, audience?: string) => {
  const jwt = new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(issuer).setIssuedAt().setExpirationTime("5m");
  return (audience ? jwt.setAudience(audience) : jwt).sign(privateKey);
};
function oidcAuth(roles = (email?: string) => (email === "ana@example.com" ? ["finance"] : [])) {
  return createAuth({
    session: { secret, secure: true },
    baseUrl: "https://bi.example.com",
    oidc: { issuer, clientId: "dashy", clientSecret: "client-secret", redirectPath: "/auth/external/callback" },
    roles: (identity) => roles(identity.email),
  });
}
async function login(auth: ReturnType<typeof createAuth>, redirect = "/dashboards/finance?x=1") {
  const start = (await auth.authRoutes(new Request(`http://internal/auth/login?redirect=${encodeURIComponent(redirect)}`)))!;
  expect(start.status).toBe(302);
  const target = new URL(start.headers.get("location")!);
  return { target, state: target.searchParams.get("state")!, nonce: target.searchParams.get("nonce")!, cookie: cookieOf(start, "dashy_session_oidc")! };
}

describe("OpenID Connect", () => {
  test("login sends the user to the provider with PKCE, state and nonce", async () => {
    const { target, cookie } = await login(oidcAuth());
    expect(target.origin + target.pathname).toBe(`${issuer}/authorize`);
    expect(target.searchParams.get("redirect_uri")).toBe("https://bi.example.com/auth/external/callback");
    expect(target.searchParams.get("code_challenge_method")).toBe("S256");
    expect(target.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(target.searchParams.get("scope")).toBe("openid profile email");
    expect(cookie).toBeDefined();
  });
  test("an issuer without OpenID discovery falls back to the OAuth server metadata", async () => {
    const auth = createAuth({
      session: { secret, secure: true },
      baseUrl: "https://bi.example.com",
      oidc: { issuer: `${issuer}/openauth`, clientId: "dashy", redirectPath: "/auth/external/callback" },
      roles: () => ["finance"],
    });
    const { target } = await login(auth);
    expect(target.origin + target.pathname).toBe(`${issuer}/openauth/authorize`);
  });
  test("a verified id_token creates a session and returns to the original page", async () => {
    const auth = oidcAuth();
    const { state, nonce, cookie } = await login(auth);
    let exchanged: URLSearchParams | undefined;
    let basic: string | null = null;
    tokenResponse = async (body, authorization) => {
      exchanged = body;
      basic = authorization;
      return { access_token: "opaque", id_token: await sign({ sub: "u1", email: "Ana@Example.com", name: "Ana", nonce }, "dashy") };
    };
    const response = (await auth.authRoutes(new Request(`http://internal/auth/external/callback?code=abc&state=${state}`, { headers: { cookie } })))!;
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/dashboards/finance?x=1");
    expect(exchanged!.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(exchanged!.get("redirect_uri")).toBe("https://bi.example.com/auth/external/callback");
    expect(basic as string | null).toBe(`Basic ${Buffer.from("dashy:client-secret").toString("base64")}`);
    const session = cookieOf(response)!;
    expect(response.headers.getSetCookie().find((c) => c.startsWith("dashy_session="))).toContain("HttpOnly; SameSite=Lax; Secure");
    const principal = await auth.authenticate(new Request("http://internal/api/catalog", { headers: { cookie: session } }));
    expect(principal).toMatchObject({ roles: ["finance"], email: "ana@example.com", name: "Ana", subject: "u1" });
  });
  test("OpenAuth-style JWT access tokens with nested properties are accepted", async () => {
    const auth = oidcAuth();
    const { state, cookie } = await login(auth);
    tokenResponse = async () => ({ access_token: await sign({ sub: "user:2", properties: { email: "ana@example.com" } }) });
    const response = (await auth.authRoutes(new Request(`http://internal/auth/external/callback?code=abc&state=${state}`, { headers: { cookie } })))!;
    expect(response.status).toBe(302);
  });
  test("users without roles are denied with 403", async () => {
    const auth = oidcAuth();
    const { state, nonce, cookie } = await login(auth);
    tokenResponse = async () => ({ id_token: await sign({ sub: "u3", email: "eve@example.com", nonce }, "dashy") });
    const response = (await auth.authRoutes(new Request(`http://internal/auth/external/callback?code=abc&state=${state}`, { headers: { cookie } })))!;
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("eve@example.com has no access");
    expect(cookieOf(response)).toBeUndefined();
  });
  test("tampered state, wrong audience and nonce are rejected", async () => {
    const auth = oidcAuth();
    const first = await login(auth);
    expect((await auth.authRoutes(new Request(`http://internal/auth/external/callback?code=abc&state=forged`, { headers: { cookie: first.cookie } })))!.status).toBe(400);
    expect((await auth.authRoutes(new Request(`http://internal/auth/external/callback?code=abc&state=${first.state}`)))!.status).toBe(400);
    tokenResponse = async () => ({ id_token: await sign({ sub: "u1", email: "ana@example.com", nonce: first.nonce }, "another-client") });
    expect((await auth.authRoutes(new Request(`http://internal/auth/external/callback?code=abc&state=${first.state}`, { headers: { cookie: first.cookie } })))!.status).toBe(401);
    const second = await login(auth);
    tokenResponse = async () => ({ id_token: await sign({ sub: "u1", email: "ana@example.com", nonce: "other" }, "dashy") });
    expect((await auth.authRoutes(new Request(`http://internal/auth/external/callback?code=abc&state=${second.state}`, { headers: { cookie: second.cookie } })))!.status).toBe(401);
  });
  test("unauthenticated pages redirect to login; data requests do not", async () => {
    const auth = oidcAuth();
    expect(await auth.authenticate(new Request("http://internal/dashboards/a?b=1"))).toEqual({ redirect: "/auth/login?redirect=%2Fdashboards%2Fa%3Fb%3D1" });
    expect(await auth.authenticate(new Request("http://internal/api/catalog"))).toBeNull();
    const logout = (await auth.authRoutes(new Request("http://internal/auth/logout")))!;
    expect(logout.headers.getSetCookie()[0]).toContain("Max-Age=0");
    expect(await auth.authRoutes(new Request("http://internal/auth/unknown"))).toBeUndefined();
  });
  test("only same-site relative redirects are honoured", () => {
    expect(safeRedirect("/dashboards/a?x=1")).toBe("/dashboards/a?x=1");
    for (const value of ["https://evil.example", "//evil.example", "/\\evil", "javascript:alert(1)", "", null])
      expect(safeRedirect(value)).toBe("/");
  });
});

describe("API keys and sessions", () => {
  let directory: string;
  beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), "dashy-keys-")); });
  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

  test("keys in a header, bearer token or query; the query key becomes a session on pages", async () => {
    const file = join(directory, "api_keys.csv");
    await writeFile(file, "api_key,role\nkey-1,commercial\nkey-1,finance\nkey-2,logistics;finance\n");
    const auth = createAuth({ session: { secret, secure: false }, apiKeys: { file } });
    expect(await auth.authenticate(new Request("http://x/api/catalog", { headers: { "x-api-key": "key-1" } })))
      .toMatchObject({ roles: ["commercial", "finance"] });
    expect(await auth.authenticate(new Request("http://x/api/catalog", { headers: { authorization: "Bearer key-2" } })))
      .toMatchObject({ roles: ["logistics", "finance"] });
    expect(await auth.authenticate(new Request("http://x/api/datasets/a?api_key=key-2&b=1"))).toMatchObject({ roles: ["logistics", "finance"] });
    const page = await auth.authenticate(new Request("http://x/dashboards/a?api_key=key-2&b=1")) as { redirect: string; headers: Headers };
    expect(page.redirect).toBe("/dashboards/a?b=1");
    const session = new Headers(page.headers).getSetCookie()[0]!.split(";")[0]!;
    expect(await auth.authenticate(new Request("http://x/dashboards/a?b=1", { headers: { cookie: session } }))).toMatchObject({ roles: ["logistics", "finance"] });
    await expect(auth.authenticate(new Request("http://x/api/catalog?api_key=wrong"))).rejects.toMatchObject({ status: 401 });
    // The file is reloaded when it changes.
    await Bun.sleep(10);
    await writeFile(file, "api_key,role\nkey-3,commercial\n");
    await expect(auth.authenticate(new Request("http://x/api/catalog", { headers: { "x-api-key": "key-1" } }))).rejects.toMatchObject({ status: 401 });
    expect(await auth.authenticate(new Request("http://x/api/catalog", { headers: { "x-api-key": "key-3" } }))).toMatchObject({ roles: ["commercial"] });
  });
  test("sessions renew after half their lifetime and invalid tokens are ignored", async () => {
    const auth = createAuth({ session: { secret, ttlSeconds: 600 } });
    const token = await new SignJWT({ roles: ["finance"], provider: "oidc" }).setProtectedHeader({ alg: "HS256" })
      .setSubject("u1").setIssuedAt().setExpirationTime("60s").sign(new TextEncoder().encode(secret));
    const renewed = await auth.authenticate(new Request("http://x/api/catalog", { headers: { cookie: `dashy_session=${token}` } })) as { principal: object; headers: HeadersInit };
    expect(renewed.principal).toMatchObject({ roles: ["finance"], subject: "u1" });
    expect(new Headers(renewed.headers).getSetCookie()[0]).toContain("Max-Age=600");
    const forged = await new SignJWT({ roles: ["*"] }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("60s").sign(new TextEncoder().encode("x".repeat(40)));
    expect(await auth.authenticate(new Request("http://x/api/catalog", { headers: { cookie: `dashy_session=${forged}` } }))).toBeNull();
  });
  test("configuration errors fail fast; disabled grants every role", async () => {
    expect(() => createAuth({ session: { secret: "short" } })).toThrow("at least 32 characters");
    expect(() => createAuth({ session: { secret }, oidc: { issuer, clientId: "a" } })).toThrow("roles(identity)");
    expect(() => createAuth({ session: { secret }, oidc: { issuer, clientId: "a", redirectPath: "/callback" }, roles: () => [] })).toThrow("under /auth/");
    expect(await createAuth({ disabled: true, session: { secret: "" } }).authenticate(new Request("http://x/"))).toMatchObject({ roles: ["*"] });
  });
});

describe("engine integration", () => {
  const project = (auth: Partial<ProjectDefinition>): ProjectDefinition => ({
    name: "Auth", params: {}, sources: {},
    queries: { one: { label: "One", sources: [], roles: ["finance"], build: () => ({ text: "SELECT 1 AS n", values: [] }) } },
    metrics: {}, datasets: {}, dashboards: {}, ...auth,
  });
  test("redirects only for pages; 401 carries WWW-Authenticate; hook headers reach the response", async () => {
    const engine = new DashyEngine(project({
      authenticate: (request) => request.headers.get("cookie")
        ? { principal: { roles: ["finance"] }, headers: { "Set-Cookie": "renewed=1" } }
        : { redirect: "/auth/login" },
    }));
    await expect(authenticate(engine, new Request("http://x/dashboards/a"), true)).rejects.toBeInstanceOf(AuthRedirect);
    const api = createApiHandler(engine);
    const denied = await api(new Request("http://x/api/queries/one"));
    expect(denied.status).toBe(401);
    expect(denied.headers.get("WWW-Authenticate")).toBe('Bearer realm="dashy"');
    const allowed = await api(new Request("http://x/api/queries/one", { headers: { cookie: "a=1" } }));
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("Set-Cookie")).toBe("renewed=1");
  });
  test("the * role reads everything", async () => {
    const auth = createAuth({ disabled: true, session: { secret: "" } });
    const api = createApiHandler(new DashyEngine(project(auth)));
    expect((await api(new Request("http://x/api/queries/one"))).status).toBe(200);
  });
  test("api_key in the query never fails parameter validation", async () => {
    const auth = createAuth({ session: { secret }, apiKeys: { keys: { k: ["finance"] } } });
    const api = createApiHandler(new DashyEngine(project(auth)));
    const response = await api(new Request("http://x/api/queries/one?api_key=k"));
    expect(response.status).toBe(200);
  });
});
