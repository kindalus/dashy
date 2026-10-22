import { randomBytes } from "node:crypto";
import { renderToString, HydrationScript } from "@solidjs/web";
import { App, type AppProps } from "./app";
import defaultProject from "../dashy.config";
import { loadProject } from "../core/runtime";
import { DashyEngine } from "../core/engine";
import {
  authenticate,
  createApiHandler,
  errorResponse,
  responseHeaders,
} from "../core/http";
import { DashyError, readParams } from "../core/params";
import clientAssets from "./entry-client?assets=client";
import serverAssets from "./entry-server?assets=ssr";

const project = process.env.DASHY_CONFIG
  ? await loadProject(
      process.env.DASHY_CONFIG,
      process.env.DASHY_THEME || undefined,
    )
  : defaultProject;
const engine = new DashyEngine(project);
const api = createApiHandler(engine);
/** Nitro's SSR renderer integration, adapted to Solid 2's @solidjs/web exports.
 * https://nitro.build/examples/vite-ssr-solid
 */
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return api(request);
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    try {
      if (request.url.length > 16_384)
        throw new DashyError("Request URL is too long", 414);
      const principal = await authenticate(engine, request);
      const catalog = engine.catalog(principal);
      const match = /^\/dashboards\/([a-zA-Z][a-zA-Z0-9_-]*)\/?$/.exec(
        url.pathname,
      );
      if (url.pathname !== "/" && !match)
        throw new DashyError("Page not found", 404);
      const id = match?.[1] || Object.keys(catalog.dashboards)[0];
      const raw = readParams(url.searchParams, engine.project.params);
      const props: AppProps = {
        catalog,
        dashboard: id ? await engine.dashboard(id, raw, principal) : null,
      };
      const nonce = randomBytes(18).toString("base64");
      const appHTML = renderToString(() => <App {...props} />, { nonce });
      const assets = clientAssets.merge(serverAssets);
      const data = JSON.stringify(props)
        .replaceAll("<", "\\u003c")
        .replaceAll(">", "\\u003e")
        .replaceAll("&", "\\u0026")
        .replaceAll("\u2028", "\\u2028")
        .replaceAll("\u2029", "\\u2029");
      const html = renderToString(
        () => (
          <html
            lang={catalog.locale.split("-")[0]}
            data-theme={catalog.theme.name}
            data-corners-inputs={catalog.theme.corners.inputs}
            data-corners-buttons={catalog.theme.corners.buttons}
            data-corners-panels={catalog.theme.corners.panels}
          >
            <head>
              <meta charset="utf-8" />
              <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
              <meta
                name="viewport"
                content="width=device-width, initial-scale=1"
              />
              <title>
                {props.dashboard
                  ? `${props.dashboard.definition.label} | ${catalog.name}`
                  : catalog.name}
              </title>
              <ForAssets assets={assets} />
            </head>
            <body>
              <div id="app" innerHTML={appHTML} />
              <script
                id="dashy-data"
                type="application/json"
                innerHTML={data}
              />
              <HydrationScript nonce={nonce} />
              <script nonce={nonce} type="module" src={assets.entry} />
            </body>
          </html>
        ),
        { nonce },
      );
      return new Response(
        request.method === "HEAD" ? null : `<!DOCTYPE html>${html}`,
        {
          headers: {
            ...responseHeaders,
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy": `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'${import.meta.env.DEV ? " ws: wss:" : ""}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
          },
        },
      );
    } catch (error) {
      return errorResponse(error);
    }
  },
};
function ForAssets(props: {
  assets: { css: { href: string }[]; js: { href: string }[] };
}) {
  return (
    <>
      {props.assets.css.map((asset) => (
        <link rel="stylesheet" {...asset} />
      ))}
      {props.assets.js.map((asset) => (
        <link rel="modulepreload" {...asset} />
      ))}
    </>
  );
}
