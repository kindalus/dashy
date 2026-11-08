import { QuerySession } from "./query-session";
import { builtInAdapters, type SourceAdapter } from "./sources";
import { defineProject } from "./project";
import { resolveTheme } from "./theme";
import { DashyError, hasQueryOptions, isDashyError, parseParams, selectParams } from "./params";
import { identifier, sql } from "./sql";
import { todayIn } from "./dates";
import { poolFor, type DatabasePool } from "./pool";
import { cacheKey, QueryCache } from "./cache";
import type {
  BlockResult,
  Catalog,
  CrossFilterOrigin,
  DashboardResult,
  DashboardShell,
  DashboardData,
  DashboardDefinition,
  DashboardBlock,
  DashboardRequest,
  DatasetColumn,
  Params,
  PageShell,
  Principal,
  ProjectDefinition,
  QueryParamOptions,
  QueryResult,
  Scalar,
  SqlStatement,
} from "./types";

export function canRead(
  roles: readonly string[] | undefined,
  principal?: Principal,
): boolean {
  return (
    !roles?.length ||
    Boolean(principal?.roles.some((role) => role === "*" || roles.includes(role)))
  );
}
function requireRead(
  roles: readonly string[] | undefined,
  principal?: Principal,
) {
  if (!canRead(roles, principal)) throw new DashyError("Access denied", 403);
}
export interface ExecutionOptions {
  /** Bypass cached results (the fresh result is cached again). */
  refresh?: boolean;
}
export interface DashboardOptions extends ExecutionOptions {
  crossFilters?: readonly CrossFilterOrigin[];
}
export interface ParamOptionsRequest {
  /** Case-insensitive search on label and value. */
  search?: string;
  /** Resolve labels for these values instead of listing. */
  values?: readonly string[];
  limit?: number;
}
export interface ParamOptionsResult {
  options: { value: Scalar; label: Scalar }[];
  truncated: boolean;
}
export const columnParam = (column: DatasetColumn) =>
  column.param === undefined
    ? undefined
    : typeof column.param === "string"
      ? { name: column.param, from: column.key }
      : column.param;
/** Parse repeated _xf=block:param query values. */
export function readCrossFilters(search: URLSearchParams): CrossFilterOrigin[] {
  return search.getAll("_xf").flatMap((value) => {
    const [block, param, ...rest] = value.split(":");
    return block && param && !rest.length ? [{ block, param }] : [];
  });
}

export class DashyEngine {
  readonly project: ProjectDefinition;
  readonly pool: DatabasePool;
  readonly cache?: QueryCache;
  private adapters: Record<string, SourceAdapter>;
  constructor(
    project: ProjectDefinition,
    adapters: Record<string, SourceAdapter> = {},
  ) {
    this.project = defineProject(project);
    this.adapters = { ...builtInAdapters, ...project.adapters, ...adapters };
    this.pool = poolFor(this.project);
    if (project.cache && project.cache.ttlSeconds > 0) this.cache = new QueryCache(project.cache);
  }
  /** Today in the project timezone; evaluated per request for relative defaults. */
  today(): Date {
    return todayIn(this.project.timezone ?? "UTC");
  }
  catalog(principal?: Principal): Catalog {
    const p = this.project;
    return {
      name: p.name,
      theme: resolveTheme(p.theme),
      description: p.description,
      locale: p.locale ?? "pt",
      timezone: p.timezone ?? "UTC",
      params: p.params,
      pages: Object.fromEntries(Object.entries(p.pages ?? {})
        .filter(([, page]) => canRead(page.roles, principal))
        .map(([id, { component: _component, ...metadata }]) => [id, metadata])),
      dashboards: Object.fromEntries(
        Object.entries(p.dashboards).filter(([, d]) =>
          canRead(d.roles, principal),
        ),
      ),
      datasets: Object.fromEntries(
        Object.entries(p.datasets)
          .filter(([, d]) => canRead(d.roles, principal) && canRead(p.queries[d.query]!.roles, principal))
          .map(([id, d]) => [id, {
            label: d.label,
            ...(d.description ? { description: d.description } : {}),
            params: p.queries[d.query]!.params ?? [],
            columns: d.columns,
          }]),
      ),
    };
  }
  pageShell(name: string, raw: Record<string, unknown> = {}, principal?: Principal): PageShell {
    const page = this.project.pages?.[name];
    if (!page || !Object.hasOwn(this.project.pages!, name)) throw new DashyError("Page not found", 404);
    requireRead(page.roles, principal);
    const { component: _component, ...definition } = page;
    return { id: name, definition, params: parseParams(this.project.params, page.params ?? [], raw, page.defaults, this.today()) };
  }

  async query(
    name: string,
    raw: Record<string, unknown> = {},
    principal?: Principal,
    signal?: AbortSignal,
    options: ExecutionOptions = {},
  ): Promise<QueryResult> {
    const session = new QuerySession(this.project, this.adapters, signal, this.pool);
    try {
      return await this.executeQuery(session, name, raw, principal, options, signal);
    } finally {
      await session.close();
    }
  }
  private definitionOf(name: string) {
    const definition = this.project.queries[name];
    if (!definition || !Object.hasOwn(this.project.queries, name))
      throw new DashyError("Query not found", 404);
    return definition;
  }
  private buildStatement(name: string, params: Params): SqlStatement {
    const definition = this.definitionOf(name);
    return definition.build({
      params,
      sql,
      source: (sourceName) => {
        if (!definition.sources.includes(sourceName))
          throw new Error(`Query ${name} uses undeclared source ${sourceName}`);
        return identifier(sourceName);
      },
    });
  }
  /** Execute a statement for a query definition through the cache. */
  private run(
    session: QuerySession,
    name: string,
    statement: SqlStatement,
    options: ExecutionOptions,
    signal?: AbortSignal,
  ): Promise<QueryResult> {
    const definition = this.definitionOf(name);
    const limit = definition.maxRows || 10_000;
    const execute = () => session.run(definition.sources, statement, limit);
    if (!this.cache || definition.cache === false) return execute();
    return this.cache.fetch(cacheKey(name, statement, limit), execute, {
      refresh: options.refresh,
      signal,
      ...(definition.cache ? { ttlMs: definition.cache.ttlSeconds * 1000 } : {}),
    });
  }
  private async executeQuery(
    session: QuerySession,
    name: string,
    raw: Record<string, unknown>,
    principal?: Principal,
    options: ExecutionOptions = {},
    signal?: AbortSignal,
  ): Promise<QueryResult> {
    const definition = this.definitionOf(name);
    requireRead(definition.roles, principal);
    const params = parseParams(
      this.project.params,
      definition.params || [],
      raw,
      {},
      this.today(),
    );
    await this.checkStrict(session, params, principal, options, signal);
    return this.run(session, name, this.buildStatement(name, params), options, signal);
  }
  /** Strict query-backed parameters must name existing options. */
  private async checkStrict(
    session: QuerySession,
    params: Params,
    principal: Principal | undefined,
    options: ExecutionOptions,
    signal?: AbortSignal,
  ) {
    for (const [name, value] of Object.entries(params)) {
      const def = this.project.params[name]!;
      if (!def.strict || !hasQueryOptions(def) || value === null) continue;
      const values = (Array.isArray(value) ? value : [value]).map(String);
      const found = await this.lookupOptions(session, name, {}, { values }, principal, options, signal);
      const known = new Set(found.options.map((option) => String(option.value)));
      if (values.some((v) => !known.has(v))) throw new DashyError(`Invalid option for ${name}`);
    }
  }
  private async lookupOptions(
    session: QuerySession,
    name: string,
    raw: Record<string, unknown>,
    request: ParamOptionsRequest,
    principal: Principal | undefined,
    options: ExecutionOptions,
    signal?: AbortSignal,
  ): Promise<ParamOptionsResult> {
    const def = this.project.params[name];
    if (!def || !Object.hasOwn(this.project.params, name) || !hasQueryOptions(def))
      throw new DashyError("Parameter options not found", 404);
    const source = def.options as QueryParamOptions;
    const query = this.definitionOf(source.query);
    requireRead(query.roles, principal);
    // Clients send their current filters; only those the options query accepts apply.
    const params = parseParams(this.project.params, query.params || [], selectParams(raw, query.params || []), {}, this.today());
    const inner = this.buildStatement(source.query, params);
    const value = identifier(source.value);
    const label = identifier(source.label ?? source.value);
    const max = Math.min(source.limit ?? 50, 500);
    const limit = Math.max(1, Math.min(request.limit ?? max, max));
    const conditions: SqlStatement[] = [];
    if (request.values) {
      if (request.values.length > 250) throw new DashyError("Too many option values");
      if (!request.values.length) return { options: [], truncated: false };
      conditions.push(sql.in(`CAST(${value} AS VARCHAR)`, [...request.values]));
    } else if (request.search?.trim()) {
      if (!source.search) throw new DashyError(`${name} does not support search`);
      const term = `%${request.search.trim().slice(0, 200).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conditions.push(sql.fragment(
        `CAST(${label} AS VARCHAR) ILIKE ? ESCAPE '\\' OR CAST(${value} AS VARCHAR) ILIKE ? ESCAPE '\\'`,
        [term, term],
      ));
    }
    const where = sql.where(...conditions);
    const statement: SqlStatement = {
      text: `SELECT DISTINCT ${value} AS value, ${label} AS label FROM (${inner.text.trim().replace(/;$/, "")}) AS dashy_options ${where.text} LIMIT ${request.values ? request.values.length : limit + 1}`,
      values: [...inner.values, ...where.values],
    };
    const result = await this.run(session, source.query, statement, options, signal);
    const rows = request.values ? result.rows : result.rows.slice(0, limit);
    return {
      options: rows.map((row) => ({ value: row.value ?? null, label: row.label ?? row.value ?? null })),
      truncated: !request.values && result.rows.length > limit,
    };
  }
  /** List or resolve options for a query-backed parameter. */
  async paramOptions(
    name: string,
    raw: Record<string, unknown> = {},
    request: ParamOptionsRequest = {},
    principal?: Principal,
    signal?: AbortSignal,
    options: ExecutionOptions = {},
  ): Promise<ParamOptionsResult> {
    const session = new QuerySession(this.project, this.adapters, signal, this.pool);
    try {
      return await this.lookupOptions(session, name, raw, request, principal, options, signal);
    } finally {
      await session.close();
    }
  }

  async metric(
    name: string,
    raw: Record<string, unknown> = {},
    principal?: Principal,
    execute?: (query: string, raw: Record<string, unknown>, principal?: Principal, signal?: AbortSignal) => Promise<QueryResult>,
    signal?: AbortSignal,
    options: ExecutionOptions = {},
  ): Promise<Scalar> {
    const definition = this.project.metrics[name];
    if (!definition || !Object.hasOwn(this.project.metrics, name))
      throw new DashyError("Metric not found", 404);
    requireRead(definition.roles, principal);
    const result = await (execute
      ? execute(definition.query, raw, principal, signal)
      : this.query(definition.query, raw, principal, signal, options));
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
    execute?: (query: string, raw: Record<string, unknown>, principal?: Principal, signal?: AbortSignal) => Promise<QueryResult>,
    signal?: AbortSignal,
    options: ExecutionOptions = {},
  ): Promise<QueryResult> {
    const definition = this.project.datasets[name];
    if (!definition || !Object.hasOwn(this.project.datasets, name))
      throw new DashyError("Dataset not found", 404);
    requireRead(definition.roles, principal);
    const result = await (execute
      ? execute(definition.query, raw, principal, signal)
      : this.query(definition.query, raw, principal, signal, options));
    for (const column of definition.columns)
      if (!result.columns.includes(column.key))
        throw new Error(`Dataset ${name} has no column ${column.key}`);
    return result;
  }
  private blockQuery(block: DashboardBlock): string {
    return block.type === "metric"
      ? this.project.metrics[block.metric]!.query
      : this.project.datasets[block.dataset]!.query;
  }
  /** Keep only cross-filters that a click on this dashboard could have produced. */
  private validCrossFilters(
    definition: DashboardDefinition,
    params: Params,
    origins: readonly CrossFilterOrigin[],
  ): CrossFilterOrigin[] {
    const seen = new Set<string>();
    return origins.filter((origin) => {
      const block = definition.blocks.find((b) => b.id === origin.block);
      if (!block || block.type !== "dataset" || !definition.params?.includes(origin.param)) return false;
      if (!Object.hasOwn(params, origin.param) || seen.has(origin.param)) return false;
      const annotated = this.project.datasets[block.dataset]!.columns
        .some((column) => columnParam(column)?.name === origin.param);
      if (annotated) seen.add(origin.param);
      return annotated;
    });
  }
  dashboardShell(
    name: string,
    raw: Record<string, unknown> = {},
    principal?: Principal,
    options: DashboardOptions = {},
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
      this.today(),
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
    const missing = (definition.required ?? []).filter((param) => !Object.hasOwn(params, param));
    const crossFilters = this.validCrossFilters(definition, params, options.crossFilters ?? []);
    const groups = new Map<string, DashboardRequest>();
    if (!missing.length)
      for (const block of definition.blocks) {
        // A cross-filter origin keeps its own selection visible, so it needs its own request.
        const excluded = crossFilters.filter((origin) => origin.block === block.id).map((origin) => origin.param);
        const key = JSON.stringify([this.blockQuery(block), excluded]);
        if (!groups.has(key)) groups.set(key, { id: block.id, blockIds: [] });
        groups.get(key)!.blockIds.push(block.id);
      }
    return {
      id: name, definition, params, labels, requests: [...groups.values()], missing, crossFilters,
    };
  }

  async dashboardData(
    name: string,
    requestId: string,
    raw: Record<string, unknown> = {},
    principal?: Principal,
    signal?: AbortSignal,
    options: DashboardOptions = {},
  ): Promise<DashboardData> {
    const shell = this.dashboardShell(name, raw, principal, options);
    if (shell.missing.length)
      throw new DashyError(`${this.project.params[shell.missing[0]!]!.label} is required`);
    const request = shell.requests.find((group) => group.id === requestId);
    if (!request) throw new DashyError("Dataset request not found", 404);
    const selected = new Set(request.blockIds);
    return this.loadBlocks(
      shell,
      shell.definition.blocks.filter((block) => selected.has(block.id)),
      principal,
      signal,
      options,
    );
  }

  async dashboard(
    name: string,
    raw: Record<string, unknown> = {},
    principal?: Principal,
    signal?: AbortSignal,
    options: DashboardOptions = {},
  ): Promise<DashboardResult> {
    const shell = this.dashboardShell(name, raw, principal, options);
    const { definition, params } = shell;
    if (shell.missing.length)
      return { id: name, definition, params, blocks: [], generatedAt: new Date().toISOString() };
    return {
      id: name, definition, params,
      ...await this.loadBlocks(shell, definition.blocks, principal, signal, options),
    };
  }

  private async loadBlocks(
    shell: DashboardShell,
    selected: readonly DashboardBlock[],
    principal?: Principal,
    signal?: AbortSignal,
    options: ExecutionOptions = {},
  ): Promise<DashboardData> {
    const { definition, params, crossFilters } = shell;
    const session = new QuerySession(this.project, this.adapters, signal, this.pool);
    try {
      // Request-local memoization shares queries between blocks without leaking results between users.
      const results = new Map<string, Promise<QueryResult>>();
      const executor = (excluded: readonly string[]) => (queryName: string) => {
        const key = JSON.stringify([queryName, excluded]);
        if (!results.has(key)) {
          const accepted = this.project.queries[queryName]!.params || [];
          const inputs = selectParams(params, accepted);
          // Preserve explicitly cleared dashboard filters. Omission would apply
          // the parameter's default a second time inside query().
          for (const name of accepted) {
            if (
              definition.params?.includes(name) &&
              (!Object.hasOwn(params, name) || excluded.includes(name))
            )
              inputs[name] = null;
          }
          results.set(
            key,
            this.executeQuery(session, queryName, inputs, principal, options, signal),
          );
        }
        return results.get(key)!;
      };
      const blocks: BlockResult[] = [];
      for (const block of selected) {
        const execute = executor(crossFilters.filter((origin) => origin.block === block.id).map((origin) => origin.param));
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
          if (signal?.aborted) throw new DashyError("Request cancelled", 499);
          if (!isDashyError(error))
            console.error(`[dashy] Block ${block.id} failed`, error);
          blocks.push({
            id: block.id,
            type: "error",
            message:
              isDashyError(error)
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
