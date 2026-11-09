/**
 * Colour checks for themes, shared by the test suite and project-theme validation.
 * Text pairs need WCAG 4.5:1. Categorical chart palettes must stay readable: inside a
 * lightness band, saturated enough not to read as grey, at least 3:1 against the chart
 * surface, and with neighbours (series are coloured in order) that differ for normal
 * vision and under protanopia and deuteranopia. Thresholds and the Machado (2009)
 * severity-1.0 simulation follow the data-visualisation palette checks used to
 * choose the built-in palettes.
 */
export const LIGHTNESS_BAND = { light: [0.43, 0.77], dark: [0.48, 0.67] } as const;
export const CHROMA_FLOOR = 0.1;
export const CVD_TARGET = 8;
export const NORMAL_FLOOR = 15;
const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
} as const;

/** #rgb or #rrggbb, optionally with alpha (ignored), to #rrggbb; undefined otherwise. */
export function hexColor(value: string | undefined): string | undefined {
  const match = /^#([0-9a-f]{3,8})$/i.exec((value ?? "").trim());
  if (!match) return undefined;
  const digits = match[1]!;
  if (digits.length === 3 || digits.length === 4) return `#${[...digits.slice(0, 3)].map((c) => c + c).join("")}`.toLowerCase();
  if (digits.length === 6 || digits.length === 8) return `#${digits.slice(0, 6)}`.toLowerCase();
  return undefined;
}
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

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Text tokens and the background each must be readable on. */
export const TEXT_PAIRS = [
  ["--text", "--surface"],
  ["--muted", "--surface"],
  ["--nav-text", "--sidebar"],
  ["--metric-color", "--surface"],
  ["--on-accent", "--accent"],
  ["--header-text", "--header-background"],
  ["--danger", "--danger-soft"],
] as const;

/** Text pairs below 4.5:1, as messages. Tokens that are not plain hex colours are skipped. */
export function textProblems(tokens: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const [foreground, background] of TEXT_PAIRS) {
    const fg = hexColor(tokens[foreground]), bg = hexColor(tokens[background]);
    if (!fg || !bg) continue;
    const ratio = contrast(fg, bg);
    if (ratio < 4.5) problems.push(`${foreground} ${fg} on ${background} ${bg} has ${ratio.toFixed(2)}:1 contrast; text needs 4.5:1`);
  }
  return problems;
}

/** Palette problems for --chart-1…6 against --surface, as messages. */
export function paletteProblems(tokens: Record<string, string>, mode: "light" | "dark"): string[] {
  const problems: string[] = [];
  const surface = hexColor(tokens["--surface"]);
  const palette = [1, 2, 3, 4, 5, 6].map((i) => ({ token: `--chart-${i}`, color: hexColor(tokens[`--chart-${i}`]) }));
  const [low, high] = LIGHTNESS_BAND[mode];
  for (const { token, color } of palette) {
    if (!color) { problems.push(`${token} must be a hex colour`); continue; }
    const [L, a, b] = oklab(linear(color));
    if (L! < low || L! > high) problems.push(`${token} ${color} lightness ${L!.toFixed(2)} is outside ${low}–${high} for a ${mode} theme`);
    if (Math.hypot(a!, b!) < CHROMA_FLOOR) problems.push(`${token} ${color} is too grey (chroma ${Math.hypot(a!, b!).toFixed(3)}, at least ${CHROMA_FLOOR})`);
    if (surface && contrast(color, surface) < 3) problems.push(`${token} ${color} has ${contrast(color, surface).toFixed(2)}:1 against the surface; marks need 3:1`);
  }
  for (let i = 1; i < palette.length; i++) {
    const [x, y] = [palette[i - 1]!, palette[i]!];
    if (!x.color || !y.color) continue;
    const [lx, ly] = [linear(x.color), linear(y.color)];
    const normal = distance(oklab(lx), oklab(ly));
    const cvd = Math.min(...Object.values(MACHADO).map((m) => distance(oklab(simulate(lx, m)), oklab(simulate(ly, m)))));
    if (normal < NORMAL_FLOOR) problems.push(`${x.token} and ${y.token} look alike (ΔE ${normal.toFixed(1)}, at least ${NORMAL_FLOOR})`);
    if (cvd < CVD_TARGET) problems.push(`${x.token} and ${y.token} look alike to colour-blind readers (ΔE ${cvd.toFixed(1)}, at least ${CVD_TARGET})`);
  }
  return problems;
}
