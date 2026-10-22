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
  for (const name of Object.keys(engine.project.dashboards)) {
    const result = await engine.dashboard(name, {
      country: "Canada",
      channel: "Online",
      category: "Computers",
    });
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
