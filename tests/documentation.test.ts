import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadProject } from "../core/runtime";
import { DashyEngine } from "../core/engine";

test("the complete llms.txt example runs outside the source tree through the public SDK", async () => {
  const doc = await readFile(resolve(import.meta.dirname, "../llms.txt"), "utf8");
  const config = [...doc.matchAll(/```ts\n([\s\S]*?)```/g)].find(match => match[1]?.includes('name: "Analytics da aplicação"'))?.[1];
  const csv = /```csv\n([\s\S]*?)```/.exec(doc)?.[1];
  expect(config).toBeDefined();
  expect(csv).toBeDefined();
  const directory = await mkdtemp(join(tmpdir(), "dashy-doc-example-"));
  try {
    await mkdir(join(directory, "node_modules"));
    await mkdir(join(directory, "data"));
    await symlink(resolve(import.meta.dirname, ".."), join(directory, "node_modules/dashy"));
    await writeFile(join(directory, "dashy.config.ts"), config!);
    await writeFile(join(directory, "data/orders.csv"), csv!);
    const engine = new DashyEngine(await loadProject(join(directory, "dashy.config.ts")));
    expect(Number(await engine.metric("revenue"))).toBe(6000);
    expect(Number(await engine.metric("orders"))).toBe(3);
    expect(Number(await engine.metric("revenue", { region: "North" }))).toBe(4000);
    expect(Number(await engine.metric("orders", { region: "North" }))).toBe(2);
    expect(engine.dashboardShell("overview").requests.length).toBe(2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
