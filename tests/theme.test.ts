import { expect, test } from "bun:test";
import {
  cornerStyles,
  readThemeCookie,
  resolveTheme,
  themeNames,
  viewerTheme,
  type ThemeConfig,
} from "../core/theme";
import { defineProject } from "../core/project";
import { DashyEngine } from "../core/engine";
import { createApiHandler } from "../core/http";
import empty from "../dashy.config";

test("legacy projects default to Excel with square controls", () => {
  expect(resolveTheme()).toEqual({
    name: "excel",
    corners: { inputs: "none", buttons: "none", panels: "none" },
    selectable: [...themeNames],
  });
});

test("each theme has defaults and accepts a shared style for all control families", () => {
  const defaults = [
    "none",
    "rounded",
    "rounded-lg",
    "rounded-sm",
    "rounded-md",
    "rounded-sm",
    "rounded-sm",
    "none",
  ] as const;
  for (const [index, name] of themeNames.entries()) {
    expect(resolveTheme({ name }).corners).toEqual({
      inputs: defaults[index]!,
      buttons: defaults[index]!,
      panels: defaults[index]!,
    });
    for (const corners of cornerStyles)
      expect(resolveTheme({ name, corners })).toEqual({
        name,
        corners: { inputs: corners, buttons: corners, panels: corners },
        selectable: [...themeNames],
      });
  }
});

test("independent corner overrides preserve theme defaults for unspecified controls", () => {
  const config: ThemeConfig = {
    name: "chromeos",
    corners: { inputs: "none", panels: "rounded-lg" },
  };
  expect(resolveTheme(config)).toEqual({
    name: "chromeos",
    corners: { inputs: "none", buttons: "rounded", panels: "rounded-lg" },
    selectable: [...themeNames],
  });
  expect(config.corners).toEqual({ inputs: "none", panels: "rounded-lg" });
});

test("rejects malformed theme names, unknown properties and invalid corner values at startup", () => {
  for (const theme of [
    null,
    "excel",
    [],
    { name: "unknown" },
    { name: "constructor" },
    { name: null },
    { colour: "red" },
    { corners: "rouded-md" },
    { corners: [] },
    { corners: null },
    { corners: { button: "rounded" } },
    { corners: { buttons: null } },
    { corners: { panels: 10 } },
    { selectable: "all" },
    { selectable: null },
    { selectable: ["excel", "unknown"] },
    { selectable: ["excel", "excel"] },
    { name: "cognos", selectable: ["excel", "power-bi"] },
  ]) {
    expect(() =>
      defineProject({ ...empty, theme: theme as unknown as ThemeConfig }),
    ).toThrow("Invalid Dashy theme");
  }
});

test("catalog API includes the resolved theme used by SSR and hydration", async () => {
  const engine = new DashyEngine({
    ...empty,
    theme: { name: "macos", corners: { buttons: "rounded" } },
  });
  const handler = createApiHandler(engine);
  const response = await handler(new Request("http://localhost/api/catalog"));
  expect(response.status).toBe(200);
  expect((await response.json()).theme).toEqual({
    name: "macos",
    corners: { inputs: "rounded-md", buttons: "rounded", panels: "rounded-md" },
    selectable: [...themeNames],
  });
});

const themeTokens = async (name: string) => {
  const css = await Bun.file(new URL(`../src/themes/${name}.css`, import.meta.url)).text();
  expect(css).toContain(`:root[data-theme="${name}"]`);
  return Object.fromEntries([...css.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)].map((m) => [m[1]!, m[2]!.trim()]));
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

test("every theme stylesheet is imported, defines the full token set and keeps text readable", async () => {
  const imports = await Bun.file(new URL("../src/theme.css", import.meta.url)).text();
  const reference = Object.keys(await themeTokens("excel")).sort();
  for (const name of themeNames) {
    expect(imports).toContain(`@import "./themes/${name}.css";`);
    const tokens = await themeTokens(name);
    expect(Object.keys(tokens).sort()).toEqual(reference);
    for (const [foreground, background] of [
      ["--text", "--surface"],
      ["--muted", "--surface"],
      ["--nav-text", "--sidebar"],
      ["--metric-color", "--surface"],
      ["--on-accent", "--accent"],
      ["--header-text", "--header-background"],
      ["--danger", "--danger-soft"],
    ] as const) {
      const ratio = contrast(tokens[foreground]!.slice(0, 7), tokens[background]!.slice(0, 7));
      expect({ name, foreground, background, ok: ratio >= 4.5 }).toEqual({ name, foreground, background, ok: true });
    }
  }
});

test("selectable themes default to all, can be limited or hidden", () => {
  expect(resolveTheme({ selectable: false }).selectable).toEqual([]);
  expect(resolveTheme({ selectable: [] }).selectable).toEqual([]);
  expect(resolveTheme({ name: "cognos", selectable: ["power-bi", "cognos"] }).selectable).toEqual(["power-bi", "cognos"]);
});

test("a viewer's choice applies only when the project offers it", () => {
  const project = resolveTheme({ name: "excel", corners: { panels: "rounded-lg" }, selectable: ["excel", "power-bi", "cognos"] });
  // The project theme keeps its configured corners.
  expect(viewerTheme(project, undefined)).toEqual({ name: "excel", corners: { inputs: "none", buttons: "none", panels: "rounded-lg" } });
  expect(viewerTheme(project, "excel")).toEqual(viewerTheme(project, undefined));
  // A chosen theme uses its own default corners.
  expect(viewerTheme(project, "power-bi")).toEqual({ name: "power-bi", corners: { inputs: "rounded-sm", buttons: "rounded-sm", panels: "rounded-sm" } });
  for (const choice of ["macos", "unknown", "", "constructor"])
    expect(viewerTheme(project, choice).name).toBe("excel");
  expect(viewerTheme(resolveTheme({ selectable: false }), "cognos").name).toBe("excel");
});

test("the theme cookie is read from a Cookie header", () => {
  expect(readThemeCookie("a=1; dashy_theme=power-bi; b=2")).toBe("power-bi");
  expect(readThemeCookie("dashy_session=x")).toBeUndefined();
  expect(readThemeCookie(null)).toBeUndefined();
});
