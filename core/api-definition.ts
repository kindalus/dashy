import type { ApiRoutes } from "./types.ts";

export const apiMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** Explicit, server-only routes. Paths are relative to /api/custom. */
export function defineApiRoutes<const T extends ApiRoutes>(routes: T): T {
  if (!routes || typeof routes !== "object" || Array.isArray(routes))
    throw new Error("API routes must be a registry");
  const signatures = new Set<string>();
  for (const [id, route] of Object.entries(routes)) {
    const fail = (message: string): never => { throw new Error(`API route ${id}: ${message}`); };
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)) fail("invalid identifier");
    if (!route || typeof route !== "object") fail("invalid definition");
    if (!apiMethods.includes(route.method)) fail("unsupported method");
    if (typeof route.path !== "string" || !/^\/(?:[a-zA-Z0-9_-]+|:[a-zA-Z][a-zA-Z0-9_]*)(?:\/(?:[a-zA-Z0-9_-]+|:[a-zA-Z][a-zA-Z0-9_]*))*$/.test(route.path) && route.path !== "/")
      fail("path must contain static segments or :parameters, with no trailing slash");
    const names = route.path.split("/").filter(part => part.startsWith(":"));
    if (new Set(names).size !== names.length) fail("duplicate path parameter");
    const signature = `${route.method} ${route.path.replace(/:[^/]+/g, ":")}`;
    if (signatures.has(signature)) fail("duplicate method and path pattern");
    signatures.add(signature);
    if (typeof route.handler !== "function") fail("handler must be a function");
    for (const key of ["roles", "params"] as const) {
      if (route[key] !== undefined && (!Array.isArray(route[key]) || route[key]!.some(value => typeof value !== "string" || !value.trim())))
        fail(`${key} must be non-empty strings`);
    }
    if (route.maxBodyBytes !== undefined && (!Number.isSafeInteger(route.maxBodyBytes) || route.maxBodyBytes < 1))
      fail("maxBodyBytes must be a positive integer");
  }
  return routes;
}
