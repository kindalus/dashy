/** Public contracts. This module is safe to import in the browser. */
export type Scalar = string | number | boolean | null;
export type Row = Record<string, Scalar>;
export type ParamValue =
  | Scalar
  | Scalar[]
  | { from: string | number; until: string | number };
export type Params = Record<string, ParamValue>;

/** Anchors are evaluated in the project timezone on every request. */
export type RelativeDateAnchor =
  | "today"
  | "yesterday"
  | "start-of-month"
  | "start-of-year"
  | "start-of-last-month"
  | "end-of-last-month"
  | "start-of-last-year"
  | "end-of-last-year";
export interface RelativeDate {
  relative: RelativeDateAnchor;
  /** Offsets applied after the anchor, in this order: years, months, days. */
  years?: number;
  months?: number;
  days?: number;
  /**
   * Output representation. `date` (YYYY-MM-DD) is the default. `month` produces
   * YYYY-MM for string parameters; `year` and `month-number` produce numbers.
   */
  as?: "date" | "month" | "year" | "month-number";
}
export type RelativeRangePreset =
  | "ytd"
  | "mtd"
  | "last-closed-month"
  | "last-closed-year";
export type RelativeRange =
  | { relative: RelativeRangePreset }
  | { relative: "last-days"; days: number }
  | { relative: "next-days"; days: number }
  | { relative: "last-months"; months: number }
  | { from: string | number | RelativeDate; until: string | number | RelativeDate };
export type ParamDefault = ParamValue | RelativeDate | RelativeRange;

export interface ParamOption {
  label: string;
  value: string | number;
}
/** Options produced by a registered query. The query must return both columns. */
export interface QueryParamOptions {
  query: string;
  /** Column holding the submitted value. */
  value: string;
  /** Column shown to users; defaults to the value column. */
  label?: string;
  /** Search on the server while typing (autocomplete). */
  search?: boolean;
  /** Maximum options per request, default 50, at most 500. */
  limit?: number;
}
export interface ParamDefinition {
  label: string;
  type: "string" | "number" | "boolean" | "date" | "select" | "array" | "range";
  valueType?: "string" | "number" | "date";
  required?: boolean;
  integer?: boolean;
  min?: number;
  max?: number;
  default?: ParamDefault;
  options?: readonly ParamOption[] | QueryParamOptions;
  /** For query options: confirm submitted values exist before executing data queries. */
  strict?: boolean;
  placeholder?: string;
  description?: string;
}
export type HiveType =
  | "VARCHAR"
  | "INTEGER"
  | "BIGINT"
  | "DOUBLE"
  | "DATE"
  | "TIMESTAMP"
  | "BOOLEAN";
export type SourceDefinition = {
  type:
    | "csv"
    | "json"
    | "parquet"
    | "sqlite"
    | "duckdb"
    | "excel"
    | (string & {});
  /** Relative to dataDir. CSV, JSON and Parquet paths may be globs such as gold/sales/**\/*.parquet. */
  path: string;
  label?: string;
  table?: string;
  schema?: string;
  sheet?: string;
  headerRow?: number;
  delimiter?: string;
  /** Column types for empty sources or to override inference. */
  columns?: Record<
    string,
    "VARCHAR" | "DOUBLE" | "BIGINT" | "BOOLEAN" | "DATE" | "TIMESTAMP"
  >;
  /** Parquet only: hive partitioning is on by default; false disables it. */
  hive?: false | { types?: Record<string, HiveType> };
  /** Parquet only: combine files whose schemas differ by column name. */
  unionByName?: boolean;
  options?: Record<string, unknown>;
};
export interface SqlStatement {
  text: string;
  values: Scalar[];
}
export interface QueryContext {
  params: Params;
  /** Only sources declared on this query can be referenced. Returns a quoted identifier. */
  source(name: string): string;
  sql: typeof import("./sql").sql;
}
export interface QueryDefinition {
  label: string;
  sources: readonly string[];
  params?: readonly string[];
  roles?: readonly string[];
  maxRows?: number;
  /** Override the project cache for this query; false disables caching. */
  cache?: false | { ttlSeconds: number };
  build(context: QueryContext): SqlStatement;
}
export interface Format {
  style?: "number" | "currency" | "percent" | "text" | "date";
  currency?: string;
  decimals?: number;
}
/** Declares that a column holds values of a project parameter. Never a navigation target. */
export type ColumnParam = string | { name: string; from: string };
/**
 * How a column combines across rows in totals, subtotals and Top N's "Other" row.
 * `ratio` divides the sums of two columns, e.g. profit / revenue for a margin.
 */
export type ColumnAggregate =
  | "sum" | "count" | "min" | "max" | "avg"
  | { ratio: readonly [numerator: string, denominator: string] };
export interface DatasetColumn {
  key: string;
  label: string;
  format?: Format;
  param?: ColumnParam;
  aggregate?: ColumnAggregate;
}
export interface TableSort {
  column: string;
  direction: "asc" | "desc";
}
export interface TopNDefinition {
  /** Numeric column that ranks the rows. */
  by: string;
  /** Choices offered next to "All". Default [5, 10, 25]. */
  options?: readonly number[];
  /** Initial choice; one of `options`. Default the first option. */
  default?: number;
  /** "top" keeps the highest values (default), "bottom" the lowest. */
  order?: "top" | "bottom";
  /** Combine the remaining rows into one row. Requires an aggregate on `by`. */
  other?: boolean;
  otherLabel?: string;
  /** Column that names the "Other" row. Default the chart's key column, then the first column without an aggregate. */
  label?: string;
}
export type SeriesKind = "line" | "bar" | "area" | "scatter";
export interface CartesianSeries {
  key: string;
  label: string;
  color?: string;
  format?: Format;
  /** Defaults to the chart's legacy type or line. */
  as?: SeriesKind;
  axis?: "left" | "right";
  /** Series with the same stack name are stacked. */
  stack?: string;
  smooth?: boolean;
  /** Horizontal (or, on horizontal charts, vertical) lines at a statistic of this series or a constant. */
  reference?: readonly ReferenceLine[];
  /** Adds a dashed least-squares trend line. Not for stacked series. */
  trend?: "linear";
  /** Projects the series past the last period, in the browser. Requires evenly spaced date periods on the x axis. */
  forecast?: SeriesForecast;
}
export interface ReferenceLine {
  kind: "average" | "median" | "min" | "max" | "constant";
  /** Required for `constant`. */
  value?: number;
  /** Defaults to the kind, e.g. "Average", or "Target" for a constant. */
  label?: string;
}
export interface SeriesForecast {
  /** Periods to project, 1–120. */
  periods: number;
  /** linear (default) fits a line; holt follows a changing trend; seasonal adds a repeating season (Holt-Winters). */
  method?: "linear" | "holt" | "seasonal";
  /** Periods per season for `seasonal`, e.g. 12 for months in a year. */
  season?: number;
}
export type ChartDefinition =
  | {
      /** line, bar and area are shorthands for cartesian charts with one series kind. */
      type: "cartesian" | "line" | "bar" | "area";
      x: string;
      /** category (default), time or value axis. Scatter usually uses value. */
      xType?: "category" | "time" | "value";
      orientation?: "vertical" | "horizontal";
      series: readonly CartesianSeries[];
    }
  | { type: "pie"; category: string; value: string; donut?: boolean; format?: Format }
  | { type: "funnel"; category: string; value: string; format?: Format }
  | { type: "treemap" | "sunburst"; path: readonly string[]; value: string; format?: Format }
  | { type: "heatmap"; x: string; y: string; value: string; format?: Format }
  | {
      type: "gauge";
      value: string;
      min?: number;
      max?: number;
      format?: Format;
      /** Colour bands up to each value, ascending. */
      bands?: readonly { until: number; tone: "danger" | "warning" | "success" | "neutral" }[];
    }
  | {
      type: "radar";
      category: string;
      series: readonly { key: string; label: string; color?: string; format?: Format }[];
      max?: number;
    }
  | { type: "sankey"; source: string; target: string; value: string; format?: Format }
  | { type: "boxplot"; category: string; value: string; format?: Format };
export type ChartType = ChartDefinition["type"];
export interface DatasetDefinition {
  label: string;
  description?: string;
  query: string;
  columns: readonly DatasetColumn[];
  chart?: ChartDefinition;
  roles?: readonly string[];
  /** Initial table order. Users can change it by clicking a column heading. */
  defaultSort?: TableSort;
  /** Adds a total row using each column's `aggregate`. */
  totals?: boolean;
  /** Groups table rows by these columns, outermost first, with a subtotal row per group. */
  subtotals?: readonly string[];
  /** Lets users keep only the N highest (or lowest) rows, in the table and the chart. */
  topN?: TopNDefinition;
}
export interface MetricDefinition {
  label: string;
  description?: string;
  query: string;
  column: string;
  format?: Format;
  roles?: readonly string[];
  /** Compares the value with another column of the same query row, e.g. the previous period. */
  compare?: MetricComparison;
  /** A goal: another column of the query row, or a constant. */
  target?: MetricTarget;
  /** A small trend line from a dataset's column, in query order. */
  sparkline?: MetricSparkline;
}
export interface MetricComparison {
  column: string;
  /** Default "vs previous". */
  label?: string;
  /** percent (default) shows the relative change; delta the difference in the metric's format. */
  as?: "percent" | "delta";
  /** Whether a higher value is good (default) or bad, e.g. costs or delivery days. */
  better?: "higher" | "lower";
}
export interface MetricTarget {
  column?: string;
  value?: number;
  /** Default "Target". */
  label?: string;
}
export interface MetricSparkline {
  dataset: string;
  /** Numeric column of the dataset to draw. */
  value: string;
}
export type DashboardBlock = { id: string; width?: number } & (
  | { type: "metric"; metric: string }
  | { type: "dataset"; dataset: string; view?: "chart" | "table" }
);
export interface DrillthroughDefinition {
  /** The parameter this dashboard details, e.g. a customer ID. */
  param: string;
  /** Carry the origin's filters that this dashboard accepts. Default true. */
  keepFilters?: boolean;
}
export interface DashboardDefinition {
  label: string;
  /** A supported Lucide icon name; defaults to layout-dashboard. */
  icon?: import("./icons").DashboardIconName;
  /** Navigation section label. Omitted dashboards belong to Dashboards. */
  group?: string;
  description?: string;
  /** Every block's query must accept every dashboard parameter, except listed in unfiltered. */
  params?: readonly string[];
  defaults?: Record<string, ParamDefault>;
  /** Without these values the dashboard shows only its filters and runs no queries. */
  required?: readonly string[];
  /** Declared exceptions: block ID to dashboard parameters its query intentionally ignores. */
  unfiltered?: Record<string, readonly string[]>;
  /** Makes this dashboard a drillthrough destination for a parameter. */
  drillthrough?: DrillthroughDefinition;
  /** Per-parameter destinations from this dashboard; false disables drillthrough. */
  drillthroughTargets?: Record<string, string | readonly string[] | false>;
  roles?: readonly string[];
  blocks: readonly DashboardBlock[];
}
/** The component path is relative to the implementation's extensions directory. */
export interface PageDefinition extends Omit<
  DashboardDefinition,
  "blocks" | "required" | "unfiltered" | "drillthrough" | "drillthroughTargets"
> {
  component: string;
}
export type PageMetadata = Omit<PageDefinition, "component">;
export interface PageShell {
  id: string;
  definition: PageMetadata;
  params: Params;
}
export type ArtifactRegistries = Pick<ProjectDefinition,
  "params" | "sources" | "queries" | "datasets" | "metrics" | "dashboards">;
export type ProjectConfig = Omit<ProjectDefinition, keyof ArtifactRegistries>
  & Partial<ArtifactRegistries>;

export interface Principal {
  /** The role "*" grants every role; reserved for disabled authentication. */
  roles: readonly string[];
  subject?: string;
  email?: string;
  name?: string;
}
/**
 * Principal, or a principal with response headers (for example a renewed
 * session cookie), or a redirect for unauthenticated page requests. null is 401.
 */
export type AuthResult =
  | Principal
  | { principal: Principal; headers?: HeadersInit }
  | { redirect: string; headers?: HeadersInit }
  | null;
export interface ApiContext {
  request: Request;
  pathParams: Record<string, string>;
  query: URLSearchParams;
  /** Validated declared query parameters, including null for explicitly cleared values. */
  params: Params;
  principal: Principal | undefined;
  signal: AbortSignal;
  /** Parses bounded JSON as unknown; the handler validates its domain fields. */
  readJson(): Promise<unknown>;
  data: {
    dataset(name: string, params?: Record<string, unknown>): Promise<QueryResult>;
    metric(name: string, params?: Record<string, unknown>): Promise<Scalar>;
    query(name: string, params?: Record<string, unknown>): Promise<QueryResult>;
  };
}
export interface ApiRouteDefinition {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Relative to /api/custom, e.g. /customers/:id. */
  path: string;
  roles?: readonly string[];
  /** Project query parameters to validate. Omit to handle query manually. */
  params?: readonly string[];
  /** Entire request body limit, default 1 MiB. */
  maxBodyBytes?: number;
  handler(context: ApiContext): Response | Promise<Response>;
}
export type ApiRoutes = Record<string, ApiRouteDefinition>;

/** Sizes accept bytes or strings such as 512MB, 1GB or 64MiB. */
export type ByteSize = number | string;
export interface LimitsConfig {
  /** DuckDB memory for the whole process, default 1GB. */
  memory?: ByteSize;
  /** DuckDB worker threads for the whole process, default 2. */
  threads?: number;
  /** Query sessions executing at once, default 4. */
  maxConcurrentQueries?: number;
  /** Sessions waiting for a slot before requests receive 503, default 32. */
  maxQueuedQueries?: number;
  /** Maximum wait for a slot, default 15000 ms. */
  queueTimeoutMs?: number;
  /** Per-query execution deadline, default 30000 ms. */
  queryTimeoutMs?: number;
  /** Writable directory for DuckDB spilling, default the OS temporary directory. */
  tempDirectory?: string;
}
export interface CacheConfig {
  /** Result lifetime; 0 disables the cache. */
  ttlSeconds: number;
  /** Approximate memory for cached results, default 64MB. */
  maxBytes?: ByteSize;
}

export interface ProjectDefinition {
  name: string;
  theme?: import("./theme").ThemeConfig;
  description?: string;
  locale?: string;
  /** IANA timezone for relative defaults and DuckDB current_date, default UTC. */
  timezone?: string;
  /** Paths in sources are resolved against this directory, never supplied by requests. */
  dataDir?: string;
  params: Record<string, ParamDefinition>;
  sources: Record<string, SourceDefinition>;
  queries: Record<string, QueryDefinition>;
  datasets: Record<string, DatasetDefinition>;
  metrics: Record<string, MetricDefinition>;
  dashboards: Record<string, DashboardDefinition>;
  pages?: Record<string, PageDefinition>;
  api?: ApiRoutes;
  limits?: LimitsConfig;
  cache?: CacheConfig;
  /** Server-only adapters for additional source types. */
  adapters?: Record<string, import("./sources").SourceAdapter>;
  /** Optional application-owned authentication. Return null for an unauthenticated request. */
  authenticate?: (request: Request) => AuthResult | Promise<AuthResult>;
  /** Handles /auth/* (login, callback, logout) before authentication. Return undefined for 404. */
  authRoutes?: (request: Request) => Response | undefined | Promise<Response | undefined>;
}
export interface QueryResult {
  columns: string[];
  rows: Row[];
  truncated: boolean;
  durationMs: number;
  /** True when served from the result cache. */
  cached?: boolean;
}
export type BlockResult = { id: string } & (
  | {
      type: "metric"; definition: MetricDefinition; value: Scalar;
      /** Present when the metric declares them. */
      compare?: Scalar; target?: Scalar; sparkline?: (number | null)[];
    }
  | { type: "dataset"; definition: DatasetDefinition; result: QueryResult }
  | { type: "error"; message: string }
);
export interface DashboardResult {
  id: string;
  definition: DashboardDefinition;
  params: Params;
  blocks: BlockResult[];
  generatedAt: string;
}
/** Cross-filter origin: the block whose click set a parameter is not filtered by it. */
export interface CrossFilterOrigin {
  block: string;
  param: string;
}
/** Initial page metadata, without executing queries or reading sources. */
export interface DashboardShell {
  id: string;
  definition: DashboardDefinition;
  params: Params;
  labels: Record<string, string>;
  /** One request per underlying query and parameter set, shared by its consuming blocks. */
  requests: DashboardRequest[];
  /** Required parameters without values; when present no requests are made. */
  missing: string[];
  crossFilters: CrossFilterOrigin[];
}
export interface DashboardRequest {
  id: string;
  blockIds: string[];
}
export interface DashboardData {
  blocks: BlockResult[];
  generatedAt: string;
}
export interface CatalogDataset {
  label: string;
  description?: string;
  /** Parameters accepted by the dataset's query. */
  params: readonly string[];
  columns: readonly DatasetColumn[];
}
export interface Catalog {
  pages?: Record<string, PageMetadata>;
  name: string;
  theme: import("./theme").ResolvedTheme;
  description?: string;
  locale: string;
  timezone: string;
  params: Record<string, ParamDefinition>;
  dashboards: Record<string, DashboardDefinition>;
  datasets: Record<string, CatalogDataset>;
}
