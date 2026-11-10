/**
 * Embedding with signed tokens: a static SVG of one charted dataset, and an
 * interactive iframe of a dashboard or a single dataset. Server-only.
 *
 * A token is an HS256 JWT signed with `embed.secret` (audience `dashy-embed`). It
 * names one resource, the parameters it fixes, the roles of the API key that
 * minted it, its subject, language and theme. Only API-key principals mint.
 */
import { decodeJwt, jwtVerify, SignJWT, errors as joseErrors } from "jose";
import type { DashyEngine, EmbedResource } from "./engine.ts";
import { resolveEmbed } from "./embed-config.ts";
import { DashyError, parseParams } from "./params.ts";
import { resolveTheme } from "./theme.ts";
import { isLanguage, resolveLanguage, type Language } from "./i18n.ts";
import type { Params, Principal } from "./types.ts";

export const embedAudience = "dashy-embed";
export const defaultEmbedTtl = 600;
/** Header carrying the token on the iframe's data requests (cookies are blocked in third-party frames). */
export const embedHeader = "X-Dashy-Embed";
const encoder = new TextEncoder();

export interface EmbedClaims {
  resource: EmbedResource;
  /** Values no request can change. Null fixes a parameter as cleared ("All"). */
  params: Params;
  roles: string[];
  subject?: string;
  language: Language;
  theme: string;
  /** Expiry, in seconds since the epoch. */
  expiresAt: number;
}
export interface EmbedMint {
  token: string;
  expiresAt: string;
  urls: { iframe: string; svg: string[] };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const pagePath = (resource: EmbedResource) =>
  `/embed/${resource.kind === "dashboard" ? "dashboards" : "datasets"}/${encodeURIComponent(resource.name)}`;

function config(engine: DashyEngine) {
  const embed = resolveEmbed(engine.project.embed);
  if (!embed) throw new DashyError("Endpoint not found", 404);
  return embed;
}

/** The token a request presents: the X-Dashy-Embed header, else `?token=`. */
export function presentedToken(request: Request): string | undefined {
  const header = request.headers.get(embedHeader)?.trim();
  if (header) return header;
  return new URL(request.url).searchParams.get("token")?.trim() || undefined;
}

/** The language a token asks for, without verifying it; for error pages only. */
export function untrustedLanguage(token: string | undefined): Language | undefined {
  if (!token) return undefined;
  try {
    const language = decodeJwt(token).language;
    return isLanguage(language) ? language : undefined;
  } catch {
    return undefined;
  }
}

/** Datasets an embed can read through /api/datasets: the dataset, or the dashboard's dataset blocks. */
export function embedDatasets(engine: DashyEngine, resource: EmbedResource): string[] {
  if (resource.kind === "dataset") return [resource.name];
  const dashboard = engine.project.dashboards[resource.name];
  return [...new Set((dashboard?.blocks ?? []).flatMap((block) => block.type === "dataset" ? [block.dataset] : []))];
}

/** Parameters a resource accepts: the dashboard's filters, or the dataset's own. */
function acceptedParams(engine: DashyEngine, resource: EmbedResource): string[] {
  return resource.kind === "dashboard"
    ? [...(engine.project.dashboards[resource.name]!.params ?? [])]
    : engine.datasetParams(resource.name);
}

/**
 * Validates a mint request and signs its token. Only API-key principals can mint,
 * only for what they can read, with parameters validated like a request's.
 */
export async function mintEmbed(engine: DashyEngine, principal: Principal | undefined, body: unknown): Promise<EmbedMint> {
  const embed = config(engine);
  if (principal?.via !== "api-key") throw new DashyError("Embed tokens can only be minted with an API key", 403);
  if (!isObject(body)) throw new DashyError("Expected a JSON object");
  for (const key of Object.keys(body))
    if (!["dashboard", "dataset", "params", "ttlSeconds", "language", "theme"].includes(key))
      throw new DashyError(`Unknown field: ${key}`);
  if ((body.dashboard === undefined) === (body.dataset === undefined))
    throw new DashyError("Give exactly one of dashboard or dataset");
  const kind = body.dashboard !== undefined ? "dashboard" : "dataset";
  const name = body[kind];
  if (typeof name !== "string" || !name) throw new DashyError(`${kind} must be a name`);
  const resource: EmbedResource = { kind, name };
  engine.assertEmbedReadable(resource, principal);

  const raw = body.params ?? {};
  if (!isObject(raw)) throw new DashyError("params must be an object of parameter values");
  const accepted = acceptedParams(engine, resource);
  for (const key of Object.keys(raw))
    if (!accepted.includes(key)) throw new DashyError(`Unknown parameter: ${key}`);
  const definitions = engine.project.params;
  const parsed = parseParams(definitions, Object.keys(raw), raw, {}, engine.today());
  const params: Params = {};
  // A key given with an empty value fixes the parameter as cleared.
  for (const key of Object.keys(raw)) params[key] = Object.hasOwn(parsed, key) ? parsed[key]! : null;
  // The embed has no filter bar: everything it needs must resolve from the token and defaults.
  const dashboard = kind === "dashboard" ? engine.project.dashboards[name]! : undefined;
  const resolved = parseParams(definitions, accepted, params, dashboard?.defaults, engine.today());
  const missing = (dashboard?.required ?? []).find((param) => !Object.hasOwn(resolved, param));
  if (missing) throw new DashyError(`${definitions[missing]!.label} is required: fix it in the token, embeds have no filters`);

  const ttl = body.ttlSeconds ?? Math.min(defaultEmbedTtl, embed.maxTtlSeconds);
  if (typeof ttl !== "number" || !Number.isInteger(ttl) || ttl < 1)
    throw new DashyError("ttlSeconds must be a positive integer");
  if (ttl > embed.maxTtlSeconds) throw new DashyError(`ttlSeconds must be at most ${embed.maxTtlSeconds}`);
  const languages = resolveLanguage(engine.project);
  const language = body.language ?? languages.name;
  if (!isLanguage(language) || (language !== languages.name && !languages.selectable.includes(language)))
    throw new DashyError(`language must be one the project offers: ${[...new Set([languages.name, ...languages.selectable])].join(", ")}`);
  const themes = resolveTheme(engine.project.theme, engine.project.themes);
  const theme = body.theme ?? themes.name;
  if (typeof theme !== "string" || (theme !== themes.name && !themes.selectable.includes(theme)))
    throw new DashyError(`theme must be one the project offers: ${[...new Set([themes.name, ...themes.selectable])].join(", ")}`);

  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + ttl;
  const token = await new SignJWT({ resource, params, roles: [...principal.roles], language, theme })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setAudience(embedAudience)
    .setSubject(principal.subject ?? "api-key")
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(encoder.encode(embed.secret));
  const query = `token=${encodeURIComponent(token)}`;
  const svg = embedDatasets(engine, resource)
    .filter((dataset) => engine.project.datasets[dataset]?.chart)
    .map((dataset) => `/api/datasets/${encodeURIComponent(dataset)}?_format=svg&${query}`);
  return { token, expiresAt: new Date(expiresAt * 1000).toISOString(), urls: { iframe: `${pagePath(resource)}?${query}`, svg } };
}

/** Verifies a token: signature, audience, expiry and claim shapes. Any failure is 401. */
export async function verifyEmbed(engine: DashyEngine, token: string): Promise<EmbedClaims> {
  const embed = config(engine);
  let payload: Record<string, unknown>;
  try {
    payload = (await jwtVerify(token, encoder.encode(embed.secret), { algorithms: ["HS256"], audience: embedAudience })).payload;
  } catch (error) {
    throw new DashyError(error instanceof joseErrors.JWTExpired ? "Embed token expired" : "Invalid embed token", 401);
  }
  const resource = payload.resource as Record<string, unknown> | undefined;
  const roles = payload.roles;
  if (!isObject(resource) || (resource.kind !== "dashboard" && resource.kind !== "dataset") || typeof resource.name !== "string"
    || !isObject(payload.params) || !Array.isArray(roles) || !roles.every((role) => typeof role === "string")
    || !isLanguage(payload.language) || typeof payload.theme !== "string" || typeof payload.exp !== "number")
    throw new DashyError("Invalid embed token", 401);
  return {
    resource: { kind: resource.kind, name: resource.name },
    params: payload.params as Params,
    roles: roles as string[],
    ...(typeof payload.sub === "string" ? { subject: payload.sub } : {}),
    language: payload.language,
    theme: payload.theme,
    expiresAt: payload.exp,
  };
}

/** The principal of an embed request: the minting key's roles, so every role check still applies. */
export const embedPrincipal = (claims: EmbedClaims): Principal => ({
  roles: claims.roles, ...(claims.subject ? { subject: claims.subject } : {}), via: "embed",
});

const decode = (part: string | undefined) => {
  try { return part === undefined ? undefined : decodeURIComponent(part); } catch { return undefined; }
};
/**
 * Endpoints an embed token opens: its page, `/api/embed/shell` and `/api/embed/data/:request`,
 * the dashboard's own shell and data endpoints, and `/api/datasets/:name` for the datasets it
 * shows (JSON or SVG). Everything else is 403.
 */
export function embedAllows(engine: DashyEngine, claims: EmbedClaims, pathname: string): boolean {
  const { kind, name } = claims.resource;
  const parts = pathname.split("/").filter(Boolean).map(decode);
  if (parts.some((part) => part === undefined)) return false;
  const [root, section, first, second] = parts as string[];
  if (root === "embed") return parts.length === 3 && section === `${kind}s` && first === name;
  if (root !== "api") return false;
  if (section === "embed") return (first === "shell" && parts.length === 3) || (first === "data" && parts.length === 4);
  if (section === "datasets") return parts.length === 3 && embedDatasets(engine, claims.resource).includes(first!);
  if (kind !== "dashboard" || first !== name) return false;
  return (section === "dashboard-shell" && parts.length === 3) || (section === "dashboard-data" && parts.length === 4 && second !== undefined);
}
