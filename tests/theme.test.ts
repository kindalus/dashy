import { expect, test } from "bun:test";
import {
  builtInThemes,
  cornerStyles,
  readThemeCookie,
  resolveTheme,
  themeEntries,
  themeNames,
  viewerTheme,
  type ThemeConfig,
} from "../core/theme";
import { checkTheme, themeTokens, unscopedSelectors } from "../core/theme-check";
import { textProblems } from "../core/palette";
import { defineProject } from "../core/project";
import { DashyEngine } from "../core/engine";
import { createApiHandler } from "../core/http";
import empty from "../dashy.config";

const entries = themeEntries();
const sheet = (name: string) => Bun.file(new URL(`../src/themes/${name}.css`, import.meta.url)).text();

test("projects without a theme get Zafir with square controls", () => {
  expect(resolveTheme()).toEqual({
    name: "zafir",
    corners: { inputs: "none", buttons: "none", panels: "none" },
    selectable: [...themeNames],
    themes: entries,
  });
  expect(themeNames[0]).toBe("zafir");
});

test("each theme brings its default corners and filter style, and accepts a shared corner style", () => {
  for (const name of themeNames) {
    const style = builtInThemes[name].corners;
    expect(resolveTheme({ name }).corners).toEqual({ inputs: style, buttons: style, panels: style });
    for (const corners of cornerStyles)
      expect(resolveTheme({ name, corners }).corners).toEqual({ inputs: corners, buttons: corners, panels: corners });
  }
  // Cognos keeps labelled fields; every other built-in theme uses chips.
  expect(themeNames.filter((name) => builtInThemes[name].filters === "fields")).toEqual(["cognos"]);
});

test("independent corner overrides preserve theme defaults for unspecified controls", () => {
  const config: ThemeConfig = { name: "chromeos", corners: { inputs: "none", panels: "rounded-lg" } };
  expect(resolveTheme(config).corners).toEqual({ inputs: "none", buttons: "rounded", panels: "rounded-lg" });
  expect(config.corners).toEqual({ inputs: "none", panels: "rounded-lg" });
});

test("rejects malformed theme names, unknown properties and invalid corner values at startup", () => {
  for (const theme of [
    null, "excel", [], { name: "unknown" }, { name: "constructor" }, { name: null }, { colour: "red" },
    { corners: "rouded-md" }, { corners: [] }, { corners: null }, { corners: { button: "rounded" } },
    { corners: { buttons: null } }, { corners: { panels: 10 } }, { selectable: "all" }, { selectable: null },
    { selectable: ["excel", "unknown"] }, { selectable: ["excel", "excel"] }, { name: "cognos", selectable: ["excel", "power-bi"] },
  ]) {
    expect(() => defineProject({ ...empty, theme: theme as unknown as ThemeConfig })).toThrow("Invalid Dashy theme");
  }
});

test("project themes: validated, offered with their label, and carrying their base theme", () => {
  const themes = { acme: { label: "Acme", stylesheet: "./themes/acme.css", extends: "excel" as const, filters: "fields" as const } };
  const resolved = resolveTheme({ name: "acme" }, themes);
  const square = { inputs: "none", buttons: "none", panels: "none" } as const;
  expect(resolved.themes.acme).toEqual({ label: "Acme", corners: square, filters: "fields", attribute: "excel acme" });
  expect(resolved.selectable).toEqual([...themeNames, "acme"]);
  expect(viewerTheme(resolved, undefined)).toMatchObject({ name: "acme", attribute: "excel acme", filters: "fields" });
  // Without extends, a project theme falls back to the default theme for anything it leaves out.
  expect(themeEntries({ solo: { label: "Solo", stylesheet: "solo.css" } }).solo).toEqual({ label: "Solo", corners: square, filters: "chips", attribute: "solo" });
  // Corners can differ per family; families left out keep the base theme's.
  const pills = themeEntries({ pill: { label: "Pill", stylesheet: "p.css", extends: "chromeos", corners: { buttons: "rounded", panels: "rounded-md" } } }).pill!;
  expect(pills.corners).toEqual({ inputs: "rounded", buttons: "rounded", panels: "rounded-md" });
  expect(viewerTheme(resolveTheme({}, { pill: { label: "Pill", stylesheet: "p.css", corners: { buttons: "rounded" } } }), "pill").corners)
    .toEqual({ inputs: "none", buttons: "rounded", panels: "none" });
  for (const bad of [
    { Acme: { label: "A", stylesheet: "a.css" } },
    { excel: { label: "A", stylesheet: "a.css" } },
    { acme: { label: "", stylesheet: "a.css" } },
    { acme: { label: "A", stylesheet: "a.scss" } },
    { acme: { label: "A", stylesheet: "../a.css" } },
    { acme: { label: "A", stylesheet: "/abs/a.css" } },
    { acme: { label: "A", stylesheet: "a.css", extends: "acme" } },
    { acme: { label: "A", stylesheet: "a.css", corners: "round" } },
    { acme: { label: "A", stylesheet: "a.css", corners: { button: "rounded" } } },
    { acme: { label: "A", stylesheet: "a.css", corners: { buttons: "pill" } } },
    { acme: { label: "A", stylesheet: "a.css", filters: "grid" } },
    { acme: { label: "A", stylesheet: "a.css", colour: "red" } },
  ])
    expect(() => defineProject({ ...empty, themes: bad as never })).toThrow("Invalid Dashy theme");
  // A project with themes can choose and list them.
  expect(defineProject({ ...empty, themes, theme: { name: "acme", selectable: ["acme", "excel"] } }).theme?.name).toBe("acme");
});

test("catalog API includes the resolved theme used by SSR and hydration", async () => {
  const engine = new DashyEngine({ ...empty, theme: { name: "macos", corners: { buttons: "rounded" } } });
  const response = await createApiHandler(engine)(new Request("http://localhost/api/catalog"));
  expect(response.status).toBe(200);
  expect((await response.json()).theme).toEqual({
    name: "macos",
    corners: { inputs: "rounded-md", buttons: "rounded", panels: "rounded-md" },
    selectable: [...themeNames],
    themes: entries,
  });
});

test("every built-in stylesheet is imported, scoped by word, defines the full token set and keeps text readable", async () => {
  const imports = await Bun.file(new URL("../src/theme.css", import.meta.url)).text();
  // Zafir is the default: its tokens also sit on :root and fill any token another theme omits.
  const zafir = themeTokens(await sheet("zafir"), "zafir", { root: true });
  const reference = Object.keys(zafir).filter((key) => key.startsWith("--")).sort();
  expect(imports.indexOf('"./themes/zafir.css"')).toBeLessThan(imports.indexOf('"./themes/excel.css"'));
  for (const name of themeNames) {
    const css = await sheet(name);
    expect(imports).toContain(`@import "./themes/${name}.css";`);
    expect(css).toContain(`:root[data-theme~="${name}"]`);
    expect(css).not.toContain(`[data-theme="`);
    const tokens = themeTokens(css, name);
    expect(Object.keys(tokens).filter((key) => key.startsWith("--")).sort()).toEqual(reference);
    expect({ name, problems: textProblems(tokens) }).toEqual({ name, problems: [] });
    // Built-in signatures stay inside their own theme.
    // Zafir is the exception by design: as the default, its tokens also sit on :root.
    expect({ name, unscoped: unscopedSelectors(css, name).filter((s) => !(name === "zafir" && s === ":root")) }).toEqual({ name, unscoped: [] });
  }
});

test("theme checks: unreadable text is an error, weak palettes and leaking rules are warnings", async () => {
  const defaults = themeTokens(await sheet("zafir"), "zafir", { root: true });
  const good = `:root[data-theme~="acme"] { --accent: #1f6480; }`;
  expect(checkTheme({ name: "acme", css: good, defaults })).toEqual({ errors: [], warnings: [] });
  const unreadable = checkTheme({ name: "acme", css: `:root[data-theme~="acme"] { --text: #dddddd; }`, defaults });
  expect(unreadable.errors[0]).toContain("--text #dddddd on --surface #ffffff");
  const weak = checkTheme({ name: "acme", css: `:root[data-theme~="acme"] { --chart-1: #999999; } .block { color: red; }`, defaults });
  expect(weak.errors).toEqual([]);
  expect(weak.warnings.some((w) => w.includes("--chart-1 #999999 is too grey"))).toBe(true);
  expect(weak.warnings.some((w) => w.includes("apply to every theme: .block"))).toBe(true);
  // A base theme's tokens count, and @font-face, @import and keyframes are not leaks.
  const base = themeTokens(await sheet("excel"), "excel");
  const css = `@import "x.css"; @font-face { font-family: X; src: url(x.woff2); } @keyframes k { 50% { opacity: 0 } }
    @media (min-width: 1px) { :root[data-theme~="acme"] .x { color: #000; } }
    :root[data-theme~="acme"] { --chart-1: #1f7a4d; }`;
  expect(checkTheme({ name: "acme", css, defaults, base })).toEqual({ errors: [], warnings: [] });
});

test("selectable themes default to all, can be limited or hidden", () => {
  expect(resolveTheme({ selectable: false }).selectable).toEqual([]);
  expect(resolveTheme({ selectable: [] }).selectable).toEqual([]);
  expect(resolveTheme({ name: "cognos", selectable: ["power-bi", "cognos"] }).selectable).toEqual(["power-bi", "cognos"]);
});

test("a viewer's choice applies only when the project offers it", () => {
  const project = resolveTheme({ name: "excel", corners: { panels: "rounded-lg" }, selectable: ["excel", "power-bi", "cognos"] });
  // The project theme keeps its configured corners.
  expect(viewerTheme(project, undefined)).toEqual({ name: "excel", corners: { inputs: "none", buttons: "none", panels: "rounded-lg" }, attribute: "excel", filters: "chips" });
  expect(viewerTheme(project, "excel")).toEqual(viewerTheme(project, undefined));
  // A chosen theme uses its own default corners and filter style.
  expect(viewerTheme(project, "power-bi")).toEqual({ name: "power-bi", corners: { inputs: "rounded-sm", buttons: "rounded-sm", panels: "rounded-sm" }, attribute: "power-bi", filters: "chips" });
  expect(viewerTheme(project, "cognos").filters).toBe("fields");
  for (const choice of ["macos", "unknown", "", "constructor"])
    expect(viewerTheme(project, choice).name).toBe("excel");
  expect(viewerTheme(resolveTheme({ selectable: false }), "cognos").name).toBe("zafir");
});

test("the theme cookie is read from a Cookie header", () => {
  expect(readThemeCookie("a=1; dashy_theme=power-bi; b=2")).toBe("power-bi");
  expect(readThemeCookie("dashy_session=x")).toBeUndefined();
  expect(readThemeCookie(null)).toBeUndefined();
});
