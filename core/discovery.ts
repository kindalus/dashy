import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function findConfig(
  directory: string,
  basename = "dashy.config",
): Promise<string | undefined> {
  for (const name of [
    `${basename}.ts`,
    `${basename}.js`,
    `${basename}.mjs`,
  ]) {
    const path = join(directory, name);
    if (await isFile(path)) return path;
  }
}

/** Discover only immediate sample directories containing a project entry. */
export async function listSamples(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(join(root, "samples"), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const names: string[] = [];
  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(entry.name) &&
      (await findConfig(join(root, "samples", entry.name)))
    )
      names.push(entry.name);
  }
  return names.sort();
}

export async function selectConfig(
  root: string,
  sample?: string,
): Promise<string> {
  root = resolve(root);
  if (sample !== undefined) {
    const available = await listSamples(root);
    if (!available.includes(sample)) {
      throw new Error(
        `Sample '${sample}' not found in ${join(root, "samples")}. Available samples: ${available.join(", ") || "none"}.`,
      );
    }
    return (await findConfig(join(root, "samples", sample)))!;
  }
  const config = await findConfig(root);
  if (!config)
    throw new Error(
      `No dashy.config.ts or dashy.config.js found in ${root}. Run Dashy from the project root.`,
    );
  return config;
}

