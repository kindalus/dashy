/**
 * Browser-safe table shaping shared by the dashboard UI and exports: sorting,
 * Top N, subtotals and totals. Pure functions over query rows; no DOM.
 */
import { chartKeyColumns, isCartesian } from "./charts.ts";
import type { DatasetColumn, DatasetDefinition, Row, Scalar, TableSort, TopNDefinition } from "./types.ts";

const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const INTEGER = /^[+-]?\d+$/;
const isEmpty = (value: Scalar | undefined) => value === null || value === undefined || value === "";

/** Numeric value of a cell: numbers and numeric strings (DuckDB sends large numbers as strings). */
export function numericValue(value: Scalar | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !NUMERIC.test(value.trim())) return null;
  const number = Number(value.trim());
  return Number.isFinite(number) ? number : null;
}

/** Row comparator for one column. Empty values sort last in both directions. */
export function compareRows(sort: TableSort, locale: string): (a: Row, b: Row) => number {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const sign = sort.direction === "desc" ? -1 : 1;
  return (a, b) => {
    const x = a[sort.column];
    const y = b[sort.column];
    if (isEmpty(x) || isEmpty(y)) return isEmpty(x) === isEmpty(y) ? 0 : isEmpty(x) ? 1 : -1;
    const nx = numericValue(x);
    const ny = numericValue(y);
    if (nx !== null && ny !== null) {
      if (nx !== ny) return sign * (nx < ny ? -1 : 1);
      // Integers beyond 2^53 collapse to the same Number; compare them exactly.
      if (typeof x === "string" && typeof y === "string" && INTEGER.test(x.trim()) && INTEGER.test(y.trim())) {
        const bx = BigInt(x.trim());
        const by = BigInt(y.trim());
        return bx === by ? 0 : sign * (bx < by ? -1 : 1);
      }
      return 0;
    }
    if (typeof x === "boolean" && typeof y === "boolean") return sign * (Number(x) - Number(y));
    return sign * collator.compare(String(x), String(y));
  };
}

/** A sorted copy; Array.prototype.sort is stable, so ties keep the query order. */
export function sortRows(rows: readonly Row[], sort: TableSort | undefined, locale: string): Row[] {
  return sort ? [...rows].sort(compareRows(sort, locale)) : [...rows];
}

function sum(rows: readonly Row[], key: string): number | null {
  let total = 0;
  let seen = false;
  for (const row of rows) {
    const value = numericValue(row[key]);
    if (value === null) continue;
    total += value;
    seen = true;
  }
  return seen ? total : null;
}

/** Combines one column across rows according to its `aggregate`, or null without one. */
export function aggregateColumn(rows: readonly Row[], column: DatasetColumn): Scalar {
  const aggregate = column.aggregate;
  if (!aggregate) return null;
  if (typeof aggregate === "object") {
    const numerator = sum(rows, aggregate.ratio[0]);
    const denominator = sum(rows, aggregate.ratio[1]);
    return numerator === null || denominator === null || denominator === 0 ? null : numerator / denominator;
  }
  if (aggregate === "count") return rows.filter((row) => !isEmpty(row[column.key])).length;
  if (aggregate === "sum") return sum(rows, column.key);
  let count = 0;
  let total = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const row of rows) {
    const value = numericValue(row[column.key]);
    if (value === null) continue;
    count++;
    total += value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!count) return null;
  return aggregate === "avg" ? total / count : aggregate === "min" ? min : max;
}

function aggregateRow(rows: readonly Row[], columns: readonly DatasetColumn[], base: Row = {}): Row {
  const row: Row = {};
  for (const column of columns)
    row[column.key] = Object.hasOwn(base, column.key) ? base[column.key]! : aggregateColumn(rows, column);
  return row;
}

const otherRows = new WeakSet<Row>();
/** True for the synthetic "Other" row, which no click can filter by. */
export const isOtherRow = (row: Row) => otherRows.has(row);

export const DEFAULT_TOP_N_OPTIONS = [5, 10, 25] as const;
/** The Top N choices offered next to "All" and the initial one; 0 means all rows. */
export function topNChoices(topN: TopNDefinition): { options: readonly number[]; initial: number } {
  const options = topN.options ?? DEFAULT_TOP_N_OPTIONS;
  return { options, initial: topN.default ?? options[0]! };
}

/**
 * Column that names summary rows ("Other", "Total"): the chart's key column, then
 * the first column without an aggregate.
 */
export function labelColumn(definition: DatasetDefinition): string | undefined {
  const chartKey = definition.chart ? chartKeyColumns(definition.chart)[0] : undefined;
  if (chartKey && definition.columns.some((c) => c.key === chartKey && !c.aggregate)) return chartKey;
  return definition.columns.find((column) => !column.aggregate)?.key;
}
/** Column that names the "Other" row: `topN.label`, else the summary label column. */
export const topNLabelColumn = (definition: DatasetDefinition) => definition.topN?.label ?? labelColumn(definition);

/**
 * Charts whose key column can show an "Other" category. Treemap and sunburst
 * paths, heatmap and sankey pairs, numeric or time axes and boxplot
 * distributions would turn the synthetic row into a misleading mark.
 */
export const otherFitsChart = (definition: DatasetDefinition) => {
  const chart = definition.chart;
  if (!chart) return true;
  if (isCartesian(chart)) return (chart.xType ?? "category") === "category";
  return chart.type === "pie" || chart.type === "funnel" || chart.type === "radar";
};

export interface TopNResult {
  /** Rows to display, in query order, plus the "Other" row when requested. */
  rows: readonly Row[];
  /** Source rows the displayed rows represent; totals aggregate these. */
  members: readonly Row[];
  /** Number of source rows not shown individually. */
  hidden: number;
}
/**
 * Keeps the `n` highest (or lowest) rows by `topN.by`; rows without a `by` value
 * are never kept. `n` of 0 keeps every row. An incomplete (truncated) result is
 * returned unchanged: ranking only the rows that fit the limit could miss the true top.
 */
export function applyTopN(rows: readonly Row[], definition: DatasetDefinition, n: number, complete: boolean): TopNResult {
  const topN = definition.topN;
  if (!topN || !n || !complete) return { rows, members: rows, hidden: 0 };
  const rankable = rows.filter((row) => numericValue(row[topN.by]) !== null);
  // Nothing to rank (e.g. no sales yet) or nothing to drop: show the result as it is.
  if (!rankable.length || (rankable.length === rows.length && rows.length <= n)) return { rows, members: rows, hidden: 0 };
  const direction = topN.order === "bottom" ? "asc" : "desc";
  const ranked = [...rows].sort(compareRows({ column: topN.by, direction }, "en"));
  const kept = new Set([...rankable].sort(compareRows({ column: topN.by, direction }, "en")).slice(0, n));
  const rest = ranked.filter((row) => !kept.has(row));
  const shown = rows.filter((row) => kept.has(row));
  if (!topN.other || !rest.length) return { rows: shown, members: shown, hidden: rest.length };
  const other = aggregateRow(rest, definition.columns);
  // Rest rows without any aggregatable value add nothing worth a row.
  if (definition.columns.every((column) => !column.aggregate || other[column.key] === null))
    return { rows: shown, members: shown, hidden: rest.length };
  other[topNLabelColumn(definition)!] = topN.otherLabel ?? "Other";
  otherRows.add(other);
  return { rows: [...shown, other], members: rows, hidden: rest.length };
}

export type TableRow =
  | { kind: "row"; row: Row }
  | { kind: "subtotal"; row: Row; level: number; column: string };
export interface ShapedTable {
  rows: TableRow[];
  /** Grand total row; absent without `totals` or for incomplete results. */
  totals?: Row;
}

/**
 * Sorts, groups and totals the rows a table displays. `members` are the source
 * rows the totals cover (Top N without "Other" totals only the kept rows).
 * Incomplete results get neither subtotals nor totals, which would be wrong.
 */
export function shapeTable(
  rows: readonly Row[],
  definition: DatasetDefinition,
  sort: TableSort | undefined,
  locale: string,
  complete: boolean,
  members: readonly Row[] = rows,
): ShapedTable {
  const compare = sort ? compareRows(sort, locale) : undefined;
  const levels = complete ? definition.subtotals ?? [] : [];
  // "Other" stays last whatever the order: it is a remainder, not a ranked row.
  const other = rows.filter(isOtherRow);
  if (other.length) rows = rows.filter((row) => !isOtherRow(row));
  const group = (list: readonly Row[], level: number, outer: Row): TableRow[] => {
    if (level >= levels.length) return (compare ? [...list].sort(compare) : list).map((row) => ({ kind: "row", row }));
    const column = levels[level]!;
    const groups = new Map<string, Row[]>();
    for (const row of list) {
      const value = row[column];
      const key = isEmpty(value) ? "\u0000" : `${typeof value}:${String(value)}`;
      const members = groups.get(key);
      if (members) members.push(row);
      else groups.set(key, [row]);
    }
    const subtotals = [...groups.values()].map((members) => {
      const keys: Row = { ...outer, [column]: members[0]![column] ?? null };
      return { members, keys, row: aggregateRow(members, definition.columns, keys) };
    });
    // Groups follow the sort through their subtotal; a column a subtotal lacks keeps first appearance.
    if (compare) subtotals.sort((a, b) => compare(a.row, b.row));
    return subtotals.flatMap(({ members, keys, row }) =>
      [...group(members, level + 1, keys), { kind: "subtotal" as const, row, level, column }]);
  };
  const shaped = [...group(rows, 0, {}), ...other.map((row) => ({ kind: "row" as const, row }))];
  if (!definition.totals || !complete) return { rows: shaped };
  return { rows: shaped, totals: aggregateRow(members, definition.columns) };
}

const AGGREGATES = ["sum", "count", "min", "max", "avg"];

/** Returns an error message, or undefined when the table options match the dataset columns. */
export function validateTable(definition: DatasetDefinition): string | undefined {
  const columns = new Map(definition.columns.map((column) => [column.key, column]));
  for (const column of definition.columns) {
    // Configs are plain JavaScript at runtime, so check shapes rather than trust the types.
    const aggregate: unknown = column.aggregate;
    if (aggregate === undefined) continue;
    const ratio: unknown = typeof aggregate === "object" && aggregate !== null ? (aggregate as { ratio?: unknown }).ratio : undefined;
    const pair = Array.isArray(ratio) && ratio.length === 2 && ratio.every((key) => typeof key === "string") ? ratio as string[] : undefined;
    if (!AGGREGATES.includes(aggregate as string) && !pair)
      return `column ${column.key} aggregate must be sum, count, min, max, avg or { ratio: [numerator, denominator] }`;
    for (const key of pair ?? []) {
      if (!columns.has(key)) return `column ${column.key} ratio references unknown column ${key}`;
      if (key === column.key) return `column ${column.key} ratio cannot reference itself`;
    }
  }
  const aggregated = definition.columns.some((column) => column.aggregate !== undefined);
  if (definition.totals !== undefined && typeof definition.totals !== "boolean") return "totals must be true or false";
  if (definition.totals && !aggregated) return "totals require at least one column aggregate";
  const sort = definition.defaultSort;
  if (sort !== undefined) {
    if (typeof sort !== "object" || sort === null) return "defaultSort must be { column, direction }";
    if (!columns.has(sort.column)) return `defaultSort references unknown column ${sort.column}`;
    if (sort.direction !== "asc" && sort.direction !== "desc") return "defaultSort direction must be asc or desc";
  }
  const subtotals = definition.subtotals;
  if (subtotals !== undefined) {
    if (!Array.isArray(subtotals) || !subtotals.length) return "subtotals require at least one column";
    if (new Set(subtotals).size !== subtotals.length) return "subtotals has duplicate columns";
    for (const key of subtotals) {
      if (!columns.has(key)) return `subtotals references unknown column ${key}`;
      if (columns.get(key)!.aggregate) return `subtotals column ${key} cannot have an aggregate`;
    }
    if (!aggregated) return "subtotals require at least one column aggregate";
  }
  const topN = definition.topN;
  if (topN !== undefined) {
    if (typeof topN !== "object" || topN === null) return "topN must be { by, options?, default?, order?, other? }";
    if (subtotals !== undefined) return "topN cannot be combined with subtotals";
    if (!columns.has(topN.by)) return `topN by references unknown column ${topN.by}`;
    const options = topN.options ?? DEFAULT_TOP_N_OPTIONS;
    if (!Array.isArray(options) || !options.length || new Set(options).size !== options.length
      || !options.every((n) => Number.isInteger(n) && n > 0 && n <= 1000))
      return "topN options must be distinct positive integers up to 1000";
    if (topN.default !== undefined && topN.default !== 0 && !options.includes(topN.default))
      return "topN default must be 0 (all rows) or one of its options";
    if (topN.order !== undefined && topN.order !== "top" && topN.order !== "bottom") return "topN order must be top or bottom";
    if (topN.label !== undefined) {
      if (!columns.has(topN.label)) return `topN label references unknown column ${topN.label}`;
      if (columns.get(topN.label)!.aggregate) return `topN label column ${topN.label} cannot have an aggregate`;
    }
    if (topN.other) {
      if (!columns.get(topN.by)!.aggregate) return `topN other requires an aggregate on ${topN.by}`;
      if (!topNLabelColumn(definition)) return "topN other requires a column without an aggregate to name the Other row";
      if (!otherFitsChart(definition))
        return "topN other requires a pie, funnel, radar or category-axis cartesian chart, or no chart";
    }
    if (topN.otherLabel !== undefined && (typeof topN.otherLabel !== "string" || !topN.otherLabel.trim()))
      return "topN otherLabel must be a non-empty string";
  }
  return undefined;
}

/** Text in a subtotal row's group column, e.g. "Audio total". */
export const summaryLabel = (display: Scalar | undefined) => `${isEmpty(display) ? "—" : String(display)} total`;
