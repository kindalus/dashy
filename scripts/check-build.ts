import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DashboardResult } from "../core/types";
import { themeNames, resolveTheme } from "../core/theme";

// Run the actual packaged CLI and server outside the source tree. This catches
// both missing production dependencies and build-time sample selection leaks.
const directory = await mkdtemp(join(tmpdir(), "dashy-build-"));
try {
  await cp(resolve(".output"), directory, { recursive: true });
  const cli = join(directory, "dashy.mjs");
  async function withServer(
    sample: string | undefined,
    verify: (
      request: (path: string, method?: string) => Promise<Response>,
    ) => Promise<void>,
    theme?: string,
  ) {
    const reservation = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response(),
    });
    const port = reservation.port!;
    await reservation.stop(true);
    const child = Bun.spawn(
      [
        process.execPath,
        cli,
        "start",
        "--port",
        String(port),
        ...(sample ? ["--with-sample", sample] : []),
        ...(theme ? ["--theme", theme] : []),
      ],
      { cwd: directory, stdout: "pipe", stderr: "pipe" },
    );
    const out = new Response(child.stdout).text();
    const err = new Response(child.stderr).text();
    const request = (path: string, method = "GET") =>
      fetch(`http://127.0.0.1:${port}${path}`, { method });
    try {
      const deadline = Date.now() + 20000;
      while (true) {
        if (child.exitCode !== null)
          throw new Error(`Server exited: ${await out}\n${await err}`);
        try {
          if ((await request("/api/catalog")).ok) break;
        } catch {}
        if (Date.now() > deadline)
          throw new Error("Server did not become ready");
        await Bun.sleep(100);
      }
      await verify(request);
    } finally {
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      await child.exited;
      clearTimeout(timer);
      await Promise.all([out, err]);
    }
  }
  async function checkPage(
    request: (path: string, method?: string) => Promise<Response>,
    path = "/",
  ) {
    const response = await request(path);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(
      response.headers.get("content-security-policy") || "",
      /script-src 'self' 'nonce-/,
    );
    const bootstrap = html.match(
      /<script[^>]*id="dashy-data"[^>]*>(.*?)<\/script>/s,
    );
    assert.ok(bootstrap, "SSR must include hydration data");
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)];
    assert.ok(assets.length >= 2);
    for (const asset of assets)
      assert.equal((await request(asset[1]!)).status, 200);
    assert.equal((await request("/dashboards/missing")).status, 404);
    assert.equal((await request("/", "POST")).status, 405);
    assert.equal(await (await request("/", "HEAD")).text(), "");
    const data = JSON.parse(bootstrap[1]!);
    if (data.dashboard) {
      assert.equal(
        data.dashboard.blocks, undefined, "SSR must not include query results",
      );
      assert.equal(data.dashboard.generatedAt, undefined);
      assert.ok(html.includes("Loading dashboard…"));
      assert.equal(
        (html.match(/class="block-loading"/g) || []).length,
        data.dashboard.definition.blocks.length,
      );
    }
    assert.ok(html.includes(`data-theme="${data.catalog.theme.name}"`));
    for (const target of ["inputs", "buttons", "panels"] as const)
      assert.ok(
        html.includes(
          `data-corners-${target}="${data.catalog.theme.corners[target]}"`,
        ),
      );
    return data;
  }

  await withServer(undefined, async (request) => {
    const data = await checkPage(request);
    assert.deepEqual(data.catalog.dashboards, {});
    assert.deepEqual(data.catalog.params, {});
    assert.equal(data.dashboard, null);
    assert.equal((await request("/api/queries/summary")).status, 404);
  });
  await withServer("maven-analytics", async (request) => {
    const data = await checkPage(
      request,
      "/dashboards/overview?country=Canada&channel=Online",
    );
    assert.equal(data.dashboard.params.country, "Canada");
    assert.equal(data.dashboard.params.channel, "Online");
    assert.equal(Object.keys(data.catalog.dashboards).length, 5);
    assert.equal(data.dashboard.labels.revenue, "Revenue");
    const dashboard = await (
      await request("/api/dashboards/overview?country=Canada&channel=Online")
    ).json();
    assert.ok(!dashboard.blocks.some((b: { type: string }) => b.type === "error"));
    assert.equal(dashboard.params.country, "Canada");
    assert.equal(dashboard.params.channel, "Online");
    const summary = await (await request("/api/queries/summary")).json();
    assert.equal(Number(summary.rows[0].revenue), 55755479.59);
    assert.equal(Number(summary.rows[0].orders), 26326);
    const detail = await (
      await request(
        "/api/datasets/orders?country=Canada&channel=Online&minQuantity=2&delivered=true",
      )
    ).json();
    assert.ok(detail.rows.length > 0);
    assert.ok(
      detail.rows.every(
        (row: Record<string, unknown>) =>
          row.country === "Canada" &&
          row.channel === "Online" &&
          Number(row.quantity) >= 2 &&
          row.delivery_date,
      ),
    );
    assert.equal(
      (await request("/api/queries/summary?country=invalid")).status,
      400,
    );
  });
  await withServer("source-examples", async (request) => {
    const data = await checkPage(request, "/dashboards/overview?region=North");
    assert.equal(data.dashboard.params.region, "North");
    const overview = await (
      await request("/api/dashboards/overview?region=North")
    ).json();
    assert.equal(Number(overview.blocks[0].value), 3160);
    const sources: DashboardResult = await (
      await request("/api/dashboards/sources")
    ).json();
    assert.equal(sources.blocks.length, 6);
    for (const block of sources.blocks) {
      assert.equal(block.type, "dataset");
      if (block.type === "dataset") {
        assert.equal(block.result.rows.length, 12, block.id);
        assert.equal(
          block.result.rows.reduce((sum, row) => sum + Number(row.revenue), 0),
          6420,
          block.id,
        );
      }
    }
  });
  // A new sample can be added after build, without editing a registry or rebuilding.
  await mkdir(join(directory, "samples/runtime-added"));
  await writeFile(
    join(directory, "samples/runtime-added/dashy.config.js"),
    `export default { name: 'Added at runtime', params: {}, sources: {}, queries: {}, datasets: {}, metrics: {}, dashboards: {} };`,
  );
  await withServer("runtime-added", async (request) => {
    assert.equal(
      (await (await request("/api/catalog")).json()).name,
      "Added at runtime",
    );
  });
  // Theme selection is runtime configuration and must reach HTML before paint.
  for (const name of themeNames) {
    const theme = { name, corners: { buttons: "rounded" as const } };
    await writeFile(
      join(directory, "samples/runtime-added/dashy.config.js"),
      `export default { name: 'Theme check', theme: ${JSON.stringify(theme)}, params: {}, sources: {}, queries: {}, datasets: {}, metrics: {}, dashboards: {} };`,
    );
    await withServer("runtime-added", async (request) => {
      const data = await checkPage(request);
      assert.deepEqual(data.catalog.theme, resolveTheme(theme));
    });
    // CLI selection replaces both the configured theme and its corner overrides.
    const overrideName =
      themeNames[(themeNames.indexOf(name) + 1) % themeNames.length]!;
    await withServer(
      "runtime-added",
      async (request) => {
        const data = await checkPage(request);
        assert.deepEqual(
          data.catalog.theme,
          resolveTheme({ name: overrideName }),
        );
      },
      overrideName,
    );
  }
  await withServer(
    undefined,
    async (request) => {
      const data = await checkPage(request);
      assert.deepEqual(data.catalog.theme, resolveTheme({ name: "chromeos" }));
    },
    "chromeos",
  );
  // Starting without the flag after samples must still load the empty project.
  await withServer(undefined, async (request) => {
    assert.deepEqual(
      (await (await request("/api/catalog")).json()).dashboards,
      {},
    );
  });
  const missing = Bun.spawn(
    [process.execPath, cli, "start", "--with-sample", "missing"],
    { cwd: directory, stdout: "pipe", stderr: "pipe" },
  );
  const error = await new Response(missing.stderr).text();
  assert.equal(await missing.exited, 1);
  assert.match(
    error,
    /Available samples: maven-analytics, runtime-added, source-examples/,
  );
  console.log(
    "Production passed: empty default, runtime discovery, Maven data, six adapters, SSR, assets, filters and missing-sample errors in an isolated deployment.",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
