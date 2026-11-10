# Embedding

Dashy charts and dashboards can appear inside another application in two forms,
both opened with the same signed token:

| Form | URL | What the viewer gets |
| --- | --- | --- |
| Static SVG | `/api/datasets/<dataset>?_format=svg&token=…` | One dataset chart, drawn on the server, with its title and filter caption. Works in `<img>`, e-mails and documents. |
| Interactive iframe | `/embed/dashboards/<dashboard>?token=…` or `/embed/datasets/<dataset>?token=…` | The dashboard's blocks (or one dataset block), live. |

In the iframe the viewer interacts **only with the mouse**: tooltips, cross-filter
between the embedded blocks and drill-down inside a block, with its breadcrumb.
There is no filter bar, no drillthrough to other dashboards, no block toolbar
(download, chart or table, Top N, print), no sidebar, top bar, theme or language
picker, and no link back into the workspace.

## Concepts

- **Your server mints tokens.** Only a principal authenticated with an **API key**
  (server to server) can mint. Browser sessions, OpenID Connect sessions and embed
  tokens cannot. Never send the API key to a browser.
- **A token names one resource**: one dashboard or one dataset. It opens that
  resource's embed page, the data requests behind it, and the SVG images of its
  datasets. Everything else returns 403.
- **A token carries the minting key's roles**, so every role check of the
  dashboard, dataset, metric and query still applies.
- **Parameters fixed in the token can never change.** They override request values,
  cross-filters on them are ignored and drill-down cannot widen them. Every other
  parameter starts at the dashboard's default and changes only through cross-filter
  and drill-down clicks. The browser sends those values with its requests, so a
  determined viewer can edit them: **fix in the token every parameter that must not
  change.**
- **Tokens expire.** The default lifetime is 600 seconds; the project sets the
  maximum. An expired token returns 401; mint a new one and reload the frame.

## Configuration

```ts
import { defineProject } from "dashy";
import { createAuth } from "dashy/auth";

export default defineProject({
  name: "Analytics",
  ...createAuth({
    session: { secret: process.env.SESSION_SECRET! },
    apiKeys: { file: "/run/secrets/api_keys.csv" }, // keys of the applications that embed
    // oidc, roles … for people using the workspace
  }),
  embed: {
    secret: process.env.DASHY_EMBED_SECRET!,       // at least 32 characters
    origins: ["https://portal.example.com"],       // pages allowed to frame the iframe
    maxTtlSeconds: 3600,                           // default 86 400 (one day), at most 30 days
  },
  // params, sources, queries, datasets, metrics, dashboards …
});
```

| Field | Meaning |
| --- | --- |
| `secret` | HS256 signing secret, at least 32 characters. Rotating it revokes every token. Keep it apart from the session secret. |
| `origins` | Exact origins allowed to frame embed pages (`frame-ancestors`): scheme, host and optional port, without path or trailing slash. `https` only, except `http://localhost`, `http://127.0.0.1` and `http://[::1]` for development. Without it no page can frame them. SVG images do not depend on it. |
| `maxTtlSeconds` | Longest lifetime a mint may request: a positive integer up to 2 592 000 (30 days). Default 86 400. |

Invalid values stop the server at startup with `Invalid Dashy embed: …`. Without
`embed`, embedding is disabled: `POST /api/embed` and `/embed/*` return 404 and a
`token` query value is ignored, so normal authentication applies.

A project with its own `authenticate` hook marks server-to-server keys with
`via: "api-key"` on the principal it returns; see [authentication](auth.md#principals).

## Minting a token

```sh
curl -s https://bi.example.com/api/embed \
  -H 'X-API-Key: a6f4…' \
  -H 'X-Dashy-Request: 1' \
  -H 'Content-Type: application/json' \
  -d '{
        "dashboard": "sales",
        "params": { "region": "North", "period": { "from": "2026-01-01", "until": "2026-06-30" } },
        "ttlSeconds": 900,
        "language": "pt",
        "theme": "excel"
      }'
```

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…",
  "expiresAt": "2026-11-10T10:15:00.000Z",
  "urls": {
    "iframe": "/embed/dashboards/sales?token=eyJ…",
    "svg": ["/api/datasets/revenue_by_month?_format=svg&token=eyJ…", "/api/datasets/categories?_format=svg&token=eyJ…"]
  }
}
```

The body takes exactly one of `dashboard` or `dataset`:

| Field | Meaning |
| --- | --- |
| `dashboard` or `dataset` | The resource. The key must read it at every level: the dashboard and each block's metric or dataset and queries (drill-down levels included), or the dataset and its queries. |
| `params` | Values to fix, validated like request values. Names must be parameters the resource accepts: the dashboard's filters, or the dataset's own. Ranges are `{ from, until }`, arrays are lists. An empty value (`""`, `null`, `[]`) fixes the parameter as cleared ("All"). Required parameters, including a dashboard's `required`, must resolve from the token or defaults. |
| `ttlSeconds` | Lifetime, default 600 (or the maximum when lower). |
| `language` | `en` or `pt`, among the languages the project offers. Default the project's language. |
| `theme` | A theme the project offers (`theme.name` or `theme.selectable`). Default the project theme. |

`urls` are relative to Dashy's origin. `svg` lists every charted dataset of the
dashboard, once each (or the one dataset). Errors: 403 for a principal that did not
use an API key or cannot read the resource, 404 for an unknown resource, 400 for an
invalid body, parameter, lifetime, language or theme. Like every write request, the
call needs `X-Dashy-Request: 1`; a browser can only send it from Dashy's own origin.

The token is an HS256 JWT (`aud: "dashy-embed"`) with the claims `resource`
(`{ kind, name }`), `params` (the fixed values), `roles` (the key's), `sub` (the key's
subject), `language`, `theme`, `iat` and `exp`. Treat it as a bearer credential for
what it shows: anyone holding it can open that resource until it expires.

## Static SVG

```html
<img src="https://bi.example.com/api/datasets/categories?_format=svg&_width=640&_height=360&token=eyJ…"
     width="640" height="360" alt="Sales by category">
```

`GET /api/datasets/:name?_format=svg` also works with normal authentication (an API
key, a session), without a token.

| Key | Meaning |
| --- | --- |
| `_width`, `_height` | Size of the whole image, title and caption included. Default 800 × 400; clamped to 200–2000 × 150–1500. |
| `_theme`, `_lang` | Theme and language without a token; they must be offered by the project. A token's values win. |
| Parameters | The dataset's parameters, as in its JSON endpoint. Fixed values win. A dashboard token's datasets start from the dashboard's values and defaults, so the image matches the iframe. |

The chart is the block as it first appears: the top drill-down level, Top N's
initial choice with its "Other" row, in the theme's colours. Numbers and dates use
the project locale for the chosen language. The title is the dataset's label; the
caption lists the parameters that narrow it. Datasets without a chart return 400
(JSON). Responses carry `Content-Type: image/svg+xml; charset=utf-8`,
`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'` (no scripts),
`X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: cross-origin` and
`Cache-Control: private, max-age=<n>`, where `n` is the result cache's lifetime (0
without a cache), never past the token's expiry.

## Interactive iframe

```html
<iframe id="sales" src="https://bi.example.com/embed/dashboards/sales?token=eyJ…"
        title="Sales" style="width: 100%; height: 600px; border: 0"></iframe>
<script>
  // Size each Dashy frame to its content.
  addEventListener("message", (event) => {
    if (event.origin !== "https://bi.example.com" || event.data?.type !== "dashy:resize") return;
    for (const frame of document.querySelectorAll("iframe"))
      if (frame.contentWindow === event.source) frame.style.height = `${event.data.height}px`;
  });
</script>
```

The page is rendered on the server in the token's theme and language, with every
block in place, then loads its data like a dashboard. It sends the token in an
`X-Dashy-Embed` header to `/api/embed/shell` and `/api/embed/data/:request`, never
with cookies, which browsers often block in third-party frames. Whenever its content
height changes it posts `{ type: "dashy:resize", height }` to the parent window.

A dataset embed shows one full-width block. It drills down but does not
cross-filter. Extra query keys on the iframe URL (parameters, `_xf`, `_dd`) set the
initial state of non-fixed parameters.

Embed pages send `Content-Security-Policy` with `frame-ancestors` set to `embed.origins`
(`'none'` without origins), `Referrer-Policy: no-referrer` and no `X-Frame-Options`.
An invalid, expired or missing token shows a short page, in the token's language (or
the browser's), with status 401 and no links.

## Security model

- **Mint on your server, per viewer.** Fix every parameter that scopes what the
  viewer may see: tenant, customer, region. Values not fixed can be changed by the
  viewer.
- **Blocks listed in a dashboard's `unfiltered`** ignore those parameters by design,
  even when the token fixes them. Do not embed such blocks when the parameter limits
  what a viewer may see.
- **Short lifetimes.** Prefer the default 10 minutes and mint again when the host
  page loads. Tokens cannot be revoked one by one; rotating `embed.secret` revokes all.
- **Scope.** A token opens only its resource. The catalog, other dashboards,
  datasets, queries, metrics, parameter options, exports and custom API routes return
  403, and the workspace pages refuse it. Its embed page receives only its own
  definition, never the rest of the workspace.
- **Roles.** Tokens carry the minting key's roles; give embedding keys only the roles
  of what they embed.
- **No cookies.** An embed token never creates or renews a session cookie.
- **Framing.** Only `embed.origins` can frame embed pages; the workspace still
  refuses all framing.

## Limitations

- The SVG is static: no tooltips, clicks or animation. It names fonts from the
  theme but does not embed web fonts, so text uses the viewer's installed fonts.
- An embed shows what a dashboard block shows: no table/chart switch, downloads,
  Top N choices or printing.
- A theme added to a project after its build (only possible for runtime
  configurations) draws SVG charts with its base theme's colours, or the default
  theme's.
