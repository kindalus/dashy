/**
 * Optional authentication for Dashy projects: a signed session cookie, OpenID
 * Connect login (authorization code + PKCE) and API keys. Server-only.
 *
 *   export default defineProject({ ...createAuth({ session, oidc, apiKeys, roles }), ... })
 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createRemoteJWKSet, decodeJwt, jwtVerify, SignJWT, type JWTPayload } from "jose";
import { DashyError } from "../params";
import type { AuthResult, Principal } from "../types";

export interface AuthIdentity {
  subject: string;
  email?: string;
  name?: string;
  provider: "oidc";
  /** Verified claims from the provider. */
  claims: Record<string, unknown>;
}
export interface OidcOptions {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  scopes?: string;
  /** Callback path under /auth/, default /auth/callback. Register `${baseUrl}${redirectPath}` with the provider. */
  redirectPath?: string;
  tokenAuthMethod?: "client_secret_basic" | "client_secret_post" | "none";
}
export interface AuthOptions {
  /** Development only: every request receives every role. */
  disabled?: boolean;
  session: {
    /** At least 32 characters; rotate to invalidate every session. */
    secret: string;
    ttlSeconds?: number;
    cookieName?: string;
    /** Secure cookies, default true when NODE_ENV is production. */
    secure?: boolean;
  };
  /** Public origin behind a proxy, e.g. https://bi.example.com. Defaults to forwarded headers or the request origin. */
  baseUrl?: string;
  oidc?: OidcOptions;
  /** CSV with header api_key,role (several roles separated by ; or |), or inline keys. */
  apiKeys?: { file?: string; keys?: Record<string, readonly string[]> };
  /** Roles for a signed-in user. Return [] to deny access (403). */
  roles?: (identity: AuthIdentity) => readonly string[] | Promise<readonly string[]>;
}
export interface Auth {
  authenticate(request: Request): Promise<AuthResult>;
  authRoutes(request: Request): Promise<Response | undefined>;
}

interface SessionClaims extends JWTPayload {
  roles: string[];
  email?: string;
  name?: string;
  provider: string;
}
interface OidcMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
}

const encoder = new TextEncoder();
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const random = (size = 32) => base64url(crypto.getRandomValues(new Uint8Array(size)));

/** Same-site relative paths only; never protocol-relative or absolute URLs. */
export function safeRedirect(value: string | null | undefined, fallback = "/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\") || /[\u0000-\u001f]/.test(value)) return fallback;
  return value;
}
function cookie(name: string, value: string, options: { maxAge: number; secure: boolean; path?: string }): string {
  return [
    `${name}=${value}`, `Path=${options.path ?? "/"}`, `Max-Age=${options.maxAge}`,
    "HttpOnly", "SameSite=Lax", ...(options.secure ? ["Secure"] : []),
  ].join("; ");
}
function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
}
const isPageRequest = (request: Request, url: URL) =>
  (request.method === "GET" || request.method === "HEAD") && !url.pathname.startsWith("/api/");
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function page(status: number, title: string, message: string, headers = new Headers(), link = { href: "/", label: "Back to the workspace" }): Response {
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>`
    + `<style>body{font:16px system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f7f7f5;color:#1d1d1b}main{max-width:32rem;padding:2rem}a{color:inherit}</style></head>`
    + `<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></p></main></body></html>`,
    { status, headers },
  );
}
function stringClaim(claims: Record<string, unknown>, name: string): string | undefined {
  // OpenAuth places user fields under `properties`.
  const nested = claims.properties && typeof claims.properties === "object" && !Array.isArray(claims.properties)
    ? (claims.properties as Record<string, unknown>)[name] : undefined;
  for (const value of [nested, claims[name]])
    if (typeof value === "string" && value.trim()) return value.trim();
}

/** API keys from a CSV file (reloaded when it changes) and inline definitions. */
class ApiKeys {
  private hashes = new Map<string, string[]>();
  private loaded?: { mtimeMs: number };
  constructor(private options: NonNullable<AuthOptions["apiKeys"]>) {}
  private static merge(target: Map<string, string[]>, key: string, roles: readonly string[]) {
    if (!key) return;
    const hash = sha256(key);
    // "*" is reserved for disabled authentication and never granted by a key.
    target.set(hash, [...new Set([...(target.get(hash) ?? []), ...roles.filter((role) => role && role !== "*")])]);
  }
  private async refresh() {
    const file = this.options.file;
    let mtimeMs = 0;
    if (file) {
      try { mtimeMs = (await stat(file)).mtimeMs; }
      catch { throw new Error(`API keys file not found: ${file}`); }
    }
    if (this.loaded && this.loaded.mtimeMs === mtimeMs) return;
    const hashes = new Map<string, string[]>();
    for (const [key, roles] of Object.entries(this.options.keys ?? {})) ApiKeys.merge(hashes, key, roles);
    if (file) {
      const lines = (await readFile(file, "utf8")).split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
      for (const [index, line] of lines.entries()) {
        const comma = line.indexOf(",");
        const key = (comma < 0 ? line : line.slice(0, comma)).trim().replace(/^"|"$/g, "");
        const roles = comma < 0 ? [] : line.slice(comma + 1).trim().replace(/^"|"$/g, "").split(/[;,|]/).map((role) => role.trim());
        if (index === 0 && key === "api_key") continue;
        ApiKeys.merge(hashes, key, roles);
      }
    }
    this.hashes = hashes;
    this.loaded = { mtimeMs };
  }
  /** Hash before lookup: comparison time does not depend on the secret's prefix. */
  async roles(key: string): Promise<string[] | undefined> {
    await this.refresh();
    const roles = this.hashes.get(sha256(key));
    return roles?.length ? roles : undefined;
  }
}

export function createAuth(options: AuthOptions): Auth {
  const secretText = options.session?.secret ?? "";
  if (!options.disabled && secretText.length < 32) throw new Error("Invalid Dashy auth: session.secret must have at least 32 characters");
  const secret = encoder.encode(secretText);
  const ttl = options.session?.ttlSeconds ?? 4 * 60 * 60;
  if (!Number.isInteger(ttl) || ttl < 60) throw new Error("Invalid Dashy auth: session.ttlSeconds must be an integer of at least 60");
  const cookieName = options.session?.cookieName ?? "dashy_session";
  const stateCookie = `${cookieName}_oidc`;
  const secure = options.session?.secure ?? process.env.NODE_ENV === "production";
  const oidc = options.oidc;
  const callbackPath = oidc?.redirectPath ?? "/auth/callback";
  if (oidc) {
    if (!oidc.issuer || !oidc.clientId) throw new Error("Invalid Dashy auth: oidc requires issuer and clientId");
    if (!callbackPath.startsWith("/auth/") || ["/auth/login", "/auth/logout", "/auth/me"].includes(callbackPath))
      throw new Error("Invalid Dashy auth: oidc.redirectPath must be a distinct path under /auth/");
    if (!options.roles) throw new Error("Invalid Dashy auth: oidc requires a roles(identity) function");
  }
  if (options.baseUrl !== undefined && !/^https?:\/\/[^/]+$/.test(options.baseUrl.replace(/\/$/, "")))
    throw new Error("Invalid Dashy auth: baseUrl must be an origin such as https://bi.example.com");
  const apiKeys = options.apiKeys ? new ApiKeys(options.apiKeys) : undefined;

  const origin = (request: Request) => {
    if (options.baseUrl) return options.baseUrl.replace(/\/$/, "");
    const url = new URL(request.url);
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    return `${proto === "https" || proto === "http" ? proto : url.protocol.slice(0, -1)}://${host || url.host}`;
  };

  async function issue(principal: Principal & { provider: string }): Promise<string> {
    const token = await new SignJWT({
      roles: [...principal.roles], provider: principal.provider,
      ...(principal.email ? { email: principal.email } : {}),
      ...(principal.name ? { name: principal.name } : {}),
    }).setProtectedHeader({ alg: "HS256" }).setSubject(principal.subject ?? "anonymous")
      .setIssuedAt().setExpirationTime(`${ttl}s`).sign(secret);
    return cookie(cookieName, token, { maxAge: ttl, secure });
  }
  async function session(token: string): Promise<{ principal: Principal; renew: boolean } | undefined> {
    try {
      const { payload } = await jwtVerify<SessionClaims>(token, secret, { algorithms: ["HS256"] });
      if (!Array.isArray(payload.roles)) return undefined;
      const remaining = (payload.exp ?? 0) - Date.now() / 1000;
      return {
        principal: {
          roles: payload.roles, subject: payload.sub,
          ...(payload.email ? { email: payload.email } : {}),
          ...(payload.name ? { name: payload.name } : {}),
        },
        renew: remaining < ttl / 2,
      };
    } catch {
      return undefined;
    }
  }

  let metadata: Promise<OidcMetadata> | undefined;
  let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
  function discover(): Promise<OidcMetadata> {
    return metadata ??= (async () => {
      const issuer = oidc!.issuer.replace(/\/$/, "");
      const response = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) })
        .catch(() => fetch(`${issuer}/.well-known/oauth-authorization-server`, { signal: AbortSignal.timeout(10_000) }));
      if (!response.ok) throw new Error(`OIDC discovery failed with ${response.status}`);
      const body = await response.json() as OidcMetadata;
      for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const)
        if (typeof body[key] !== "string") throw new Error(`OIDC discovery is missing ${key}`);
      jwks = createRemoteJWKSet(new URL(body.jwks_uri));
      return body;
    })().catch((error) => { metadata = undefined; throw error; });
  }

  async function claimsFrom(meta: OidcMetadata, tokens: Record<string, unknown>, nonce: string): Promise<Record<string, unknown>> {
    const issuer = meta.issuer ?? oidc!.issuer;
    if (typeof tokens.id_token === "string") {
      const { payload } = await jwtVerify(tokens.id_token, jwks!, { issuer, audience: oidc!.clientId });
      if (payload.nonce !== undefined && payload.nonce !== nonce) throw new DashyError("Invalid login response", 401);
      if (stringClaim(payload, "email")) return payload;
      // Some providers keep the e-mail in userinfo only.
      if (typeof tokens.access_token === "string" && meta.userinfo_endpoint) {
        const info = await userinfo(meta, tokens.access_token);
        if (info && (info.sub === undefined || info.sub === payload.sub)) return { ...payload, ...info };
      }
      return payload;
    }
    if (typeof tokens.access_token === "string" && meta.userinfo_endpoint) {
      const info = await userinfo(meta, tokens.access_token);
      if (info) return info;
    }
    // OpenAuth issues verifiable JWT access tokens without an id_token.
    if (typeof tokens.access_token === "string" && tokens.access_token.split(".").length === 3) {
      const { payload } = await jwtVerify(tokens.access_token, jwks!, { issuer });
      return payload;
    }
    throw new DashyError("The identity provider returned no verifiable identity", 502);
  }
  async function userinfo(meta: OidcMetadata, accessToken: string): Promise<Record<string, unknown> | undefined> {
    const response = await fetch(meta.userinfo_endpoint!, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return undefined;
    const body = await response.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : undefined;
  }

  async function login(request: Request, url: URL): Promise<Response> {
    if (!oidc) return page(401, "Sign in required", "This workspace accepts API keys only.");
    const meta = await discover();
    const state = random();
    const nonce = random();
    const verifier = random(48);
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
    const redirect = safeRedirect(url.searchParams.get("redirect"));
    const token = await new SignJWT({ state, nonce, verifier, redirect })
      .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m").sign(secret);
    const target = new URL(meta.authorization_endpoint);
    target.searchParams.set("client_id", oidc.clientId);
    target.searchParams.set("redirect_uri", `${origin(request)}${callbackPath}`);
    target.searchParams.set("response_type", "code");
    target.searchParams.set("scope", oidc.scopes ?? "openid profile email");
    target.searchParams.set("state", state);
    target.searchParams.set("nonce", nonce);
    target.searchParams.set("code_challenge", challenge);
    target.searchParams.set("code_challenge_method", "S256");
    const headers = new Headers({ Location: target.toString(), "Cache-Control": "no-store" });
    headers.append("Set-Cookie", cookie(stateCookie, token, { maxAge: 600, secure, path: "/auth" }));
    return new Response(null, { status: 302, headers });
  }

  async function callback(request: Request, url: URL): Promise<Response> {
    const clear = new Headers();
    clear.append("Set-Cookie", cookie(stateCookie, "", { maxAge: 0, secure, path: "/auth" }));
    const retry = { href: "/auth/login", label: "Sign in again" };
    const providerError = url.searchParams.get("error");
    if (providerError)
      return page(401, "Sign in failed", url.searchParams.get("error_description") || `The identity provider returned ${providerError}.`, clear, retry);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const stored = readCookie(request, stateCookie);
    let saved: { state: string; nonce: string; verifier: string; redirect: string };
    try {
      if (!code || !state || !stored) throw new Error();
      saved = (await jwtVerify(stored, secret, { algorithms: ["HS256"] })).payload as unknown as typeof saved;
      if (saved.state !== state) throw new Error();
    } catch {
      return page(400, "Sign in expired", "The sign-in attempt is invalid or has expired.", clear, retry);
    }
    const meta = await discover();
    const body = new URLSearchParams({
      grant_type: "authorization_code", code, redirect_uri: `${origin(request)}${callbackPath}`,
      code_verifier: saved.verifier, client_id: oidc!.clientId,
    });
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
    const method = oidc!.tokenAuthMethod ?? (oidc!.clientSecret ? "client_secret_basic" : "none");
    if (method === "client_secret_basic" && oidc!.clientSecret)
      headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(oidc!.clientId)}:${encodeURIComponent(oidc!.clientSecret)}`).toString("base64")}`;
    if (method === "client_secret_post" && oidc!.clientSecret) body.set("client_secret", oidc!.clientSecret);
    const response = await fetch(meta.token_endpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return page(502, "Sign in failed", "The identity provider rejected the sign-in.", clear, retry);
    const tokens = await response.json() as Record<string, unknown>;
    let claims: Record<string, unknown>;
    try {
      claims = await claimsFrom(meta, tokens, saved.nonce);
    } catch (error) {
      if (!(error instanceof DashyError)) console.error("[dashy] OIDC token verification failed", error);
      return page(401, "Sign in failed", "The identity provider's response could not be verified.", clear, retry);
    }
    const email = stringClaim(claims, "email")?.toLowerCase();
    const subject = stringClaim(claims, "sub") ?? email;
    if (!subject) return page(401, "Sign in failed", "The identity has no subject or e-mail.", clear, retry);
    const name = stringClaim(claims, "name") ?? stringClaim(claims, "preferred_username");
    const identity: AuthIdentity = { subject, provider: "oidc", claims, ...(email ? { email } : {}), ...(name ? { name } : {}) };
    const roles = [...await options.roles!(identity)].filter((role) => typeof role === "string" && role && role !== "*");
    if (!roles.length)
      return page(403, "Access denied", `${email ?? subject} has no access to this workspace. Ask an administrator for a role.`, clear,
        { href: "/auth/logout", label: "Sign out" });
    clear.append("Set-Cookie", await issue({ roles, subject, provider: "oidc", ...(email ? { email } : {}), ...(name ? { name } : {}) }));
    clear.set("Location", safeRedirect(saved.redirect));
    clear.set("Cache-Control", "no-store");
    return new Response(null, { status: 302, headers: clear });
  }

  async function authenticate(request: Request): Promise<AuthResult> {
    if (options.disabled) return { roles: ["*"], subject: "development" };
    const url = new URL(request.url);
    const pageRequest = isPageRequest(request, url);
    const authorization = request.headers.get("authorization");
    const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
    const queryKey = url.searchParams.get("api_key");
    const presented = request.headers.get("x-api-key") ?? (bearer && bearer.split(".").length !== 3 ? bearer : undefined) ?? queryKey;
    if (presented !== null && presented !== undefined) {
      const roles = apiKeys ? await apiKeys.roles(presented) : undefined;
      if (!roles) throw new DashyError("Invalid API key", 401);
      const principal = { roles, subject: `api-key:${sha256(presented).slice(0, 12)}` };
      if (queryKey !== null && pageRequest) {
        // Exchange the key for a session and drop it from the address bar and history.
        url.searchParams.delete("api_key");
        const headers = new Headers();
        headers.append("Set-Cookie", await issue({ ...principal, provider: "api-key" }));
        return { redirect: `${url.pathname}${url.search}`, headers };
      }
      return principal;
    }
    const token = (bearer && bearer.split(".").length === 3 ? bearer : undefined) ?? readCookie(request, cookieName);
    if (token) {
      const found = await session(token);
      if (found) {
        if (!found.renew) return found.principal;
        const headers = new Headers();
        const payload = decodeJwt(token) as SessionClaims;
        headers.append("Set-Cookie", await issue({ ...found.principal, provider: payload.provider ?? "session" }));
        return { principal: found.principal, headers };
      }
    }
    if (oidc && pageRequest) return { redirect: `/auth/login?redirect=${encodeURIComponent(`${url.pathname}${url.search}`)}` };
    return null;
  }

  async function authRoutes(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/auth/login" && request.method === "GET") return await login(request, url);
      if (oidc && url.pathname === callbackPath && request.method === "GET") return await callback(request, url);
      if (url.pathname === "/auth/logout" && (request.method === "GET" || request.method === "POST")) {
        const headers = new Headers();
        headers.append("Set-Cookie", cookie(cookieName, "", { maxAge: 0, secure }));
        return page(200, "Signed out", "You have signed out of this workspace.", headers, { href: oidc ? "/auth/login" : "/", label: "Sign in again" });
      }
      if (url.pathname === "/auth/me" && request.method === "GET") {
        const result = await authenticate(request).catch(() => null);
        const principal = result && "roles" in result ? result : result && "principal" in result ? result.principal : undefined;
        return Response.json(principal ? { authenticated: true, ...principal } : { authenticated: false }, { headers: { "Cache-Control": "no-store" } });
      }
    } catch (error) {
      console.error("[dashy] Authentication route failed", error);
      return page(502, "Sign in unavailable", "The identity provider could not be reached. Try again shortly.");
    }
    return undefined;
  }

  return { authenticate, authRoutes };
}
