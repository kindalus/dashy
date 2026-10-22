import { expect, test } from "bun:test";
import { mkdtemp, mkdir, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extensionsPlugin } from "../scripts/extensions-plugin";
import { assertCompiledPages } from "../core/pages";
import { defineConfig } from "../core/project";

test("external page components cannot escape extensions through a symlink", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dashy-page-path-"));
  try {
    await mkdir(join(directory, "extensions"));
    await writeFile(join(directory, "private.tsx"), "export default function Private() { return null; }");
    await symlink(join(directory, "private.tsx"), join(directory, "extensions/page.tsx"));
    const project = defineConfig({ name: "Paths", pages: { example: { label: "Example", component: "page.tsx" } } });
    await expect(extensionsPlugin(project, join(directory, "extensions"))).rejects.toThrow("escapes extensions");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("production manifests reject missing or changed components while allowing metadata edits", () => {
  const project = defineConfig({ name: "Pages", pages: { example: { label: "New label", component: "./pages/example.tsx" } } });
  expect(() => assertCompiledPages(project, { example: { component: "pages/example.tsx" } })).not.toThrow();
  expect(() => assertCompiledPages(project, {})).toThrow("Rebuild Dashy");
  expect(() => assertCompiledPages(project, { example: { component: "pages/old.tsx" } })).toThrow("Rebuild Dashy");
});
