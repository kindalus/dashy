import { importConfig } from "dashy/internal/import-config";
export { findConfig, listSamples, selectConfig } from "./discovery.ts";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defineProject } from "./project.ts";
import { findRegistry, type ProjectLocations } from "./locations.ts";
import type { ProjectDefinition } from "./types.ts";
import { resolveTheme, type ThemeName } from "./theme.ts";

/** Import trusted server code at runtime, outside Vite's module graph. */
export async function loadProject(
  configPath: string,
  theme?: string,
  locale?: string,
  locations?: ProjectLocations,
): Promise<ProjectDefinition> {
  const path = resolve(configPath);
  const module = await importConfig(pathToFileURL(path).href);
  if (!module.default || typeof module.default !== "object")
    throw new Error(`Project ${path} must have a default project export.`);
  const base = { ...module.default };
  const registries = ["params", "sources", "queries", "datasets", "metrics", "dashboards"] as const;
  if (locations) {
    const artifactPath = await findRegistry(locations.artifactsDir, locations.artifactsRequired);
    if (artifactPath) {
      const artifacts = (await importConfig(pathToFileURL(artifactPath).href)).default;
      if (!artifacts || typeof artifacts !== "object" || Array.isArray(artifacts))
        throw new Error(`Artifacts ${artifactPath} must have a default registry export.`);
      for (const key of Object.keys(artifacts))
        if (!(registries as readonly string[]).includes(key))
          throw new Error(`Unknown artifact registry: ${key}`);
      for (const key of registries) base[key] = mergeRegistry(key, base[key], artifacts[key]);
    }
    const extensionPath = await findRegistry(locations.extensionsDir, locations.extensionsRequired);
    if (extensionPath) {
      const pages = (await importConfig(pathToFileURL(extensionPath).href)).default;
      if (!pages || typeof pages !== "object" || Array.isArray(pages))
        throw new Error(`Extensions ${extensionPath} must have a default pages export.`);
      base.pages = mergeRegistry("pages", base.pages, pages);
    }
  }
  for (const key of registries) {
    const registry = base[key];
    if (!registry || typeof registry !== "object" || Array.isArray(registry))
      throw new Error(`Project ${path} must define a ${key} registry.`);
  }
  const project = defineProject({
    ...base,
    locale: locale ?? base.locale ?? "pt",
    ...(theme === undefined
      ? {}
      : { theme: resolveTheme({ name: theme as ThemeName }) }),
  });
  return {
    ...project,
    dataDir: locations?.dataDir ?? resolve(dirname(path), project.dataDir || "."),
  };
}

function mergeRegistry(name: string, first: unknown, second: unknown) {
  const result: Record<string, unknown> = Object.create(null);
  for (const registry of [first, second]) {
    if (registry === undefined) continue;
    if (!registry || typeof registry !== "object" || Array.isArray(registry))
      throw new Error(`Invalid ${name} registry`);
    for (const [id, entry] of Object.entries(registry)) {
      if (Object.hasOwn(result, id)) throw new Error(`Duplicate ${name} identifier: ${id}`);
      result[id] = entry;
    }
  }
  return result;
}

export async function loadImplementation(locations: ProjectLocations) {
  return loadProject(locations.config, locations.theme, locations.locale, locations);
}
