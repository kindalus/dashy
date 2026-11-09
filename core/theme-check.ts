/**
 * Reads a theme stylesheet well enough to check it: which custom properties a theme
 * declares, and which rules escape its `:root[data-theme~="<name>"]` scope.
 * Plain CSS only (no nesting); comments and strings are skipped.
 */
import { paletteProblems, textProblems } from "./palette.ts";

interface Rule { selector: string; body: string; at: string[] }

/** Flat style rules with the at-rules that contain them. */
export function cssRules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  const walk = (source: string, at: string[]) => {
    let i = 0;
    while (i < source.length) {
      const open = source.indexOf("{", i);
      if (open < 0) break;
      const prelude = source.slice(i, open).trim();
      // Find the matching brace, skipping strings.
      let depth = 1, j = open + 1, quote = "";
      for (; j < source.length && depth > 0; j++) {
        const c = source[j]!;
        if (quote) { if (c === quote && source[j - 1] !== "\\") quote = ""; continue; }
        if (c === '"' || c === "'") quote = c;
        else if (c === "{") depth++;
        else if (c === "}") depth--;
      }
      const body = source.slice(open + 1, j - 1);
      // Statements such as @import end in ";" before the next block.
      const statement = prelude.lastIndexOf(";");
      const selector = statement >= 0 ? prelude.slice(statement + 1).trim() : prelude;
      if (selector.startsWith("@media") || selector.startsWith("@supports") || selector.startsWith("@layer") || selector.startsWith("@container"))
        walk(body, [...at, selector]);
      else rules.push({ selector, body, at });
      i = j;
    }
  };
  walk(text, []);
  return rules;
}

const scoped = (selector: string, name: string) => selector.includes(`[data-theme~="${name}"]`);

/** Custom properties a theme declares in rules scoped to it (later rules win). */
export function themeTokens(css: string, name: string, { root = false } = {}): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const rule of cssRules(css)) {
    if (rule.at.length) continue;
    const selectors = rule.selector.split(",").map((s) => s.trim());
    if (!selectors.some((s) => scoped(s, name) || (root && s === ":root"))) continue;
    for (const match of rule.body.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+)/g)) tokens[match[1]!] = match[2]!.trim();
    if (/color-scheme\s*:\s*dark/.test(rule.body)) tokens["color-scheme"] = "dark";
    else if (/color-scheme\s*:\s*light/.test(rule.body)) tokens["color-scheme"] = "light";
  }
  return tokens;
}

/** Selectors outside the theme's scope; they would style every theme. */
export function unscopedSelectors(css: string, name: string): string[] {
  const found: string[] = [];
  for (const rule of cssRules(css)) {
    if (rule.selector.startsWith("@") || rule.at.some((a) => a.startsWith("@keyframes"))) continue;
    // Keyframe steps (from, to, 50%) belong to their @keyframes block.
    if (/^(from|to|\d+%)(\s*,\s*(from|to|\d+%))*$/.test(rule.selector)) continue;
    for (const selector of rule.selector.split(",").map((s) => s.trim()))
      if (selector && !scoped(selector, name)) found.push(selector);
  }
  return found;
}

export interface ThemeCheck {
  /** Unreadable text: the theme must not ship. */
  errors: string[];
  /** Weak chart palette or rules that leak to other themes. */
  warnings: string[];
}

/**
 * Checks a project theme as it will look: the default theme's tokens, then its base
 * theme's, then its own. Text contrast failures are errors; palette problems and
 * unscoped rules are warnings.
 */
export function checkTheme(input: {
  name: string;
  css: string;
  /** The default theme's tokens, which fill anything else leaves out. */
  defaults: Record<string, string>;
  /** The `extends` theme's tokens, if any. */
  base?: Record<string, string>;
}): ThemeCheck {
  const own = themeTokens(input.css, input.name);
  const tokens = { ...input.defaults, ...input.base, ...own };
  const mode = tokens["color-scheme"] === "dark" ? "dark" : "light";
  const unscoped = unscopedSelectors(input.css, input.name);
  return {
    errors: textProblems(tokens),
    warnings: [
      ...paletteProblems(tokens, mode).map((problem) => `chart palette: ${problem}`),
      ...(unscoped.length ? [`rules outside :root[data-theme~="${input.name}"] apply to every theme: ${unscoped.slice(0, 5).join(", ")}${unscoped.length > 5 ? ", …" : ""}`] : []),
    ],
  };
}
