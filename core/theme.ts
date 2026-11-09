/**
 * Themes: the engine's built-in themes plus any a project declares. Browser-safe.
 * A theme's colours, type and signature live in CSS; this module holds what the
 * HTML itself depends on (label, default corners, filter style) and validates it.
 */
export const cornerStyles = [
  "none",
  "rounded",
  "rounded-sm",
  "rounded-md",
  "rounded-lg",
] as const;
export type CornerStyle = (typeof cornerStyles)[number];
export type CornerTargets = "inputs" | "buttons" | "panels";
/** Filters as chips that open a popover, or as labelled fields in the bar. */
export type FilterStyle = "chips" | "fields";
export const filterStyles: readonly FilterStyle[] = ["chips", "fields"];

export interface ThemeOptions {
  label: string;
  corners: CornerStyle;
  filters: FilterStyle;
}
/** One style for every control family, or one per family. */
export type ThemeCorners = CornerStyle | Partial<Record<CornerTargets, CornerStyle>>;
const targets: readonly CornerTargets[] = ["inputs", "buttons", "panels"];
const everywhere = (style: CornerStyle): Record<CornerTargets, CornerStyle> => ({ inputs: style, buttons: style, panels: style });
export const builtInThemes = {
  zafir: { label: "Zafir", corners: "none", filters: "chips" },
  excel: { label: "Excel", corners: "none", filters: "chips" },
  chromeos: { label: "ChromeOS", corners: "rounded", filters: "chips" },
  chatgpt: { label: "ChatGPT", corners: "rounded-lg", filters: "chips" },
  "claude-code": { label: "Claude Code", corners: "rounded-sm", filters: "chips" },
  macos: { label: "macOS", corners: "rounded-md", filters: "chips" },
  "power-bi": { label: "Power BI", corners: "rounded-sm", filters: "chips" },
  microstrategy: { label: "MicroStrategy", corners: "rounded-sm", filters: "chips" },
  cognos: { label: "Cognos", corners: "none", filters: "fields" },
} as const satisfies Record<string, ThemeOptions>;
export type BuiltInThemeName = keyof typeof builtInThemes;
/** Built-in theme names, the default first. */
export const themeNames = Object.keys(builtInThemes) as BuiltInThemeName[];
export const defaultThemeName: BuiltInThemeName = "zafir";
/** A built-in or project theme name. */
export type ThemeName = string;
/** Labels of the built-in themes. */
export const themeLabels: Record<string, string> = Object.fromEntries(
  themeNames.map((name) => [name, builtInThemes[name].label]),
);

/**
 * A theme a project adds, with its own stylesheet in the extensions directory.
 * Scope its rules to `:root[data-theme~="<name>"]`. With `extends`, the page
 * carries both names, so the base theme's tokens and signature apply first and
 * this stylesheet overrides what differs; without it, missing tokens fall back
 * to the default theme.
 */
export interface ProjectTheme {
  label: string;
  /** Relative to the extensions directory, e.g. "./themes/acme.css". */
  stylesheet: string;
  extends?: BuiltInThemeName;
  /** One style, or per family, e.g. { inputs: "rounded", buttons: "rounded", panels: "rounded-md" }. */
  corners?: ThemeCorners;
  filters?: FilterStyle;
}

export interface ThemeConfig {
  name?: ThemeName;
  /** A shared style, or independent overrides for each control family. */
  corners?: CornerStyle | Partial<Record<CornerTargets, CornerStyle>>;
  /**
   * Themes viewers may pick from the sidebar. `true` (default) offers every
   * theme, `false` hides the selector, and a list must include `name`.
   */
  selectable?: boolean | readonly ThemeName[];
}
/** What the page needs to show a theme. */
export interface ThemeEntry extends Omit<ThemeOptions, "corners"> {
  corners: Record<CornerTargets, CornerStyle>;
  /** `data-theme` value: the base theme, then this one ("excel acme"). */
  attribute: string;
}
export interface ResolvedTheme {
  name: ThemeName;
  corners: Record<CornerTargets, CornerStyle>;
  /** Selector choices; fewer than two hides the selector. */
  selectable: ThemeName[];
  /** Every available theme, built-in and project. */
  themes: Record<ThemeName, ThemeEntry>;
}

const fail = (message: string): never => {
  throw new Error(`Invalid Dashy theme: ${message}`);
};
const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Built-in themes plus validated project themes, as the page uses them. */
export function themeEntries(projectThemes: unknown = {}): Record<ThemeName, ThemeEntry> {
  const entries: Record<ThemeName, ThemeEntry> = {};
  for (const name of themeNames) entries[name] = { ...builtInThemes[name], corners: everywhere(builtInThemes[name].corners), attribute: name };
  if (projectThemes === undefined) return entries;
  if (!isObject(projectThemes)) fail("themes must be an object of project themes");
  for (const [name, raw] of Object.entries(projectThemes as Record<string, unknown>)) {
    const at = `project theme '${name}'`;
    // Lowercase identifiers: the name is one word of the data-theme attribute.
    if (!/^[a-z][a-z0-9-]*$/.test(name)) fail(`${at}: name must be lowercase letters, digits and hyphens`);
    if (Object.hasOwn(builtInThemes, name)) fail(`${at}: '${name}' is a built-in theme; choose another name`);
    if (!isObject(raw)) fail(`${at} must be an object`);
    const theme = raw as Record<string, unknown>;
    for (const key of Object.keys(theme))
      if (!["label", "stylesheet", "extends", "corners", "filters"].includes(key)) fail(`${at}: unknown property '${key}'`);
    if (typeof theme.label !== "string" || !theme.label.trim()) fail(`${at} requires a label`);
    const sheet = theme.stylesheet;
    if (typeof sheet !== "string" || !/\.css$/.test(sheet) || sheet.startsWith("/") || sheet.includes("\\") || sheet.split("/").includes(".."))
      fail(`${at}: stylesheet must be a relative .css path inside extensions`);
    const base = theme.extends;
    if (base !== undefined && (typeof base !== "string" || !Object.hasOwn(builtInThemes, base)))
      fail(`${at}: extends must be a built-in theme (${themeNames.join(", ")})`);
    const parent = base === undefined ? undefined : builtInThemes[base as BuiltInThemeName];
    // Families left out take the base theme's corners, then the default theme's.
    const inherited = everywhere(parent?.corners ?? builtInThemes[defaultThemeName].corners);
    let corners = inherited;
    if (typeof theme.corners === "string") {
      if (!cornerStyles.includes(theme.corners as CornerStyle)) fail(`${at}: corners must be ${cornerStyles.join(", ")}`);
      corners = everywhere(theme.corners as CornerStyle);
    } else if (theme.corners !== undefined) {
      if (!isObject(theme.corners)) fail(`${at}: corners must be a style or an object with inputs, buttons and panels`);
      const own = theme.corners as Record<string, unknown>;
      for (const key of Object.keys(own)) {
        if (!targets.includes(key as CornerTargets)) fail(`${at}: unknown corner target '${key}'`);
        if (!cornerStyles.includes(own[key] as CornerStyle)) fail(`${at}: ${key} corners must be ${cornerStyles.join(", ")}`);
      }
      corners = { ...inherited, ...(own as Partial<Record<CornerTargets, CornerStyle>>) };
    }
    if (theme.filters !== undefined && !filterStyles.includes(theme.filters as FilterStyle))
      fail(`${at}: filters must be chips or fields`);
    entries[name] = {
      label: (theme.label as string).trim(),
      corners,
      filters: (theme.filters as FilterStyle | undefined) ?? parent?.filters ?? "chips",
      attribute: base ? `${base} ${name}` : name,
    };
  }
  return entries;
}

/** Used during project validation and catalog serialization, before any rendering. */
export function resolveTheme(config?: ThemeConfig, projectThemes?: unknown): ResolvedTheme {
  if (config !== undefined && !isObject(config)) fail("expected a theme configuration object");
  for (const key of Object.keys(config || {}))
    if (!["name", "corners", "selectable", "themes"].includes(key)) fail(`unknown property '${key}'`);
  // A resolved theme may be resolved again; its `themes` key is ignored and rebuilt.
  const themes = themeEntries(projectThemes);
  const names = Object.keys(themes);
  const name = (config?.name === undefined ? defaultThemeName : config.name) as ThemeName;
  if (typeof name !== "string" || !Object.hasOwn(themes, name))
    fail(`unknown name '${String(name)}'. Choose ${names.join(", ")}`);
  const requested = config?.corners;
  if (requested !== undefined && typeof requested !== "string" && !isObject(requested))
    fail("corners must be a style or an object with inputs, buttons and panels");
  if (isObject(requested))
    for (const key of Object.keys(requested))
      if (!["inputs", "buttons", "panels"].includes(key)) fail(`unknown corner target '${key}'`);
  const corners = {} as Record<CornerTargets, CornerStyle>;
  for (const target of ["inputs", "buttons", "panels"] as const) {
    // Only an omitted target takes the theme default; null and other values are validated.
    const own = (requested as Partial<Record<CornerTargets, unknown>> | undefined)?.[target];
    const value = (typeof requested === "string" ? requested : own === undefined ? themes[name]!.corners[target] : own) as CornerStyle;
    if (!cornerStyles.includes(value))
      fail(`invalid ${target} corners '${value}'. Choose ${cornerStyles.join(", ")}`);
    corners[target] = value;
  }
  const offered = config?.selectable;
  let selectable: ThemeName[];
  if (offered === undefined || offered === true) selectable = [...names];
  else if (offered === false) selectable = [];
  else {
    if (!Array.isArray(offered)) fail("selectable must be true, false or a list of theme names");
    const list = offered as readonly ThemeName[];
    for (const entry of list)
      if (!Object.hasOwn(themes, entry)) fail(`unknown selectable theme '${entry}'. Choose ${names.join(", ")}`);
    if (new Set(list).size !== list.length) fail("selectable lists a theme twice");
    if (list.length && !list.includes(name)) fail(`selectable must include the default theme '${name}'`);
    selectable = [...list];
  }
  return { name, corners, selectable, themes };
}
/**
 * The theme a viewer sees: their saved choice when the project offers it,
 * otherwise the project theme. A chosen theme uses its own default corners;
 * the project theme keeps any configured corner overrides.
 */
export function viewerTheme(
  project: ResolvedTheme,
  choice: string | null | undefined,
): { name: ThemeName; corners: Record<CornerTargets, CornerStyle>; attribute: string; filters: FilterStyle } {
  const name = choice && choice !== project.name && project.selectable.length > 1 && project.selectable.includes(choice)
    ? choice
    : project.name;
  const entry: ThemeEntry = project.themes[name] ?? project.themes[defaultThemeName]
    ?? { ...builtInThemes.zafir, corners: everywhere(builtInThemes.zafir.corners), attribute: "zafir" };
  if (name === project.name) return { name, corners: project.corners, attribute: entry.attribute, filters: entry.filters };
  return { name, corners: { ...entry.corners }, attribute: entry.attribute, filters: entry.filters };
}

/** Cookie holding a viewer's theme choice; read during SSR so the first paint matches. */
export const themeCookie = "dashy_theme";
/** Reads the theme choice from a Cookie header. */
export function readThemeCookie(header: string | null): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === themeCookie) return decodeURIComponent(value.join("="));
  }
  return undefined;
}
