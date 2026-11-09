import { expect, test } from "bun:test";
import { composeSvg, wrapCaption } from "../src/chart-image";

test("composes a standalone, escaped SVG with title, chart and filter caption", () => {
  const svg = composeSvg({
    svg: '<?xml version="1.0"?>\n<svg width="100" height="50" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="50"/></svg>',
    width: 100, height: 50, title: "Sales & <margins>", caption: "Country: \"Côte d'Ivoire\"",
    background: "#fff", text: "#000", muted: "#666", font: "'Segoe UI', sans-serif",
  });
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="132" height="') && svg.includes(' viewBox="0 0 132 ')).toBe(true);
  // A 100px chart wraps the title too; every line stays escaped.
  expect(svg).toContain(">Sales &amp;</text>");
  expect(svg).toContain(">&lt;margins&gt;</text>");
  // A 100px chart wraps the caption; both lines stay escaped.
  expect(svg).toContain(">Country: &quot;Côte</text>");
  expect(svg).toContain(">d&apos;Ivoire&quot;</text>");
  expect(svg).toContain('<svg x="16" y="60" width="100" height="50"');
  expect(svg).not.toContain("<?xml");
  expect(svg).toContain(`font-family="&apos;Segoe UI&apos;, sans-serif"`);
});

test("captions wrap at filter separators so they never clip", () => {
  const caption = "Period: 2016-01-01 – 2021-02-20 · Customer country: Canada · Category: Computers · Channel: Online";
  const lines = wrapCaption(caption, 300);
  expect(lines.length).toBeGreaterThan(1);
  expect(lines.join(" ")).toBe(caption);
  for (const line of lines) expect(line.length).toBeLessThanOrEqual(Math.floor(300 / 6.4));
  expect(wrapCaption("", 300)).toEqual([]);
  const svg = composeSvg({ svg: "<svg/>", width: 300, height: 100, title: "T", caption, background: "#fff", text: "#000", muted: "#666", font: "sans-serif" });
  expect((svg.match(/<text /g) ?? []).length).toBe(1 + lines.length);
});

test("a short title keeps the single-line header", () => {
  const svg = composeSvg({ svg: "<svg/>", width: 600, height: 100, title: "Revenue", caption: "", background: "#fff", text: "#000", muted: "#666", font: "sans-serif" });
  expect(svg).toContain('<svg x="16" y="40"');
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="632" height="152"')).toBe(true);
});
