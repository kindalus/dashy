/**
 * Resolved CSS tokens of every theme, for drawing charts on the server, where no
 * stylesheet is computed. Built at build time (the `virtual:dashy-theme-tokens`
 * module) with the browser's cascade: the default theme's `:root` tokens and the
 * engine's base tokens, then a project theme's base theme, then its own. Server-only.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { themeTokens } from "./theme-check.ts";
import { builtInThemes, defaultThemeName, themeNames, type BuiltInThemeName } from "./theme.ts";
import type { ProjectDefinition } from "./types.ts";
import { chartThemeFromTokens, type ChartTheme } from "../src/chart-options.ts";

/** Theme name to resolved custom properties (`--surface`, `--chart-1`, …). */
export type ThemeTokenMap = Record<string, Record<string, string>>;

const engineSources = resolve(import.meta.dirname, "../src");

/** Substitutes `var(--name, fallback)` references, as computed custom properties do. */
export function resolveVars(tokens: Record<string, string>): Record<string, string> {
  const resolved = { ...tokens };
  const pattern = /var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,\s*([^()]*))?\)/g;
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const [name, value] of Object.entries(resolved)) {
      const next = value.replace(pattern, (_, reference: string, fallback?: string) =>
        reference === name ? (fallback ?? "").trim() : resolved[reference] ?? (fallback ?? "").trim());
      if (next !== value) { resolved[name] = next; changed = true; }
    }
    if (!changed) break;
  }
  return resolved;
}

/** Tokens of the built-in themes and, given its extensions directory, a project's own themes. */
export async function themeTokenMap(
  project: Pick<ProjectDefinition, "themes"> = {},
  extensionsDir?: string,
): Promise<ThemeTokenMap> {
  const read = (path: string) => readFile(path, "utf8");
  const sheet = (name: BuiltInThemeName) => read(resolve(engineSources, "themes", `${name}.css`));
  const defaults = {
    ...themeTokens(await sheet(defaultThemeName), defaultThemeName, { root: true }),
    // The engine's base tokens (--warning, --success) sit on :root in styles.css.
    ...themeTokens(await read(resolve(engineSources, "styles.css")), "-", { root: true }),
  };
  const own: Partial<Record<BuiltInThemeName, Record<string, string>>> = {};
  const map: ThemeTokenMap = {};
  for (const name of themeNames) {
    own[name] = themeTokens(await sheet(name), name);
    map[name] = resolveVars({ ...defaults, ...own[name] });
  }
  for (const [name, theme] of Object.entries(project.themes ?? {})) {
    if (!extensionsDir || Object.hasOwn(builtInThemes, name)) continue;
    const css = await read(resolve(extensionsDir, theme.stylesheet)).catch(() => undefined);
    if (css === undefined) continue;
    map[name] = resolveVars({ ...defaults, ...(theme.extends ? own[theme.extends] : {}), ...themeTokens(css, name) });
  }
  return map;
}

export interface ServerChartTheme extends ChartTheme {
  /** The page background behind the chart, for the image frame. */
  background: string;
}
/**
 * The chart theme for a theme name. A theme missing from the map (a project theme
 * added after the build) falls back to its base theme, then the default theme.
 */
export function serverChartTheme(map: ThemeTokenMap, name: string, project: Pick<ProjectDefinition, "themes"> = {}): ServerChartTheme {
  const base = project.themes?.[name]?.extends;
  const tokens = map[name] ?? (base ? map[base] : undefined) ?? map[defaultThemeName] ?? {};
  const token = (key: string) => tokens[key] ?? "";
  return {
    ...chartThemeFromTokens(token, token("--font-ui") || "sans-serif"),
    background: token("--surface") || "#ffffff",
  };
}
