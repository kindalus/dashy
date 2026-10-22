import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { findConfig, listSamples } from "../core/runtime";

// Ship runnable server configurations next to their data. TypeScript helpers are
// bundled so a deployment does not need the source tree or dev dependencies.
async function bundle(entry: string, outfile: string) {
  await mkdir(dirname(outfile), { recursive: true });
  const result = await Bun.build({
    entrypoints: [entry],
    target: "bun",
    packages: "external",
  });
  if (!result.success)
    throw new AggregateError(result.logs, `Could not bundle ${entry}`);
  if (result.outputs.length !== 1)
    throw new Error(`Expected one output for ${entry}`);
  await Bun.write(outfile, result.outputs[0]!);
}

await bundle("bin/dashy.ts", ".output/dashy.mjs");
await bundle("dashy.config.ts", ".output/dashy.config.js");
for (const name of await listSamples(process.cwd())) {
  const source = join("samples", name);
  const target = join(".output/samples", name);
  await cp(source, target, {
    recursive: true,
    filter: (path) => !/\.(?:ts|tsx|js|mjs)$/.test(path),
  });
  await bundle((await findConfig(source))!, join(target, "dashy.config.js"));
}
console.log("Packaged runtime CLI, project configuration and samples.");
