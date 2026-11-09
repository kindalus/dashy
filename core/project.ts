import type { ProjectDefinition, ProjectConfig } from "./types.ts";
import { dashboardIconNames } from "./icons.ts";
import { defineApiRoutes } from "./api-definition.ts";
import { resolveTheme } from "./theme.ts";
import { isValidTimezone, relativeDefaultError } from "./dates.ts";
import { isReservedParam, parseParams } from "./params.ts";
import { resolveLimits, parseBytes } from "./limits.ts";
import { validateChart } from "./charts.ts";
import { validateTable } from "./tables.ts";
import { drilldownError, drilldownQueries, drilldownSetParams, levelDefinition } from "./drilldown.ts";
import type { DatasetColumn } from "./types.ts";

export function defineProject<const T extends ProjectDefinition>(
  project: T,
): T {
  resolveTheme(project.theme);
  if (project.locale !== undefined) {
    try {
      if (typeof project.locale !== "string" || !project.locale)
        throw new Error();
      Intl.getCanonicalLocales(project.locale);
    } catch {
      throw new Error("Invalid Dashy project: locale must be a language tag such as pt, en or pt-AO.");
    }
  }
  const assert = (condition: unknown, message: string) => {
    if (!condition) throw new Error(`Invalid Dashy project: ${message}`);
  };
  const names = (kind: string, entries: Record<string, unknown>) => {
    for (const name of Object.keys(entries))
      assert(
        /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name),
        `${kind} name '${name}' must be an identifier`,
      );
  };
  for (const kind of [
    "params",
    "sources",
    "queries",
    "metrics",
    "datasets",
    "dashboards",
  ] as const)
    names(kind, project[kind]);
  assert(project.timezone === undefined || (typeof project.timezone === "string" && isValidTimezone(project.timezone)),
    `timezone '${project.timezone}' is not an IANA timezone such as Africa/Luanda`);
  try {
    resolveLimits(project.limits);
    if (project.cache !== undefined) {
      assert(Number.isFinite(project.cache.ttlSeconds) && project.cache.ttlSeconds >= 0, "cache.ttlSeconds must be zero or positive");
      if (project.cache.maxBytes !== undefined) parseBytes(project.cache.maxBytes, "cache.maxBytes");
    }
  } catch (error) {
    throw new Error(`Invalid Dashy project: ${(error as Error).message.replace(/^Invalid Dashy project: /, "")}`);
  }
  const defaultValue = (owner: string, param: string, value: unknown) => {
    const def = project.params[param];
    if (!def) return;
    const error = relativeDefaultError(def, value as never);
    assert(!error, `${owner} default for ${param}: ${error}`);
  };
  for (const [name, def] of Object.entries(project.params)) {
    assert(!isReservedParam(name), `parameter name '${name}' is reserved`);
    if (def.default !== undefined) defaultValue(`parameter ${name}`, name, def.default);
    const options = def.options;
    if (options && !Array.isArray(options)) {
      const source = options as import("./types").QueryParamOptions;
      assert(["select", "array", "string", "number"].includes(def.type), `${name} query options require a select, array, string or number parameter`);
      assert(typeof source.query === "string" && Object.hasOwn(project.queries, source.query), `${name} options reference unknown query ${source.query}`);
      assert(typeof source.value === "string" && source.value, `${name} options require a value column`);
      assert(source.label === undefined || (typeof source.label === "string" && source.label), `${name} options label must be a column name`);
      assert(source.limit === undefined || (Number.isInteger(source.limit) && source.limit >= 1 && source.limit <= 500), `${name} options limit must be 1–500`);
      assert(!(project.queries[source.query]?.params ?? []).includes(name), `${name} options query cannot depend on ${name} itself`);
    } else assert(!def.strict, `${name} strict requires query options`);
  }
  for (const [name, source] of Object.entries(project.sources)) {
    assert(source.hive === undefined || source.type === "parquet", `${name} hive options require a parquet source`);
    assert(source.unionByName === undefined || source.type === "parquet", `${name} unionByName requires a parquet source`);
    if (source.hive && source.hive.types)
      for (const [column, type] of Object.entries(source.hive.types))
        assert(["VARCHAR", "INTEGER", "BIGINT", "DOUBLE", "DATE", "TIMESTAMP", "BOOLEAN"].includes(type),
          `${name} hive type for ${column} must be VARCHAR, INTEGER, BIGINT, DOUBLE, DATE, TIMESTAMP or BOOLEAN`);
    if (/[*?[{]/.test(source.path ?? ""))
      assert(["csv", "json", "parquet"].includes(source.type) || !["sqlite", "duckdb", "excel"].includes(source.type),
        `${name} globs are supported for csv, json and parquet sources`);
  }
  const params = (owner: string, list: readonly string[] = []) => {
    for (const name of list)
      assert(
        Object.hasOwn(project.params, name),
        `${owner} references unknown parameter ${name}`,
      );
  };
  for (const [name, query] of Object.entries(project.queries)) {
    params(name, query.params);
    for (const source of query.sources)
      assert(
        Object.hasOwn(project.sources, source),
        `${name} references unknown source ${source}`,
      );
    assert(
      query.cache === undefined || query.cache === false ||
        (typeof query.cache === "object" && Number.isFinite(query.cache.ttlSeconds) && query.cache.ttlSeconds >= 0),
      `${name} cache must be false or { ttlSeconds }`,
    );
    assert(
      query.maxRows === undefined ||
        (Number.isInteger(query.maxRows) &&
          query.maxRows > 0 &&
          query.maxRows <= 100_000),
      `${name} has invalid maxRows`,
    );
  }
  const text = (value: unknown) => value === undefined || (typeof value === "string" && value.trim().length > 0);
  for (const [name, metric] of Object.entries(project.metrics)) {
    assert(
      Object.hasOwn(project.queries, metric.query),
      `${name} references unknown query ${metric.query}`,
    );
    // Configs are plain JavaScript at runtime, so check shapes rather than trust the types.
    const compare: unknown = metric.compare;
    if (compare !== undefined) {
      const c = (typeof compare === "object" && compare !== null ? compare : {}) as Record<string, unknown>;
      assert(typeof c.column === "string" && c.column, `${name} compare requires a column`);
      assert(c.as === undefined || c.as === "percent" || c.as === "delta", `${name} compare as must be percent or delta`);
      assert(c.better === undefined || c.better === "higher" || c.better === "lower", `${name} compare better must be higher or lower`);
      assert(text(c.label), `${name} compare label must be a non-empty string`);
    }
    const target: unknown = metric.target;
    if (target !== undefined) {
      const t = (typeof target === "object" && target !== null ? target : {}) as Record<string, unknown>;
      assert((typeof t.column === "string" && t.column.length > 0) !== (t.value !== undefined),
        `${name} target requires either a column or a value`);
      assert(t.value === undefined || Number.isFinite(t.value), `${name} target value must be a finite number`);
      assert(text(t.label), `${name} target label must be a non-empty string`);
    }
    const sparkline: unknown = metric.sparkline;
    if (sparkline !== undefined) {
      const s = (typeof sparkline === "object" && sparkline !== null ? sparkline : {}) as Record<string, unknown>;
      const dataset = typeof s.dataset === "string" && Object.hasOwn(project.datasets, s.dataset) ? project.datasets[s.dataset]! : undefined;
      assert(dataset, `${name} sparkline references unknown dataset ${String(s.dataset)}`);
      assert(dataset!.columns.some((column) => column.key === s.value), `${name} sparkline value must be a column of ${String(s.dataset)}`);
      // Whatever filters reach the metric must reach its sparkline too.
      const accepted = project.queries[dataset!.query]?.params ?? [];
      const missing = (project.queries[metric.query]?.params ?? []).filter((param) => !accepted.includes(param));
      assert(!missing.length, `${name} sparkline query ${dataset!.query} must accept ${missing.join(", ")} like ${metric.query}`);
    }
  }
  for (const [name, dataset] of Object.entries(project.datasets)) {
    assert(
      Object.hasOwn(project.queries, dataset.query),
      `${name} references unknown query ${dataset.query}`,
    );
    const columns = dataset.columns.map((column) => column.key);
    assert(
      new Set(columns).size === columns.length,
      `${name} has duplicate columns`,
    );
    if (dataset.chart) {
      const error = validateChart(dataset.chart, columns);
      assert(!error, `${name} chart ${error}`);
    }
    const tableError = validateTable(dataset);
    assert(!tableError, `${name} ${tableError}`);
    const annotations = (columnsOf: readonly DatasetColumn[]) => {
      for (const column of columnsOf) {
        if (column.param === undefined) continue;
        const target = typeof column.param === "string" ? { name: column.param, from: column.key } : column.param;
        assert(target && typeof target.name === "string" && typeof target.from === "string" && target.from,
          `${name} column ${column.key} param must be a parameter name or { name, from }`);
        const def = project.params[target.name];
        assert(def, `${name} column ${column.key} references unknown parameter ${target.name}`);
        assert(def!.type !== "range", `${name} column ${column.key} cannot map to range parameter ${target.name}`);
      }
    };
    annotations(dataset.columns);
    if (dataset.drilldown !== undefined) {
      const drillError = drilldownError(dataset, project, {
        chart: (definition) => definition.chart ? validateChart(definition.chart, definition.columns.map((c) => c.key)) : undefined,
        table: validateTable,
      });
      assert(!drillError, `${name} ${drillError}`);
      for (const [index, level] of dataset.drilldown.entries()) {
        annotations(levelDefinition(dataset, index).columns);
        if (level.set) {
          try {
            parseParams(project.params, Object.keys(level.set), level.set);
          } catch (error) {
            assert(false, `${name} drilldown level ${index + 1} set: ${(error as Error).message}`);
          }
        }
      }
    }
  }
  defineApiRoutes(project.api ?? {});
  for (const [name, route] of Object.entries(project.api ?? {})) params(name, route.params);
  names("pages", project.pages ?? {});
  for (const [name, page] of Object.entries(project.pages ?? {})) {
    assert(typeof page.label === "string" && page.label.trim(), `${name} page requires a label`);
    assert(typeof page.component === "string" && /\.(tsx|jsx)$/.test(page.component)
      && !page.component.startsWith("/") && !page.component.includes("\\")
      && !page.component.split("/").includes(".."), `${name} component must be a relative .tsx or .jsx path inside extensions`);
    params(name, page.params);
    for (const [key, value] of Object.entries(page.defaults ?? {})) {
      assert(page.params?.includes(key), `${name} default ${key} is not a page parameter`);
      defaultValue(name, key, value);
    }
    assert(page.icon === undefined || dashboardIconNames.includes(page.icon), `${name} has unknown icon '${page.icon}'`);
    assert(page.group === undefined || (typeof page.group === "string" && page.group.trim() && page.group.trim() === page.group), `${name} group must be a non-empty label without surrounding whitespace`);
    assert(page.roles === undefined || (Array.isArray(page.roles) && page.roles.every(role => typeof role === "string")), `${name} roles must be strings`);
  }
  for (const [name, dashboard] of Object.entries(project.dashboards)) {
    assert(
      dashboard.icon === undefined ||
        dashboardIconNames.includes(dashboard.icon),
      `${name} has unknown icon '${dashboard.icon}'. Use a supported Lucide name.`,
    );
    assert(
      dashboard.group === undefined ||
        (typeof dashboard.group === "string" &&
          dashboard.group.trim().length > 0 &&
          dashboard.group === dashboard.group.trim()),
      `${name} group must be a non-empty label without surrounding whitespace`,
    );
    params(name, dashboard.params);
    assert(
      new Set(dashboard.blocks.map((block) => block.id)).size ===
        dashboard.blocks.length,
      `${name} has duplicate block IDs`,
    );
    for (const [key, value] of Object.entries(dashboard.defaults || {})) {
      assert(
        dashboard.params?.includes(key),
        `${name} default ${key} is not a dashboard parameter`,
      );
      defaultValue(name, key, value);
    }
    for (const param of dashboard.required ?? [])
      assert(dashboard.params?.includes(param), `${name} required ${param} is not a dashboard parameter`);
    const blockIds = new Set(dashboard.blocks.map((block) => block.id));
    for (const [blockId, list] of Object.entries(dashboard.unfiltered ?? {})) {
      assert(blockIds.has(blockId), `${name} unfiltered references unknown block ${blockId}`);
      for (const param of list) assert(dashboard.params?.includes(param), `${name} unfiltered ${blockId} lists ${param}, which is not a dashboard parameter`);
    }
    if (dashboard.drillthrough !== undefined) {
      assert(typeof dashboard.drillthrough.param === "string" && dashboard.params?.includes(dashboard.drillthrough.param),
        `${name} drillthrough parameter must be one of its parameters`);
      assert(project.params[dashboard.drillthrough.param]?.type !== "range", `${name} drillthrough cannot use a range parameter`);
    }
    for (const [param, targets] of Object.entries(dashboard.drillthroughTargets ?? {})) {
      assert(Object.hasOwn(project.params, param), `${name} drillthroughTargets references unknown parameter ${param}`);
      if (targets === false) continue;
      for (const target of typeof targets === "string" ? [targets] : targets) {
        const destination = project.dashboards[target];
        assert(destination && Object.hasOwn(project.dashboards, target), `${name} drillthroughTargets ${param} references unknown dashboard ${target}`);
        assert(destination!.drillthrough?.param === param, `${name} drillthroughTargets ${param}: dashboard ${target} is not a drillthrough destination for ${param}`);
      }
    }
    for (const block of dashboard.blocks) {
      assert(
        block.width === undefined ||
          (Number.isInteger(block.width) &&
            block.width >= 1 &&
            block.width <= 12),
        `${name} block width must be 1–12`,
      );
      const target =
        block.type === "metric"
          ? project.metrics[block.metric]
          : project.datasets[block.dataset];
      assert(target, `${name} references an unknown ${block.type}`);
      // A drill-down block runs one query per level; each must honour the dashboard's filters.
      const drilled = block.type === "dataset" ? project.datasets[block.dataset]! : undefined;
      const queryNames = drilled?.drilldown ? drilldownQueries(drilled) : [target!.query];
      for (const param of drilled ? drilldownSetParams(drilled) : [])
        assert(!dashboard.params?.includes(param), `${name} block ${block.id}: drill-down sets ${param}, so it cannot also be a dashboard parameter`);
      for (const queryName of queryNames) {
        const query = project.queries[queryName]!;
        // Dashboard filters apply to every block; exceptions are declared, never silent.
        const ignored = dashboard.unfiltered?.[block.id] ?? [];
        for (const param of dashboard.params ?? []) {
          const accepted = (query.params ?? []).includes(param);
          if (ignored.includes(param))
            assert(!accepted, `${name} block ${block.id} lists ${param} as unfiltered, but query ${queryName} accepts it`);
          else
            assert(accepted, `${name} block ${block.id}: query ${queryName} does not accept dashboard parameter ${param}. Add it to the query or declare unfiltered: { ${block.id}: ["${param}"] }`);
        }
        for (const param of query.params || []) {
          if (
            project.params[param]?.required &&
            project.params[param]?.default === undefined
          )
            assert(
              dashboard.params?.includes(param),
              `${name} must expose required parameter ${param}`,
            );
        }
      }
    }
  }
  return project;
}

/** Compose external registries at runtime before validating cross-references. */
export function defineConfig<const T extends ProjectConfig>(config: T): T & ProjectDefinition {
  return { params: {}, sources: {}, queries: {}, datasets: {}, metrics: {}, dashboards: {}, ...config };
}
