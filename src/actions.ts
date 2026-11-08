/** Click actions derived from column parameter annotations. Pure and browser-safe. */
import type {
  Catalog,
  CrossFilterOrigin,
  DashboardDefinition,
  DatasetColumn,
  DatasetDefinition,
  ParamValue,
  Params,
  Row,
  Scalar,
} from "../core/types";

export type ClickAction =
  | { kind: "filter"; param: string; label: string; value: Scalar; display: string }
  | { kind: "clear"; param: string; label: string; display: string }
  | { kind: "open"; dashboard: string; label: string; href: string; display: string };

export interface ActionContext {
  catalog: Catalog;
  dashboardId: string;
  dashboard: DashboardDefinition;
  params: Params;
  crossFilters: readonly CrossFilterOrigin[];
  /** Current location, used for the destination's back link. */
  location: string;
}

export const columnTarget = (column: DatasetColumn) =>
  column.param === undefined
    ? undefined
    : typeof column.param === "string"
      ? { name: column.param, from: column.key }
      : column.param;

const scalarOf = (value: ParamValue | undefined): Scalar | undefined =>
  Array.isArray(value) ? (value.length === 1 ? value[0] : undefined)
    : value !== null && typeof value === "object" ? undefined : value;

/** Encode parameters as Dashy query keys: ranges as .from/.until, arrays repeated. */
export function appendParam(search: URLSearchParams, name: string, value: ParamValue | undefined) {
  if (value === undefined) return;
  if (Array.isArray(value)) {
    if (!value.length) search.set(name, "");
    else value.forEach((item) => search.append(name, item == null ? "" : String(item)));
  } else if (value && typeof value === "object") {
    search.set(`${name}.from`, String(value.from));
    search.set(`${name}.until`, String(value.until));
  } else search.set(name, value == null ? "" : String(value));
}

/** Dashboards a value of `param` can open from this dashboard, in catalog order. */
export function drillthroughTargets(context: ActionContext, param: string): string[] {
  const override = context.dashboard.drillthroughTargets?.[param];
  if (override === false) return [];
  const readable = (id: string) => Object.hasOwn(context.catalog.dashboards, id);
  if (override !== undefined)
    return (typeof override === "string" ? [override] : [...override]).filter(readable);
  return Object.entries(context.catalog.dashboards)
    .filter(([id, d]) => id !== context.dashboardId && d.drillthrough?.param === param)
    .map(([id]) => id);
}

export function drillthroughHref(context: ActionContext, target: string, param: string, value: Scalar): string {
  const destination = context.catalog.dashboards[target]!;
  const search = new URLSearchParams();
  const def = context.catalog.params[param];
  appendParam(search, param, def?.type === "array" ? [value] : value);
  if (destination.drillthrough?.keepFilters !== false)
    for (const name of destination.params ?? [])
      if (name !== param && context.dashboard.params?.includes(name) && Object.hasOwn(context.params, name))
        appendParam(search, name, context.params[name]);
  search.set("_from", context.location);
  return `/dashboards/${encodeURIComponent(target)}?${search}`;
}

/** Whether `param` currently selects exactly `value`. */
export function isSelected(params: Params, param: string, value: Scalar): boolean {
  const current = scalarOf(params[param]);
  return current !== undefined && current !== null && String(current) === String(value);
}

/**
 * Actions for one clicked value. Cross-filter comes first when the dashboard
 * filters by the parameter; drillthrough destinations follow.
 */
export function actionsFor(
  context: ActionContext,
  blockId: string,
  column: DatasetColumn,
  row: Row,
  formatted: string,
): ClickAction[] {
  const target = columnTarget(column);
  if (!target) return [];
  const value = row[target.from];
  if (value === null || value === undefined || value === "") return [];
  const label = context.catalog.params[target.name]?.label ?? target.name;
  const actions: ClickAction[] = [];
  if (context.dashboard.params?.includes(target.name)) {
    const origin = context.crossFilters.some((o) => o.block === blockId && o.param === target.name);
    actions.push(origin && isSelected(context.params, target.name, value)
      ? { kind: "clear", param: target.name, label, display: formatted }
      : { kind: "filter", param: target.name, label, value, display: formatted });
  }
  for (const dashboard of drillthroughTargets(context, target.name))
    actions.push({
      kind: "open", dashboard, label: context.catalog.dashboards[dashboard]!.label,
      href: drillthroughHref(context, dashboard, target.name, value), display: formatted,
    });
  return actions;
}

/** Annotated columns whose values a chart element identifies. */
export function chartColumns(definition: DatasetDefinition, keys: readonly string[]): DatasetColumn[] {
  return definition.columns.filter((column) => keys.includes(column.key) && column.param !== undefined);
}

/** Next params and cross-filter origins after a filter or clear action. */
export function applyAction(
  params: Params,
  crossFilters: readonly CrossFilterOrigin[],
  catalog: Catalog,
  blockId: string,
  action: Extract<ClickAction, { kind: "filter" | "clear" }>,
): { params: Params; crossFilters: CrossFilterOrigin[] } {
  const others = crossFilters.filter((origin) => origin.param !== action.param);
  const next = { ...params };
  if (action.kind === "clear") {
    next[action.param] = catalog.params[action.param]?.type === "array" ? [] : null;
    return { params: next, crossFilters: others };
  }
  next[action.param] = catalog.params[action.param]?.type === "array" ? [action.value] : action.value;
  return { params: next, crossFilters: [...others, { block: blockId, param: action.param }] };
}

/** Accept only same-site dashboard or page paths for the back link. */
export function backLink(catalog: Catalog, from: string | null): { href: string; label: string } | undefined {
  if (!from) return undefined;
  const match = /^\/(dashboards|pages)\/([a-zA-Z][a-zA-Z0-9_-]*)\/?(\?[^#]*)?$/.exec(from);
  if (!match) return undefined;
  const label = match[1] === "dashboards" ? catalog.dashboards[match[2]!]?.label : catalog.pages?.[match[2]!]?.label;
  return label ? { href: from, label } : undefined;
}
