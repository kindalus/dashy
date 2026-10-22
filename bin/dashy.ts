#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { listSamples, loadImplementation } from "../core/runtime";
import { resolveLocations } from "../core/locations";
import { themeNames } from "../core/theme";

const help = `Usage: dashy <start|dev|build|samples> [--with-sample <name>] [--theme <name>] [--locale <tag>] [--port <number>]

  start     Start the production build (run bun run build first)
  dev       Start Vite for development
  build     Build the selected implementation for production
  samples   List samples found in ./samples

Without --with-sample, Dashy loads ./dashy.config.ts (empty by default).
Samples are read in place. Your project configuration is never overwritten.
--theme selects a theme and its default corners for this run.
--locale overrides the project's formatting locale (default: pt).
Themes: ${themeNames.join(", ")}.
DASHY_PROJECT_DIR selects an external implementation. DASHY_CONFIG,
DASHY_ARTIFACTS_DIR, DASHY_EXTENSIONS_DIR and DASHY_DATA_DIR override its paths.
DASHY_THEME and DASHY_LOCALE override configured presentation defaults.`;

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: true,
    options: {
      "with-sample": { type: "string" },
      theme: { type: "string" },
      locale: { type: "string" },
      port: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(help);
    return;
  }
  const [command] = positionals;
  if (
    positionals.length !== 1 ||
    !["start", "dev", "build", "samples"].includes(command!)
  )
    throw new Error(help);
  const installation = existsSync(join(import.meta.dir, "dashy.config.js"))
    ? import.meta.dir : resolve(import.meta.dir, "..");
  const root = process.cwd();
  if (command === "samples") {
    if (
      values["with-sample"] !== undefined ||
      values.port !== undefined ||
      values.theme !== undefined ||
      values.locale !== undefined
    )
      throw new Error(
        "The samples command does not accept --with-sample, --theme, --locale or --port.",
      );
    console.log(
      (await listSamples(root)).join("\n") || "No samples found in ./samples.",
    );
    return;
  }
  if (
    values.port !== undefined &&
    (!/^\d+$/.test(values.port) ||
      Number(values.port) < 1 ||
      Number(values.port) > 65535)
  )
    throw new Error("--port must be an integer between 1 and 65535.");
  const locations = await resolveLocations({
    installationDir: process.env.DASHY_PROJECT_DIR ? installation : root,
    sample: values["with-sample"], theme: values.theme, locale: values.locale,
  });
  const { config } = locations;
  const project = await loadImplementation(locations);
  for (const source of Object.values(project.sources)) {
    if (
      ["csv", "json", "excel", "sqlite", "duckdb", "parquet"].includes(
        source.type,
      ) &&
      source.path &&
      !existsSync(resolve(project.dataDir!, source.path))
    )
      throw new Error(
        `Missing source file: ${resolve(project.dataDir!, source.path)}. Check the selected project or sample configuration.`,
      );
  }
  const env = {
    ...process.env,
    DASHY_CONFIG: config,
    DASHY_PROJECT_DIR: locations.projectDir,
    DASHY_ARTIFACTS_DIR: locations.artifactsRequired ? locations.artifactsDir : "",
    DASHY_EXTENSIONS_DIR: locations.extensionsRequired ? locations.extensionsDir : "",
    DASHY_DATA_DIR: locations.dataDir ?? "",
    ...(locations.theme === undefined ? {} : { DASHY_THEME: locations.theme }),
    DASHY_LOCALE: project.locale!,
  };
  let args: string[];
  if (command === "dev" || command === "build") {
    args = [
      process.execPath,
      "--bun",
      "vite",
      ...(command === "build" ? ["build"] : []),
      ...(values.port ? ["--port", values.port] : []),
    ];
  } else {
    const entry = [
      join(root, ".output/server/index.mjs"),
      join(root, "server/index.mjs"),
      ...(process.env.DASHY_PROJECT_DIR || process.env.DASHY_CONFIG ? [join(installation, ".output/server/index.mjs"), join(installation, "server/index.mjs")] : []),
    ].find(existsSync);
    if (!entry)
      throw new Error(
        "Production build not found. Run bun run build, then dashy start.",
      );
    if (values.port) Object.assign(env, { PORT: values.port });
    args = [process.execPath, entry];
  }
  console.log(
    `[dashy] ${values["with-sample"] ? `Sample: ${values["with-sample"]}` : "Project"} (${config})`,
  );
  const child = Bun.spawn(args, {
    cwd: command === "start" ? root : installation,
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const interrupt = () => child.kill("SIGINT");
  const terminate = () => child.kill("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  const code = await child.exited;
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", terminate);
  if (code === 0 && command === "build") {
    const packaged = Bun.spawn([process.execPath, join(installation, "scripts/package-runtime.ts")], {
      cwd: installation, env, stdout: "inherit", stderr: "inherit",
    });
    process.exitCode = await packaged.exited;
  } else process.exitCode = code;
}

main().catch((error) => {
  console.error(
    `[dashy] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
