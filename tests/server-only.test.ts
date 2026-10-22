import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serverOnlyPlugin } from "../scripts/server-only-plugin";
import { resolveLocations } from "../core/locations";

test("browser modules and direct dev URLs cannot expose server handlers or their local dependencies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dashy-api-private-"));
  try {
    await mkdir(join(directory, "extensions/api"), { recursive: true });
    await writeFile(join(directory, "dashy.config.ts"), "export default { name: 'Private', params: {}, sources: {}, queries: {}, metrics: {}, datasets: {}, dashboards: {} };");
    await writeFile(join(directory, "private-helper.ts"), "export const privateValue = 'server-private-marker';");
    await writeFile(join(directory, "extensions/api/index.ts"), "import { privateValue } from '../../private-helper'; export default { hello: { method: 'GET', path: '/hello', handler: () => new Response(privateValue) } };");
    await symlink(join(directory, "private-helper.ts"), join(directory, "public-alias.ts"));
    const plugin = await serverOnlyPlugin(await resolveLocations({ env: { DASHY_PROJECT_DIR: directory } }));
    const load = plugin.load as Function;
    for (const path of ["extensions/api/index.ts", "private-helper.ts", "public-alias.ts", "dashy.config.ts"])
      await expect(load.call({ environment: { config: { consumer: "client" } } }, join(directory, path) + "?raw")).rejects.toThrow("server-only");
    await load.call({ environment: { config: { consumer: "server" } } }, join(directory, "extensions/api/index.ts"));
    let middleware!: Function;
    (plugin.configureServer as Function)({ config: { root: directory }, middlewares: { use(callback: Function) { middleware = callback; } } });
    for (const url of ["/extensions/api/index.ts", `/@fs/${directory}/private-helper.ts?raw`, "/extensions/%61pi/index.ts?url", "/public-alias.ts"]) {
      const result = { statusCode: 0, end() {} };
      let next = false;
      await middleware({ url }, result, () => { next = true; });
      expect(result.statusCode).toBe(403);
      expect(next).toBe(false);
    }
    let next = false;
    await middleware({ url: "/api/custom/hello" }, {}, () => { next = true; });
    expect(next).toBe(true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("server import tracing protects in-repository files reported relative to cwd", async () => {
  const plugin = await serverOnlyPlugin(await resolveLocations({ sample: "maven-analytics", env: {} }));
  await expect((plugin.load as Function).call({ environment: { config: { consumer: "client" } } }, join(process.cwd(), "samples/maven-analytics/queries.ts"))).rejects.toThrow("server-only");
});
