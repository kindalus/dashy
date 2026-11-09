/**
 * Server-side export of one dashboard block as CSV or Excel. The rows match the
 * table on screen: same filters and cross-filter exclusions, Top N choice and sort.
 */
import { DashyError } from "./params.ts";
import { filterValue } from "./filters.ts";
import { textFor } from "./i18n.ts";
import { applyTopN, isOtherRow, labelColumn, numericValue, shapeTable, summaryLabel, topNChoices, type ShapedTable } from "./tables.ts";
import type {
  DatasetColumn, DatasetDefinition, Format, ParamDefinition, Params, QueryResult, Row, Scalar, TableSort,
} from "./types.ts";

export type ExportFormat = "csv" | "xlsx";
export interface ExportOptions {
  format: ExportFormat;
  sort?: TableSort;
  /** Top N choice; 0 means all rows. Ignored for datasets without `topN`. */
  top?: number;
}
export const exportKeys = ["_format", "_sort", "_top"] as const;

/** Reads `_format`, `_sort=column:asc|desc` and `_top=N` and validates them against the dataset. */
export function readExportOptions(search: URLSearchParams, definition: DatasetDefinition): ExportOptions {
  const format = search.get("_format") ?? "csv";
  if (format !== "csv" && format !== "xlsx") throw new DashyError("_format must be csv or xlsx");
  const options: ExportOptions = { format };
  // No _sort uses the dataset's defaultSort; an empty _sort means the query's order.
  const sort = search.get("_sort");
  if (sort === null) {
    if (definition.defaultSort) options.sort = definition.defaultSort;
  } else if (sort) {
    const separator = sort.lastIndexOf(":");
    const column = sort.slice(0, separator);
    const direction = sort.slice(separator + 1);
    if (separator < 1 || (direction !== "asc" && direction !== "desc") || !definition.columns.some((c) => c.key === column))
      throw new DashyError("_sort must be <column>:asc or <column>:desc for a column of this dataset");
    options.sort = { column, direction };
  }
  const top = search.get("_top");
  if (top !== null) {
    if (!definition.topN) throw new DashyError("_top requires a dataset with topN");
    const n = /^\d{1,4}$/.test(top) ? Number(top) : Number.NaN;
    if (n !== 0 && !topNChoices(definition.topN).options.includes(n)) throw new DashyError("_top must be 0 or one of the dataset's topN options");
    options.top = n;
  }
  return options;
}

export interface ExportInput {
  dashboardId: string;
  dashboardLabel: string;
  blockId: string;
  definition: DatasetDefinition;
  result: QueryResult;
  /** The dashboard's resolved filter values, by parameter name. */
  filters: Params;
  /** The dashboard's filters, in order; listed in the Excel Filters sheet. */
  filterNames: readonly string[];
  /** Filters this block does not apply: its own cross-filters and its `unfiltered` list. */
  ignored: readonly string[];
  /** The block's drill-down path, e.g. "Category: Computers › Brand: Contoso". */
  drilldown?: string;
  params: Record<string, ParamDefinition>;
  generatedAt: Date;
  /** The viewer's locale, so text sorts as it does on screen and the Filters sheet is in their language. */
  locale: string;
  options: ExportOptions;
}
export interface ExportFile {
  body: string | Uint8Array<ArrayBuffer>;
  contentType: string;
  filename: string;
}

function shape(input: ExportInput): { table: ShapedTable; hidden: number; topN?: number } {
  const { definition, result, options } = input;
  const complete = !result.truncated;
  const n = definition.topN && complete ? options.top ?? topNChoices(definition.topN).initial : 0;
  const ranked = applyTopN(result.rows, definition, n, complete, textFor(input.locale).other);
  return {
    table: shapeTable(ranked.rows, definition, options.sort, input.locale, complete, ranked.members),
    hidden: ranked.hidden,
    topN: n || undefined,
  };
}

// Spreadsheets run cells starting with these characters as formulas (CSV injection).
const FORMULA = /^[=+\-@\t\r]/;
function csvCell(value: Scalar | undefined, computed = false): string {
  if (value === null || value === undefined) return "";
  // Computed values (the Other row) can carry float noise such as 0.30000000000000004;
  // query values are written exactly.
  let text = typeof value === "number" && computed ? String(Number(value.toPrecision(15))) : String(value);
  if (typeof value === "string" && FORMULA.test(text) && numericValue(value) === null) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * RFC 4180 CSV with a UTF-8 BOM, a header of column labels and raw values (dot
 * decimals, ISO dates), one line per data row. Subtotal and total rows are left
 * out so the file stays a plain table; use Excel for the presented view.
 */
export function toCsv(input: ExportInput): string {
  const { definition } = input;
  const lines = [definition.columns.map((column) => csvCell(column.label)).join(",")];
  for (const entry of shape(input).table.rows)
    if (entry.kind === "row")
      lines.push(definition.columns.map((column) => csvCell(entry.row[column.key], isOtherRow(entry.row))).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

const NUMERIC_STYLES = new Set(["number", "currency", "percent"]);
function numberFormat(format: Format | undefined): string | undefined {
  const fixed = (decimals: number) => decimals > 0 ? `.${"0".repeat(Math.min(decimals, 10))}` : "";
  switch (format?.style) {
    case "currency": return `[$${format.currency || "USD"}] #,##0${fixed(format.decimals ?? 2)}`;
    // The UI shows 0–2 decimals by default; Excel cannot drop a trailing ".", so 1–2.
    case "percent": return format.decimals !== undefined ? `0${fixed(format.decimals)}%` : "0.0#%";
    case "date": return "yyyy-mm-dd";
    case "text": return "@";
    default: return format?.decimals !== undefined ? `#,##0${fixed(format.decimals)}` : undefined;
  }
}
const INTEGER = /^[+-]?\d+$/;
// Plain decimals only: "+244…" phone numbers, "1e5" and zero-padded codes stay text. Values that
// look like decimals ("1.10") still convert, so columns of versions or codes should use format text.
const PLAIN_DECIMAL = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const LOCAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
/**
 * Excel cell value. Numeric strings (DuckDB sends counts and sums as strings)
 * become numbers in numeric, aggregated or unformatted columns, except integers
 * beyond 2^53, which stay exact as text, and zero-padded codes such as 00123.
 * Dates and zone-less timestamps are read as UTC, the way the UI shows them.
 */
function excelValue(value: Scalar | undefined, column: DatasetColumn): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return typeof value === "number" && !Number.isFinite(value) ? null : value;
  const style = column.format?.style;
  if (style === "date") {
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z`
      : LOCAL_TIMESTAMP.test(value) ? `${value.replace(" ", "T")}Z` : value;
    const date = new Date(iso);
    return Number.isFinite(date.valueOf()) ? date : value;
  }
  if (style === "text") return value;
  const trimmed = value.trim();
  const number = numericValue(trimmed);
  if (number === null) return value;
  if (INTEGER.test(trimmed) && !Number.isSafeInteger(number)) return value;
  if (NUMERIC_STYLES.has(style ?? "") || column.aggregate) return number;
  return PLAIN_DECIMAL.test(trimmed) ? number : value;
}
/** A valid worksheet name that cannot clash with the Filters sheet or Excel's reserved History. */
function sheetName(label: string, info: string, data: string): string {
  const name = (label.replace(/[[\]:*?/\\]/g, " ").replace(/^'+|'+$/g, "").trim() || data).slice(0, 31).trim();
  return [info.toLowerCase(), "history"].includes(name.toLowerCase()) ? data : name;
}

type Cell = string | number | boolean | Date | null;
/**
 * Formatted workbook: the table (with subtotal and total rows) and a Filters
 * sheet. Written with ExcelJS's streaming writer, so large results do not build
 * a full workbook model in memory.
 */
export async function toXlsx(input: ExportInput): Promise<Uint8Array<ArrayBuffer>> {
  const [{ default: ExcelJS }, { PassThrough }] = await Promise.all([import("exceljs"), import("node:stream")]);
  const { definition, result } = input;
  const t = textFor(input.locale);
  const { table, hidden, topN } = shape(input);
  const labelKey = labelColumn(definition);
  const lines: { cells: () => Cell[]; bold: boolean }[] = [];
  const values = (row: Row, label?: { key: string; text: string }) => () =>
    definition.columns.map((column) => label?.key === column.key ? label.text : excelValue(row[column.key], column));
  for (const entry of table.rows)
    lines.push(entry.kind === "row"
      ? { cells: values(entry.row), bold: false }
      : { cells: values(entry.row, { key: entry.column, text: summaryLabel(entry.row[entry.column], t) }), bold: true });
  if (table.totals) lines.push({ cells: values(table.totals, labelKey ? { key: labelKey, text: t.total } : undefined), bold: true });

  // Streaming rows are written once, so measure column widths first.
  const widths = definition.columns.map((column) => column.label.length);
  for (const line of lines)
    line.cells().forEach((cell, i) => {
      widths[i] = Math.max(widths[i]!, cell instanceof Date ? 10 : cell === null ? 0 : String(cell).length);
    });

  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
  workbook.created = input.generatedAt;
  const sheet = workbook.addWorksheet(sheetName(definition.label, t.filtersSheet, t.dataSheet), { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = definition.columns.map((column, i) => ({ key: column.key, width: Math.min(60, Math.max(10, widths[i]! + 2)) }));
  const formats = definition.columns.map((column) => numberFormat(column.format));
  const header = sheet.addRow(definition.columns.map((column) => column.label));
  header.font = { bold: true };
  header.commit();
  for (const line of lines) {
    const row = sheet.addRow(line.cells());
    formats.forEach((format, i) => { if (format) row.getCell(i + 1).numFmt = format; });
    if (line.bold) row.font = { bold: true };
    row.commit();
  }
  sheet.commit();

  const info = workbook.addWorksheet(t.filtersSheet);
  info.columns = [{ key: "name", width: 24 }, { key: "value", width: 48 }];
  const add = (cells: string[], bold = false) => {
    const row = info.addRow(cells);
    if (bold) row.font = { bold: true };
    row.commit();
  };
  add([t.filter, t.value], true);
  add([t.dashboard, input.dashboardLabel]);
  add([t.block, definition.label]);
  for (const name of input.filterNames) {
    const param = input.params[name];
    if (!param) continue;
    add([param.label, input.ignored.includes(name) ? t.notAppliedToBlock : filterValue(input.filters[name], param, t)]);
  }
  if (input.drilldown) add([t.drillDown, input.drilldown]);
  if (definition.topN)
    add([t.rowsHeading, topN && hidden
      ? t.rankedOf(definition.topN.order === "bottom" ? t.bottom(topN) : t.top(topN), result.rows.length, Boolean(definition.topN.other))
      : t.allRows(result.rows.length)]);
  if (input.options.sort) {
    const column = definition.columns.find((c) => c.key === input.options.sort!.column)!;
    add([t.sortedBy, `${column.label} (${input.options.sort.direction === "asc" ? t.ascending : t.descending})`]);
  }
  add([t.generated, input.generatedAt.toISOString()]);
  if (result.truncated) add([t.note, t.incompleteNote]);
  info.commit();
  await workbook.commit();
  return new Uint8Array(Buffer.concat(chunks));
}

const slug = (text: string) => text.normalize("NFKD").replace(/\p{M}+/gu, "").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "data";
export async function exportFile(input: ExportInput): Promise<ExportFile> {
  const filename = `${slug(input.dashboardId)}-${slug(input.blockId)}-${input.generatedAt.toISOString().slice(0, 10)}.${input.options.format}`;
  return input.options.format === "csv"
    ? { body: toCsv(input), contentType: "text/csv; charset=utf-8", filename }
    : {
        body: await toXlsx(input),
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename,
      };
}
