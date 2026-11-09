import { createCustomApiHandler } from "./custom-api";
import { DashyEngine, readCrossFilters } from "./engine";
import { exportFile, readExportOptions } from "./export";
import { describeDrilldown, readDrilldowns } from "./drilldown";
import { DashyError, isDashyError, readParams } from "./params";
import type { AuthResult, Principal } from "./types";
import {
  formattingLocale, messages, readLanguageCookie, resolveLanguage, viewerLanguage, type Language,
} from "./i18n";

/** The viewer's interface language: their saved choice when the project offers it. */
export function requestLanguage(engine: DashyEngine, request: Request): Language {
  return viewerLanguage(resolveLanguage(engine.project), readLanguageCookie(request.headers.get("Cookie")));
}

export interface Authentication {
  principal?: Principal;
  /** Headers from the hook, e.g. a renewed session cookie, for the final response. */
  headers: Headers;
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
function withHeaders(response: Response, extra: Headers): Response {
  if (![...extra.keys()].length) return response;
  const headers = new Headers(response.headers);
  extra.forEach((value, name) => headers.append(name, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
/** Options endpoint keys; parameter names cannot start with an underscore. */
const optionKeys = ["_q", "_value", "_limit"];
export function createApiHandler(engine: DashyEngine) {
  const custom = createCustomApiHandler(engine);
  return async (request: Request): Promise<Response> => {
    let auth: Authentication | undefined;
    try {
      if (request.url.length > 16_384) throw new DashyError("Request URL is too long", 414);
      const path = new URL(request.url).pathname;
      if (path === "/api/custom" || path.startsWith("/api/custom/")) {
        auth = await authenticate(engine, request);
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
      const parts = url.pathname.split("/").filter(Boolean);
      const refresh = url.searchParams.get("refresh") === "true";
      const crossFilters = readCrossFilters(url.searchParams);
      const drilldowns = readDrilldowns(url.searchParams);
      let result: unknown;
      if (url.pathname === "/api/catalog") result = engine.catalog(principal);
      else if (parts[0] === "api" && parts[1] === "params" && parts[3] === "options" && parts.length === 4) {
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
        const params = readParams(url.searchParams, engine.project.params);
        let name: string;
        let group = "";
        try {
          name = decodeURIComponent(parts[2]!);
          if (independent) group = decodeURIComponent(parts[3]!);
        } catch {
          throw new DashyError("Invalid endpoint name");
        }
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
          result = engine.dashboardShell(name, params, principal, { crossFilters, drilldowns });
        else if (independent)
          result = await engine.dashboardData(name, group, params, principal, request.signal, { refresh, crossFilters, drilldowns });
        else if (parts[1] === "dashboards")
          result = await engine.dashboard(name, params, principal, request.signal, { refresh, crossFilters, drilldowns });
        else if (parts[1] === "datasets")
          result = await engine.dataset(name, params, principal, undefined, request.signal, { refresh });
        else if (parts[1] === "metrics")
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
