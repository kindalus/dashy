import { afterAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { listSamples, loadProject, selectConfig } from "../core/runtime";

const root = await mkdtemp(join(tmpdir(), "dashy-runtime-"));
const empty = {
  name: "Empty",
  params: {},
  sources: {},
  queries: {},
  datasets: {},
  metrics: {},
  dashboards: {},
};
const config = (name: string, extra = {}) =>
  `export default ${JSON.stringify({ ...empty, name, ...extra })};`;
await writeFile(join(root, "dashy.config.ts"), config("Own project"));
for (const name of ["alpha", "beta", "incomplete"])
  await mkdir(join(root, "samples", name), { recursive: true });
await writeFile(
  join(root, "samples/alpha/dashy.config.ts"),
  config("Alpha", { dataDir: "./data" }),
);
await writeFile(join(root, "samples/beta/dashy.config.js"), config("Beta"));
afterAll(() => rm(root, { recursive: true, force: true }));

test("default project ships with no sources, queries, metrics, datasets or dashboards", async () => {
  const project = await loadProject(await selectConfig(process.cwd()));
  for (const name of [
    "params",
    "sources",
    "queries",
    "datasets",
    "metrics",
    "dashboards",
  ] as const)
    expect(project[name]).toEqual({});
});

test("discovers immediate runnable samples and loads relative data paths in place", async () => {
  expect(await listSamples(root)).toEqual(["alpha", "beta"]);
  const before = await readFile(join(root, "dashy.config.ts"), "utf8");
  expect((await loadProject(await selectConfig(root, "alpha"))).dataDir).toBe(
    join(root, "samples/alpha/data"),
  );
  expect((await loadProject(await selectConfig(root, "beta"))).name).toBe(
    "Beta",
  );
  expect((await loadProject(await selectConfig(root))).name).toBe(
    "Own project",
  );
  expect(await readFile(join(root, "dashy.config.ts"), "utf8")).toBe(before);
});

test("missing, incomplete, empty and traversal sample names fail with available names", async () => {
  for (const name of [
    "missing",
    "incomplete",
    "",
    "../alpha",
    "/tmp",
    "constructor",
  ]) {
    await expect(selectConfig(root, name)).rejects.toThrow(
      "Available samples: alpha, beta",
    );
  }
  expect(await listSamples(join(root, "nowhere"))).toEqual([]);
});

test("invalid configuration reports a useful error before the server starts", async () => {
  const path = join(root, "invalid.ts");
  await writeFile(path, "export default {};");
  await expect(loadProject(path)).rejects.toThrow(
    "must define a params registry",
  );
});

test("runtime theme selection overrides configured corners without modifying the project", async () => {
  const path = join(root, "themed.ts");
  const original = config("Themed", {
    theme: { name: "excel", corners: "none" },
  });
  await writeFile(path, original);
  expect((await loadProject(path, "chromeos")).theme).toEqual({
    name: "chromeos",
    corners: { inputs: "rounded", buttons: "rounded", panels: "rounded" },
  });
  expect((await loadProject(path)).theme).toEqual({
    name: "excel",
    corners: "none",
  });
  expect(await readFile(path, "utf8")).toBe(original);
  await expect(loadProject(path, "unknown")).rejects.toThrow(
    "unknown name 'unknown'",
  );
});

async function cli(args: string[], cwd = root) {
  const child = Bun.spawn(
    [process.execPath, resolve("bin/dashy.ts"), ...args],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, out, err };
}

test("CLI lists the filesystem samples and rejects missing names and invalid arguments", async () => {
  expect(await cli(["samples"])).toEqual({
    code: 0,
    out: "alpha\nbeta\n",
    err: "",
  });
  for (const command of ["start", "dev"]) {
    const result = await cli([command, "--with-sample", "missing"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("Available samples: alpha, beta");
    for (const name of ["unknown", ""]) {
      const invalidTheme = await cli([command, `--theme=${name}`]);
      expect(invalidTheme.code).toBe(1);
      expect(invalidTheme.err).toContain(
        "Choose excel, chromeos, chatgpt, claude-code, macos",
      );
    }
  }
  for (const args of [
    ["start", "--with-sample"],
    ["start", "--with-sample="],
    ["start", "--port", "-1"],
    ["start", "--port", "65536"],
    ["start", "--unknown"],
    ["start", "--theme"],
    ["dev", "--theme"],
    ["samples", "--theme", "excel"],
    ["start", "extra"],
  ])
    expect((await cli(args)).code).toBe(1);
  const noBuild = await cli(["start"]);
  expect(noBuild.code).toBe(1);
  expect(noBuild.err).toContain("Production build not found");
});

test("CLI reports missing data instead of opening a broken sample", async () => {
  const dir = join(root, "samples/broken-data");
  await mkdir(dir);
  try {
    await writeFile(
      join(dir, "dashy.config.ts"),
      config("Broken", {
        sources: { orders: { type: "csv", path: "missing.csv" } },
      }),
    );
    const result = await cli(["start", "--with-sample", "broken-data"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("Missing source file");
  } finally {
    await rm(dir, { recursive: true });
  }
});
