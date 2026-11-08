// Build the base and the example project images, run the project container and
// check the probe, SSR, catalog and a dataset. Uses podman, or docker if absent.
//   bun run check:container [--keep]
import assert from "node:assert/strict";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const tool = Bun.which("podman") ?? Bun.which("docker");
if (!tool) throw new Error("check:container requires podman or docker");
const keep = process.argv.includes("--keep");
const tag = `check-${Date.now().toString(36)}`;
const base = `localhost/dashy-base:${tag}`;
const app = `localhost/dashy-example:${tag}`;
const name = `dashy-check-${tag}`;
// Podman defaults to OCI images, which drop HEALTHCHECK.
const format = tool.endsWith("podman") ? ["--format", "docker"] : [];

async function run(args: string[], inherit = true): Promise<string> {
  const child = Bun.spawn([tool!, ...args], { cwd: root, stdout: inherit ? "inherit" : "pipe", stderr: inherit ? "inherit" : "pipe" });
  const output = inherit ? "" : await new Response(child.stdout).text();
  const code = await child.exited;
  if (code !== 0) throw new Error(`${tool} ${args.join(" ")} exited with ${code}`);
  return output.trim();
}

try {
  await run(["build", ...format, "-t", base, "-f", "Containerfile", "."]);
  await run(["build", ...format, "--build-arg", `DASHY_BASE=${base}`, "-t", app, "-f", "examples/external-application/Containerfile", "examples/external-application"]);
  await run(["run", "-d", "--name", name, "-p", "127.0.0.1::3000", app], false);
  const port = (await run(["port", name, "3000"], false)).split("\n")[0]!.split(":").at(-1)!;
  const origin = `http://127.0.0.1:${port}`;
  let healthy = false;
  for (let attempt = 0; attempt < 60 && !healthy; attempt++) {
    healthy = await fetch(`${origin}/healthz`).then((r) => r.ok).catch(() => false);
    if (!healthy) await Bun.sleep(1000);
  }
  assert.ok(healthy, "container did not become healthy");
  assert.deepEqual(await (await fetch(`${origin}/healthz`)).json(), { status: "ok" });
  const page = await fetch(`${origin}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<!DOCTYPE html>/);
  const catalog = await (await fetch(`${origin}/api/catalog`)).json();
  assert.ok(Object.keys(catalog.dashboards).length > 0);
  const orders = await (await fetch(`${origin}/api/datasets/customer_orders`)).json();
  assert.ok(orders.rows.length > 0);
  const user = (await run(["exec", name, "id", "-un"], false));
  assert.equal(user, "bun", "the runtime must not run as root");
  console.log(`Container passed: base and project images build, non-root runtime, health probe, SSR, catalog and data (${tool}).`);
} finally {
  await run(["rm", "-f", name], false).catch(() => {});
  if (!keep) await run(["rmi", "-f", app, base], false).catch(() => {});
}
