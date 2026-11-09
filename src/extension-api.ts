/** Browser-safe API for custom pages. Server credentials/config stay outside this module. */
import type { Catalog, PageShell, Params } from "../core/types";
import type { Language } from "../core/i18n";
export type { Language } from "../core/i18n";
export type { Catalog, PageShell, Params, QueryResult, Scalar } from "../core/types";
export { Spinner } from "./spinner";
export { formatValue } from "./format";
export interface PageProps {
  page: PageShell;
  params: Params;
  catalog: Catalog;
  /** Locale for numbers and dates: the project locale, or the viewer's chosen language when it differs. */
  locale: string;
  /** The interface language the viewer sees. */
  language: Language;
}
export { paramsSearch, fetchDataset, fetchMetric } from "./page-data";
export { fetchOptions as fetchParamOptions } from "./controls";
