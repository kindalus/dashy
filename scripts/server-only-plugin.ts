import { realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { Plugin } from "vite";
import { findExtensionRegistries, findRegistry, type ProjectLocations } from "../core/locations.ts";

const inside = (file: string, root: string) => file === root || file.startsWith(root + sep);

/** Trace implementation imports with Bun; none of these modules belong in the browser. */
export async function serverOnlyPlugin(locations: ProjectLocations): Promise<Plugin> {
  const installation = resolve(import.meta.dirname, "..");
  const { pages, api } = await findExtensionRegistries(locations.extensionsDir, locations.extensionsRequired);
  const artifacts = await findRegistry(locations.artifactsDir, locations.artifactsRequired);
  const entries = [locations.config, pages, api, artifacts].filter((path): path is string => Boolean(path));
  const graph = await Bun.build({
    entrypoints: entries, root: "/", target: "bun", metafile: true,
    external: ["@duckdb/node-api", "exceljs", "dashy/internal/import-config"],
    plugins: [{ name: "dashy-sdk", setup(build) {
      build.onResolve({ filter: /^dashy$/ }, () => ({ path: resolve(installation, "core/index.ts") }));
    } }],
  });
  if (!graph.success || !graph.metafile) throw new AggregateError(graph.logs, "Could not trace server-only implementation imports");
  const canonical = (path: string) => realpath(path).catch(() => resolve(path));
  const files = new Set(await Promise.all(entries.map(canonical)));
  for (const input of Object.keys(graph.metafile.inputs)) {
    const path = await canonical(resolve(input));
    // Engine modules and installed libraries can have separate browser-safe exports.
    if (!inside(path, resolve(installation, "core")) && !inside(path, resolve(installation, "src")) && !path.includes(`${sep}node_modules${sep}`)) files.add(path);
  }
  files.add(resolve(installation, "core/index.ts"));
  const apiRoot = await canonical(resolve(locations.extensionsDir, "api"));
  const denied = async (path: string) => {
    const file = await canonical(path.split("?")[0]!);
    return files.has(file) || inside(file, apiRoot);
  };
  return {
    name: "dashy-server-only", enforce: "pre",
    async load(id) {
      if (this.environment.config.consumer === "client" && !id.startsWith("\0") && await denied(id))
        throw new Error("Cannot import server-only implementation code in a browser page. Use /api/custom instead.");
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        try {
          const path = decodeURIComponent((request.url ?? "/").split("?")[0]!);
          const file = path.startsWith("/@fs/") ? path.slice(4) : resolve(server.config.root, "." + path);
          if (await denied(file)) {
            response.statusCode = 403;
            response.end("Server-only implementation file");
          } else next();
        } catch { response.statusCode = 400; response.end("Invalid path"); }
      });
    },
  };
}
