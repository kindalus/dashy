import { DuckDBInstance } from "@duckdb/node-api";
import { resolve } from "node:path";
import { mountSource, type SourceAdapter } from "./sources";
import type {
  ProjectDefinition,
  QueryResult,
  Row,
  SqlStatement,
} from "./types";

/** One request owns one lazy database. Its queries run sequentially and share
 * mounted sources, but nothing survives the request or crosses principals. */
export class QuerySession {
  private database?: ReturnType<QuerySession["open"]>;
  private mounted = new Map<string, Promise<void>>();

  constructor(
    private project: ProjectDefinition,
    private adapters: Record<string, SourceAdapter>,
  ) {}

  private async open() {
    const instance = await DuckDBInstance.create(":memory:", {
      threads: "2",
      memory_limit: "512MB",
      autoinstall_known_extensions: "false",
      autoload_known_extensions: "false",
    });
    try {
      return { instance, connection: await instance.connect() };
    } catch (error) {
      instance.closeSync();
      throw error;
    }
  }

  async run(
    sources: readonly string[],
    statement: SqlStatement,
    limit: number,
  ): Promise<QueryResult> {
    const start = performance.now();
    const { connection } = await (this.database ??= this.open());
    const timer = setTimeout(() => connection.interrupt(), 30_000);
    try {
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
            ),
          );
        await this.mounted.get(name);
      }
      // Only a single relational query is accepted; materialization is capped.
      const reader = await connection.runAndReadAll(
        `SELECT * FROM (${statement.text.trim().replace(/;$/, "")}) AS dashy_result LIMIT ${limit + 1}`,
        statement.values,
      );
      const rows = reader.getRowObjectsJson() as Row[];
      return {
        columns: reader.columnNames(),
        rows: rows.slice(0, limit),
        truncated: rows.length > limit,
        durationMs: Math.round(performance.now() - start),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    // open() already cleans up when connecting fails; preserve the original error.
    const database = await this.database?.catch(() => undefined);
    if (!database) return;
    try {
      database.connection.closeSync();
    } finally {
      database.instance.closeSync();
    }
  }
}
