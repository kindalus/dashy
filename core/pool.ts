import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { mkdirSync } from "node:fs";
import { DashyError } from "./params";
import { resolveLimits, type ResolvedLimits } from "./limits";
import type { LimitsConfig } from "./types";
export { parseBytes, resolveLimits, type ResolvedLimits } from "./limits";

export interface Lease {
  connection: DuckDBConnection;
  /** Unique per lease; adapters use it to name instance-wide objects such as ATTACH aliases. */
  id: string;
  release(): Promise<void>;
}
interface Waiter {
  resolve(): void;
  reject(error: unknown): void;
}

/**
 * One DuckDB instance per engine with a process-wide memory limit. Each lease
 * gets a fresh connection: temporary views are connection-local, so closing it
 * on release drops everything a request mounted. The slot count bounds
 * concurrency; excess requests queue, then receive 503.
 */
export class DatabasePool {
  readonly limits: ResolvedLimits;
  private instance?: Promise<DuckDBInstance>;
  private active = 0;
  private queue: Waiter[] = [];
  private sequence = 0;
  private cleanups = new Map<string, Array<(connection: DuckDBConnection) => Promise<void>>>();

  constructor(limits: LimitsConfig = {}, private timezone = "UTC") {
    this.limits = resolveLimits(limits);
  }

  get stats() {
    return { active: this.active, queued: this.queue.length };
  }

  private async open(): Promise<DuckDBInstance> {
    mkdirSync(this.limits.tempDirectory, { recursive: true });
    const instance = await DuckDBInstance.create(":memory:", {
      threads: String(this.limits.threads),
      memory_limit: `${Math.floor(this.limits.memoryBytes / 1024 / 1024)}MiB`,
      temp_directory: this.limits.tempDirectory,
      autoinstall_known_extensions: "false",
      autoload_known_extensions: "false",
    });
    const setup = await instance.connect();
    try {
      await setup.run(`SET GLOBAL TimeZone = '${this.timezone.replaceAll("'", "''")}'`);
      // Trusted builders still cannot raise limits or change the timezone at runtime.
      await setup.run("SET lock_configuration = true");
    } catch (error) {
      setup.closeSync();
      instance.closeSync();
      throw error;
    }
    setup.closeSync();
    return instance;
  }

  private async slot(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new DashyError("Request cancelled", 499);
    if (this.active < this.limits.maxConcurrentQueries) {
      this.active++;
      return;
    }
    if (this.queue.length >= this.limits.maxQueuedQueries)
      throw new DashyError("The server is busy. Try again shortly.", 503, 2);
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve: () => { cleanup(); resolve(); },
        reject: (error) => { cleanup(); reject(error); },
      };
      const timer = setTimeout(() => {
        this.remove(waiter);
        waiter.reject(new DashyError("The server is busy. Try again shortly.", 503, 2));
      }, this.limits.queueTimeoutMs);
      const abort = () => {
        this.remove(waiter);
        waiter.reject(new DashyError("Request cancelled", 499));
      };
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.queue.push(waiter);
    });
  }

  private remove(waiter: Waiter) {
    const index = this.queue.indexOf(waiter);
    if (index >= 0) this.queue.splice(index, 1);
  }

  private free() {
    const next = this.queue.shift();
    // Hand the slot over directly so a queued request cannot be overtaken.
    if (next) next.resolve();
    else this.active--;
  }

  /** Register work to run on this lease's connection before it closes. */
  onRelease(id: string, cleanup: (connection: DuckDBConnection) => Promise<void>) {
    const list = this.cleanups.get(id);
    if (!list) throw new Error("Unknown lease");
    list.push(cleanup);
  }

  async acquire(signal?: AbortSignal): Promise<Lease> {
    await this.slot(signal);
    let connection: DuckDBConnection;
    try {
      const instance = await (this.instance ??= this.open().catch((error) => {
        this.instance = undefined;
        throw error;
      }));
      connection = await instance.connect();
    } catch (error) {
      this.free();
      throw error;
    }
    const id = `l${++this.sequence}`;
    this.cleanups.set(id, []);
    let released = false;
    return {
      connection,
      id,
      release: async () => {
        if (released) return;
        released = true;
        try {
          for (const cleanup of this.cleanups.get(id) ?? [])
            await cleanup(connection).catch((error) => console.error("[dashy] Lease cleanup failed", error));
        } finally {
          this.cleanups.delete(id);
          connection.closeSync();
          this.free();
        }
      },
    };
  }

  async close(): Promise<void> {
    const instance = await this.instance?.catch(() => undefined);
    this.instance = undefined;
    instance?.closeSync();
  }
}

/** Engines share a pool per project definition; direct QuerySession users get the same. */
const pools = new WeakMap<object, DatabasePool>();
export function poolFor(project: { limits?: LimitsConfig; timezone?: string }): DatabasePool {
  let pool = pools.get(project);
  if (!pool) {
    pool = new DatabasePool(project.limits, project.timezone ?? "UTC");
    pools.set(project, pool);
  }
  return pool;
}
