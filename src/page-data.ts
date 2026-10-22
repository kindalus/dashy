import type { Params, QueryResult, Scalar } from "../core/types";

export function paramsSearch(params: Params): URLSearchParams {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      if (!value.length) search.set(name, "");
      else value.forEach(item => search.append(name, item == null ? "" : String(item)));
    } else if (value && typeof value === "object") {
      search.set(`${name}.from`, String(value.from));
      search.set(`${name}.until`, String(value.until));
    } else search.set(name, value == null ? "" : String(value));
  }
  return search;
}
async function request<T>(kind: string, name: string, params: Params, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/${kind}/${encodeURIComponent(name)}?${paramsSearch(params)}`, { signal, credentials: "same-origin" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load data");
  return body;
}
export const fetchDataset = (name: string, params: Params = {}, signal?: AbortSignal) => request<QueryResult>("datasets", name, params, signal);
export const fetchMetric = (name: string, params: Params = {}, signal?: AbortSignal) => request<{ value: Scalar }>("metrics", name, params, signal);
