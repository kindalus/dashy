import { expect, test } from "bun:test";
import { themeNames } from "../core/theme";
import { paletteProblems } from "../core/palette";
import { themeTokens } from "../core/theme-check";

const tokens = async (name: string) =>
  themeTokens(await Bun.file(new URL(`../src/themes/${name}.css`, import.meta.url)).text(), name);

test("every theme's chart palette passes the lightness, chroma, contrast and colour-vision checks", async () => {
  for (const name of themeNames) {
    const t = await tokens(name);
    const mode = t["color-scheme"] === "dark" ? "dark" : "light";
    expect({ name, problems: paletteProblems(t, mode) }).toEqual({ name, problems: [] });
  }
});

test("the checks catch grey, too light, low-contrast and look-alike neighbours", () => {
  const base = { "--surface": "#ffffff" };
  const palette = (colors: string[]) => ({ ...base, ...Object.fromEntries(colors.map((c, i) => [`--chart-${i + 1}`, c])) });
  const problems = paletteProblems(palette(["#999999", "#ffd54f", "#1f7a4d", "#1f7a4e", "#2f6fd6", "#c43d79"]), "light");
  expect(problems.some((p) => p.includes("--chart-1 #999999 is too grey"))).toBe(true);
  expect(problems.some((p) => p.includes("--chart-2 #ffd54f lightness"))).toBe(true);
  expect(problems.some((p) => p.includes("--chart-3 and --chart-4 look alike"))).toBe(true);
});

test("chart tokens choose a grid style, a bar radius, focus mode and a bar style", async () => {
  for (const name of themeNames) {
    const t = await tokens(name);
    expect(["solid", "dashed"]).toContain(t["--chart-grid-style"]!);
    expect(Number.isFinite(Number(t["--chart-bar-radius"]))).toBe(true);
    expect(["on", "off"]).toContain(t["--chart-focus"]!);
    expect(["solid", "blocks"]).toContain(t["--chart-bar-style"]!);
  }
});
