import type { DuckDBConnection } from "@duckdb/node-api";
import { resolve } from "node:path";
import { mountSource, type SourceAdapter } from "./sources";
import { DashyError } from "./params";
import { poolFor, type DatabasePool, type Lease } from "./pool";
import type {
  ProjectDefinition,
  QueryResult,
  Row,
  SqlStatement,
} from "./types";

/** One request owns one lazy pooled connection. Its queries run sequentially and
 * share mounted sources; closing the connection drops them, so nothing survives
 * the request or crosses principals. */
export class QuerySession {
  private lease?: Promise<Lease>;
  private mounted = new Map<string, Promise<void>>();

  constructor(
    private project: ProjectDefinition,
    private adapters: Record<string, SourceAdapter>,
    private signal?: AbortSignal,
    private pool: DatabasePool = poolFor(project),
  ) {}

  async run(
    sources: readonly string[],
    statement: SqlStatement,
    limit: number,
  ): Promise<QueryResult> {
    const start = performance.now();
    const deadline = new AbortController();
    const signal = this.signal
      ? AbortSignal.any([this.signal, deadline.signal])
      : deadline.signal;
    const check = () => {
      if (this.signal?.aborted) throw new DashyError("Request cancelled", 499);
      deadline.signal.throwIfAborted();
    };
    let connection: DuckDBConnection | undefined;
    const interrupt = () => connection?.interrupt();
    signal.addEventListener("abort", interrupt, { once: true });
    const timer = setTimeout(() => deadline.abort(
      new DashyError("Query timed out", 504),
    ), this.pool.limits.queryTimeoutMs);
    try {
      check();
      const lease = await (this.lease ??= this.pool.acquire(signal));
      connection = lease.connection;
      check();
      for (const name of sources) {
        if (!this.mounted.has(name))
          this.mounted.set(
            name,
            mountSource(
              connection,
              name,
              this.project.sources[name]!,
              resolve(this.project.dataDir || "."),
              this.adapters,
              signal,
              { id: lease.id, onRelease: (cleanup) => this.pool.onRelease(lease.id, cleanup) },
            ),
          );
        await this.mounted.get(name);
        check();
      }
      // Only a single relational query is accepted; materialization is capped.
      const reader = await connection.runAndReadAll(
        `SELECT * FROM (${statement.text.trim().replace(/;$/, "")}) AS dashy_result LIMIT ${limit + 1}`,
        statement.values,
      );
      const rows = reader.getRowObjectsJson() as Row[];
      check();
      return {
        columns: reader.columnNames(),
        rows: rows.slice(0, limit),
        truncated: rows.length > limit,
        durationMs: Math.round(performance.now() - start),
      };
    } catch (error) {
      check();
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", interrupt);
    }
  }

  async close(): Promise<void> {
    // A failed acquire already released its slot; preserve the original error.
    const lease = await this.lease?.catch(() => undefined);
    this.lease = undefined;
    await lease?.release();
  }
}
