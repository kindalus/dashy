import { expect, test } from "bun:test";
import { themeNames } from "../core/theme";

/**
 * Categorical chart palettes must stay readable: inside a lightness band, saturated
 * enough not to read as grey, at least 3:1 against the chart surface, and with
 * neighbours (series are coloured in order) that differ for normal vision and under
 * protanopia and deuteranopia. Thresholds and the Machado (2009) severity-1.0
 * simulation follow the data-visualisation palette checks used to choose them.
 */
const BAND = { light: [0.43, 0.77], dark: [0.48, 0.67] } as const;
const CHROMA_FLOOR = 0.1;
const CVD_TARGET = 8;
const NORMAL_FLOOR = 15;
const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
} as const;

const linear = (hex: string) => [1, 3, 5].map((i) => {
  const c = parseInt(hex.slice(i, i + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}) as [number, number, number];
const oklab = ([r, g, b]: readonly number[]) => {
  const l = Math.cbrt(0.4122214708 * r! + 0.5363325363 * g! + 0.0514459929 * b!);
  const m = Math.cbrt(0.2119034982 * r! + 0.6806995451 * g! + 0.1073969566 * b!);
  const s = Math.cbrt(0.0883024619 * r! + 0.2817188376 * g! + 0.6299787005 * b!);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};
const simulate = (rgb: readonly number[], matrix: readonly (readonly number[])[]) =>
  matrix.map((row) => Math.max(0, Math.min(1, row[0]! * rgb[0]! + row[1]! * rgb[1]! + row[2]! * rgb[2]!)));
const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!) * 100;
const luminance = (hex: string) => { const [r, g, b] = linear(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

const tokens = async (name: string) => {
  const css = await Bun.file(new URL(`../src/themes/${name}.css`, import.meta.url)).text();
  return Object.fromEntries([...css.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)].map((m) => [m[1]!, m[2]!.trim()]));
};

test("every theme's chart palette passes the lightness, chroma, contrast and colour-vision checks", async () => {
  for (const name of themeNames) {
    const t = await tokens(name);
    const palette = [1, 2, 3, 4, 5, 6].map((i) => t[`--chart-${i}`]!);
    const css = await Bun.file(new URL(`../src/themes/${name}.css`, import.meta.url)).text();
    const mode = /color-scheme:\s*dark/.test(css) ? "dark" : "light";
    const [low, high] = BAND[mode];
    for (const color of palette) {
      const [L, a, b] = oklab(linear(color));
      expect({ name, color, inBand: L! >= low && L! <= high }).toEqual({ name, color, inBand: true });
      expect({ name, color, saturated: Math.hypot(a!, b!) >= CHROMA_FLOOR }).toEqual({ name, color, saturated: true });
      expect({ name, color, contrast: contrast(color, t["--surface"]!) >= 3 }).toEqual({ name, color, contrast: true });
    }
    for (let i = 1; i < palette.length; i++) {
      const [x, y] = [linear(palette[i - 1]!), linear(palette[i]!)];
      const normal = distance(oklab(x), oklab(y));
      const cvd = Math.min(...Object.values(MACHADO).map((m) => distance(oklab(simulate(x, m)), oklab(simulate(y, m)))));
      const pair = `${palette[i - 1]}↔${palette[i]}`;
      expect({ name, pair, normal: normal >= NORMAL_FLOOR }).toEqual({ name, pair, normal: true });
      expect({ name, pair, cvd: cvd >= CVD_TARGET }).toEqual({ name, pair, cvd: true });
    }
  }
});

test("chart tokens choose a grid style and a bar radius", async () => {
  for (const name of themeNames) {
    const t = await tokens(name);
    expect(["solid", "dashed"]).toContain(t["--chart-grid-style"]!);
    expect(Number.isFinite(Number(t["--chart-bar-radius"]))).toBe(true);
  }
});
