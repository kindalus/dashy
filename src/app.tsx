import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
  onSettled,
  untrack,
} from "solid-js";
import type {
  BlockResult,
  DashboardBlock,
  Catalog,
  CrossFilterOrigin,
  DashboardShell,
  DatasetColumn,
  DatasetDefinition,
  Params,
  QueryResult,
  PageShell,
  Row,
  TableSort,
} from "../core/types";
import { Chart } from "./chart";
import { formatValue } from "./format";
import { Workspace } from "./workspace";
import { PageContent } from "./page-content";
import type { Component } from "solid-js";
import type { PageProps } from "./extension-api";
import { Spinner } from "./spinner";
import {
  DashboardLoader, dashboardSearchParams, type DashboardLoads,
} from "./dashboard-loader";
import { ParameterControl } from "./controls";
import {
  actionsFor, applyAction, backLink, chartColumns, columnTarget, drillAction, drillColumn, drillDown, drillthroughTargets,
  drillTo, selectionFor, type ActionContext, type ClickAction,
} from "./actions";
import { appendDrilldowns, describeDrilldown, levelLabel } from "../core/drilldown";
import { chartKeyColumns } from "../core/charts";
import { applyTopN, isOtherRow, labelColumn, shapeTable, summaryLabel, topNChoices, type TableRow } from "../core/tables";
import { compareMetric, sparklinePaths, targetProgress } from "./metric-compare";
import { describeFilters, filterValue } from "../core/filters";
import { installPrint, printing } from "./print";
import type { ChartSnapshot } from "./chart";
import type { ThemeName } from "../core/theme";
import { applyTheme, ThemeContext } from "./theme-picker";

export interface AppProps {
  catalog: Catalog;
  dashboard: DashboardShell | null;
  page?: PageShell;
  /** The theme rendered for this viewer: the project theme or their saved choice. */
  theme?: ThemeName;
}
export function App(props: AppProps & { Page?: Component<PageProps> }) {
  const selected = props.page ? `/pages/${props.page.id}` : props.dashboard ? `/dashboards/${props.dashboard.id}` : undefined;
  const [theme, setTheme] = createSignal<ThemeName>(untrack(() => props.theme ?? props.catalog.theme.name));
  const changeTheme = (name: ThemeName) => setTheme(applyTheme(props.catalog.theme, name));
  return <ThemeContext value={theme}>
    <Workspace catalog={props.catalog} selected={selected}
      label={props.page?.definition.label ?? props.dashboard?.definition.label}
      kind={props.page ? "Pages" : "Dashboards"}
      theme={theme()} onThemeChange={changeTheme}>
      {props.page && props.Page
        ? <PageContent page={props.page} catalog={props.catalog} component={props.Page} />
        : <DashboardContent {...props} />}
    </Workspace>
  </ThemeContext>;
}

interface MenuState {
  x: number;
  y: number;
  blockId: string;
  title: string;
  actions: ClickAction[];
}
/** Per-block interaction handed to datasets: resolves and runs click actions. */
export interface BlockInteraction {
  columns: (definition: DatasetDefinition) => DatasetColumn[];
  /** A table cell (with its column) or a chart element (column undefined, or the identified one). */
  select: (definition: DatasetDefinition, column: DatasetColumn | undefined, row: Row, event?: MouseEvent | KeyboardEvent, chart?: boolean) => void;
  /** The block's drill-down path; empty at the top level. */
  drillPath: () => readonly string[];
  /** Return to a depth: 0 is the top level. */
  drillTo: (depth: number) => void;
  selection: (definition: DatasetDefinition) => ((row: Row) => boolean) | undefined;
  /** Download URL for this block as shown: filters, cross-filters, sort and Top N choice. */
  exportHref: (format: "csv" | "xlsx", sort: TableSort | undefined, top: number | undefined) => string | undefined;
  /** The filters this block applies, as one line for image captions. */
  caption: () => string;
  /** File name stem for images: dashboard and block. */
  filename: () => string;
}

function DashboardContent(props: AppProps) {
  const [shell, setShell] = createSignal(untrack(() => props.dashboard));
  let loader = untrack(() => props.dashboard) ? new DashboardLoader(untrack(() => props.dashboard)!, (state) => setLoads(state)) : undefined;
  const [loads, setLoads] = createSignal<DashboardLoads>(loader?.state || {});
  const [draft, setDraft] = createSignal<Params>(untrack(() => ({ ...props.dashboard?.params })));
  const [menu, setMenu] = createSignal<MenuState>();
  const [from, setFrom] = createSignal<string | null>(null);
  // Plain copy for building URLs synchronously; the signal drives the back link.
  let fromParam: string | null = null;
  const definition = () => shell()?.definition;
  const locale = () => props.catalog.locale;
  const groupIds = createMemo(() => new Map(shell()?.requests.flatMap(
    (group) => group.blockIds.map((id) => [id, group.id] as const),
  )));
  const stateFor = (id: string) => loads()[groupIds().get(id)!];
  // Keep each block's last result while new filters load, so views and data stay in place.
  let previous = new Map<string, BlockResult>();
  const blocks = createMemo(() => {
    const next = new Map(previous);
    for (const group of Object.values(loads()))
      for (const block of group.data?.blocks || []) next.set(block.id, block);
    previous = next;
    return next;
  });
  const updateStatus = createMemo(() => {
    if (!shell()) return "No dashboards configured";
    if (shell()!.missing.length) return "";
    const groups = Object.values(loads());
    const pending = groups.filter((group) => group.loading).length;
    if (pending) return `Loading data (${groups.length - pending}/${groups.length})…`;
    if (groups.some((group) =>
      group.error || group.data?.blocks.some((block) => block.type === "error"),
    ))
      return "Some data could not be loaded. Retry the affected panels.";
    const updated = groups.map((group) => group.data?.generatedAt || "")
      .sort().at(-1);
    if (!updated) return "No blocks configured";
    return `Updated ${new Intl.DateTimeFormat(locale(), { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(updated))} UTC`;
  });
  const search = (
    current: DashboardShell, params: Params, crossFilters: readonly CrossFilterOrigin[],
    drilldowns: Record<string, readonly string[]> = current.drilldowns,
  ) => {
    const query = dashboardSearchParams({ ...current, params });
    for (const origin of crossFilters) query.append("_xf", `${origin.block}:${origin.param}`);
    appendDrilldowns(query, drilldowns);
    if (fromParam) query.set("_from", fromParam);
    return query;
  };
  let generation = 0;
  /** Drill-down paths survive cross-filters and refreshes; new dashboard filters start at the top level. */
  async function apply(
    params: Params, crossFilters: readonly CrossFilterOrigin[] = [], refresh = false,
    drilldowns?: Record<string, readonly string[]>,
  ) {
    const current = shell();
    if (!current) return;
    const query = search(current, params, crossFilters, drilldowns ?? current.drilldowns);
    history.replaceState(null, "", `${location.pathname}${query.size ? `?${query}` : ""}`);
    setMenu(undefined);
    const run = ++generation;
    try {
      // Request groups depend on cross-filters and required filters, so ask the server.
      const response = await fetch(`/api/dashboard-shell/${encodeURIComponent(current.id)}?${query}`, { credentials: "same-origin" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to apply filters");
      if (run !== generation) return;
      const next = body as DashboardShell;
      loader?.dispose();
      loader = new DashboardLoader(next, (state) => setLoads(state));
      setShell(next);
      setDraft({ ...next.params });
      setLoads(loader.state);
      if (refresh) query.set("refresh", "true");
      if (!next.missing.length) void loader.load(query);
    } catch (error) {
      if (run !== generation) return;
      setLoads(Object.fromEntries(current.requests.map(({ id }) => [id, {
        ...loads()[id], loading: false, error: error instanceof Error ? error.message : "Unable to apply filters",
      }])));
    }
  }
  onSettled(() => {
    installPrint();
    fromParam = new URLSearchParams(location.search).get("_from");
    setFrom(fromParam);
    const current = shell();
    if (current && !current.missing.length) {
      const query = search(current, current.params, current.crossFilters);
      history.replaceState(null, "", `${location.pathname}${query.size ? `?${query}` : ""}`);
      void loader!.load(query);
    }
    return () => loader?.dispose();
  });
  const back = () => backLink(props.catalog, from());
  const context = (): ActionContext | undefined => {
    const current = shell();
    if (!current) return undefined;
    return {
      catalog: props.catalog, dashboardId: current.id, dashboard: current.definition,
      params: current.params, crossFilters: current.crossFilters,
      location: `${location.pathname}${location.search}`,
    };
  };
  const run = (blockId: string, action: ClickAction) => {
    setMenu(undefined);
    const current = shell();
    if (!current) return;
    if (action.kind === "open") {
      location.href = action.href;
      return;
    }
    if (action.kind === "drill") {
      void apply(current.params, current.crossFilters, false, drillDown(current.drilldowns, blockId, action.value));
      return;
    }
    const next = applyAction(current.params, current.crossFilters, props.catalog, blockId, action);
    void apply(next.params, next.crossFilters);
  };
  const depthOf = (blockId: string) => shell()?.drilldowns[blockId]?.length ?? 0;
  const interaction = (blockId: string): BlockInteraction => ({
    columns: (dataset) => {
      const ctx = context();
      if (!ctx) return [];
      const drilling = drillColumn(dataset, depthOf(blockId));
      return dataset.columns.filter((column) => {
        if (column.key === drilling) return true;
        const target = columnTarget(column);
        return target && (ctx.dashboard.params?.includes(target.name) || drillthroughTargets(ctx, target.name).length > 0);
      });
    },
    select: (dataset, column, row, event, chart = false) => {
      const ctx = context();
      if (!ctx) return;
      const depth = depthOf(blockId);
      const drilling = drillColumn(dataset, depth);
      const formatOf = (key: string) => dataset.columns.find((c) => c.key === key)?.format;
      // Charts drill from any element; tables from the drill-down column's cells.
      const drill = chart || column?.key === drilling
        ? drillAction(dataset, depth, row, (value) => formatValue(value, formatOf(drilling!), locale())) : undefined;
      const shown = column ?? dataset.columns.find((c) => c.key === drilling);
      const display = shown ? formatValue(row[shown.key] ?? null, shown.format, locale()) : "";
      const actions = [...(drill ? [drill] : []), ...(column ? actionsFor(ctx, blockId, column, row, display) : [])];
      if (!actions.length) return;
      if (actions.length === 1) return run(blockId, actions[0]!);
      const target = event?.target instanceof Element ? event.target.getBoundingClientRect() : undefined;
      const pointer = event && "clientX" in event && event.clientX ? { x: event.clientX, y: event.clientY } : undefined;
      setMenu({
        x: pointer?.x ?? target?.left ?? innerWidth / 2,
        y: pointer?.y ?? (target ? target.bottom : innerHeight / 2),
        blockId, title: `${dataset.label}: ${display}`, actions,
      });
    },
    drillPath: () => shell()?.drilldowns[blockId] ?? [],
    drillTo: (depth) => {
      const current = shell();
      if (current) void apply(current.params, current.crossFilters, false, drillTo(current.drilldowns, blockId, depth));
    },
    selection: (dataset) => {
      const current = shell();
      return current ? selectionFor(current.params, current.crossFilters, blockId, dataset.columns) : undefined;
    },
    exportHref: (format, sort, top) => {
      const current = shell();
      if (!current || current.missing.length) return undefined;
      const query = search(current, current.params, current.crossFilters);
      query.delete("_from");
      query.set("_format", format);
      // An empty _sort keeps the query's order; omitting it would apply defaultSort.
      query.set("_sort", sort ? `${sort.column}:${sort.direction}` : "");
      if (top !== undefined) query.set("_top", String(top));
      return `/api/dashboard-export/${encodeURIComponent(current.id)}/${encodeURIComponent(blockId)}?${query}`;
    },
    caption: () => {
      const current = shell();
      if (!current) return "";
      // Same rule as exports: the block's own cross-filters and unfiltered parameters do not apply.
      const ignored = new Set([
        ...current.crossFilters.filter((origin) => origin.block === blockId).map((origin) => origin.param),
        ...(current.definition.unfiltered?.[blockId] ?? []),
      ]);
      // Only filters that narrow the data, so the caption stays short.
      const set = (name: string) => filterValue(current.params[name], props.catalog.params[name]!) !== "All";
      const filters = describeFilters((current.definition.params ?? []).filter((name) => !ignored.has(name) && set(name)),
        current.params, props.catalog.params);
      const block = blocks().get(blockId);
      const path = current.drilldowns[blockId] ?? [];
      const drill = block?.type === "dataset" && path.length
        ? describeDrilldown(block.definition, path, (value, depth) => drillValue(block.definition, depth, value, locale())) : "";
      return [filters, drill].filter(Boolean).join(" · ");
    },
    filename: () => `${shell()?.id ?? "dashboard"}-${blockId}`,
  });
  // Printed under the title: every filter, noting the blocks a cross-filter does not apply to.
  const filterSummary = () => {
    const current = shell();
    if (!current) return "";
    const notes: Record<string, string> = {};
    for (const origin of current.crossFilters)
      notes[origin.param] = `not applied to ${current.labels[origin.block] ?? origin.block}`;
    return describeFilters(current.definition.params ?? [], current.params, props.catalog.params, notes);
  };
  return (
    <>
          <Show when={back()}>
            {(link) => <a class="back-link" href={link().href}><span aria-hidden="true">←</span> {link().label}</a>}
          </Show>
          <div class="page-heading">
            <div>
              <h1>{definition()?.label || "Your dashboards"}</h1>
              <p>
                {definition()
                  ? definition()?.description
                  : "Add a dashboard to your project configuration to get started."}
              </p>
            </div>
            <Show when={shell() && !shell()!.missing.length}>
              <div class="page-actions">
                <button class="button secondary" onClick={() => print()}>Print / PDF</button>
                <button
                  class="button secondary"
                  onClick={() => void apply(shell()!.params, shell()!.crossFilters, true)}
                >
                  Refresh
                </button>
              </div>
            </Show>
          </div>
          <Show when={filterSummary()}>
            <p class="print-summary">{filterSummary()}</p>
          </Show>
          <Show when={(definition()?.params?.length || 0) > 0}>
            <form
              class="filters"
              onSubmit={(event) => { event.preventDefault(); void apply(draft(), [], false, {}); }}
              autocomplete="off"
            >
              <For each={definition()?.params || []}>
                {(name) => (
                  <ParameterControl
                    name={name}
                    definition={props.catalog.params[name]!}
                    value={draft()[name]}
                    onChange={(value) => setDraft({ ...draft(), [name]: value ?? null })}
                    timezone={props.catalog.timezone}
                    context={draft}
                  />
                )}
              </For>
              <div class="filter-actions">
                <button class="button primary" type="submit">Apply filters</button>
                <button class="button text" type="button" onClick={() => { location.href = location.pathname; }}>Reset</button>
              </div>
            </form>
          </Show>
          <Show when={shell()?.crossFilters.length}>
            <div class="cross-filters" aria-label="Active cross-filters">
              <For each={shell()!.crossFilters}>
                {(origin) => (
                  <span class="chip">
                    {props.catalog.params[origin.param]?.label}: {String(shell()!.params[origin.param] ?? "")}
                    <button type="button" aria-label={`Clear ${props.catalog.params[origin.param]?.label} filter`}
                      onClick={() => run(origin.block, { kind: "clear", param: origin.param, label: "", display: "" })}>×</button>
                  </span>
                )}
              </For>
            </div>
          </Show>
          <Show when={shell()?.missing.length}>
            <div class="required-state" role="status">
              Select {shell()!.missing.map((name) => props.catalog.params[name]?.label ?? name).join(", ")} to load this dashboard.
            </div>
          </Show>
          <div class="update-status" role="status" aria-live="polite">
            {updateStatus()}
          </div>
          <noscript>Enable JavaScript to load dashboard data.</noscript>
          <Show when={shell() && !shell()!.missing.length}>
            <section
              class="dashboard-grid"
              aria-label="Dashboard results"
            >
              <For each={definition()?.blocks || []} keyed={(block) => block.id}>
                {(layout) => (
                  <DashboardCard
                    block={blocks().get(layout().id)}
                    layout={layout()}
                    label={shell()!.labels[layout().id]!}
                    loading={stateFor(layout().id)?.loading ?? false}
                    loadError={stateFor(layout().id)?.error || ""}
                    retry={() => void loader?.retry(groupIds().get(layout().id)!)}
                    locale={locale()}
                    unfiltered={(definition()?.unfiltered?.[layout().id] ?? []).map((name) => props.catalog.params[name]?.label ?? name)}
                    interaction={interaction(layout().id)}
                  />
                )}
              </For>
            </section>
          </Show>
          <Show when={menu()}>
            {(state) => <ActionMenu state={state()} close={() => setMenu(undefined)} run={(action) => run(state().blockId, action)} />}
          </Show>
    </>
  );
}

function ActionMenu(props: { state: MenuState; close: () => void; run: (action: ClickAction) => void }) {
  let element!: HTMLDivElement;
  const label = (action: ClickAction) =>
    action.kind === "drill" ? `Drill down to ${action.label}`
    : action.kind === "filter" ? `Filter by ${action.label}`
      : action.kind === "clear" ? `Clear ${action.label} filter`
        : `Open ${action.label}`;
  onSettled(() => {
    // Keep the menu inside the viewport and move focus into it.
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(props.state.x, innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(props.state.y + 6, innerHeight - rect.height - 8))}px`;
    element.querySelector<HTMLButtonElement>("button")?.focus();
    const pointer = (event: PointerEvent) => { if (!element.contains(event.target as Node)) props.close(); };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.close();
      const items = [...element.querySelectorAll<HTMLButtonElement>("button")];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "ArrowDown") { event.preventDefault(); items[(index + 1) % items.length]?.focus(); }
      if (event.key === "ArrowUp") { event.preventDefault(); items[(index - 1 + items.length) % items.length]?.focus(); }
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", key);
    };
  });
  return (
    <div class="action-menu" ref={element} role="menu" aria-label={props.state.title} style={{ left: `${props.state.x}px`, top: `${props.state.y}px` }}>
      <div class="action-menu-title">{props.state.title}</div>
      <For each={props.state.actions}>
        {(action) => <button type="button" role="menuitem" onClick={() => props.run(action)}>{label(action)}</button>}
      </For>
    </div>
  );
}

function DashboardCard(props: {
  block?: BlockResult;
  layout: DashboardBlock;
  label: string;
  loading: boolean;
  loadError: string;
  retry: () => void;
  locale: string;
  unfiltered: string[];
  interaction: BlockInteraction;
}) {
  const metric = () =>
    props.block?.type === "metric" ? props.block : undefined;
  const dataset = () =>
    props.block?.type === "dataset" ? props.block : undefined;
  const error = () => (props.block?.type === "error" ? props.block : undefined);
  return (
    <article
      class={`block ${props.layout.type === "metric" ? "metric-block" : "data-block"}`}
      style={{
        "--span": String(props.layout.width || (props.layout.type === "metric" ? 3 : 6)),
      }}
      aria-label={props.label}
      aria-busy={props.loading ? "true" : "false"}
    >
      <Show when={!props.block}>
        <div class="block-placeholder">
          <h2>{props.label}</h2>
        </div>
      </Show>
      <div
        class={`block-content${props.loading ? " is-pending" : ""}`}
        inert={props.loading}
        aria-hidden={props.loading ? "true" : undefined}
      >
        <Show when={error()}>
          {(block) => (
            <div class="block-error">
              <h2>Block unavailable</h2>
              <p>{block().message}</p>
              <button class="button secondary" onClick={props.retry}>Try again</button>
            </div>
          )}
        </Show>
        <Show when={metric()}>
          {(block) => (
            <>
              <h2>{block().definition.label}</h2>
              <div class="metric-value">
                {formatValue(
                  block().value,
                  block().definition.format,
                  props.locale,
                )}
              </div>
              <Show when={compareMetric(block().definition, block().value, block().compare, props.locale)}>
                {(change) => (
                  <p class={`metric-compare tone-${change().tone}`}>
                    <span class="metric-arrow" aria-hidden="true">
                      {change().direction === "up" ? "▲" : change().direction === "down" ? "▼" : "▬"}
                    </span>
                    <span aria-hidden="true">{change().change} {change().label}</span>
                    <span class="visually-hidden">{change().description}</span>
                  </p>
                )}
              </Show>
              <Show when={targetProgress(block().definition, block().value, block().target, props.locale)}>
                {(goal) => (
                  <div class="metric-target">
                    <div class="metric-target-track" role="meter" aria-label={goal().label}
                      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(goal().ratio * 100)}
                      aria-valuetext={`${goal().percent} of ${goal().label} ${goal().target}`}>
                      <div class="metric-target-fill" style={{ width: `${goal().ratio * 100}%` }} />
                    </div>
                    <span aria-hidden="true">{goal().percent} of {goal().label} {goal().target}</span>
                  </div>
                )}
              </Show>
              <Show when={sparklinePaths(block().sparkline ?? [], 120, 28)}>
                {(paths) => (
                  <Show when={paths().length}>
                    <svg class="metric-sparkline" viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true">
                      <For each={paths()}>{(points) => <polyline points={points} />}</For>
                    </svg>
                  </Show>
                )}
              </Show>
              <Show when={block().definition.description}>
                <p class="metric-description">{block().definition.description}</p>
              </Show>
            </>
          )}
        </Show>
        <Show when={dataset()}>
          {(block) => (
            <Dataset
              id={props.layout.id}
              definition={block().definition}
              result={block().result}
              initialView={
                props.layout?.type === "dataset" ? props.layout.view : undefined
              }
              locale={props.locale}
              interaction={props.interaction}
            />
          )}
        </Show>
        <Show when={props.unfiltered.length && props.block}>
          <p class="unfiltered-note">Not filtered by {props.unfiltered.join(", ")}</p>
        </Show>
      </div>
      <Show when={props.loadError && !props.loading}>
        <div class="block-error" role="alert">
          <p>{props.loadError}</p>
          <Show when={props.block}><p>Showing previous data.</p></Show>
          <button class="button secondary" onClick={props.retry}>Try again</button>
        </div>
      </Show>
      <Show when={props.loading}>
        <div class="block-loading">
          <Spinner />
          <span>{props.block ? "Updating…" : "Loading…"}</span>
        </div>
      </Show>
    </article>
  );
}

const PRINT_ROWS = 2000;

/** Download menu: closes after a choice, on Escape and on a click outside. */
function ExportMenu(props: {
  label: string;
  href: (format: "csv" | "xlsx") => string | undefined;
  /** Saves the visible chart; absent in table view. */
  image?: (type: "png" | "svg") => void;
}) {
  let element!: HTMLDetailsElement;
  const close = () => { element.open = false; };
  const outside = (event: PointerEvent) => { if (!element.contains(event.target as Node)) close(); };
  const toggle = () => {
    if (element.open) document.addEventListener("pointerdown", outside);
    else document.removeEventListener("pointerdown", outside);
  };
  onSettled(() => () => document.removeEventListener("pointerdown", outside));
  return (
    <details class="export-menu" ref={element} onToggle={toggle}
      onKeyDown={(event) => { if (event.key === "Escape" && element.open) { close(); element.querySelector("summary")?.focus(); } }}>
      <summary aria-label={`Download ${props.label}`}>Download</summary>
      <div class="export-options" onClick={close}>
        <a href={props.href("csv")} download>CSV</a>
        <a href={props.href("xlsx")} download>Excel (.xlsx)</a>
        <Show when={props.image}>
          {(image) => (
            <>
              <button type="button" onClick={() => image()("png")}>Image (.png)</button>
              <button type="button" onClick={() => image()("svg")}>Image (.svg)</button>
            </>
          )}
        </Show>
      </div>
    </details>
  );
}

function Dataset(props: {
  id: string;
  definition: DatasetDefinition;
  result: QueryResult;
  initialView?: "chart" | "table";
  locale: string;
  interaction: BlockInteraction;
}) {
  const [view, setView] = createSignal(
    untrack(
      () => props.initialView || (props.definition.chart ? "chart" : "table"),
    ),
  );
  const [page, setPage] = createSignal(0);
  const [sort, setSort] = createSignal<TableSort | undefined>(untrack(() => props.definition.defaultSort));
  const [limit, setLimit] = createSignal(untrack(() =>
    props.definition.topN ? topNChoices(props.definition.topN).initial : 0));
  const complete = () => !props.result.truncated;
  const ranked = createMemo(() => applyTopN(props.result.rows, props.definition, limit(), complete()));
  // Charts and tables show the same Top N rows; the table also sorts, groups and totals them.
  const shown = createMemo(() => ranked().rows === props.result.rows
    ? props.result : { ...props.result, rows: [...ranked().rows] });
  const table = createMemo(() =>
    shapeTable(ranked().rows, props.definition, sort(), props.locale, complete(), ranked().members));
  // A drill-down level can have other columns: drop a sort the new level cannot apply.
  createEffect(
    () => props.definition.columns,
    (columns) => {
      const current = untrack(sort);
      if (current && !columns.some((column) => column.key === current.column)) setSort(props.definition.defaultSort);
    },
  );
  const pageSize = 8;
  const pageCount = () =>
    Math.max(1, Math.ceil(table().rows.length / pageSize));
  // Keep the selected view across refreshes, but start new results, orders and Top N choices on page one.
  createEffect(
    () => [props.result, sort(), limit()],
    () => {
      setPage(0);
    },
  );
  const currentPage = () => Math.min(page(), pageCount() - 1);
  // Printing shows every row up to a cap (more would freeze the page and fill hundreds
  // of sheets); on screen, one page at a time.
  const pageRows = () => printing() ? table().rows.slice(0, PRINT_ROWS) : table().rows.slice(
      currentPage() * pageSize,
      (currentPage() + 1) * pageSize,
    );
  let snapshot: (() => ChartSnapshot | undefined) | undefined;
  const [imageError, setImageError] = createSignal("");
  const saveImage = async (type: "png" | "svg") => {
    setImageError("");
    try {
      const shot = snapshot?.();
      if (!shot) throw new Error("Chart not ready");
      const { saveChartImage } = await import("./chart-image");
      await saveChartImage({ ...shot, title: props.definition.label, caption: props.interaction.caption() }, type, props.interaction.filename());
    } catch (error) {
      console.error("[dashy] Image export failed", error);
      setImageError("The image could not be saved. Try the other format or Print / PDF.");
    }
  };
  const sortFor = (key: string) => sort()?.column === key ? sort()!.direction : undefined;
  // Ascending, descending, then back to the query's order.
  const cycleSort = (key: string) => setSort(
    sortFor(key) === "asc" ? { column: key, direction: "desc" } : sortFor(key) === "desc" ? undefined : { column: key, direction: "asc" });
  const totalLabel = () => labelColumn(props.definition);
  // Truncated results skip what would be wrong on partial data.
  const unavailable = () => [
    props.definition.totals || props.definition.subtotals ? "totals" : "",
    props.definition.topN ? "Top N" : "",
  ].filter(Boolean).join(" and ");
  const interactive = createMemo(() => new Set(props.interaction.columns(props.definition).map((c) => c.key)));
  // The synthetic "Other" row is never a selection, even when a real value shares its label.
  const selection = createMemo(() => {
    const selected = props.interaction.selection(props.definition);
    return selected && ((row: Row) => !isOtherRow(row) && selected(row));
  });
  const chartTargets = createMemo(() =>
    props.definition.chart
      ? chartColumns(props.definition, chartKeyColumns(props.definition.chart)).filter((c) => interactive().has(c.key))
      : []);
  const depth = () => props.interaction.drillPath().length;
  const drillable = () => drillColumn(props.definition, depth()) !== undefined;
  const chartSelect = (row: Row, event: MouseEvent | undefined) => {
    if (isOtherRow(row)) return;
    // The deepest identified column wins (e.g. a treemap leaf over its parent).
    const column = [...chartTargets()].reverse().find((c) => {
      const target = columnTarget(c);
      return target && row[target.from] !== undefined && row[target.from] !== null;
    });
    if (column || drillable()) props.interaction.select(props.definition, column, row, event, true);
  };
  return (
    <>
      <div class="block-heading">
        <div>
          <h2>{props.definition.label}</h2>
          <Show when={props.definition.description}>
            <p>{props.definition.description}</p>
          </Show>
          <Show when={props.definition.drilldown}>
            <DrillPath definition={props.definition} path={props.interaction.drillPath()} locale={props.locale}
              go={props.interaction.drillTo} />
          </Show>
        </div>
        <div class="block-tools">
        <Show when={imageError()}>
          <p class="image-error" role="alert">{imageError()}</p>
        </Show>
        <ExportMenu label={props.definition.label}
          href={(format) => props.interaction.exportHref(format, sort(), props.definition.topN ? limit() : undefined)}
          image={view() === "chart" && props.definition.chart ? saveImage : undefined} />
        <Show when={props.definition.topN}>
          {(topN) => (
            <label class="top-n">
              <span class="visually-hidden">Rows shown in {props.definition.label}</span>
              <select name={`${props.id}-top-n`} disabled={!complete()}
                onChange={(event) => setLimit(Number(event.currentTarget.value))}>
                <For each={topNChoices(topN()).options}>
                  {(n) => (
                    <option value={String(n)} selected={(complete() ? limit() : 0) === n}>
                      {topN().order === "bottom" ? "Bottom" : "Top"} {n}
                    </option>
                  )}
                </For>
                <option value="0" selected={!complete() || limit() === 0}>All</option>
              </select>
            </label>
          )}
        </Show>
        <Show when={props.definition.chart}>
          <div
            class="view-toggle"
            role="group"
            aria-label={`View ${props.definition.label}`}
          >
            <button
              aria-pressed={view() === "chart" ? "true" : "false"}
              onClick={() => setView("chart")}
            >
              Chart
            </button>
            <button
              aria-pressed={view() === "table" ? "true" : "false"}
              onClick={() => setView("table")}
            >
              Table
            </button>
          </div>
        </Show>
        </div>
      </div>
      <Show
        when={props.result.rows.length}
        fallback={
          <div class="empty-state">
            No results for these filters. Try a different period or selection.
          </div>
        }
      >
        <Show
          when={view() === "chart" && props.definition.chart}
          fallback={
            <>
              <div
                class="table-scroll"
                tabindex={0}
                role="region"
                aria-label={`${props.definition.label} table`}
              >
                <table>
                  <thead>
                    <tr>
                      <For each={props.definition.columns}>
                        {(column) => (
                          <th scope="col" aria-sort={sortFor(column.key) === "asc" ? "ascending" : sortFor(column.key) === "desc" ? "descending" : undefined}>
                            {/* Print uses plain text: Chrome repeats header rows on each page but drops button text. */}
                            <Show when={!printing()}
                              fallback={`${column.label}${sortFor(column.key) === "asc" ? " ▲" : sortFor(column.key) === "desc" ? " ▼" : ""}`}>
                              <button type="button" class="sort-button" onClick={() => cycleSort(column.key)}>
                                {column.label}
                                <span class="sort-indicator" aria-hidden="true">
                                  {sortFor(column.key) === "asc" ? "▲" : sortFor(column.key) === "desc" ? "▼" : ""}
                                </span>
                              </button>
                            </Show>
                          </th>
                        )}
                      </For>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={pageRows()}>
                      {(entry: TableRow) => entry.kind === "subtotal" ? (
                        <tr class="subtotal-row" data-level={String(entry.level)}>
                          <For each={props.definition.columns}>
                            {(column) => (
                              <td>
                                {column.key === entry.column
                                  ? summaryLabel(formatValue(entry.row[column.key] ?? null, column.format, props.locale))
                                  : column.aggregate ? formatValue(entry.row[column.key] ?? null, column.format, props.locale) : ""}
                              </td>
                            )}
                          </For>
                        </tr>
                      ) : (
                        <tr class={[selection()?.(entry.row) ? "is-selected" : "", isOtherRow(entry.row) ? "other-row" : ""].filter(Boolean).join(" ")}>
                          <For each={props.definition.columns}>
                            {(column) => {
                              const row = entry.row;
                              const text = () => formatValue(row[column.key] ?? null, column.format, props.locale);
                              const target = columnTarget(column);
                              const source = target?.from ?? column.key;
                              const clickable = () => interactive().has(column.key) && !isOtherRow(row)
                                && row[source] !== null && row[source] !== undefined;
                              return (
                                <td>
                                  <Show when={clickable()} fallback={text()}>
                                    <button type="button" class="cell-action"
                                      onClick={(event) => props.interaction.select(props.definition, column, row, event)}>
                                      {text()}
                                    </button>
                                  </Show>
                                </td>
                              );
                            }}
                          </For>
                        </tr>
                      )}
                    </For>
                  </tbody>
                  <Show when={table().totals}>
                    {(totals) => (
                      <tfoot>
                        <tr class="total-row">
                          <For each={props.definition.columns}>
                            {(column) => (
                              <td>
                                {column.key === totalLabel() ? "Total"
                                  : column.aggregate ? formatValue(totals()[column.key] ?? null, column.format, props.locale) : ""}
                              </td>
                            )}
                          </For>
                        </tr>
                      </tfoot>
                    )}
                  </Show>
                </table>
              </div>
              <div class="table-footer">
                <span>
                  {ranked().hidden ? `${props.definition.topN?.order === "bottom" ? "Bottom" : "Top"} ${ranked().rows.filter((row) => !isOtherRow(row)).length} of ${props.result.rows.length} rows` : `${props.result.rows.length} rows`}
                  {props.result.truncated ? ` · Row limit reached${unavailable() ? `; ${unavailable()} unavailable` : ""}` : ""}
                  {printing() && table().rows.length > PRINT_ROWS
                    ? ` · Printed the first ${PRINT_ROWS.toLocaleString(props.locale)} rows; download CSV or Excel for all` : ""}
                </span>
                <div>
                  <button
                    aria-label={`Previous page of ${props.definition.label}`}
                    disabled={currentPage() === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </button>
                  <span>
                    {currentPage() + 1} / {pageCount()}
                  </span>
                  <button
                    aria-label={`Next page of ${props.definition.label}`}
                    disabled={currentPage() + 1 >= pageCount()}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          }
        >
          <Chart
            definition={props.definition}
            result={shown()}
            locale={props.locale}
            selected={selection()}
            onSelect={chartTargets().length || drillable() ? chartSelect : undefined}
            register={(next) => { snapshot = next; }}
          />
        </Show>
      </Show>
    </>
  );
}

/** A drill-down value as shown: periods by grain, other values as text. */
function drillValue(definition: DatasetDefinition, depth: number, value: string, locale: string): string {
  const grain = definition.drilldown?.[depth]?.grain;
  return grain ? formatValue(value, { style: "date", grain }, locale) : value;
}

/** Breadcrumb for a drill-down block: the top level, each clicked value, then the level shown. */
function DrillPath(props: { definition: DatasetDefinition; path: readonly string[]; locale: string; go: (depth: number) => void }) {
  const levels = () => props.definition.drilldown ?? [];
  const depth = () => props.path.length;
  return (
    <Show when={depth() > 0} fallback={
      <p class="drill-hint">
        Click a {levelLabel(props.definition, 0).toLowerCase()} to drill down to {levelLabel(props.definition, 1).toLowerCase()}
      </p>
    }>
      <nav class="drill-path" aria-label={`${props.definition.label} drill-down`}>
        <button type="button" class="drill-up" aria-label="Up one level" onClick={() => props.go(depth() - 1)}>↑</button>
        <ol>
          <li><button type="button" onClick={() => props.go(0)}>All</button></li>
          <For each={[...props.path]}>
            {(value, index) => (
              <li>
                <span aria-hidden="true">›</span>
                <Show when={index() < depth() - 1}
                  fallback={<span aria-current="location">{drillValue(props.definition, index(), value, props.locale)}</span>}>
                  <button type="button" onClick={() => props.go(index() + 1)}>
                    {drillValue(props.definition, index(), value, props.locale)}
                  </button>
                </Show>
              </li>
            )}
          </For>
        </ol>
        <span class="drill-level">{levelLabel(props.definition, Math.min(depth(), levels().length - 1))}</span>
      </nav>
    </Show>
  );
}
