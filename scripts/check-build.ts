import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DashboardResult } from "../core/types";
import { themeNames, resolveTheme, viewerTheme } from "../core/theme";

// Run the actual packaged CLI and server outside the source tree. This catches
// both missing production dependencies and build-time sample selection leaks.
const mavenOnly = process.argv.includes("--maven");
const directory = await mkdtemp(join(tmpdir(), "dashy-build-"));
try {
  await cp(resolve(".output"), directory, { recursive: true });
  const cli = join(directory, "dashy.mjs");
  async function withServer(
    sample: string | undefined,
    verify: (
      request: (path: string, method?: string, signal?: AbortSignal, body?: unknown, headers?: Record<string, string>) => Promise<Response>,
    ) => Promise<void>,
    theme?: string,
    locale?: string,
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
        ...(locale ? ["--locale", locale] : []),
      ],
      { cwd: directory, stdout: "pipe", stderr: "pipe" },
    );
    const out = new Response(child.stdout).text();
    const err = new Response(child.stderr).text();
    const request = (path: string, method = "GET", signal?: AbortSignal, body?: unknown, headers: Record<string, string> = {}) =>
      fetch(`http://127.0.0.1:${port}${path}`, { method, signal, headers, ...(body === undefined ? {} : {
        body: JSON.stringify(body), headers: { ...headers, "Content-Type": "application/json", "X-Dashy-Request": "1" },
      }) });
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
    assert.ok(html.includes(`lang="${data.catalog.locale.split("-")[0]}"`));
    assert.equal((await (await request("/api/catalog")).json()).locale, data.catalog.locale);
    if (data.dashboard) {
      assert.equal(
        data.dashboard.blocks, undefined, "SSR must not include query results",
      );
      assert.equal(data.dashboard.generatedAt, undefined);
      assert.ok(html.includes("Loading data"));
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

  if (!mavenOnly) await withServer(undefined, async (request) => {
    const data = await checkPage(request);
    assert.deepEqual(data.catalog.dashboards, {});
    assert.deepEqual(data.catalog.params, {});
    assert.equal(data.dashboard, null);
    assert.equal(data.catalog.locale, "pt");
    assert.equal((await request("/api/queries/summary")).status, 404);
  });
  if (mavenOnly) await withServer("maven-analytics", async (request) => {
    const data = await checkPage(
      request,
      "/dashboards/overview?country=Canada&channel=Online",
    );
    for (const [id, dataset] of [["product-explorer", "products"], ["market-explorer", "countries"]]) {
      const page = await checkPage(request, `/pages/${id}?category=Computers&channel=Online`);
      assert.equal(page.page.id, id);
      assert.equal(page.page.params.category, "Computers");
      assert.equal(page.page.definition.component, undefined);
      const html = await (await request(`/pages/${id}`)).text();
      assert.ok(html.includes("Loading data"));
      assert.ok(html.includes("Custom pages"));
      const styles = [...html.matchAll(/href="(\/assets\/[^"?]+\.css)"/g)];
      const css = (await Promise.all(styles.map(async match => (await request(match[1]!)).text()))).join("\n");
      assert.ok(css.includes(".maven-page"), "Custom CSS must be included before hydration");
      const result = await (await request(`/api/datasets/${dataset}?category=Computers&channel=Online`)).json();
      assert.ok(result.rows.length > 0);
      const empty = await (await request(`/api/datasets/${dataset}?period.from=2030-01-01&period.until=2030-12-31`)).json();
      assert.equal(empty.rows.length, 0);
    }
    const markets = await (await request("/api/custom/markets?category=Computers&channel=Online")).json();
    assert.ok(markets.rows.length > 0);
    const marketOrders = await (await request("/api/custom/markets/Canada/orders?category=Computers&channel=Online")).json();
    assert.ok(marketOrders.rows.length > 0);
    assert.ok(marketOrders.rows.every((row: { country: string }) => row.country === "Canada"));
    assert.equal((await request("/api/custom/markets/invalid/orders")).status, 400);
    assert.equal((await request("/api/custom/calculate-margin", "POST")).status, 403);
    assert.equal((await request("/api/custom/calculate-margin", "OPTIONS")).status, 204);
    const calculation = await request("/api/custom/calculate-margin", "POST", undefined, { revenue: 100, cost: 60 });
    assert.equal(calculation.status, 200);
    assert.deepEqual(await calculation.json(), { profit: 40, margin: 0.4 });
    assert.equal((await request("/api/custom/calculate-margin", "POST", undefined, { revenue: -1, cost: 60 })).status, 422);
    assert.equal(data.dashboard.params.country, "Canada");
    assert.equal(data.catalog.locale, "pt");
    assert.equal(data.dashboard.params.channel, "Online");
    assert.equal(Object.keys(data.catalog.dashboards).length, 7);
    assert.equal(data.dashboard.labels.revenue, "Revenue");
    // summary, catalogue, monthly and categories (shared by two blocks).
    assert.equal(data.dashboard.requests.length, 4);
    const independent = await Promise.all(data.dashboard.requests.map(async (group: { id: string }) => {
      const response = await request(`/api/dashboard-data/overview/${group.id}?country=Canada&channel=Online`);
      assert.equal(response.status, 200);
      return response.json();
    }));
    assert.equal(independent.flatMap((group) => group.blocks).length, 7);
    assert.ok(independent.every((group) => group.blocks.every((block: { type: string }) => block.type !== "error")));
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
    // Phase 1 contracts in the packaged runtime: probe, options, shells and drillthrough.
    assert.deepEqual(await (await request("/healthz")).json(), { status: "ok" });
    const products = await (await request("/api/params/productName/options?_q=contoso%20wireless")).json();
    assert.ok(products.options.length > 0 && products.options.every((o: { label: string }) => /contoso wireless/i.test(o.label)));
    const brands = await (await request("/api/params/brand/options?category=Audio")).json();
    assert.deepEqual(brands.options.map((o: { value: string }) => o.value), ["Contoso", "Northwind Traders", "Wide World Importers"]);
    const shell = await (await request("/api/dashboard-shell/overview?category=Audio&_xf=categories:category")).json();
    assert.deepEqual(shell.crossFilters, [{ block: "categories", param: "category" }]);
    const required = await (await request("/api/dashboard-shell/product-detail")).json();
    assert.deepEqual(required.missing, ["productName"]);
    assert.equal(required.requests.length, 0);
    const detailPage = await request("/dashboards/product-detail?productName=Contoso%20Wireless%20Laser%20Mouse%20E50%20Grey&_from=%2Fdashboards%2Fproducts");
    assert.equal(detailPage.status, 200);
  });
  if (!mavenOnly) {
    // Custom components must be compiled for the chosen implementation.
    const uncompiled = Bun.spawn([process.execPath, cli, "start", "--with-sample", "maven-analytics"],
      { cwd: directory, stdout: "pipe", stderr: "pipe" });
    const uncompiledOutput = Promise.all([new Response(uncompiled.stdout).text(), new Response(uncompiled.stderr).text()]);
    assert.equal(await uncompiled.exited, 1);
    assert.match((await uncompiledOutput).join("\n"), /not compiled|rebuild/i);
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
    // A real HTTP disconnect must reach adapters through the packaged server.
    const cancellationMarker = join(directory, "cancelled.txt");
    await writeFile(
      join(directory, "samples/runtime-added/dashy.config.js"),
      `export default {
        name: 'Cancellation check', params: {}, datasets: {}, metrics: {}, dashboards: {},
        api: { slow: { method: 'GET', path: '/slow', handler: async ({ data }) => Response.json(await data.query('slow')) } },
        sources: { slow: { type: 'slow', path: '' } },
        queries: { slow: { label: 'Slow', sources: ['slow'],
          build: () => ({ text: 'SELECT 42 AS value', values: [] }) } },
        adapters: { slow: async ({ signal }) => {
          await Bun.write(${JSON.stringify(cancellationMarker)}, 'started');
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 5000);
            signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
          });
          await Bun.write(${JSON.stringify(cancellationMarker)}, signal.aborted ? 'cancelled' : 'finished');
        } }
      };`,
    );
    await withServer("runtime-added", async (request) => {
      const waitForMarker = async (expected: string) => {
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
          if (await readFile(cancellationMarker, "utf8").catch(() => "") === expected) return;
          await Bun.sleep(20);
        }
        assert.fail(`Expected cancellation marker: ${expected}`);
      };
      for (const path of ["/api/queries/slow", "/api/custom/slow"]) {
        await writeFile(cancellationMarker, "");
        const controller = new AbortController();
        const pending = request(path, "GET", controller.signal).catch((error) => error);
        try {
          await waitForMarker("started");
          controller.abort();
          assert.equal((await pending).name, "AbortError");
          await waitForMarker("cancelled");
        } finally {
          controller.abort();
          await pending;
        }
      }
    });
    // Locale selection must reach both the API and the hydration data.
    await writeFile(
      join(directory, "samples/runtime-added/dashy.config.js"),
      `export default { name: 'Locale check', locale: 'pt-AO', params: {}, sources: {}, queries: {}, datasets: {}, metrics: {}, dashboards: {} };`,
    );
    await withServer("runtime-added", async (request) => {
      assert.equal((await checkPage(request)).catalog.locale, "pt-AO");
    });
    await withServer("runtime-added", async (request) => {
      assert.equal((await checkPage(request)).catalog.locale, "en");
    }, undefined, "en");
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
        // A viewer's saved choice reaches the first paint with that theme's corners.
        const chosen = themeNames[(themeNames.indexOf(name) + 3) % themeNames.length]!;
        const html = await (await request("/", "GET", undefined, undefined, { Cookie: `dashy_theme=${chosen}` })).text();
        const expected = viewerTheme(resolveTheme(theme), chosen);
        assert.ok(html.includes(`data-theme="${expected.name}"`), `cookie theme ${chosen}`);
        assert.ok(html.includes(`data-corners-panels="${expected.corners.panels}"`));
        assert.ok(html.includes('class="theme-picker"'));
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
  }
  console.log(mavenOnly
    ? "Maven production passed: custom pages, initial CSS, datasets, filters, empty results and dashboards in an isolated deployment."
    : "Production passed: empty default, runtime discovery, uncompiled-page guard, six adapters, SSR, assets, filters, locale/theme overrides, HTTP cancellation and missing-sample errors in an isolated deployment.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
