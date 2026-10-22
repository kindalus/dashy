import assert from "node:assert/strict";
import { DuckDBInstance } from "@duckdb/node-api";
import { DashyEngine } from "../core/engine";
import { loadProject } from "../core/runtime";
import { mountRows } from "../core/sources";
import { formatValue } from "../src/format";

// Fixed workloads, one warm-up, then five timed samples. Run cases independently
// when comparing changes so competing work does not contaminate the timings.
const cases: Record<string, () => Promise<void> | void> = {
  "format-numbers": () => {
    let length = 0;
    for (let i = 0; i < 10_000; i++)
      length += formatValue(i / 100, {
        style: "currency",
        currency: "EUR",
      }).length;
    assert.equal(length, 57800);
  },
  "format-dates": () => {
    let length = 0;
    for (let i = 0; i < 10_000; i++)
      length += formatValue("2026-01-15", { style: "date" }).length;
    assert.equal(length, 110000);
  },
  "import-rows": async () => {
    const instance = await DuckDBInstance.create(":memory:", { threads: "2" });
    const connection = await instance.connect();
    try {
      await mountRows(
        connection,
        "data",
        Array.from({ length: 10_000 }, (_, id) => ({
          id,
          amount: id / 100,
          label: `Item ${id}`,
          enabled: id % 2 === 0,
          date: "2026-01-15",
          optional: id % 3 ? null : "value",
        })),
        ["id", "amount", "label", "enabled", "date", "optional"],
        { date: "DATE" },
      );
      const result = (
        await connection.runAndReadAll(
          "SELECT COUNT(*) AS total, SUM(id) AS sum FROM data",
        )
      ).getRowObjectsJson();
      assert.equal(Number(result[0]!.total), 10000);
      assert.equal(Number(result[0]!.sum), 49995000);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  },
  "maven-dashboard": async () => {
    const engine = new DashyEngine(
      await loadProject("samples/maven-analytics/dashy.config.ts"),
    );
    const result = await engine.dashboard("overview");
    assert.equal(
      result.blocks.some((b) => b.type === "error"),
      false,
    );
    const revenue = result.blocks.find((b) => b.id === "revenue");
    assert.equal(
      revenue?.type === "metric" && Number(revenue.value),
      55755479.59,
    );
  },
  "maven-concurrent": async () => {
    const engine = new DashyEngine(
      await loadProject("samples/maven-analytics/dashy.config.ts"),
    );
    const results = await Promise.all(
      Array.from({ length: 4 }, () => engine.dashboard("overview")),
    );
    assert.ok(results.every((r) => r.blocks.every((b) => b.type !== "error")));
  },
};
const names = process.argv.slice(2);
for (const name of names.length ? names : Object.keys(cases)) {
  const run = cases[name];
  if (!run)
    throw new Error(
      `Unknown benchmark '${name}'. Choose ${Object.keys(cases).join(", ")}`,
    );
  await run();
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    await run();
    samples.push(performance.now() - start);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      name,
      medianMs: +sorted[2]!.toFixed(2),
      minMs: +sorted[0]!.toFixed(2),
      maxMs: +sorted[4]!.toFixed(2),
      samplesMs: samples.map((n) => +n.toFixed(2)),
    }),
  );
}
