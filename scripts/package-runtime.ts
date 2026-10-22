import { cp, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { listSamples, loadImplementation } from "../core/runtime";
import { findExtensionRegistries, findRegistry, resolveLocations, type ProjectLocations } from "../core/locations";

const root = process.cwd();
const sdk = resolve(root, "core/index.ts");

// Bundle server helpers, including the public SDK. Native adapters stay external
// and are already copied by Nitro's traceDeps configuration.
async function bundle(entry: string, outfile: string, code?: string) {
  await mkdir(dirname(outfile), { recursive: true });
  const result = await Bun.build({
    entrypoints: [entry], target: "bun",
    external: ["@duckdb/node-api", "exceljs"],
    plugins: [{ name: "dashy-runtime-package", setup(build) {
      build.onResolve({ filter: /^dashy$/ }, () => ({ path: sdk }));
      build.onResolve({ filter: /^dashy\/internal\/import-config$/ }, () => ({ path: resolve(root, "core/import-config.mjs") }));
      if (code !== undefined) {
        build.onResolve({ filter: /^dashy:config$/ }, () => ({ path: "config", namespace: "dashy" }));
        build.onLoad({ filter: /.*/, namespace: "dashy" }, () => ({ contents: code, loader: "ts", resolveDir: root }));
      }
    } }],
  });
  if (!result.success) throw new AggregateError(result.logs, `Could not bundle ${entry}`);
  if (result.outputs.length !== 1) throw new Error(`Expected one output for ${entry}`);
  await Bun.write(outfile, result.outputs[0]!);
}

const locations = await resolveLocations();
const project = await loadImplementation(locations);
async function bundleImplementation(locations: ProjectLocations, outfile: string, portableData = false) {
  const project = await loadImplementation(locations);
  const artifactPath = await findRegistry(locations.artifactsDir, locations.artifactsRequired);
  const { pages: extensionPath, api: apiPath } = await findExtensionRegistries(locations.extensionsDir, locations.extensionsRequired);
  const registries = ["params", "sources", "queries", "datasets", "metrics", "dashboards"];
  const composed = [
    `import config from ${JSON.stringify(locations.config)};`,
    artifactPath ? `import artifacts from ${JSON.stringify(artifactPath)};` : "const artifacts = {};",
    extensionPath ? `import pages from ${JSON.stringify(extensionPath)};` : "const pages = {};",
    apiPath ? `import api from ${JSON.stringify(apiPath)};` : "const api = {};",
    `export default { ...config, ${registries.map(key => `${key}: { ...config.${key}, ...artifacts.${key} }`).join(",")}, pages: { ...config.pages, ...pages }, api: { ...config.api, ...api }, ${portableData ? "dataDir: './data'," : ""} locale: ${JSON.stringify(project.locale)}, theme: ${JSON.stringify(project.theme)} };`,
  ].join("\n");
  await bundle("dashy:config", outfile, composed);
}
await bundle(resolve("bin/dashy.ts"), ".output/dashy.mjs");
await bundleImplementation(locations, ".output/dashy.config.js", true);
await Bun.write(".output/pages.json", JSON.stringify(Object.fromEntries(
  Object.entries(project.pages ?? {}).map(([id, page]) => [id, { component: page.component.replace(/^\.\//, "") }]),
)));
// Copy only registered relative local files. Absolute sources remain external.
for (const source of Object.values(project.sources)) {
  if (!["csv", "json", "excel", "sqlite", "duckdb", "parquet"].includes(source.type) || isAbsolute(source.path)) continue;
  const target = resolve(".output/data", source.path);
  if (!target.startsWith(resolve(".output/data") + "/")) throw new Error(`Cannot package source outside data directory: ${source.path}. Use an absolute external source path.`);
  await mkdir(dirname(target), { recursive: true });
  await cp(resolve(project.dataDir!, source.path), target, { recursive: true });
}
for (const name of await listSamples(root)) {
  const source = join("samples", name);
  const target = join(".output/samples", name);
  await cp(source, target, { recursive: true, filter: (path) => !/\.(?:ts|tsx|js|mjs)$/.test(path) });
  await bundleImplementation(await resolveLocations({ installationDir: root, sample: name, env: {} }), join(target, "dashy.config.js"));
}
console.log("Packaged runtime CLI, selected implementation, relative source files and samples.");
