#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { listSamples, loadProject, selectConfig } from "../core/runtime";
import { themeNames } from "../core/theme";

const help = `Usage: dashy <start|dev|samples> [--with-sample <name>] [--theme <name>] [--port <number>]

  start     Start the production build (run bun run build first)
  dev       Start Vite for development
  samples   List samples found in ./samples

Without --with-sample, Dashy loads ./dashy.config.ts (empty by default).
Samples are read in place. Your project configuration is never overwritten.
--theme selects a theme and its default corners for this run.
Themes: ${themeNames.join(", ")}.
Run from the project root, or from a deployed .output directory.`;

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: true,
    options: {
      "with-sample": { type: "string" },
      theme: { type: "string" },
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
    !["start", "dev", "samples"].includes(command!)
  )
    throw new Error(help);
  const root = process.cwd();
  if (command === "samples") {
    if (
      values["with-sample"] !== undefined ||
      values.port !== undefined ||
      values.theme !== undefined
    )
      throw new Error(
        "The samples command does not accept --with-sample, --theme or --port.",
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
  const config = await selectConfig(root, values["with-sample"]);
  const project = await loadProject(config, values.theme);
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
    DASHY_THEME: values.theme ?? "",
  };
  let args: string[];
  if (command === "dev") {
    args = [
      process.execPath,
      "--bun",
      "vite",
      ...(values.port ? ["--port", values.port] : []),
    ];
  } else {
    const entry = [
      join(root, ".output/server/index.mjs"),
      join(root, "server/index.mjs"),
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
    cwd: root,
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
  process.exitCode = code;
}

main().catch((error) => {
  console.error(
    `[dashy] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
