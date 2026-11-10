import { readFile, realpath } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import type { ProjectDefinition } from "../core/types.ts";
import { checkTheme, themeTokens } from "../core/theme-check.ts";
import { defaultThemeName, themeEntries } from "../core/theme.ts";
import { themeTokenMap } from "../core/theme-tokens.ts";

const engineThemes = resolve(dirname(fileURLToPath(import.meta.url)), "../src/themes");

/**
 * Project themes: each stylesheet must sit inside extensions and keep its text readable
 * (an error stops the build); a weak chart palette or rules outside the theme's scope
 * only warn. Returns the stylesheets to bundle.
 */
export async function projectThemeSheets(project: ProjectDefinition, extensionsDir: string, warn = console.warn): Promise<string[]> {
  const themes = project.themes ?? {};
  if (!Object.keys(themes).length) return [];
  themeEntries(themes);
  const root = await realpath(extensionsDir);
  const defaults = themeTokens(await readFile(resolve(engineThemes, `${defaultThemeName}.css`), "utf8"), defaultThemeName, { root: true });
  const sheets: string[] = [];
  for (const [name, theme] of Object.entries(themes)) {
    let path: string;
    try {
      path = await realpath(resolve(root, theme.stylesheet));
    } catch {
      throw new Error(`Theme ${name}: stylesheet ${theme.stylesheet} was not found in ${root}`);
    }
    const within = relative(root, path);
    if (within === ".." || within.startsWith(`..${sep}`)) throw new Error(`Theme ${name} stylesheet escapes extensions`);
    const base = theme.extends
      ? themeTokens(await readFile(resolve(engineThemes, `${theme.extends}.css`), "utf8"), theme.extends)
      : undefined;
    const result = checkTheme({ name, css: await readFile(path, "utf8"), defaults, base });
    if (result.errors.length)
      throw new Error(`Theme ${name} (${theme.stylesheet}) has unreadable text:\n- ${result.errors.join("\n- ")}`);
    for (const warning of result.warnings) warn(`[dashy] Theme ${name}: ${warning}`);
    sheets.push(path);
  }
  return sheets;
}

/** Literal imports let Vite compile external TSX and split each page into a chunk. */
export async function extensionsPlugin(project: ProjectDefinition, extensionsDir: string): Promise<Plugin> {
  const entries: string[] = [];
  const assets: string[] = [];
  for (const [id, page] of Object.entries(project.pages ?? {})) {
    const root = await realpath(extensionsDir);
    const path = await realpath(resolve(root, page.component));
    const within = relative(root, path);
    if (within === ".." || within.startsWith(`..${sep}`)) throw new Error(`Page ${id} component escapes extensions`);
    const assetName = `pageAssets${assets.length}`;
    assets.push(`import ${assetName} from ${JSON.stringify(path + "?assets")};`);
    entries.push(`${JSON.stringify(id)}: { assets: ${assetName}, component: ${JSON.stringify(page.component.replace(/^\.\//, ""))}, load: () => import(${JSON.stringify(path)}) }`);
  }
  const sheets = await projectThemeSheets(project, extensionsDir);
  // Server-side SVG charts have no computed styles: every theme's resolved tokens, built in.
  const tokens = await themeTokenMap(project, extensionsDir);
  return {
    name: "dashy-extensions",
    enforce: "pre",
    resolveId(id) {
      if (id === "virtual:dashy-pages") return "\0virtual:dashy-pages";
      if (id === "virtual:dashy-themes") return "\0virtual:dashy-themes";
      if (id === "virtual:dashy-theme-tokens") return "\0virtual:dashy-theme-tokens";
    },
    configureServer(server) { server.watcher.add(extensionsDir); },
    load(id) {
      if (id === "\0virtual:dashy-pages") return `${assets.join("\n")}\nexport const pages = {${entries.join(",\n")}};`;
      // Project theme stylesheets join the client CSS, after the engine's themes.
      if (id === "\0virtual:dashy-themes") return sheets.map((path) => `import ${JSON.stringify(path)};`).join("\n");
      if (id === "\0virtual:dashy-theme-tokens") return `export default ${JSON.stringify(tokens)};`;
    },
  };
}
