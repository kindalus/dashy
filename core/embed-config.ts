/** Validation of `ProjectDefinition.embed`, at startup. Pure; no secrets leave the server. */
import type { EmbedConfig } from "./types.ts";

export const defaultEmbedMaxTtl = 86_400;
/** The longest lifetime a project may allow: 30 days. */
export const embedTtlLimit = 30 * 86_400;
export interface ResolvedEmbed {
  secret: string;
  origins: string[];
  maxTtlSeconds: number;
}

const local = (hostname: string) => hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

/** Validates the embed configuration; undefined when embedding is disabled. */
export function resolveEmbed(config: unknown): ResolvedEmbed | undefined {
  if (config === undefined) return undefined;
  const fail = (message: string): never => { throw new Error(`Invalid Dashy embed: ${message}`); };
  if (!config || typeof config !== "object" || Array.isArray(config)) return fail("embed must be an object with a secret");
  const embed = config as Record<string, unknown>;
  for (const key of Object.keys(embed))
    if (!["secret", "origins", "maxTtlSeconds"].includes(key)) fail(`unknown property '${key}'`);
  if (typeof embed.secret !== "string" || embed.secret.length < 32) fail("secret must have at least 32 characters");
  const origins: string[] = [];
  if (embed.origins !== undefined) {
    if (!Array.isArray(embed.origins)) fail("origins must be a list of origins such as https://portal.example.com");
    for (const origin of embed.origins as unknown[]) {
      let url: URL | undefined;
      try { url = typeof origin === "string" ? new URL(origin) : undefined; } catch { url = undefined; }
      // Exactly scheme://host[:port]: no path, query, credentials or trailing slash.
      if (!url || url.origin !== origin || !(url.protocol === "https:" || (url.protocol === "http:" && local(url.hostname))))
        fail(`origin '${String(origin)}' must be an absolute https origin without a path, such as https://portal.example.com (http only for localhost)`);
      origins.push(url!.origin);
    }
  }
  const ttl = embed.maxTtlSeconds ?? defaultEmbedMaxTtl;
  if (typeof ttl !== "number" || !Number.isInteger(ttl) || ttl < 1 || ttl > embedTtlLimit)
    fail(`maxTtlSeconds must be a positive integer of at most ${embedTtlLimit} (30 days)`);
  return { secret: embed.secret as string, origins: [...new Set(origins)], maxTtlSeconds: ttl as number };
}

/** The CSP frame-ancestors value for embed pages: the configured origins, or 'none'. */
export function frameAncestors(config: EmbedConfig | undefined): string {
  const origins = resolveEmbed(config)?.origins ?? [];
  return origins.length ? origins.join(" ") : "'none'";
}
