import { randomBytes } from "node:crypto";
import { renderToString, HydrationScript } from "@solidjs/web";
import type { Component } from "solid-js";
import { App, type AppProps } from "./app";
import type { PageProps } from "./extension-api";
import { loadImplementation } from "../core/runtime";
import { resolveLocations } from "../core/locations";
import { assertCompiledPages } from "../core/pages";
import { pages } from "virtual:dashy-pages";
import themeTokens from "virtual:dashy-theme-tokens";
import { DashyEngine } from "../core/engine";
import {
  AuthRedirect,
  authenticate,
  createApiHandler,
  embedErrorPage,
  embedPageHeaders,
  errorPage,
  requestLanguage,
  responseHeaders,
  type Authentication,
} from "../core/http";
import { readCrossFilters } from "../core/engine";
import { readDrilldowns } from "../core/drilldown";
import { DashyError, readParams } from "../core/params";
import { readThemeCookie, viewerTheme } from "../core/theme";
import { acceptedLanguage, messages, type Language } from "../core/i18n";
import { embedAllows, presentedToken, untrustedLanguage } from "../core/embed";
import type { Catalog, DashboardShell } from "../core/types";
import clientAssets from "./entry-client?assets=client";
import serverAssets from "./entry-server?assets=ssr";

const project = await loadImplementation(await resolveLocations());
assertCompiledPages(project, pages);
const engine = new DashyEngine(project);
const api = createApiHandler(engine, { themeTokens });

/** The app's policy; embed pages replace its frame-ancestors with the configured origins. */
const contentPolicy = (nonce: string) =>
  `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'${import.meta.env.DEV ? " ws: wss:" : ""}; worker-src 'self'${import.meta.env.DEV ? " blob:" : ""}; object-src 'none'; base-uri 'none'`;

/** The full HTML document for the app's props, with hydration data and a fresh nonce. */
function renderDocument(
  props: AppProps,
  Page: Component<PageProps> | undefined,
  theme: ReturnType<typeof viewerTheme>,
  title: string,
): { html: string; nonce: string } {
  const nonce = randomBytes(18).toString("base64");
  const language = props.language ?? "en";
  const appHTML = renderToString(() => <App {...props} Page={Page} />, { nonce });
  const assets = clientAssets.merge(serverAssets, ...(props.page ? [pages[props.page.id]!.assets] : []));
  const data = JSON.stringify(props)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll(" ", "\\u2028")
    .replaceAll(" ", "\\u2029");
  const html = renderToString(
    () => (
      <html
        lang={language}
        data-theme={theme.attribute}
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
          <title>{title}</title>
          <ForAssets assets={assets} />
        </head>
        <body>
          {/* Outside the hydrated app: browsers without scripts never hydrate, so its text can follow the language. */}
          {props.dashboard && <noscript><p class="noscript-note">{messages[language].enableJavaScript}</p></noscript>}
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
  return { html: `<!DOCTYPE html>${html}`, nonce };
}

/**
 * What an embed page's browser code receives: its own dashboard and the parameters
 * it uses, never the rest of the workspace (other dashboards, datasets, pages).
 */
function embedCatalog(catalog: Catalog, shell: DashboardShell, dashboard: boolean): Catalog {
  const names = shell.definition.params ?? [];
  return {
    ...catalog,
    description: undefined,
    pages: {},
    dashboards: dashboard && catalog.dashboards[shell.id] ? { [shell.id]: catalog.dashboards[shell.id]! } : {},
    datasets: {},
    params: Object.fromEntries(names.filter((name) => catalog.params[name]).map((name) => [name, catalog.params[name]!])),
  };
}

/** /embed/dashboards/:name and /embed/datasets/:name, opened with ?token=. */
async function embedPage(request: Request, url: URL): Promise<Response> {
  const token = presentedToken(request);
  const language: Language = untrustedLanguage(token) ?? acceptedLanguage(request.headers.get("accept-language"))
    ?? requestLanguage(engine, request);
  try {
    if (request.url.length > 16_384) throw new DashyError("Request URL is too long", 414);
    const match = /^\/embed\/(dashboards|datasets)\/([a-zA-Z][a-zA-Z0-9_-]*)\/?$/.exec(url.pathname);
    if (!engine.project.embed || !match) throw new DashyError("Page not found", 404);
    if (!token) throw new DashyError("Embed token required", 401);
    const auth = await authenticate(engine, request, true);
    const claims = auth.embed!;
    if (!embedAllows(engine, claims, url.pathname.replace(/\/$/, ""))) throw new DashyError("Access denied", 403);
    const shell = engine.embedShell(claims.resource, readParams(url.searchParams, engine.project.params), auth.principal, {
      crossFilters: readCrossFilters(url.searchParams), drilldowns: readDrilldowns(url.searchParams), fixed: claims.params,
    });
    const catalog = engine.catalog(auth.principal);
    const theme = viewerTheme(catalog.theme, claims.theme);
    const props: AppProps = {
      catalog: embedCatalog(catalog, shell, claims.resource.kind === "dashboard"),
      theme: theme.name,
      language: claims.language,
      dashboard: shell,
      embed: { kind: claims.resource.kind, name: claims.resource.name, token: token!, fixed: Object.keys(claims.params) },
    };
    const { html, nonce } = renderDocument(props, undefined, theme, `${shell.definition.label} | ${catalog.name}`);
    return new Response(request.method === "HEAD" ? null : html, {
      headers: embedPageHeaders(engine.project.embed, contentPolicy(nonce)),
    });
  } catch (error) {
    return embedErrorPage(error, engine.project.embed, language);
  }
}

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
      return response ?? errorPage(new DashyError("Page not found", 404), undefined, requestLanguage(engine, request));
    }
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    if (url.pathname === "/embed" || url.pathname.startsWith("/embed/")) return embedPage(request, url);
    let auth: Authentication | undefined;
    try {
      if (request.url.length > 16_384)
        throw new DashyError("Request URL is too long", 414);
      auth = await authenticate(engine, request, true);
      // An embed token opens its embed page only, never the workspace.
      if (auth.embed) throw new DashyError("Access denied", 403);
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
      // The viewer's language reaches the first response, like the theme: no flash of the other language.
      const language = requestLanguage(engine, request);
      const props: AppProps = {
        catalog,
        theme: theme.name,
        language,
        dashboard: id && kind === "dashboards"
          ? engine.dashboardShell(id, raw, principal, {
              crossFilters: readCrossFilters(url.searchParams), drilldowns: readDrilldowns(url.searchParams),
            })
          : null,
        ...(id && kind === "pages" ? { page: engine.pageShell(id, raw, principal) } : {}),
      };
      const Page = props.page ? (await pages[props.page.id]!.load()).default : undefined;
      const title = props.page || props.dashboard
        ? `${(props.page ?? props.dashboard)!.definition.label} | ${catalog.name}`
        : catalog.name;
      const { html, nonce } = renderDocument(props, Page, theme, title);
      const headers = new Headers({
        ...responseHeaders,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `${contentPolicy(nonce)}; frame-ancestors 'none'`,
      });
      auth.headers.forEach((value, name) => headers.append(name, value));
      return new Response(
        request.method === "HEAD" ? null : html,
        { headers },
      );
    } catch (error) {
      if (error instanceof AuthRedirect) {
        const headers = new Headers(error.headers);
        headers.set("Location", error.location);
        headers.set("Cache-Control", "no-store");
        return new Response(null, { status: 302, headers });
      }
      return errorPage(error, auth?.headers, requestLanguage(engine, request));
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
