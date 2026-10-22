import { expect, test } from "bun:test";
import { fetchDataset, fetchMetric, paramsSearch } from "../src/page-data";

test("page data helpers serialize arrays, ranges and explicit clears without losing zero or false", () => {
  expect(paramsSearch({ customer: 0, active: false, region: null, ids: ["A&B", "C"], empty: [], period: { from: "2026-01-01", until: "2026-02-01" } }).toString())
    .toBe("customer=0&active=false&region=&ids=A%26B&ids=C&empty=&period.from=2026-01-01&period.until=2026-02-01");
});

test("page data requests include params, same-origin credentials and cancellation and surface HTTP errors", async () => {
  const original = globalThis.fetch;
  const requests: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    if (String(url).includes("denied")) return Response.json({ error: "Access denied" }, { status: 403 });
    return String(url).includes("metrics") ? Response.json({ value: 7 }) : Response.json({ columns: ["n"], rows: [{ n: 7 }], truncated: false, durationMs: 1 });
  }) as typeof fetch;
  try {
    const controller = new AbortController();
    const result = await fetchDataset("orders", { customer: 2 }, controller.signal);
    expect(result.rows).toEqual([{ n: 7 }]);
    expect(requests[0]?.url).toBe("/api/datasets/orders?customer=2");
    expect(requests[0]?.init?.credentials).toBe("same-origin");
    expect(requests[0]?.init?.signal).toBe(controller.signal);
    expect(await fetchMetric("total", { customer: 2 })).toEqual({ value: 7 });
    await expect(fetchDataset("denied")).rejects.toThrow("Access denied");
  } finally { globalThis.fetch = original; }
});
