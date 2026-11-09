import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectThemeSheets } from "../scripts/extensions-plugin";
import { loadProject } from "../core/runtime";
import empty from "../dashy.config";
import type { ProjectDefinition } from "../core/types";

const root = await mkdtemp(join(tmpdir(), "dashy-themes-"));
const extensions = join(root, "extensions");
await mkdir(join(extensions, "themes"), { recursive: true });
await writeFile(join(root, "outside.css"), `:root[data-theme~="escape"] { --accent: #1f6480; }`);
const project = (themes: ProjectDefinition["themes"]): ProjectDefinition => ({ ...empty, themes });

test("project theme stylesheets are checked before they are bundled", async () => {
  await writeFile(join(extensions, "themes/good.css"), `:root[data-theme~="good"] { --accent: #1f6480; --on-accent: #ffffff; }`);
  const warnings: string[] = [];
  const sheets = await projectThemeSheets(project({ good: { label: "Good", stylesheet: "./themes/good.css", extends: "excel" } }), extensions, (w) => warnings.push(w));
  expect(sheets).toEqual([join(await import("node:fs/promises").then((fs) => fs.realpath(extensions)), "themes/good.css")]);
  expect(warnings).toEqual([]);
});

test("unreadable text stops the build; a weak palette and leaking rules only warn", async () => {
  await writeFile(join(extensions, "themes/pale.css"), `:root[data-theme~="pale"] { --text: #cccccc; }`);
  await expect(projectThemeSheets(project({ pale: { label: "Pale", stylesheet: "./themes/pale.css" } }), extensions, () => {}))
    .rejects.toThrow("Theme pale (./themes/pale.css) has unreadable text");
  await writeFile(join(extensions, "themes/loose.css"), `:root[data-theme~="loose"] { --chart-1: #aaaaaa; } .sidebar { background: red; }`);
  const warnings: string[] = [];
  await projectThemeSheets(project({ loose: { label: "Loose", stylesheet: "./themes/loose.css" } }), extensions, (w) => warnings.push(w));
  expect(warnings.some((w) => w.startsWith("[dashy] Theme loose: chart palette: --chart-1 #aaaaaa"))).toBe(true);
  expect(warnings.some((w) => w.includes("apply to every theme: .sidebar"))).toBe(true);
});

test("stylesheets must exist inside extensions", async () => {
  await expect(projectThemeSheets(project({ gone: { label: "Gone", stylesheet: "./themes/gone.css" } }), extensions, () => {}))
    .rejects.toThrow("Theme gone: stylesheet ./themes/gone.css was not found");
  // A symbolic link pointing outside still escapes.
  await import("node:fs/promises").then((fs) => fs.symlink(join(root, "outside.css"), join(extensions, "themes/escape.css")));
  await expect(projectThemeSheets(project({ escape: { label: "Escape", stylesheet: "./themes/escape.css" } }), extensions, () => {}))
    .rejects.toThrow("Theme escape stylesheet escapes extensions");
});

test("the Maven sample's theme passes and can be the default or a viewer choice", async () => {
  const maven = await loadProject("samples/maven-analytics/dashy.config.ts");
  const warnings: string[] = [];
  expect(await projectThemeSheets(maven, "samples/maven-analytics/extensions", (w) => warnings.push(w))).toHaveLength(1);
  expect(warnings).toEqual([]);
  const run = await loadProject("samples/maven-analytics/dashy.config.ts", "maven");
  expect(run.theme).toMatchObject({ name: "maven", corners: { inputs: "rounded-sm", buttons: "rounded", panels: "rounded-sm" } });
  expect(run.theme && "themes" in run.theme && (run.theme as { themes: Record<string, { attribute: string }> }).themes.maven!.attribute).toBe("power-bi maven");
});
