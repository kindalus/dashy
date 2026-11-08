import { isDashyError } from "./params";
import { parseBytes } from "./limits";
import type { CacheConfig, QueryResult, SqlStatement } from "./types";

interface Entry {
  value: QueryResult;
  expires: number;
  bytes: number;
}

/** The statement fully determines a result: roles are checked before lookup and
 * the engine has no row-level security. Add the principal if that changes. */
export function cacheKey(query: string, statement: SqlStatement, limit: number): string {
  return JSON.stringify([query, statement.text, statement.values, limit]);
}

/**
 * In-process LRU with TTL and an approximate byte budget. Concurrent misses for
 * one key share a single execution ("single-flight"). Errors are never cached.
 */
export class QueryCache {
  private entries = new Map<string, Entry>();
  private inflight = new Map<string, Promise<QueryResult>>();
  private bytes = 0;
  readonly maxBytes: number;
  readonly ttlMs: number;

  constructor(config: CacheConfig, private now = () => Date.now()) {
    if (!Number.isFinite(config.ttlSeconds) || config.ttlSeconds < 0)
      throw new Error("cache.ttlSeconds must be zero or positive");
    this.ttlMs = config.ttlSeconds * 1000;
    this.maxBytes = parseBytes(config.maxBytes ?? "64MB", "cache.maxBytes");
  }

  get size() {
    return { entries: this.entries.size, bytes: this.bytes };
  }

  private get(key: string): QueryResult | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) {
      this.delete(key);
      return undefined;
    }
    // Refresh recency.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  private delete(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.bytes -= entry.bytes;
    this.entries.delete(key);
  }

  private set(key: string, value: QueryResult, ttlMs: number) {
    // JSON length approximates retained size; strings are the dominant cost.
    const bytes = JSON.stringify(value.rows).length * 2 + 256;
    if (ttlMs <= 0 || bytes > this.maxBytes) return;
    this.delete(key);
    this.entries.set(key, { value, expires: this.now() + ttlMs, bytes });
    this.bytes += bytes;
    for (const oldest of this.entries.keys()) {
      if (this.bytes <= this.maxBytes) break;
      this.delete(oldest);
    }
  }

  /**
   * Return a cached result or execute once. A shared execution that is
   * cancelled by its own request does not fail the others: they retry.
   */
  async fetch(
    key: string,
    execute: () => Promise<QueryResult>,
    options: { refresh?: boolean; ttlMs?: number; signal?: AbortSignal } = {},
  ): Promise<QueryResult> {
    const ttlMs = options.ttlMs ?? this.ttlMs;
    if (!options.refresh) {
      const hit = this.get(key);
      if (hit) return { ...hit, cached: true };
    }
    for (;;) {
      const pending = this.inflight.get(key);
      if (!pending) break;
      try {
        return { ...(await pending), cached: true };
      } catch (error) {
        if (!(isDashyError(error) && error.status === 499) || options.signal?.aborted) throw error;
      }
    }
    const running = execute();
    this.inflight.set(key, running);
    try {
      const value = await running;
      this.set(key, value, ttlMs);
      return value;
    } finally {
      if (this.inflight.get(key) === running) this.inflight.delete(key);
    }
  }

  clear() {
    this.entries.clear();
    this.bytes = 0;
  }
}
