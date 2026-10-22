/** Public contracts. This module is safe to import in the browser. */
export type Scalar = string | number | boolean | null;
export type Row = Record<string, Scalar>;
export type ParamValue =
  | Scalar
  | Scalar[]
  | { from: string | number; until: string | number };
export type Params = Record<string, ParamValue>;
export interface ParamDefinition {
  label: string;
  type: "string" | "number" | "boolean" | "date" | "select" | "array" | "range";
  valueType?: "string" | "number" | "date";
  required?: boolean;
  integer?: boolean;
  min?: number;
  max?: number;
  default?: ParamValue;
  options?: readonly { label: string; value: string | number }[];
  description?: string;
}
export type SourceDefinition = {
  type:
    | "csv"
    | "json"
    | "parquet"
    | "sqlite"
    | "duckdb"
    | "excel"
    | (string & {});
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
  build(context: QueryContext): SqlStatement;
}
export interface Format {
  style?: "number" | "currency" | "percent" | "text" | "date";
  currency?: string;
  decimals?: number;
}
export interface DatasetDefinition {
  label: string;
  description?: string;
  query: string;
  columns: readonly { key: string; label: string; format?: Format }[];
  chart?: {
    type: "line" | "bar";
    x: string;
    series: readonly {
      key: string;
      label: string;
      color?: string;
      format?: Format;
    }[];
  };
  roles?: readonly string[];
}
export interface MetricDefinition {
  label: string;
  description?: string;
  query: string;
  column: string;
  format?: Format;
  roles?: readonly string[];
}
export type DashboardBlock = { id: string; width?: number } & (
  | { type: "metric"; metric: string }
  | { type: "dataset"; dataset: string; view?: "chart" | "table" }
);
export interface DashboardDefinition {
  label: string;
  /** A supported Lucide icon name; defaults to layout-dashboard. */
  icon?: import("./icons").DashboardIconName;
  /** Navigation section label. Omitted dashboards belong to Dashboards. */
  group?: string;
  description?: string;
  params?: readonly string[];
  defaults?: Params;
  roles?: readonly string[];
  blocks: readonly DashboardBlock[];
}
/** The component path is relative to the implementation's extensions directory. */
export interface PageDefinition extends Omit<DashboardDefinition, "blocks"> {
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
  roles: readonly string[];
}
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

export interface ProjectDefinition {
  name: string;
  theme?: import("./theme").ThemeConfig;
  description?: string;
  locale?: string;
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
  /** Server-only adapters for additional source types. */
  adapters?: Record<string, import("./sources").SourceAdapter>;
  /** Optional application-owned authentication. Return null for an unauthenticated request. */
  authenticate?: (
    request: Request,
  ) => Principal | null | Promise<Principal | null>;
}
export interface QueryResult {
  columns: string[];
  rows: Row[];
  truncated: boolean;
  durationMs: number;
}
export type BlockResult = { id: string } & (
  | { type: "metric"; definition: MetricDefinition; value: Scalar }
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
/** Initial page metadata, without executing queries or reading sources. */
export interface DashboardShell {
  id: string;
  definition: DashboardDefinition;
  params: Params;
  labels: Record<string, string>;
  /** One request per underlying query, shared by all its consuming blocks. */
  requests: DashboardRequest[];
}
export interface DashboardRequest {
  id: string;
  blockIds: string[];
}
export interface DashboardData {
  blocks: BlockResult[];
  generatedAt: string;
}
export interface Catalog {
  pages?: Record<string, PageMetadata>;
  name: string;
  theme: import("./theme").ResolvedTheme;
  description?: string;
  locale: string;
  params: Record<string, ParamDefinition>;
  dashboards: Record<string, DashboardDefinition>;
}
