import { createCustomApiHandler } from "./custom-api";
import { DashyEngine } from "./engine";
import { DashyError, isDashyError, readParams } from "./params";
import type { Principal } from "./types";

export async function authenticate(
  engine: DashyEngine,
  request: Request,
): Promise<Principal | undefined> {
  if (!engine.project.authenticate) return undefined;
  const principal = await engine.project.authenticate(request);
  if (!principal) throw new DashyError("Authentication required", 401);
  return principal;
}
export const responseHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};
export function errorResponse(error: unknown): Response {
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
      headers: responseHeaders,
    },
  );
}
export function createApiHandler(engine: DashyEngine) {
  const custom = createCustomApiHandler(engine);
  return async (request: Request): Promise<Response> => {
    try {
      if (request.url.length > 16_384) throw new DashyError("Request URL is too long", 414);
      const path = new URL(request.url).pathname;
      if (path === "/api/custom" || path.startsWith("/api/custom/")) {
        const principal = await authenticate(engine, request);
        const response = await custom(request, principal);
        const headers = new Headers(response.headers);
        for (const [name, value] of Object.entries(responseHeaders)) headers.set(name, value);
        if (request.method === "HEAD") void response.body?.cancel().catch(() => {});
        return new Response(request.method === "HEAD" ? null : response.body, { status: response.status, statusText: response.statusText, headers });
      }
      if (request.method !== "GET")
        return Response.json(
          { error: "Method not allowed" },
          { status: 405, headers: { ...responseHeaders, Allow: "GET" } },
        );
      const principal = await authenticate(engine, request);
      const url = new URL(request.url);
      const parts = url.pathname.split("/").filter(Boolean);
      let result: unknown;
      if (url.pathname === "/api/catalog") result = engine.catalog(principal);
      else {
        const independent = parts[1] === "dashboard-data" && parts.length === 4;
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
        if (independent)
          result = await engine.dashboardData(name, group, params, principal, request.signal);
        else if (parts[1] === "dashboards")
          result = await engine.dashboard(name, params, principal, request.signal);
        else if (parts[1] === "datasets")
          result = await engine.dataset(name, params, principal, undefined, request.signal);
        else if (parts[1] === "metrics")
          result = { value: await engine.metric(name, params, principal, undefined, request.signal) };
        else if (parts[1] === "queries")
          result = await engine.query(name, params, principal, request.signal);
        else throw new DashyError("Endpoint not found", 404);
      }
      return Response.json(result, { headers: responseHeaders });
    } catch (error) {
      const response = errorResponse(error);
      return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }
  };
}
