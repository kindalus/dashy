#!/usr/bin/env bun
/**
 * A host application for trying embeds. Like a real host, its server mints tokens
 * with an API key that never reaches the browser, then serves a page with an SVG
 * <img> and <iframe>s that resize to their content.
 *
 *   bun run start --with-sample maven-analytics --port 3730
 *   bun scripts/embed-host.ts --dashy http://127.0.0.1:3730 --port 3731
 *
 * Maven lets http://localhost:3731 and http://127.0.0.1:3731 frame its embeds. Start
 * a second host on another port (say 3732) to see the browser refuse the frames.
 */
import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    dashy: { type: "string", default: "http://127.0.0.1:3730" },
    port: { type: "string", default: "3731" },
    dashboard: { type: "string", default: "gallery" },
    dataset: { type: "string", default: "categories" },
    params: { type: "string", default: "{}" },
    language: { type: "string" },
    theme: { type: "string" },
  },
});
const dashy = values.dashy!.replace(/\/$/, "");
const key = process.env.DASHY_API_KEY ?? process.env.MAVEN_API_KEY ?? "maven-sample-api-key";
const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function mint(body: Record<string, unknown>) {
  const response = await fetch(`${dashy}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Dashy-Request": "1", "X-API-Key": key },
    body: JSON.stringify({
      params: JSON.parse(values.params!),
      ...(values.language ? { language: values.language } : {}),
      ...(values.theme ? { theme: values.theme } : {}),
      ...body,
    }),
  });
  if (!response.ok) throw new Error(`Mint failed with ${response.status}: ${await response.text()}`);
  return await response.json() as { token: string; expiresAt: string; urls: { iframe: string; svg: string[] } };
}

const server = Bun.serve({
  port: Number(values.port),
  hostname: "127.0.0.1",
  async fetch(request) {
    if (new URL(request.url).pathname !== "/") return new Response("Not found", { status: 404 });
    try {
      // Fresh tokens on every page load; their parameters stay fixed.
      const board = await mint({ dashboard: values.dashboard, ttlSeconds: 600 });
      const single = await mint({ dataset: values.dataset, ttlSeconds: 600 });
      const host = new URL(request.url).host;
      const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashy embed host</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; padding: 24px 16px; background: #eef1f5; color: #1d2433; }
  section { max-width: 1100px; margin: 0 auto 32px; }
  h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 0 0 8px; }
  img { display: block; max-width: 100%; height: auto; border: 1px solid #d5dae1; }
  iframe { display: block; width: 100%; height: 400px; border: 1px solid #d5dae1; background: #fff; }
</style>
</head>
<body>
<section>
  <h1>Host application on ${escape(host)}</h1>
  <p>Tokens minted server-side for <code>${escape(values.dashboard!)}</code> and <code>${escape(values.dataset!)}</code>, valid until ${escape(board.expiresAt)}.</p>
</section>
<section>
  <h2>Static SVG</h2>
  <img id="dashy-svg" src="${escape(dashy + single.urls.svg[0])}" width="800" height="400" alt="${escape(values.dataset!)} chart">
</section>
<section>
  <h2>Interactive dashboard</h2>
  <iframe id="dashy-dashboard" src="${escape(dashy + board.urls.iframe)}" title="${escape(values.dashboard!)} dashboard"></iframe>
</section>
<section>
  <h2>Single dataset</h2>
  <iframe id="dashy-dataset" src="${escape(dashy + single.urls.iframe)}" title="${escape(values.dataset!)}"></iframe>
</section>
<script>
  // Size each Dashy frame to its content (see docs/embedding.md).
  window.addEventListener("message", (event) => {
    if (event.origin !== ${JSON.stringify(new URL(dashy).origin)} || event.data?.type !== "dashy:resize") return;
    for (const frame of document.querySelectorAll("iframe"))
      if (frame.contentWindow === event.source) frame.style.height = event.data.height + "px";
  });
</script>
</body>
</html>`;
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    } catch (error) {
      return new Response(String(error), { status: 502 });
    }
  },
});
console.log(`Embed host on http://127.0.0.1:${server.port}, framing ${dashy}`);
