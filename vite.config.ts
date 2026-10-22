import { resolve } from "node:path";
import { resolveLocations } from "./core/locations.ts";
import { loadImplementation } from "./core/runtime.ts";
import { serverOnlyPlugin } from "./scripts/server-only-plugin.ts";
import { extensionsPlugin } from "./scripts/extensions-plugin.ts";
import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";
import { nitro } from "nitro/vite";

// https://nitro.build/examples/vite-ssr-solid
// https://github.com/solidjs/solid-vite-plugin/tree/next
export default defineConfig(async ({ command }) => {
  const locations = await resolveLocations();
  const project = await loadImplementation(locations);
  return {
    resolve: {
      alias: [
        ...(command === "build" ? [{ find: /^dashy\/internal\/import-config$/, replacement: resolve("core/import-config.mjs") }] : []),
        { find: /^dashy\/ui$/, replacement: resolve("src/extension-api.ts") },
        { find: /^dashy\/types$/, replacement: resolve("core/types.ts") },
      ],
      dedupe: ["solid-js", "@solidjs/web", "@solidjs/signals"],
    },
    plugins: [
      await serverOnlyPlugin(locations),
      await extensionsPlugin(project, locations.extensionsDir),
      solid({ ssr: true }),
      nitro({
        preset: "bun",
        serverDir: false,
        // Keep native DuckDB bindings outside the bundle and copy runtime dependencies.
        traceDeps: ["@duckdb/node-api", "exceljs"],
      }),
    ],
    server: { host: "127.0.0.1", port: 3000, fs: { allow: [process.cwd(), locations.extensionsDir] } },
    environments: {
      ssr: {
        build: { rollupOptions: { input: "./src/entry-server.tsx" } },
        resolve: { external: [...(command === "serve" ? ["dashy/internal/import-config"] : []), "@duckdb/node-api", "exceljs", "bun:sqlite"] },
      },
      client: { build: { rollupOptions: { input: "./src/entry-client.tsx" } } },
    },
  };
});
