export const themeNames = [
  "excel",
  "chromeos",
  "chatgpt",
  "claude-code",
  "macos",
] as const;
export type ThemeName = (typeof themeNames)[number];
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
}
export interface ResolvedTheme {
  name: ThemeName;
  corners: Record<CornerTargets, CornerStyle>;
}
const defaults: Record<ThemeName, CornerStyle> = {
  excel: "none",
  chromeos: "rounded",
  chatgpt: "rounded-lg",
  "claude-code": "rounded-sm",
  macos: "rounded-md",
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
    if (!["name", "corners"].includes(key)) fail(`unknown property '${key}'`);
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
  return { name, corners };
}
