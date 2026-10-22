import { DuckDBInstance } from "@duckdb/node-api";
import { resolve } from "node:path";
import { builtInAdapters, mountSource, type SourceAdapter } from "./sources";
import { defineProject } from "./project";
import { resolveTheme } from "./theme";
import { DashyError, parseParams, selectParams } from "./params";
import { identifier, sql } from "./sql";
import type {
  BlockResult,
  Catalog,
  DashboardResult,
  Principal,
  ProjectDefinition,
  QueryResult,
  Row,
  Scalar,
} from "./types";

export function canRead(
  roles: readonly string[] | undefined,
  principal?: Principal,
): boolean {
  return (
    !roles?.length ||
    Boolean(principal?.roles.some((role) => roles.includes(role)))
  );
}
function requireRead(
  roles: readonly string[] | undefined,
  principal?: Principal,
) {
  if (!canRead(roles, principal)) throw new DashyError("Access denied", 403);
}
export class DashyEngine {
  readonly project: ProjectDefinition;
  private adapters: Record<string, SourceAdapter>;
  constructor(
    project: ProjectDefinition,
    adapters: Record<string, SourceAdapter> = {},
  ) {
    this.project = defineProject(project);
    this.adapters = { ...builtInAdapters, ...project.adapters, ...adapters };
  }
  catalog(principal?: Principal): Catalog {
    const p = this.project;
    return {
      name: p.name,
      theme: resolveTheme(p.theme),
      description: p.description,
      locale: p.locale || "en-GB",
      params: p.params,
      dashboards: Object.fromEntries(
        Object.entries(p.dashboards).filter(([, d]) =>
          canRead(d.roles, principal),
        ),
      ),
    };
  }
  async query(
    name: string,
    raw: Record<string, unknown> = {},
    principal?: Principal,
  ): Promise<QueryResult> {
    const definition = this.project.queries[name];
    if (!definition || !Object.hasOwn(this.project.queries, name))
      throw new DashyError("Query not found", 404);
    requireRead(definition.roles, principal);
    const params = parseParams(
      this.project.params,
      definition.params || [],
      raw,
    );
    const statement = definition.build({
      params,
      sql,
      source: (sourceName) => {
        if (!definition.sources.includes(sourceName))
          throw new Error(`Query ${name} uses undeclared source ${sourceName}`);
        return identifier(sourceName);
      },
    });
    const start = performance.now();
    const instance = await DuckDBInstance.create(":memory:", {
      threads: "2",
      memory_limit: "512MB",
      autoinstall_known_extensions: "false",
      autoload_known_extensions: "false",
    });
    const connection = await instance.connect();
    const timer = setTimeout(() => connection.interrupt(), 30_000);
    try {
      for (const sourceName of new Set(definition.sources))
        await mountSource(
          connection,
          sourceName,
          this.project.sources[sourceName]!,
          resolve(this.project.dataDir || "."),
          this.adapters,
        );
      // The wrapper permits a single relational query and caps the materialized response.
      const limit = definition.maxRows || 10_000;
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
      connection.closeSync();
      instance.closeSync();
    }
  }
  async metric(
    name: string,
    raw: Record<string, unknown> = {},
    principal?: Principal,
    execute = this.query.bind(this),
  ): Promise<Scalar> {
    const definition = this.project.metrics[name];
    if (!definition || !Object.hasOwn(this.project.metrics, name))
      throw new DashyError("Metric not found", 404);
    requireRead(definition.roles, principal);
    const result = await execute(definition.query, raw, principal);
    if (!result.columns.includes(definition.column))
      throw new Error(`Metric ${name} has no column ${definition.column}`);
    if (result.rows.length > 1 || result.truncated)
      throw new Error(`Metric ${name} must return at most one row`);
    return result.rows[0]?.[definition.column] ?? null;
  }
  async dataset(
    name: string,
    raw: Record<string, unknown> = {},
    principal?: Principal,
    execute = this.query.bind(this),
  ): Promise<QueryResult> {
    const definition = this.project.datasets[name];
    if (!definition || !Object.hasOwn(this.project.datasets, name))
      throw new DashyError("Dataset not found", 404);
    requireRead(definition.roles, principal);
    const result = await execute(definition.query, raw, principal);
    for (const column of definition.columns)
      if (!result.columns.includes(column.key))
        throw new Error(`Dataset ${name} has no column ${column.key}`);
    return result;
  }
  async dashboard(
    name: string,
    raw: Record<string, unknown> = {},
    principal?: Principal,
  ): Promise<DashboardResult> {
    const definition = this.project.dashboards[name];
    if (!definition || !Object.hasOwn(this.project.dashboards, name))
      throw new DashyError("Dashboard not found", 404);
    requireRead(definition.roles, principal);
    const params = parseParams(
      this.project.params,
      definition.params || [],
      raw,
      definition.defaults,
    );
    // Request-local memoization shares queries between blocks without leaking results between users.
    const results = new Map<string, Promise<QueryResult>>();
    const execute = (queryName: string) => {
      if (!results.has(queryName)) {
        const accepted = this.project.queries[queryName]!.params || [];
        const inputs = selectParams(params, accepted);
        // Preserve explicitly cleared dashboard filters. Omission would apply
        // the parameter's default a second time inside query().
        for (const name of accepted) {
          if (definition.params?.includes(name) && !Object.hasOwn(params, name))
            inputs[name] = null;
        }
        results.set(queryName, this.query(queryName, inputs, principal));
      }
      return results.get(queryName)!;
    };
    const blocks: BlockResult[] = [];
    for (const block of definition.blocks) {
      try {
        if (block.type === "metric")
          blocks.push({
            id: block.id,
            type: "metric",
            definition: this.project.metrics[block.metric]!,
            value: await this.metric(block.metric, {}, principal, execute),
          });
        else
          blocks.push({
            id: block.id,
            type: "dataset",
            definition: this.project.datasets[block.dataset]!,
            result: await this.dataset(block.dataset, {}, principal, execute),
          });
      } catch (error) {
        if (!(error instanceof DashyError))
          console.error(`[dashy] Block ${block.id} failed`, error);
        blocks.push({
          id: block.id,
          type: "error",
          message:
            error instanceof DashyError
              ? error.message
              : "Unable to load this block. Check the server logs and source configuration.",
        });
      }
    }
    return {
      id: name,
      definition,
      params,
      blocks,
      generatedAt: new Date().toISOString(),
    };
  }
}
