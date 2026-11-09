# Authentication

Dashy has no built-in users. A project either writes its own `authenticate(request)` hook or uses the optional `dashy/auth` module, which provides a signed session cookie, OpenID Connect login and API keys.

```ts
import { defineProject } from "dashy";
import { createAuth } from "dashy/auth";

const finance = (process.env.FINANCE_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase());

export default defineProject({
  name: "Analytics",
  ...createAuth({
    session: { secret: process.env.SESSION_SECRET!, ttlSeconds: 4 * 60 * 60 },
    baseUrl: "https://bi.example.com",
    oidc: {
      issuer: "https://auth.example.com",
      clientId: "analytics",
      clientSecret: process.env.OIDC_CLIENT_SECRET,
      redirectPath: "/auth/callback",
    },
    apiKeys: { file: "/run/secrets/api_keys.csv" },
    roles: (identity) => (identity.email && finance.includes(identity.email) ? ["finance"] : []),
  }),
  // params, sources, queries, datasets, metrics, dashboards …
});
```

`createAuth` returns `{ authenticate, authRoutes }`; spreading it into the project enables both. Its pages (signed out, sign-in errors, access denied) use the viewer's interface language from the `dashy_language` cookie, then `language` (`"en"` or `"pt"`) if set, then the browser's `Accept-Language`, then English. Every query, metric, dataset, dashboard, page and custom API route can declare `roles`, and access requires a match at every level used.

## Session

- **Cookie:** an HS256 JWT named `dashy_session` (configurable), `HttpOnly`, `SameSite=Lax`, and `Secure` when `NODE_ENV=production` unless `secure` is set.
- **Contents:** the subject, e-mail, name and roles.
- **Lifetime:** `ttlSeconds`, default 4 hours. After half the lifetime, the next request renews the cookie.
- **Secret:** at least 32 characters. Rotating it signs out every user.
- **Bearer:** session tokens are also accepted as `Authorization: Bearer <token>`.

## OpenID Connect

| Route | Purpose |
| --- | --- |
| `GET /auth/login?redirect=/dashboards/x` | Starts authorization code flow with PKCE (S256), `state` and `nonce`, kept in a signed 10-minute cookie scoped to `/auth` |
| `GET <redirectPath>` | Exchanges the code, verifies the identity, assigns roles, sets the session and returns to `redirect` |
| `GET /auth/logout` | Clears the session and shows a signed-out page with a link to sign in again |
| `GET /auth/me` | `{ authenticated, roles, email?, name?, subject? }` for the current request |

- **Unauthenticated users:** page requests are redirected to `/auth/login` with the original path. Data requests receive `401`, never a login page.
- **Redirect safety:** only same-site relative paths are followed after login. Anything else returns to `/`.
- **Identity verification:**
  - An `id_token` is verified against the provider's JWKS, with issuer, audience (`clientId`) and nonce checks.
  - Without an `id_token`, the `userinfo` endpoint is used.
  - Otherwise, a JWT access token verified against the JWKS is accepted. OpenAuth uses this; its `properties.email` claim is read.
- **Roles:**
  - `roles(identity)` assigns roles from the verified identity (`subject`, `email`, `name`, `claims`).
  - An empty list denies access with a 403 page and no session.
  - The `*` role is never granted from a sign-in.
- **Behind a proxy:** set `baseUrl` to the public origin. The callback URL is `${baseUrl}${redirectPath}` and must be registered with the provider. Without `baseUrl`, `X-Forwarded-Proto`/`X-Forwarded-Host` or the request origin are used.
- **Client authentication:** `tokenAuthMethod` is `client_secret_basic` (the default with a secret), `client_secret_post`, or `none` for public clients.
- **Callback path:** `redirectPath` must be a path under `/auth/` other than `/auth/login`, `/auth/logout` and `/auth/me`. For example, an existing registration such as `/auth/external/openauth/callback` can be kept.

## API keys

```csv
api_key,role
a6f4…,commercial
a6f4…,finance
91c2…,logistics;finance
```

- **Sending a key:** in an `X-API-Key` header, as `Authorization: Bearer <key>`, or as `?api_key=<key>`.
- **Roles:** a key may appear on several rows; its roles merge. Several roles in one cell are separated by `;` or `|`.
- **File reloads:** the file is reloaded when it changes. Inline keys are also accepted: `apiKeys: { keys: { "key": ["finance"] } }`.
- **Storage:** keys are compared by SHA-256 hash, and the reserved `*` role cannot be granted by a key.
- **Parameter validation:** `api_key` is a reserved query key, so it never fails parameter validation.
- **Pages:** on a page request, `?api_key=` is exchanged for a session cookie and the browser is redirected to the same URL without the key, which keeps it out of history and shared links. Data requests remain stateless.
- **Invalid keys:** receive `401`.

## Development

`createAuth({ disabled: true, session: { secret: "" } })` grants every request the reserved `*` role, which satisfies every role check. Use it only locally.

## Writing your own hook

`authenticate(request)` may return:

- `{ roles }`: a principal;
- `{ principal, headers }`: a principal plus headers to append to the response, such as `Set-Cookie`;
- `{ redirect, headers? }`: a redirect for page requests. Data requests turn it into `401`;
- `null`: `401`.

Throwing a `DashyError` with status 403 denies access with that status. `authRoutes(request)` receives every `/auth/*` request before authentication; return `undefined` for 404.
