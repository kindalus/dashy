import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const installation = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(tmpdir(), "dashy-extension-check-"));
const implementation = join(directory, "application");
const deployment = join(directory, "deployment");
const externalPaths = {
  DASHY_PROJECT_DIR: implementation,
  DASHY_ARTIFACTS_DIR: "../artifacts",
  DASHY_EXTENSIONS_DIR: "../extensions",
};
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("DASHY_")));
async function run(args: string[], extra: Record<string, string> = {}) {
  const child = Bun.spawn([process.execPath, ...args], { cwd: directory, env: { ...env, ...extra }, stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  assert.equal(code, 0, `${out}\n${err}`);
}
async function withServer(extra: Record<string, string>, check: (request: (path: string, role?: string, method?: string) => Promise<Response>) => Promise<void>) {
  const reservation = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = reservation.port!;
  reservation.stop(true);
  const child = Bun.spawn([process.execPath, join(deployment, "dashy.mjs"), "start", "--port", String(port)], {
    cwd: directory, env: { ...env, ...extra }, stdout: "pipe", stderr: "pipe",
  });
  const logs = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const request = (path: string, role?: string, method = "GET") => fetch(`http://127.0.0.1:${port}${path}`, { method, headers: role ? { "x-test-role": role } : {} });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      if (child.exitCode !== null) throw new Error((await logs).join("\n"));
      try { await request("/api/catalog"); ready = true; break; } catch { await Bun.sleep(50); }
    }
    assert(ready, "Production server did not start");
    await check(request);
  } finally { child.kill(); await child.exited; await logs; }
}

try {
  await cp(join(installation, "examples/external-application"), implementation, { recursive: true });
  await mkdir(join(implementation, "node_modules"));
  await symlink(installation, join(implementation, "node_modules/dashy"));
  const configPath = join(implementation, "dashy.config.ts");
  const config = (await readFile(configPath, "utf8")).replace('  name:', `  authenticate(request) {
    const role = request.headers.get("x-test-role");
    // Server-only marker must never reach the client bundle.
    const serverOnly = "dashy-private-config-marker";
    if (!role || !serverOnly) return null;
    return { roles: [role] };
  },\n  name:`);
  await writeFile(configPath, config);
  const pagesPath = join(implementation, "extensions/index.ts");
  await writeFile(pagesPath, (await readFile(pagesPath, "utf8")).replace('} satisfies', '  private_customer: { label: "Private customer", roles: ["admin"], component: "pages/customer.tsx", params: ["customer"] },\n} satisfies'));
  const artifactsPath = join(implementation, "artifacts/index.ts");
  await writeFile(artifactsPath, (await readFile(artifactsPath, "utf8")).replace('label: "Customer orders",', 'label: "Customer orders", roles: ["admin"],'));
  await rename(join(implementation, "artifacts"), join(directory, "artifacts"));
  await rename(join(implementation, "extensions"), join(directory, "extensions"));
  const before = await readFile(configPath, "utf8");
  const originals = new Map<string, string>();
  for (const folder of ["application", "artifacts", "extensions"]) {
    for await (const path of new Bun.Glob("**/*.{ts,tsx,css,csv}").scan({ cwd: join(directory, folder), onlyFiles: true })) {
      if (path.startsWith("node_modules/")) continue;
      const file = join(directory, folder, path);
      originals.set(file, await readFile(file, "utf8"));
    }
  }
  await run([join(installation, "bin/dashy.ts"), "build"], externalPaths);
  for (const [file, contents] of originals) assert.equal(await readFile(file, "utf8"), contents, `Build changed ${file}`);
  assert.equal(await readFile(configPath, "utf8"), before, "Build modified implementation configuration");
  await cp(join(installation, ".output"), deployment, { recursive: true });
  for await (const path of new Bun.Glob("**/*.js").scan(join(deployment, "public")))
    assert(!(await readFile(join(deployment, "public", path), "utf8")).includes("dashy-private-config-marker"), `Server config leaked into ${path}`);

  const check = async (request: (path: string, role?: string, method?: string) => Promise<Response>) => {
    assert.equal((await request("/pages/customer")).status, 401);
    assert.equal((await request("/api/catalog")).status, 401);
    assert.equal((await request("/pages/private_customer", "viewer")).status, 403);
    assert.equal((await request("/pages/private_customer", "admin")).status, 200);
    assert.equal((await request("/pages/customer?customer=0", "admin")).status, 400);
    assert.equal((await request("/pages/missing", "admin")).status, 404);
    const catalog = await (await request("/api/catalog", "viewer")).json();
    assert.deepEqual(Object.keys(catalog.pages), ["customer"]);
    assert(!JSON.stringify(catalog).includes("component"));
    const response = await request("/pages/customer?customer=2", "admin");
    assert.equal(response.status, 200);
    const html = await response.text();
    assert(html.includes("Orders for customer <!--$-->2"), "Custom page was not rendered on the server");
    assert(html.includes('data-theme="excel"'));
    assert(html.includes("/dashboards/sales") && html.includes("/pages/customer"));
    let pageStyle = false;
    for (const [, path] of html.matchAll(/(?:src|href)="(\/[^"?#]+\.(?:js|css))"/g))
      {
        const asset = await request(path!);
        assert.equal(asset.status, 200, `Missing asset ${path}`);
        if (path!.endsWith(".css") && (await asset.text()).includes(".customer-orders")) pageStyle = true;
      }
    assert(pageStyle, "The initial HTML must include the custom page stylesheet");
    assert.equal((await request("/api/datasets/customer_orders?customer=2", "viewer")).status, 403);
    const data = await (await request("/api/datasets/customer_orders?customer=2", "admin")).json();
    assert.deepEqual(data.rows, [{ product: "Monitor", amount: 210 }]);
    assert.equal(await (await request("/pages/customer", "admin", "HEAD")).text(), "");
  };
  await withServer(externalPaths, check);
  // An implementation can update presentation and queries without rebuilding pages.
  await writeFile(configPath, config.replace('locale: "pt"', 'locale: "en"').replace('name: "excel"', 'name: "macos"'));
  await withServer(externalPaths, async request => {
    const html = await (await request("/pages/customer", "admin")).text();
    assert(html.includes('lang="en"') && html.includes('data-theme="macos"'));
  });
  // The portable build must work after the original implementation is gone.
  for (const folder of [implementation, join(directory, "artifacts"), join(directory, "extensions")])
    await rm(folder, { recursive: true, force: true });
  await withServer({}, check);
  // A new uncompiled page is a startup error, not a broken navigation link.
  await writeFile(join(deployment, "mismatch.js"), `import config from './dashy.config.js'; export default { ...config, pages: { ...config.pages, missing: { label: 'Missing', component: 'missing.tsx' } } };`);
  const mismatch = Bun.spawn([process.execPath, join(deployment, "dashy.mjs"), "start", "--port", "1"], {
    cwd: directory, env: { ...env, DASHY_CONFIG: join(deployment, "mismatch.js") }, stdout: "pipe", stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([mismatch.exited, new Response(mismatch.stdout).text(), new Response(mismatch.stderr).text()]);
  assert.notEqual(code, 0);
  assert.match(out + err, /Rebuild Dashy/);
  console.log("External implementation passed: independent cwd and registry directories, build preservation, portable deployment, SSR/assets, auth/roles, parameters, protected data, runtime theme/locale and missing-build diagnostics.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
