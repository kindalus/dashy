/** Browser-safe API for custom pages. Server credentials/config stay outside this module. */
import type { Catalog, PageShell, Params } from "../core/types";
export type { Catalog, PageShell, Params, QueryResult, Scalar } from "../core/types";
export { Spinner } from "./spinner";
export { formatValue } from "./format";
export interface PageProps {
  page: PageShell;
  params: Params;
  catalog: Catalog;
  locale: string;
}
export { paramsSearch, fetchDataset, fetchMetric } from "./page-data";
