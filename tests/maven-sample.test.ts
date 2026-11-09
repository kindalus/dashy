import { expect, test } from "bun:test";
import { DashyEngine } from "../core/engine";
import { loadProject } from "../core/runtime";

// Full CSV integration checks need headroom on busy development and CI hosts.
const csvTimeout = 60_000;

const engine = new DashyEngine(
  await loadProject("samples/maven-analytics/dashy.config.ts"),
);

test("Maven sample includes all order lines without join fanout and reconciles totals", async () => {
  const result = await engine.query("summary");
  expect(Number(result.rows[0]!.orders)).toBe(26326);
  expect(Number(result.rows[0]!.units)).toBe(197757);
  expect(Number(result.rows[0]!.revenue)).toBeCloseTo(55755479.59, 2);
  expect(Number(result.rows[0]!.profit)).toBeCloseTo(32662688.38, 2);
  const monthly = await engine.query("monthly");
  expect(monthly.rows).toHaveLength(62);
  expect(
    monthly.rows.reduce(
      (sum, row) => sum + Number(row.online) + Number(row.store),
      0,
    ),
  ).toBeCloseTo(55755479.59, 2);
}, csvTimeout);

test("every Maven dashboard executes and all filters reach its queries", async () => {
  for (const [name, definition] of Object.entries(engine.project.dashboards)) {
    const raw: Record<string, unknown> = { country: "Canada", channel: "Online" };
    if (definition.params?.includes("category")) raw.category = "Computers";
    if (definition.required?.includes("productName")) raw.productName = "Contoso Wireless Laser Mouse E50 Grey";
    const result = await engine.dashboard(name, raw);
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.blocks.filter((block) => block.type === "error")).toEqual([]);
  }
  const rows = (
    await engine.query("orders", {
      country: "Canada",
      channel: "Online",
      product: "Contoso",
      minQuantity: 2,
      delivered: true,
    })
  ).rows;
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.country).toBe("Canada");
    expect(row.channel).toBe("Online");
    expect(String(row.product)).toContain("Contoso");
    expect(Number(row.quantity)).toBeGreaterThanOrEqual(2);
    expect(row.delivery_date).not.toBeNull();
    expect(row.exchange_rate).not.toBeNull();
  }
}, csvTimeout);

test("detail caps rows and preserves no-results semantics", async () => {
  const result = await engine.query("orders");
  expect(result.rows).toHaveLength(1000);
  expect(result.truncated).toBe(true);
  const noRows = await engine.query("summary", {
    period: { from: "2030-01-01", until: "2030-12-31" },
  });
  expect(Number(noRows.rows[0]!.revenue)).toBe(0);
  expect(Number(noRows.rows[0]!.orders)).toBe(0);
}, csvTimeout);

test("Maven table totals, subtotals and Top N reconcile with the summary", async () => {
  const { applyTopN, shapeTable } = await import("../core/tables");
  const total = Number((await engine.query("summary")).rows[0]!.revenue);
  const categoryBrands = engine.project.datasets.category_brands!;
  const rows = (await engine.dataset("category_brands")).rows;
  const table = shapeTable(rows, categoryBrands, undefined, "en", true);
  expect(Number(table.totals!.revenue)).toBeCloseTo(total, 2);
  const subtotals = table.rows.filter((row) => row.kind === "subtotal");
  expect(subtotals).toHaveLength(8);
  expect(subtotals.reduce((sum, row) => sum + Number(row.row.revenue), 0)).toBeCloseTo(total, 2);
  const countries = engine.project.datasets.countries!;
  const top = applyTopN((await engine.dataset("countries")).rows, countries, 5, true);
  expect(top.rows).toHaveLength(6);
  expect(top.rows.at(-1)!.country).toBe("Other");
  expect(top.rows.reduce((sum, row) => sum + Number(row.revenue), 0)).toBeCloseTo(total, 2);
  const summary = (await engine.query("summary")).rows[0]!;
  const countryTotals = shapeTable(top.rows, countries, undefined, "en", true, top.members).totals!;
  expect(Number(countryTotals.customers)).toBe(Number(summary.customers));
  expect(Number(countryTotals.orders)).toBe(Number(summary.orders));
  const brands = engine.project.datasets.brands!;
  expect(applyTopN((await engine.dataset("brands")).rows, brands, 5, true).rows).toHaveLength(5);
  const products = engine.project.datasets.products!;
  const ranked = shapeTable((await engine.dataset("products")).rows, products, products.defaultSort, "en", true);
  const margin = Number(ranked.totals!.margin);
  expect(margin).toBeCloseTo(Number(ranked.totals!.profit) / Number(ranked.totals!.revenue), 10);
}, csvTimeout);

test("Maven summary compares with the period just before", async () => {
  const period = { from: "2020-01-01", until: "2020-12-31" };
  const row = (await engine.query("summary", { period })).rows[0]!;
  // A whole calendar year compares with the previous calendar year.
  const prior = (await engine.query("summary", { period: { from: "2019-01-01", until: "2019-12-31" } })).rows[0]!;
  expect(Number(row.previous_revenue)).toBeCloseTo(Number(prior.revenue), 2);
  expect(Number(row.previous_orders)).toBe(Number(prior.orders));
  const result = await engine.dashboard("overview", { period });
  const revenue = result.blocks.find((b) => b.id === "revenue")!;
  expect(revenue).toMatchObject({ type: "metric", compare: row.previous_revenue });
  expect(revenue.type === "metric" && revenue.sparkline!.length).toBe(12);
}, csvTimeout);

test("Maven forecast series leaves out the incomplete last month", async () => {
  const rows = (await engine.query("monthly_complete")).rows;
  expect(rows.at(-1)!.month).toBe("2021-01");
  expect(rows).toHaveLength(61);
  // A period ending mid-month drops that month; one ending on a month end keeps it.
  const mid = (await engine.query("monthly_complete", { period: { from: "2020-01-01", until: "2020-06-15" } })).rows;
  expect(mid.at(-1)!.month).toBe("2020-05");
  const end = (await engine.query("monthly_complete", { period: { from: "2020-01-01", until: "2020-06-30" } })).rows;
  expect(end.at(-1)!.month).toBe("2020-06");
}, csvTimeout);
