/**
 * Saves a rendered chart as an SVG or PNG file with its title and filters, so the
 * image stands on its own outside the dashboard. Browser-only; no dependencies.
 */
export interface ImageContext {
  /** The chart's SVG markup, from ECharts' SVG renderer. */
  svg: string;
  width: number;
  height: number;
  title: string;
  /** One line describing the filters, e.g. "Period: 2016-01-01 – 2021-02-20 · Country: All". */
  caption: string;
  background: string;
  text: string;
  muted: string;
  font: string;
}

const TITLE_LINE = 20;
const LINE = 15;
const MARGIN = 16;
// Average glyph widths of the 11px caption and 15px bold title; wrapping need not be exact, only never clip.
const CHAR = 6.4;
const TITLE_CHAR = 9.2;
const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

/** Splits text at " · " (then spaces) into lines that fit the width. */
export function wrapCaption(caption: string, width: number, char = CHAR): string[] {
  const max = Math.max(12, Math.floor(width / char));
  const lines: string[] = [];
  let line = "";
  for (const word of caption.split(/(?<= · )|(?<= )/)) {
    if (line && (line + word).trimEnd().length > max) {
      lines.push(line.trimEnd());
      line = "";
    }
    line += word;
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}
const footerHeight = (lines: number) => (lines ? lines * LINE + 13 : 12);
const headerHeight = (lines: number) => 20 + Math.max(1, lines) * TITLE_LINE;
export const imageSize = (context: Pick<ImageContext, "width" | "height" | "caption" | "title">) => ({
  width: context.width + 2 * MARGIN,
  height: context.height + headerHeight(wrapCaption(context.title, context.width, TITLE_CHAR).length)
    + footerHeight(wrapCaption(context.caption, context.width).length),
});

/** A standalone SVG: title, the chart and a wrapped filter caption on the theme background. */
export function composeSvg(context: ImageContext): string {
  const lines = wrapCaption(context.caption, context.width);
  const titles = wrapCaption(context.title, context.width, TITLE_CHAR);
  const top = headerHeight(titles.length);
  const { width, height } = imageSize(context);
  const chart = context.svg.replace(/^<\?xml[^>]*>\s*/, "").replace(/^<svg\b/, `<svg x="${MARGIN}" y="${top}"`);
  const font = escape(context.font);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<rect width="100%" height="100%" fill="${escape(context.background)}"/>`
    + titles.map((line, i) =>
      `<text x="${MARGIN}" y="${26 + i * TITLE_LINE}" font-family="${font}" font-size="15" font-weight="600" fill="${escape(context.text)}">${escape(line)}</text>`).join("")
    + chart
    + lines.map((line, i) =>
      `<text x="${MARGIN}" y="${top + context.height + 16 + i * LINE}" font-family="${font}" font-size="11" fill="${escape(context.muted)}">${escape(line)}</text>`).join("")
    + `</svg>`;
}

/**
 * Rasterises the composed SVG at `scale` times its size. The image loads from a
 * data: URL because the page's Content-Security-Policy allows `img-src 'self' data:`.
 */
export async function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  const image = new Image();
  image.decoding = "async";
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  context.scale(scale, scale);
  context.drawImage(image, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))), "image/png"));
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Slow save dialogs (notably Safari) read the URL late.
  setTimeout(() => URL.revokeObjectURL(url), 40_000);
}

export async function saveChartImage(context: ImageContext, type: "svg" | "png", filename: string) {
  const svg = composeSvg(context);
  const { width, height } = imageSize(context);
  const blob = type === "svg" ? new Blob([svg], { type: "image/svg+xml" }) : await svgToPng(svg, width, height);
  download(blob, `${filename}.${type}`);
}
