import { afterAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveLocations } from "../core/locations";
import { loadImplementation } from "../core/runtime";

const root = await mkdtemp(join(tmpdir(), "dashy-external-"));
afterAll(() => rm(root, { recursive: true, force: true }));
const empty = { name: "External", params: {}, sources: {}, queries: {}, metrics: {}, datasets: {}, dashboards: {} };
await mkdir(join(root, "implementation/artifacts"), { recursive: true });
await mkdir(join(root, "implementation/extensions"));
await writeFile(join(root, "implementation/dashy.config.ts"), `export default ${JSON.stringify({ ...empty, locale: "pt-AO", theme: { name: "excel" }, dataDir: "data" })}`);
await writeFile(join(root, "implementation/artifacts/index.ts"), `export default { params: { customer: { type: 'number', label: 'Customer', default: 7 } } }`);
await writeFile(join(root, "implementation/extensions/index.ts"), `export default { customer: { label: 'Customer', component: 'pages/customer.tsx', params: ['customer'] } }`);

test("external implementation merges independent registries and resolves all paths from its root", async () => {
  const env = { DASHY_PROJECT_DIR: join(root, "implementation") };
  const locations = await resolveLocations({ cwd: "/", env });
  const before = await readFile(locations.config, "utf8");
  const project = await loadImplementation(locations);
  expect(project.params.customer?.default).toBe(7);
  expect(project.pages?.customer?.component).toBe("pages/customer.tsx");
  expect(project.locale).toBe("pt-AO");
  expect(project.dataDir).toBe(join(root, "implementation/data"));
  expect(await readFile(locations.config, "utf8")).toBe(before);
});

test("explicit CLI options beat environment, which beats config, without losing configured defaults", async () => {
  const env = { DASHY_PROJECT_DIR: join(root, "implementation"), DASHY_THEME: "macos", DASHY_LOCALE: "en", DASHY_DATA_DIR: "../data" };
  const locations = await resolveLocations({ env });
  const project = await loadImplementation(locations);
  expect(project.locale).toBe("en");
  expect(project.theme?.name).toBe("macos");
  expect(project.dataDir).toBe(join(root, "data"));
  const overridden = await loadImplementation(await resolveLocations({ env, locale: "fr", theme: "chromeos" }));
  expect(overridden.locale).toBe("fr");
  expect(overridden.theme?.name).toBe("chromeos");
});

test("explicit independent registry paths work and missing paths never fall back", async () => {
  await mkdir(join(root, "separate"));
  await writeFile(join(root, "separate/index.js"), "export default { params: { region: { type: 'string', label: 'Region' }, customer: { type: 'number', label: 'Customer' } } }");
  const env = { DASHY_CONFIG: join(root, "implementation/dashy.config.ts"), DASHY_ARTIFACTS_DIR: "../separate" };
  const locations = await resolveLocations({ cwd: "/", env });
  expect(locations.projectDir).toBe(join(root, "implementation"));
  expect((await loadImplementation(locations)).params.region).toBeDefined();
  await expect(loadImplementation(await resolveLocations({ env: { ...env, DASHY_ARTIFACTS_DIR: "missing" } }))).rejects.toThrow("Missing index");
  await expect(resolveLocations({ env: { DASHY_CONFIG: join(root, "missing.ts") } })).rejects.toThrow();
});

test("duplicate identifiers are rejected instead of silently overriding artifacts", async () => {
  const path = join(root, "duplicate.ts");
  await writeFile(path, `export default ${JSON.stringify({ ...empty, params: { customer: { label: "Customer", type: "string" } } })}`);
  const locations = await resolveLocations({ env: { DASHY_CONFIG: path, DASHY_ARTIFACTS_DIR: "implementation/artifacts" } });
  await expect(loadImplementation(locations)).rejects.toThrow("Duplicate params identifier: customer");
});

test("explicit sample selection excludes external paths but retains presentation overrides", async () => {
  await mkdir(join(root, "samples/demo"), { recursive: true });
  await writeFile(join(root, "samples/demo/dashy.config.js"), `export default ${JSON.stringify(empty)}`);
  const locations = await resolveLocations({ installationDir: root, sample: "demo", env: {
    DASHY_PROJECT_DIR: "/does-not-exist", DASHY_CONFIG: "wrong.ts", DASHY_ARTIFACTS_DIR: "/wrong", DASHY_EXTENSIONS_DIR: "/wrong", DASHY_DATA_DIR: "/wrong", DASHY_LOCALE: "en",
  } });
  expect(locations.projectDir).toBe(join(root, "samples/demo"));
  expect((await loadImplementation(locations)).pages).toBeUndefined();
  expect((await loadImplementation(locations)).locale).toBe("en");
});
