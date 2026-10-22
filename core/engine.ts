import { QuerySession } from "./query-session";
import { builtInAdapters, type SourceAdapter } from "./sources";
import { defineProject } from "./project";
import { resolveTheme } from "./theme";
import { DashyError, parseParams, selectParams } from "./params";
import { identifier, sql } from "./sql";
import type {
  BlockResult,
  Catalog,
  DashboardResult,
  DashboardShell,
  DashboardData,
  DashboardDefinition,
  DashboardBlock,
  DashboardRequest,
  Params,
  Principal,
  ProjectDefinition,
  QueryResult,
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
    const session = new QuerySession(this.project, this.adapters);
    try {
      return await this.executeQuery(session, name, raw, principal);
    } finally {
      await session.close();
    }
  }
  private async executeQuery(
    session: QuerySession,
    name: string,
    raw: Record<string, unknown>,
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
    return session.run(
      definition.sources,
      statement,
      definition.maxRows || 10_000,
    );
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
  dashboardShell(
    name: string,
    raw: Record<string, unknown> = {},
    principal?: Principal,
  ): DashboardShell {
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
    const labels = Object.fromEntries(
      definition.blocks.map((block) => {
        const item = block.type === "metric"
          ? this.project.metrics[block.metric]!
          : this.project.datasets[block.dataset]!;
        const query = this.project.queries[item.query]!;
        return [
          block.id,
          canRead(item.roles, principal) && canRead(query.roles, principal)
            ? item.label
            : "Block unavailable",
        ];
      }),
    );
    const groups = new Map<string, DashboardRequest>();
    for (const block of definition.blocks) {
      const query = block.type === "metric"
        ? this.project.metrics[block.metric]!.query
        : this.project.datasets[block.dataset]!.query;
      if (!groups.has(query)) groups.set(query, { id: block.id, blockIds: [] });
      groups.get(query)!.blockIds.push(block.id);
    }
    return {
      id: name, definition, params, labels, requests: [...groups.values()],
    };
  }

  async dashboardData(
    name: string,
    requestId: string,
    raw: Record<string, unknown> = {},
    principal?: Principal,
  ): Promise<DashboardData> {
    const { definition, params, requests } = this.dashboardShell(
      name, raw, principal,
    );
    const request = requests.find((group) => group.id === requestId);
    if (!request) throw new DashyError("Dataset request not found", 404);
    const selected = new Set(request.blockIds);
    return this.loadBlocks(
      definition,
      params,
      definition.blocks.filter((block) => selected.has(block.id)),
      principal,
    );
  }

  async dashboard(
    name: string,
    raw: Record<string, unknown> = {},
    principal?: Principal,
  ): Promise<DashboardResult> {
    const { definition, params } = this.dashboardShell(name, raw, principal);
    return {
      id: name, definition, params,
      ...await this.loadBlocks(definition, params, definition.blocks, principal),
    };
  }

  private async loadBlocks(
    definition: DashboardDefinition,
    params: Params,
    selected: readonly DashboardBlock[],
    principal?: Principal,
  ): Promise<DashboardData> {
    const session = new QuerySession(this.project, this.adapters);
    try {
      // Request-local memoization shares queries between blocks without leaking results between users.
      const results = new Map<string, Promise<QueryResult>>();
      const execute = (queryName: string) => {
        if (!results.has(queryName)) {
          const accepted = this.project.queries[queryName]!.params || [];
          const inputs = selectParams(params, accepted);
          // Preserve explicitly cleared dashboard filters. Omission would apply
          // the parameter's default a second time inside query().
          for (const name of accepted) {
            if (
              definition.params?.includes(name) &&
              !Object.hasOwn(params, name)
            )
              inputs[name] = null;
          }
          results.set(
            queryName,
            this.executeQuery(session, queryName, inputs, principal),
          );
        }
        return results.get(queryName)!;
      };
      const blocks: BlockResult[] = [];
      for (const block of selected) {
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
        blocks,
        generatedAt: new Date().toISOString(),
      };
    } finally {
      await session.close();
    }
  }
}
