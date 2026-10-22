import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";
import { nitro } from "nitro/vite";

// https://nitro.build/examples/vite-ssr-solid
// https://github.com/solidjs/solid-vite-plugin/tree/next
export default defineConfig({
  plugins: [
    solid({ ssr: true }),
    nitro({
      preset: "bun",
      serverDir: false,
      // Keep native DuckDB bindings outside the bundle and copy runtime dependencies.
      traceDeps: ["@duckdb/node-api", "exceljs"],
    }),
  ],
  server: { host: "127.0.0.1", port: 3000 },
  environments: {
    ssr: {
      build: { rollupOptions: { input: "./src/entry-server.tsx" } },
      resolve: { external: ["@duckdb/node-api", "exceljs", "bun:sqlite"] },
    },
    client: { build: { rollupOptions: { input: "./src/entry-client.tsx" } } },
  },
});
