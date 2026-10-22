import { realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";
import type { ProjectDefinition } from "../core/types.ts";

/** Literal imports let Vite compile external TSX and split each page into a chunk. */
export async function extensionsPlugin(project: ProjectDefinition, extensionsDir: string): Promise<Plugin> {
  const entries: string[] = [];
  for (const [id, page] of Object.entries(project.pages ?? {})) {
    const root = await realpath(extensionsDir);
    const path = await realpath(resolve(root, page.component));
    const within = relative(root, path);
    if (within === ".." || within.startsWith(`..${sep}`)) throw new Error(`Page ${id} component escapes extensions`);
    entries.push(`${JSON.stringify(id)}: { component: ${JSON.stringify(page.component.replace(/^\.\//, ""))}, load: () => import(${JSON.stringify(path)}) }`);
  }
  return {
    name: "dashy-extensions",
    enforce: "pre",
    resolveId(id) {
      if (id === "virtual:dashy-pages") return "\0virtual:dashy-pages";
    },
    configureServer(server) { server.watcher.add(extensionsDir); },
    load(id) {
      if (id === "\0virtual:dashy-pages") return `export const pages = {${entries.join(",\n")}};`;
    },
  };
}
