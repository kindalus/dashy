/**
 * Drill-down inside one dataset block. Pure and browser-safe: the server uses it
 * to run the active level, the browser to build links and breadcrumbs.
 *
 * Levels relate in one of two ways:
 * - categorical: the clicked value becomes a parameter (`param`) that every deeper
 *   level's query accepts, and that query's WHERE defines the relationship;
 * - dates: the clicked value is the start of a period of length `grain`; the
 *   period narrows a date range parameter (`range`), intersected with the
 *   dashboard's value, so a level never widens the dashboard filter.
 */
import type {
  DashboardDefinition, DatasetDefinition, DateGrain, ParamDefinition, Params, ProjectDefinition,
} from "./types.ts";
import { DashyError } from "./params.ts";

export const dateGrains: readonly DateGrain[] = ["year", "quarter", "month", "day"];

/** Repeated `_dd=block:value` keys, in order; each block's values form its path. */
export function readDrilldowns(search: URLSearchParams): Record<string, string[]> {
  const paths: Record<string, string[]> = Object.create(null);
  for (const entry of search.getAll("_dd")) {
    const separator = entry.indexOf(":");
    if (separator < 1) continue;
    (paths[entry.slice(0, separator)] ??= []).push(entry.slice(separator + 1));
  }
  return paths;
}
export function appendDrilldowns(search: URLSearchParams, paths: Record<string, readonly string[]>) {
  for (const [block, path] of Object.entries(paths))
    for (const value of path) search.append("_dd", `${block}:${value}`);
}

const iso = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);

/**
 * The period of length `grain` that starts at (or contains) `value`. Accepts
 * YYYY for years and YYYY-MM for quarters and months; days need YYYY-MM-DD.
 * Timestamps are read by their date part.
 */
export function periodRange(value: unknown, grain: DateGrain): { from: string; until: string } | undefined {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:$|[T ])/.exec(String(value ?? "").trim());
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : undefined;
  const day = match[3] ? Number(match[3]) : undefined;
  if (month !== undefined && (month < 1 || month > 12)) return undefined;
  if (day !== undefined && iso(year, month!, day) !== `${match[1]}-${match[2]}-${match[3]}`) return undefined;
  if (grain === "year") return { from: iso(year, 1, 1), until: iso(year, 12, 31) };
  if (month === undefined) return undefined;
  if (grain === "quarter") {
    const first = Math.floor((month - 1) / 3) * 3 + 1;
    return { from: iso(year, first, 1), until: iso(year, first + 3, 0) };
  }
  if (grain === "month") return { from: iso(year, month, 1), until: iso(year, month + 1, 0) };
  if (day === undefined) return undefined;
  const date = iso(year, month, day);
  return { from: date, until: date };
}

const ownLabel = (dataset: DatasetDefinition, depth: number) => {
  const level = dataset.drilldown![depth]!;
  return level.label ?? (level.columns ?? dataset.columns).find((column) => column.key === level.column)?.label ?? level.column;
};

/**
 * The definition a block shows at a depth: the level's query, columns and chart.
 * Level labels are resolved, so the browser can name every level from it alone.
 */
export function levelDefinition(dataset: DatasetDefinition, depth: number): DatasetDefinition {
  const level = dataset.drilldown?.[depth];
  if (!level) return dataset;
  const drilldown = dataset.drilldown!.map((entry, index) => ({ ...entry, label: ownLabel(dataset, index) }));
  let columns = level.columns ?? dataset.columns;
  // A date level shows its values as periods (2024, Q1 2024, Jan 2024).
  if (level.grain)
    columns = columns.map((column) => column.key === level.column
      ? { ...column, format: { ...column.format, style: "date", grain: level.grain } }
      : column);
  return { ...dataset, query: level.query ?? dataset.query, columns, chart: level.chart ?? dataset.chart, drilldown };
}

/** Breadcrumb and menu name of a level. */
export function levelLabel(dataset: DatasetDefinition, depth: number): string {
  return dataset.drilldown?.[depth] ? ownLabel(dataset, depth) : dataset.label;
}

/**
 * Raw parameter inputs for the level at `path.length`: what each level above
 * sets, then the level's own `set` values. Ranges start from `params[range]`
 * (the dashboard's value) and are intersected at every date level.
 */
export function drillInputs(
  dataset: DatasetDefinition,
  path: readonly string[],
  params: Params,
  definitions: Record<string, ParamDefinition>,
): Record<string, unknown> {
  const levels = dataset.drilldown ?? [];
  if (path.length >= levels.length) throw new DashyError("Too many drill-down levels");
  const inputs: Record<string, unknown> = {};
  path.forEach((value, index) => {
    const level = levels[index]!;
    if (level.param) {
      inputs[level.param] = definitions[level.param]?.type === "array" ? [value] : value;
    } else if (level.range) {
      const period = periodRange(value, level.grain!);
      if (!period) throw new DashyError(`Invalid ${levelLabel(dataset, index)} period: ${value}`);
      const current = (inputs[level.range] ?? params[level.range]) as { from: string | number; until: string | number } | undefined;
      const from = current && String(current.from) > period.from ? String(current.from) : period.from;
      const until = current && String(current.until) < period.until ? String(current.until) : period.until;
      if (from > until) throw new DashyError(`${value} is outside the ${definitions[level.range]?.label ?? level.range} filter`);
      inputs[level.range] = { from, until };
    }
  });
  Object.assign(inputs, levels[path.length]!.set ?? {});
  return inputs;
}

/** Keep paths for dataset blocks with drill-down, at most one level short of the last. */
export function validDrilldowns(
  definition: DashboardDefinition,
  datasets: Record<string, DatasetDefinition>,
  paths: Record<string, readonly string[]>,
): Record<string, string[]> {
  const valid: Record<string, string[]> = {};
  for (const block of definition.blocks) {
    if (block.type !== "dataset" || !Object.hasOwn(paths, block.id)) continue;
    const levels = datasets[block.dataset]!.drilldown;
    const path = paths[block.id]!.filter((value) => value !== "" && value.length <= 500);
    if (levels && path.length) valid[block.id] = path.slice(0, levels.length - 1);
  }
  return valid;
}

/** "Category: Computers › Brand: Contoso", for captions, print and exports. */
export function describeDrilldown(dataset: DatasetDefinition, path: readonly string[], format: (value: string, depth: number) => string = (v) => v): string {
  return path.map((value, depth) => `${levelLabel(dataset, depth)}: ${format(value, depth)}`).join(" › ");
}

/** Startup validation; returns the first problem or undefined. */
export function drilldownError(
  dataset: DatasetDefinition,
  project: Pick<ProjectDefinition, "params" | "queries">,
  validate: { chart: (definition: DatasetDefinition) => string | undefined; table: (definition: DatasetDefinition) => string | undefined },
): string | undefined {
  const levels: unknown = dataset.drilldown;
  if (levels === undefined) return undefined;
  if (!Array.isArray(levels) || levels.length < 2) return "drilldown requires at least two levels";
  for (const [index, level] of dataset.drilldown!.entries()) {
    const at = `drilldown level ${index + 1}`;
    if (!level || typeof level !== "object") return `${at} must be an object`;
    const queryName = level.query ?? dataset.query;
    if (!Object.hasOwn(project.queries, queryName)) return `${at} references unknown query ${queryName}`;
    const definition = levelDefinition(dataset, index);
    const keys = definition.columns.map((column) => column.key);
    if (new Set(keys).size !== keys.length) return `${at} has duplicate columns`;
    if (typeof level.column !== "string" || !keys.includes(level.column)) return `${at} column ${String(level.column)} is not one of its columns`;
    if (level.label !== undefined && (typeof level.label !== "string" || !level.label.trim())) return `${at} label must be a non-empty string`;
    const problem = validate.chart(definition) ?? validate.table(definition);
    if (problem) return `${at} ${problem}`;
    if (level.grain !== undefined && !dateGrains.includes(level.grain)) return `${at} grain must be year, quarter, month or day`;
    const last = index === levels.length - 1;
    if (level.param !== undefined && level.range !== undefined) return `${at} cannot set both param and range`;
    if (last && (level.param !== undefined || level.range !== undefined)) return `${at} is the last level, so it has nothing to drill into; remove param or range`;
    if (!last && level.param === undefined && level.range === undefined) return `${at} needs a param or range to filter the next level`;
    const passed = level.param ?? level.range;
    if (level.param !== undefined) {
      const def = project.params[level.param];
      if (!def) return `${at} references unknown parameter ${level.param}`;
      if (def.type === "range") return `${at} param ${level.param} is a range; use range with a grain`;
    }
    if (level.range !== undefined) {
      const def = project.params[level.range];
      if (!def) return `${at} references unknown parameter ${level.range}`;
      if (def.type !== "range" || def.valueType !== "date") return `${at} range ${level.range} must be a date range parameter`;
      if (!level.grain) return `${at} range requires a grain`;
    }
    const accepted = project.queries[queryName]!.params ?? [];
    for (const [name, value] of Object.entries(level.set ?? {})) {
      if (!project.params[name]) return `${at} set references unknown parameter ${name}`;
      if (!accepted.includes(name)) return `${at} set ${name}, but query ${queryName} does not accept it`;
      if (value !== null && typeof value === "object") return `${at} set ${name} must be a single value`;
    }
    // Every deeper level receives what this level passes down.
    if (passed !== undefined)
      for (const [deeper, next] of dataset.drilldown!.entries()) {
        if (deeper <= index) continue;
        const name = next.query ?? dataset.query;
        if (!(project.queries[name]?.params ?? []).includes(passed))
          return `${at} passes ${passed}, but level ${deeper + 1} query ${name} does not accept it`;
      }
  }
  return undefined;
}

/** Distinct queries a drill-down dataset can run, the dataset's own query first. */
export function drilldownQueries(dataset: DatasetDefinition): string[] {
  return [...new Set([dataset.query, ...(dataset.drilldown ?? []).map((level) => level.query ?? dataset.query)])];
}

/** Params a level's `set` fixes; dashboards may not also expose them. */
export function drilldownSetParams(dataset: DatasetDefinition): string[] {
  return [...new Set((dataset.drilldown ?? []).flatMap((level) => Object.keys(level.set ?? {})))];
}
