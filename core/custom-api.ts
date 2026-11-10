import { canRead, type DashyEngine } from "./engine";
import { DashyError, parseParams, readParams } from "./params";
import type { Principal } from "./types";

const defaultBodyLimit = 1024 * 1024;
const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** The request with its whole body read, refusing bodies over `limit` bytes (413). */
export async function boundedRequest(request: Request, limit: number): Promise<Request> {
  if (Number(request.headers.get("content-length")) > limit)
    throw new DashyError("Request body too large", 413);
  if (!request.body) return request;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  request.signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (request.signal.aborted) throw new DashyError("Request cancelled", 499);
      const { value, done } = await reader.read();
      if (request.signal.aborted) throw new DashyError("Request cancelled", 499);
      if (done) break;
      size += value.byteLength;
      if (size > limit) { cancel(); throw new DashyError("Request body too large", 413); }
      chunks.push(value);
    }
  } finally {
    request.signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new Request(request.url, { method: request.method, headers: request.headers, body, signal: request.signal });
}

/**
 * Write requests carry `X-Dashy-Request: 1`, and browsers must send them from the
 * same origin: a cross-site form cannot set the header, and scripts on other sites
 * are refused by Origin and Sec-Fetch-Site. Server-to-server callers send neither.
 */
export function assertWriteRequest(request: Request) {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (request.headers.get("x-dashy-request") !== "1" || (origin !== null && origin !== new URL(request.url).origin)
    || (site !== null && site !== "same-origin" && site !== "none"))
    throw new DashyError("Write requests require X-Dashy-Request: 1 and a same-origin browser request", 403);
}
/** Parses a bounded JSON body as unknown; 415 without a JSON content type, 400 when malformed. */
export async function readJsonBody(request: Request): Promise<unknown> {
  if (!/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))
    throw new DashyError("Expected application/json", 415);
  try { return await request.json(); }
  catch { throw new DashyError("Invalid JSON body"); }
}

/** Compile once; more specific static segments take precedence, left to right. */
export function createCustomApiHandler(engine: DashyEngine) {
  const routes = Object.values(engine.project.api ?? {}).map(route => ({
    route,
    parts: route.path === "/" ? [] : route.path.slice(1).split("/"),
    pattern: route.path.replace(/:[^/]+/g, ":"),
  })).sort((a, b) => {
    for (let i = 0; i < Math.min(a.parts.length, b.parts.length); i++) {
      const difference = Number(a.parts[i]!.startsWith(":")) - Number(b.parts[i]!.startsWith(":"));
      if (difference) return difference;
    }
    return 0;
  });
  return async (request: Request, principal?: Principal): Promise<Response> => {
    const url = new URL(request.url);
    const suffix = url.pathname.slice("/api/custom".length).replace(/\/$/, "");
    let parts: string[];
    try {
      parts = suffix ? suffix.slice(1).split("/").map(decodeURIComponent) : [];
      if (parts.some(part => !part || /[/\\\u0000-\u001f\u007f]/.test(part) || part === "." || part === "..")) throw new Error();
    } catch { throw new DashyError("Invalid endpoint path"); }
    const matched = routes.filter(({ parts: pattern }) => pattern.length === parts.length
      && pattern.every((part, i) => part.startsWith(":") || part === parts[i]));
    const first = matched[0];
    if (!first) throw new DashyError("Endpoint not found", 404);
    // Method fallback must never select a less specific path.
    const candidates = matched.filter(item => item.pattern === first.pattern);
    const authorized = candidates.filter(item => canRead(item.route.roles, principal));
    const methods = new Set(authorized.map(item => item.route.method as string));
    if (methods.has("GET")) methods.add("HEAD");
    methods.add("OPTIONS");
    const allow = [...methods].sort().join(", ");
    if (request.method === "OPTIONS") {
      if (!authorized.length) throw new DashyError("Access denied", 403);
      return new Response(null, { status: 204, headers: { Allow: allow } });
    }
    const selected = candidates.find(item => item.route.method === (request.method === "HEAD" ? "GET" : request.method));
    if (!selected) {
      if (!authorized.length) throw new DashyError("Access denied", 403);
      return Response.json({ error: "Method not allowed" }, { status: 405, headers: { Allow: allow } });
    }
    if (!canRead(selected.route.roles, principal)) throw new DashyError("Access denied", 403);
    if (unsafeMethods.has(request.method)) assertWriteRequest(request);
    const route = selected.route;
    const raw = route.params === undefined ? {} : readParams(url.searchParams, engine.project.params);
    const params = parseParams(engine.project.params, route.params ?? [], raw);
    // Preserve explicit clears when a handler forwards these parameters to data.*.
    for (const name of route.params ?? []) if (!Object.hasOwn(params, name)) params[name] = null;
    const pathParams = Object.fromEntries(selected.parts.flatMap((part, i) => part.startsWith(":") ? [[part.slice(1), parts[i]!]] : []));
    if (request.signal.aborted) throw new DashyError("Request cancelled", 499);
    const bounded = await boundedRequest(request, route.maxBodyBytes ?? defaultBodyLimit);
    let json: Promise<unknown> | undefined;
    const response = await route.handler({
      request: bounded, pathParams, query: url.searchParams, params, principal, signal: request.signal,
      readJson() {
        return json ??= readJsonBody(bounded);
      },
      data: {
        dataset: (name, values = {}) => engine.dataset(name, values, principal, undefined, request.signal),
        metric: (name, values = {}) => engine.metric(name, values, principal, undefined, request.signal),
        query: (name, values = {}) => engine.query(name, values, principal, request.signal),
      },
    });
    if (!(response instanceof Response)) throw new Error("API handler must return a Response");
    return response;
  };
}
