import { dirname, resolve } from "node:path";
import { stat } from "node:fs/promises";
import { findConfig, selectConfig } from "./discovery.ts";

export interface ProjectLocations {
  projectDir: string;
  config: string;
  artifactsDir: string;
  extensionsDir: string;
  artifactsRequired: boolean;
  extensionsRequired: boolean;
  dataDir?: string;
  theme?: string;
  locale?: string;
}

/** One path/override policy shared by the CLI, Vite and production server. */
export async function resolveLocations(options: {
  cwd?: string;
  installationDir?: string;
  env?: Record<string, string | undefined>;
  sample?: string;
  theme?: string;
  locale?: string;
} = {}): Promise<ProjectLocations> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  // A sample is an explicit implementation selection. Never mix its artifacts
  // or data with paths inherited from a different implementation.
  const selectedSample = options.sample !== undefined;
  const paths = selectedSample ? {} : env;
  let projectDir = resolve(cwd, paths.DASHY_PROJECT_DIR || ".");
  const config = selectedSample
    ? await selectConfig(options.installationDir ?? cwd, options.sample)
    : paths.DASHY_CONFIG
      ? resolve(projectDir, paths.DASHY_CONFIG)
      : await selectConfig(projectDir);
  if (!(await stat(config)).isFile()) throw new Error(`Not a config file: ${config}`);
  if (selectedSample || (!paths.DASHY_PROJECT_DIR && paths.DASHY_CONFIG))
    projectDir = dirname(config);
  return {
    projectDir, config,
    artifactsDir: resolve(projectDir, paths.DASHY_ARTIFACTS_DIR || "artifacts"),
    extensionsDir: resolve(projectDir, paths.DASHY_EXTENSIONS_DIR || "extensions"),
    artifactsRequired: Boolean(paths.DASHY_ARTIFACTS_DIR),
    extensionsRequired: Boolean(paths.DASHY_EXTENSIONS_DIR),
    dataDir: paths.DASHY_DATA_DIR ? resolve(projectDir, paths.DASHY_DATA_DIR) : undefined,
    theme: options.theme ?? env.DASHY_THEME ?? undefined,
    locale: options.locale ?? env.DASHY_LOCALE ?? undefined,
  };
}

export async function findRegistry(directory: string, required = false) {
  // Reuse the supported module extensions without recursively importing files.
  const config = await findConfig(directory, "index");
  if (!config && required) throw new Error(`Missing index.ts, index.js or index.mjs in ${directory}`);
  return config;
}

/** Pages remain backward compatible; an explicit extensions directory may contain only API routes. */
export async function findExtensionRegistries(directory: string, required = false) {
  const [pages, api] = await Promise.all([findRegistry(directory), findRegistry(resolve(directory, "api"))]);
  if (required && !pages && !api)
    throw new Error(`Missing index.ts, index.js or index.mjs in ${directory} or its api directory`);
  return { pages, api };
}
