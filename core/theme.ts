export const themeNames = [
  "excel",
  "chromeos",
  "chatgpt",
  "claude-code",
  "macos",
  "power-bi",
  "microstrategy",
  "cognos",
] as const;
export type ThemeName = (typeof themeNames)[number];
/** Names shown in the theme selector. */
export const themeLabels: Record<ThemeName, string> = {
  excel: "Excel",
  chromeos: "ChromeOS",
  chatgpt: "ChatGPT",
  "claude-code": "Claude Code",
  macos: "macOS",
  "power-bi": "Power BI",
  microstrategy: "MicroStrategy",
  cognos: "Cognos",
};
/** Cookie holding a viewer's theme choice; read during SSR so the first paint matches. */
export const themeCookie = "dashy_theme";
export const cornerStyles = [
  "none",
  "rounded",
  "rounded-sm",
  "rounded-md",
  "rounded-lg",
] as const;
export type CornerStyle = (typeof cornerStyles)[number];
export type CornerTargets = "inputs" | "buttons" | "panels";
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
export interface ResolvedTheme {
  name: ThemeName;
  corners: Record<CornerTargets, CornerStyle>;
  /** Selector choices; fewer than two hides the selector. */
  selectable: ThemeName[];
}
const defaults: Record<ThemeName, CornerStyle> = {
  excel: "none",
  chromeos: "rounded",
  chatgpt: "rounded-lg",
  "claude-code": "rounded-sm",
  macos: "rounded-md",
  "power-bi": "rounded-sm",
  microstrategy: "rounded-sm",
  cognos: "none",
};

/** Used during project validation and catalog serialization, before any rendering. */
export function resolveTheme(config?: ThemeConfig): ResolvedTheme {
  const fail = (message: string): never => {
    throw new Error(`Invalid Dashy theme: ${message}`);
  };
  if (
    config !== undefined &&
    (!config || typeof config !== "object" || Array.isArray(config))
  )
    fail("expected a theme configuration object");
  for (const key of Object.keys(config || {}))
    if (!["name", "corners", "selectable"].includes(key)) fail(`unknown property '${key}'`);
  const name = config?.name === undefined ? "excel" : config.name;
  if (!themeNames.includes(name))
    fail(`unknown name '${name}'. Choose ${themeNames.join(", ")}`);
  const requested = config?.corners;
  if (
    requested !== undefined &&
    typeof requested !== "string" &&
    (!requested || typeof requested !== "object" || Array.isArray(requested))
  )
    fail(
      "corners must be a style or an object with inputs, buttons and panels",
    );
  if (requested && typeof requested === "object") {
    for (const key of Object.keys(requested))
      if (!["inputs", "buttons", "panels"].includes(key))
        fail(`unknown corner target '${key}'`);
  }
  const corners = {} as Record<CornerTargets, CornerStyle>;
  for (const target of ["inputs", "buttons", "panels"] as const) {
    const value =
      typeof requested === "string"
        ? requested
        : requested?.[target] === undefined
          ? defaults[name]
          : requested[target];
    if (!cornerStyles.includes(value))
      fail(
        `invalid ${target} corners '${value}'. Choose ${cornerStyles.join(", ")}`,
      );
    corners[target] = value;
  }
  const offered = config?.selectable;
  let selectable: ThemeName[];
  if (offered === undefined || offered === true) selectable = [...themeNames];
  else if (offered === false) selectable = [];
  else {
    if (!Array.isArray(offered))
      fail("selectable must be true, false or a list of theme names");
    for (const entry of offered)
      if (!themeNames.includes(entry))
        fail(`unknown selectable theme '${entry}'. Choose ${themeNames.join(", ")}`);
    if (new Set(offered).size !== offered.length) fail("selectable lists a theme twice");
    if (offered.length && !offered.includes(name))
      fail(`selectable must include the default theme '${name}'`);
    selectable = [...offered];
  }
  return { name, corners, selectable };
}

/**
 * The theme a viewer sees: their saved choice when the project offers it,
 * otherwise the project theme. A chosen theme uses its own default corners;
 * the project theme keeps any configured corner overrides.
 */
export function viewerTheme(
  project: ResolvedTheme,
  choice: string | null | undefined,
): { name: ThemeName; corners: Record<CornerTargets, CornerStyle> } {
  const name =
    choice && choice !== project.name && project.selectable.length > 1 &&
    project.selectable.includes(choice as ThemeName)
      ? (choice as ThemeName)
      : project.name;
  if (name === project.name) return { name, corners: project.corners };
  const style = defaults[name];
  return { name, corners: { inputs: style, buttons: style, panels: style } };
}

/** Reads the theme choice from a Cookie header. */
export function readThemeCookie(header: string | null): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === themeCookie) return decodeURIComponent(value.join("="));
  }
  return undefined;
}
