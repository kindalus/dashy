import { cp, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { listSamples, loadImplementation } from "../core/runtime";
import { isGlob, resolveSourcePath, sourceHasFiles } from "../core/sources";
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
      build.onResolve({ filter: /^dashy\/auth$/ }, () => ({ path: resolve(root, "core/auth/index.ts") }));
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

function globDirectory(path: string): string {
  const parts = path.split("/");
  return parts.slice(0, parts.findIndex((part) => isGlob(part))).join("/") || ".";
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
  // A glob packages its static directory; an absent tree is supplied at runtime (DASHY_DATA_DIR).
  const path = isGlob(source.path) ? globDirectory(source.path) : source.path;
  const target = resolve(".output/data", path);
  if (target !== resolve(".output/data") && !target.startsWith(resolve(".output/data") + "/")) throw new Error(`Cannot package source outside data directory: ${source.path}. Use an absolute external source path.`);
  if (isGlob(source.path) && !(await sourceHasFiles(resolveSourcePath(project.dataDir!, source.path)))) {
    console.warn(`[dashy] Not packaging ${source.path}: no matching files. Mount the data directory at runtime with DASHY_DATA_DIR.`);
    continue;
  }
  await mkdir(dirname(target), { recursive: true });
  await cp(resolve(project.dataDir!, path), target, { recursive: true });
}
for (const name of await listSamples(root)) {
  const source = join("samples", name);
  const target = join(".output/samples", name);
  await cp(source, target, { recursive: true, filter: (path) => !/\.(?:ts|tsx|js|mjs)$/.test(path) });
  await bundleImplementation(await resolveLocations({ installationDir: root, sample: name, env: {} }), join(target, "dashy.config.js"));
}
console.log("Packaged runtime CLI, selected implementation, relative source files and samples.");
