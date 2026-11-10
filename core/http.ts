import { assertWriteRequest, boundedRequest, createCustomApiHandler, readJsonBody } from "./custom-api";
import { DashyEngine, readCrossFilters } from "./engine";
import { exportFile, readExportOptions } from "./export";
import { describeDrilldown, readDrilldowns } from "./drilldown";
import { DashyError, isDashyError, parseParams, readParams, selectParams } from "./params";
import { resolveLimits } from "./limits";
import type { AuthResult, Params, Principal } from "./types";
import {
  formattingLocale, isLanguage, messages, readLanguageCookie, resolveLanguage, viewerLanguage, type Language,
} from "./i18n";
import {
  embedAllows, embedPrincipal, mintEmbed, presentedToken, verifyEmbed, type EmbedClaims,
} from "./embed";
import { resolveTheme } from "./theme";
import { frameAncestors } from "./embed-config";
import { describeFilters, isUnset } from "./filters";
import type { ThemeTokenMap } from "./theme-tokens";

/** The viewer's interface language: their saved choice when the project offers it. */
export function requestLanguage(engine: DashyEngine, request: Request): Language {
  return viewerLanguage(resolveLanguage(engine.project), readLanguageCookie(request.headers.get("Cookie")));
}

export interface Authentication {
  principal?: Principal;
  /** Headers from the hook, e.g. a renewed session cookie, for the final response. */
  headers: Headers;
  /** The verified embed token, when the request presented one. Its scope limits every endpoint. */
  embed?: EmbedClaims;
}
/** An unauthenticated page request that the hook sent to a login page. */
export class AuthRedirect extends Error {
  constructor(readonly location: string, readonly headers: Headers) {
    super("Authentication required");
  }
}
function normalize(result: AuthResult): { principal?: Principal; redirect?: string; headers: Headers } | null {
  if (!result) return null;
  if ("redirect" in result) return { redirect: result.redirect, headers: new Headers(result.headers) };
  if ("principal" in result) return { principal: result.principal, headers: new Headers(result.headers) };
  return { principal: result, headers: new Headers() };
}
/**
 * Run the project's hook. Redirects are honoured only for page requests; data
 * requests receive 401 so scripts never follow a login page.
 */
export async function authenticate(
  engine: DashyEngine,
  request: Request,
  page = false,
): Promise<Authentication> {
  // An embed token replaces the project's authentication and never sets a cookie.
  // Without embedding configured, `token` is only a reserved key and normal authentication applies.
  const token = engine.project.embed ? presentedToken(request) : undefined;
  if (token) {
    const embed = await verifyEmbed(engine, token);
    return { principal: embedPrincipal(embed), headers: new Headers(), embed };
  }
  if (!engine.project.authenticate) return { headers: new Headers() };
  const result = normalize(await engine.project.authenticate(request));
  if (result?.principal) {
    if (!Array.isArray(result.principal.roles)) throw new Error("authenticate must return a principal with roles");
    return { principal: result.principal, headers: result.headers };
  }
  if (result?.redirect && page) throw new AuthRedirect(result.redirect, result.headers);
  throw new DashyError("Authentication required", 401);
}
export const responseHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};
function errorHeaders(error: unknown, extra?: Headers): Headers {
  const headers = new Headers(responseHeaders);
  if (isDashyError(error)) {
    if (error.status === 401) headers.set("WWW-Authenticate", 'Bearer realm="dashy"');
    if (error.retryAfter) headers.set("Retry-After", String(error.retryAfter));
  }
  extra?.forEach((value, name) => headers.append(name, value));
  return headers;
}
export function errorResponse(error: unknown, extra?: Headers): Response {
  if (!isDashyError(error))
    console.error("[dashy] Request failed", error);
  return Response.json(
    {
      error:
        isDashyError(error)
          ? error.message
          : "Unable to complete the request. Check the server logs.",
    },
    {
      status: isDashyError(error) ? error.status : 500,
      headers: errorHeaders(error, extra),
    },
  );
}
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** Minimal HTML error page for browser navigation, in the viewer's language; data requests keep JSON. */
export function errorPage(error: unknown, extra?: Headers, language: Language = "en"): Response {
  if (!isDashyError(error)) console.error("[dashy] Request failed", error);
  const t = messages[language];
  const status = isDashyError(error) ? error.status : 500;
  // The engine's own page errors have translations; project errors keep their text.
  const known: Record<string, string> = {
    "Page not found": t.pageNotFound, "Request URL is too long": t.urlTooLong, "Authentication required": t.authenticationRequired,
  };
  const message = isDashyError(error) ? known[error.message] ?? error.message : t.requestFailed;
  const titles: Record<number, string> = { 401: t.signInRequired, 403: t.accessDenied, 404: t.notFound, 503: t.temporarilyUnavailable };
  const headers = errorHeaders(error, extra);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
  const title = titles[status] ?? t.somethingWentWrong;
  return new Response(
    `<!DOCTYPE html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>`
    + `<style>body{font:16px system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f7f7f5;color:#1d1d1b}main{max-width:32rem;padding:2rem}a{color:inherit}</style></head>`
    + `<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="/">${escapeHtml(t.backToWorkspace)}</a></p></main></body></html>`,
    { status, headers },
  );
}
/**
 * Headers of every embed page: the host's origins may frame it (no X-Frame-Options),
 * and the token-bearing address never leaves as a referrer.
 */
export function embedPageHeaders(embed: import("./types").EmbedConfig | undefined, csp: string): Headers {
  const headers = new Headers({ ...responseHeaders, "Referrer-Policy": "no-referrer" });
  headers.delete("X-Frame-Options");
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Content-Security-Policy", `${csp}; frame-ancestors ${frameAncestors(embed)}`);
  return headers;
}
/** A short error inside the frame, in the token's language, without links into the workspace. */
export function embedErrorPage(error: unknown, embed: import("./types").EmbedConfig | undefined, language: Language = "en"): Response {
  if (!isDashyError(error)) console.error("[dashy] Request failed", error);
  const t = messages[language];
  const status = isDashyError(error) ? error.status : 500;
  const known: Record<string, string> = {
    "Invalid embed token": t.embedInvalid, "Embed token expired": t.embedExpired, "Embed token required": t.embedRequired,
    "Access denied": t.embedNotAllowed, "Page not found": t.pageNotFound, "Request URL is too long": t.urlTooLong,
  };
  const message = isDashyError(error) ? known[error.message] ?? error.message : t.requestFailed;
  const headers = embedPageHeaders(embed, "default-src 'none'; style-src 'unsafe-inline'");
  if (isDashyError(error) && error.retryAfter) headers.set("Retry-After", String(error.retryAfter));
  return new Response(
    `<!DOCTYPE html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(t.embedUnavailable)}</title>`
    + `<style>body{font:14px system-ui,sans-serif;margin:0;padding:16px;color:#1d1d1b}h1{font-size:15px;margin:0 0 4px}p{margin:0;color:#55524f}</style></head>`
    + `<body><main><h1>${escapeHtml(t.embedUnavailable)}</h1><p>${escapeHtml(message)}</p></main></body></html>`,
    { status, headers },
  );
}
function withHeaders(response: Response, extra: Headers): Response {
  if (![...extra.keys()].length) return response;
  const headers = new Headers(response.headers);
  extra.forEach((value, name) => headers.append(name, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
/** Options endpoint keys; parameter names cannot start with an underscore. */
const optionKeys = ["_q", "_value", "_limit"];
/**
 * Seconds a data request may stay silent: the queue wait plus the query time,
 * with a margin. Bun closes connections idle for 10 s by default, which would
 * cut slow queries before their own timeout. Bun accepts at most 255.
 */
export function requestIdleSeconds(limits: ProjectLimits): number {
  const resolved = resolveLimits(limits);
  return Math.min(255, Math.ceil((resolved.queueTimeoutMs + resolved.queryTimeoutMs) / 1000) + 5);
}
type ProjectLimits = Parameters<typeof resolveLimits>[0];
/** Bun's per-request idle timeout, when the request is served by Bun (srvx exposes the server). */
function extendIdleTimeout(request: Request, seconds: number) {
  const server = (request as { runtime?: { bun?: { server?: { timeout?: (request: Request, seconds: number) => void } } } })
    .runtime?.bun?.server;
  try { server?.timeout?.(request, seconds); } catch { /* not served by Bun */ }
}

export interface ApiHandlerOptions {
  /**
   * Resolved theme tokens for server-side SVG charts, generated at build time.
   * Without it, the built-in themes are read from the engine's stylesheets.
   */
  themeTokens?: ThemeTokenMap;
}
const mintBodyLimit = 64 * 1024;
const svgLimits = { width: [200, 2000, 800], height: [150, 1500, 400] } as const;
function dimension(search: URLSearchParams, key: "_width" | "_height"): number {
  const [min, max, fallback] = svgLimits[key === "_width" ? "width" : "height"];
  const raw = search.get(key);
  if (raw === null || raw === "") return fallback;
  if (!/^\d{1,5}$/.test(raw)) throw new DashyError(`${key} must be a whole number of pixels`);
  return Math.min(max, Math.max(min, Number(raw)));
}

export function createApiHandler(engine: DashyEngine, handlerOptions: ApiHandlerOptions = {}) {
  const custom = createCustomApiHandler(engine);
  const idleSeconds = requestIdleSeconds(engine.project.limits);
  let tokenMap: Promise<ThemeTokenMap> | undefined;
  const themeTokens = () => handlerOptions.themeTokens
    ? Promise.resolve(handlerOptions.themeTokens)
    : tokenMap ??= import("./theme-tokens").then(({ themeTokenMap }) => themeTokenMap());
  /**
   * Raw parameters for /api/datasets. An embed's fixed values win; a dashboard
   * token's datasets start from the dashboard's values, so they match its iframe.
   */
  const datasetInputs = (embed: EmbedClaims | undefined, accepted: readonly string[], raw: Record<string, unknown>) => {
    if (!embed) return raw;
    const base: Record<string, unknown> = {};
    if (embed.resource.kind === "dashboard") {
      const dashboard = engine.project.dashboards[embed.resource.name]!;
      const names = dashboard.params ?? [];
      const resolved = parseParams(engine.project.params, names, selectParams(embed.params, names), dashboard.defaults, engine.today());
      for (const name of names) if (accepted.includes(name)) base[name] = Object.hasOwn(resolved, name) ? resolved[name] : null;
    }
    return { ...base, ...raw, ...selectParams(embed.params, accepted) };
  };
  /** A charted dataset as a standalone SVG image, in the token's (or requested) theme and language. */
  async function svg(request: Request, url: URL, name: string, auth: Authentication): Promise<Response> {
    const search = url.searchParams;
    const width = dimension(search, "_width");
    const height = dimension(search, "_height");
    const project = engine.project;
    const themes = resolveTheme(project.theme, project.themes);
    const languages = resolveLanguage(project);
    const requestedTheme = search.get("_theme");
    const requestedLanguage = search.get("_lang");
    // Token values win; requested ones must be offered by the project.
    if (!auth.embed && requestedTheme !== null && requestedTheme !== themes.name && !themes.selectable.includes(requestedTheme))
      throw new DashyError("_theme must be a theme the project offers");
    if (!auth.embed && requestedLanguage !== null && !(isLanguage(requestedLanguage)
      && (requestedLanguage === languages.name || languages.selectable.includes(requestedLanguage))))
      throw new DashyError("_lang must be a language the project offers");
    const theme = auth.embed?.theme ?? requestedTheme ?? themes.name;
    const language = auth.embed?.language ?? (requestedLanguage as Language | null) ?? requestLanguage(engine, request);
    const dataset = project.datasets[name];
    const accepted = dataset && Object.hasOwn(project.datasets, name) ? engine.datasetParams(name) : [];
    const data = await engine.chartData(name, datasetInputs(auth.embed, accepted, readParams(search, project.params)),
      auth.principal, request.signal, { refresh: search.get("refresh") === "true", fixed: auth.embed?.params });
    const text = messages[language];
    const params: Params = data.params;
    const caption = describeFilters(data.filters.filter((param) => !isUnset(params[param])), params, project.params, {}, text);
    const { renderChartSvg } = await import("./chart-svg");
    const { serverChartTheme } = await import("./theme-tokens");
    const body = renderChartSvg({
      definition: data.definition, result: data.result,
      locale: formattingLocale(project.locale ?? "pt", language),
      theme: serverChartTheme(await themeTokens(), theme, project),
      title: data.definition.label, caption, otherLabel: text.other, width, height,
    });
    // Cached privately no longer than the result cache keeps data, nor past the token's expiry.
    let maxAge = engine.cache ? Math.floor(project.cache!.ttlSeconds) : 0;
    if (auth.embed) maxAge = Math.max(0, Math.min(maxAge, auth.embed.expiresAt - Math.ceil(Date.now() / 1000)));
    const headers = new Headers(responseHeaders);
    headers.set("Content-Type", "image/svg+xml; charset=utf-8");
    headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
    headers.set("Cache-Control", `private, max-age=${maxAge}`);
    // Other sites show it in <img>, also when they isolate themselves (COEP).
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    if (auth.embed) headers.set("Referrer-Policy", "no-referrer");
    return withHeaders(new Response(body, { headers }), auth.headers);
  }
  /** POST /api/embed: an API-key principal mints a token for one dashboard or dataset. */
  async function mint(request: Request): Promise<Response> {
    if (!engine.project.embed) throw new DashyError("Endpoint not found", 404);
    if (request.method !== "POST")
      return Response.json({ error: "Method not allowed" }, { status: 405, headers: { ...responseHeaders, Allow: "POST" } });
    const auth = await authenticate(engine, request);
    if (auth.embed) throw new DashyError("Embed tokens can only be minted with an API key", 403);
    assertWriteRequest(request);
    const body = await readJsonBody(await boundedRequest(request, mintBodyLimit));
    return withHeaders(Response.json(await mintEmbed(engine, auth.principal, body), { headers: responseHeaders }), auth.headers);
  }
  return async (request: Request): Promise<Response> => {
    let auth: Authentication | undefined;
    extendIdleTimeout(request, idleSeconds);
    try {
      if (request.url.length > 16_384) throw new DashyError("Request URL is too long", 414);
      const path = new URL(request.url).pathname;
      if (path === "/api/embed" || path === "/api/embed/") return await mint(request);
      if (path === "/api/custom" || path.startsWith("/api/custom/")) {
        auth = await authenticate(engine, request);
        if (auth.embed) throw new DashyError("Access denied", 403);
        const response = await custom(request, auth.principal);
        const headers = new Headers(response.headers);
        for (const [name, value] of Object.entries(responseHeaders)) headers.set(name, value);
        auth.headers.forEach((value, name) => headers.append(name, value));
        if (request.method === "HEAD") void response.body?.cancel().catch(() => {});
        return new Response(request.method === "HEAD" ? null : response.body, { status: response.status, statusText: response.statusText, headers });
      }
      if (request.method !== "GET")
        return Response.json(
          { error: "Method not allowed" },
          { status: 405, headers: { ...responseHeaders, Allow: "GET" } },
        );
      auth = await authenticate(engine, request);
      const principal = auth.principal;
      const url = new URL(request.url);
      // An embed token opens only what it shows.
      if (auth.embed && !embedAllows(engine, auth.embed, url.pathname)) throw new DashyError("Access denied", 403);
      const fixed = auth.embed?.params;
      const parts = url.pathname.split("/").filter(Boolean);
      const refresh = url.searchParams.get("refresh") === "true";
      const crossFilters = readCrossFilters(url.searchParams);
      const drilldowns = readDrilldowns(url.searchParams);
      let result: unknown;
      if (url.pathname === "/api/catalog") result = engine.catalog(principal);
      else if (parts[0] === "api" && parts[1] === "embed") {
        if (!engine.project.embed) throw new DashyError("Endpoint not found", 404);
        if (!auth.embed) throw new DashyError("Embed token required", 401);
        const params = readParams(url.searchParams, engine.project.params);
        const options = { refresh, crossFilters, drilldowns, fixed };
        if (parts[2] === "shell" && parts.length === 3)
          result = engine.embedShell(auth.embed.resource, params, principal, options);
        else if (parts[2] === "data" && parts.length === 4) {
          let group: string;
          try { group = decodeURIComponent(parts[3]!); } catch { throw new DashyError("Invalid endpoint name"); }
          result = await engine.embedData(auth.embed.resource, group, params, principal, request.signal, options);
        } else throw new DashyError("Endpoint not found", 404);
      } else if (parts[0] === "api" && parts[1] === "params" && parts[3] === "options" && parts.length === 4) {
        let name: string;
        try { name = decodeURIComponent(parts[2]!); } catch { throw new DashyError("Invalid parameter name"); }
        const search = new URLSearchParams(url.searchParams);
        for (const key of optionKeys) search.delete(key);
        const limit = url.searchParams.get("_limit");
        if (limit !== null && !/^\d{1,3}$/.test(limit)) throw new DashyError("_limit must be an integer");
        const values = url.searchParams.getAll("_value");
        result = await engine.paramOptions(name, readParams(search, engine.project.params), {
          search: url.searchParams.get("_q") ?? undefined,
          values: values.length ? values : undefined,
          limit: limit === null ? undefined : Number(limit),
        }, principal, request.signal, { refresh });
      } else {
        const independent = (parts[1] === "dashboard-data" || parts[1] === "dashboard-export") && parts.length === 4;
        if ((!independent && parts.length !== 3) || parts[0] !== "api")
          throw new DashyError("Endpoint not found", 404);
        let name: string;
        let group = "";
        try {
          name = decodeURIComponent(parts[2]!);
          if (independent) group = decodeURIComponent(parts[3]!);
        } catch {
          throw new DashyError("Invalid endpoint name");
        }
        if (parts[1] === "datasets") {
          const format = url.searchParams.get("_format");
          if (format === "svg") return await svg(request, url, name, auth);
          if (format !== null && format !== "json") throw new DashyError("_format must be json or svg");
        }
        const params = readParams(url.searchParams, engine.project.params);
        if (parts[1] === "dashboard-export" && independent) {
          let options: ReturnType<typeof readExportOptions> | undefined;
          const block = await engine.dashboardBlock(name, group, params, principal, request.signal, { refresh, crossFilters, drilldowns },
            (definition) => { options = readExportOptions(url.searchParams, definition); });
          const dashboard = block.shell.definition;
          const file = await exportFile({
            dashboardId: name, dashboardLabel: dashboard.label, blockId: group,
            definition: block.definition, result: block.result,
            filters: block.shell.params, filterNames: dashboard.params ?? [],
            ignored: [
              ...block.shell.crossFilters.filter((origin) => origin.block === group).map((origin) => origin.param),
              ...(dashboard.unfiltered?.[group] ?? []),
            ],
            drilldown: describeDrilldown(block.definition, block.shell.drilldowns[group] ?? []) || undefined,
            params: engine.project.params, generatedAt: new Date(),
            locale: formattingLocale(engine.project.locale ?? "pt", requestLanguage(engine, request)),
            options: options!,
          });
          const headers = new Headers(responseHeaders);
          headers.set("Content-Type", file.contentType);
          headers.set("Content-Disposition", `attachment; filename="${file.filename}"`);
          return withHeaders(new Response(file.body, { headers }), auth.headers);
        }
        if (parts[1] === "dashboard-shell")
          result = engine.dashboardShell(name, params, principal, { crossFilters, drilldowns, fixed });
        else if (independent)
          result = await engine.dashboardData(name, group, params, principal, request.signal, { refresh, crossFilters, drilldowns, fixed });
        else if (parts[1] === "dashboards")
          result = await engine.dashboard(name, params, principal, request.signal, { refresh, crossFilters, drilldowns });
        else if (parts[1] === "datasets") {
          const query = engine.project.datasets[name] && Object.hasOwn(engine.project.datasets, name)
            ? engine.project.queries[engine.project.datasets[name]!.query]?.params ?? [] : [];
          result = await engine.dataset(name, datasetInputs(auth.embed, query, params), principal, undefined, request.signal, { refresh });
        } else if (parts[1] === "metrics")
          result = await engine.metricValue(name, params, principal, undefined, request.signal, { refresh });
        else if (parts[1] === "queries")
          result = await engine.query(name, params, principal, request.signal, { refresh });
        else throw new DashyError("Endpoint not found", 404);
      }
      return withHeaders(Response.json(result, { headers: responseHeaders }), auth.headers);
    } catch (error) {
      const response = errorResponse(error, auth?.headers);
      return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }
  };
}
