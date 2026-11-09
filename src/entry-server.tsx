import { randomBytes } from "node:crypto";
import { renderToString, HydrationScript } from "@solidjs/web";
import { App, type AppProps } from "./app";
import { loadImplementation } from "../core/runtime";
import { resolveLocations } from "../core/locations";
import { assertCompiledPages } from "../core/pages";
import { pages } from "virtual:dashy-pages";
import { DashyEngine } from "../core/engine";
import {
  AuthRedirect,
  authenticate,
  createApiHandler,
  errorPage,
  responseHeaders,
  type Authentication,
} from "../core/http";
import { readCrossFilters } from "../core/engine";
import { readDrilldowns } from "../core/drilldown";
import { DashyError, readParams } from "../core/params";
import { readThemeCookie, viewerTheme } from "../core/theme";
import clientAssets from "./entry-client?assets=client";
import serverAssets from "./entry-server?assets=ssr";

const project = await loadImplementation(await resolveLocations());
assertCompiledPages(project, pages);
const engine = new DashyEngine(project);
const api = createApiHandler(engine);
/** Nitro's SSR renderer integration, adapted to Solid 2's @solidjs/web exports.
 * https://nitro.build/examples/vite-ssr-solid
 */
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // Public liveness probe for containers; it reads no data and no configuration.
    if (url.pathname === "/healthz")
      return Response.json({ status: "ok" }, { headers: responseHeaders });
    if (url.pathname.startsWith("/api/")) return api(request);
    if (url.pathname === "/auth" || url.pathname.startsWith("/auth/")) {
      const response = await engine.project.authRoutes?.(request);
      return response ?? errorPage(new DashyError("Page not found", 404));
    }
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    let auth: Authentication | undefined;
    try {
      if (request.url.length > 16_384)
        throw new DashyError("Request URL is too long", 414);
      auth = await authenticate(engine, request, true);
      const principal = auth.principal;
      const catalog = engine.catalog(principal);
      const match = /^\/(dashboards|pages)\/([a-zA-Z][a-zA-Z0-9_-]*)\/?$/.exec(
        url.pathname,
      );
      if (url.pathname !== "/" && !match)
        throw new DashyError("Page not found", 404);
      const kind = match?.[1] ?? (Object.keys(catalog.dashboards).length ? "dashboards" : "pages");
      const id = match?.[2] || Object.keys(kind === "pages" ? catalog.pages ?? {} : catalog.dashboards)[0];
      const raw = readParams(url.searchParams, engine.project.params);
      const theme = viewerTheme(catalog.theme, readThemeCookie(request.headers.get("Cookie")));
      const props: AppProps = {
        catalog,
        theme: theme.name,
        dashboard: id && kind === "dashboards"
          ? engine.dashboardShell(id, raw, principal, {
              crossFilters: readCrossFilters(url.searchParams), drilldowns: readDrilldowns(url.searchParams),
            })
          : null,
        ...(id && kind === "pages" ? { page: engine.pageShell(id, raw, principal) } : {}),
      };
      const Page = props.page ? (await pages[props.page.id]!.load()).default : undefined;
      const nonce = randomBytes(18).toString("base64");
      const appHTML = renderToString(() => <App {...props} Page={Page} />, { nonce });
      const assets = clientAssets.merge(serverAssets, ...(props.page ? [pages[props.page.id]!.assets] : []));
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
            data-theme={theme.name}
            data-corners-inputs={theme.corners.inputs}
            data-corners-buttons={theme.corners.buttons}
            data-corners-panels={theme.corners.panels}
          >
            <head>
              <meta charset="utf-8" />
              <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
              <meta
                name="viewport"
                content="width=device-width, initial-scale=1"
              />
              <title>
                {props.page || props.dashboard
                  ? `${(props.page ?? props.dashboard)!.definition.label} | ${catalog.name}`
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
      const headers = new Headers({
            ...responseHeaders,
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy": `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'${import.meta.env.DEV ? " ws: wss:" : ""}; worker-src 'self'${import.meta.env.DEV ? " blob:" : ""}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
      });
      auth.headers.forEach((value, name) => headers.append(name, value));
      return new Response(
        request.method === "HEAD" ? null : `<!DOCTYPE html>${html}`,
        { headers },
      );
    } catch (error) {
      if (error instanceof AuthRedirect) {
        const headers = new Headers(error.headers);
        headers.set("Location", error.location);
        headers.set("Cache-Control", "no-store");
        return new Response(null, { status: 302, headers });
      }
      return errorPage(error, auth?.headers);
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
