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
  actionsFor, applyAction, backLink, chartColumns, columnTarget, drillthroughTargets, isSelected,
  type ActionContext, type ClickAction,
} from "./actions";
import { chartKeyColumns } from "../core/charts";

export interface AppProps {
  catalog: Catalog;
  dashboard: DashboardShell | null;
  page?: PageShell;
}
export function App(props: AppProps & { Page?: Component<PageProps> }) {
  const selected = props.page ? `/pages/${props.page.id}` : props.dashboard ? `/dashboards/${props.dashboard.id}` : undefined;
  return <Workspace catalog={props.catalog} selected={selected}
    label={props.page?.definition.label ?? props.dashboard?.definition.label}
    kind={props.page ? "Pages" : "Dashboards"}>
    {props.page && props.Page
      ? <PageContent page={props.page} catalog={props.catalog} component={props.Page} />
      : <DashboardContent {...props} />}
  </Workspace>;
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
  select: (definition: DatasetDefinition, column: DatasetColumn, row: Row, event?: MouseEvent | KeyboardEvent) => void;
  selection: (definition: DatasetDefinition) => ((row: Row) => boolean) | undefined;
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
  const search = (current: DashboardShell, params: Params, crossFilters: readonly CrossFilterOrigin[]) => {
    const query = dashboardSearchParams({ ...current, params });
    for (const origin of crossFilters) query.append("_xf", `${origin.block}:${origin.param}`);
    if (fromParam) query.set("_from", fromParam);
    return query;
  };
  let generation = 0;
  async function apply(params: Params, crossFilters: readonly CrossFilterOrigin[] = [], refresh = false) {
    const current = shell();
    if (!current) return;
    const query = search(current, params, crossFilters);
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
    const next = applyAction(current.params, current.crossFilters, props.catalog, blockId, action);
    void apply(next.params, next.crossFilters);
  };
  const interaction = (blockId: string): BlockInteraction => ({
    columns: (dataset) => {
      const ctx = context();
      if (!ctx) return [];
      return dataset.columns.filter((column) => {
        const target = columnTarget(column);
        return target && (ctx.dashboard.params?.includes(target.name) || drillthroughTargets(ctx, target.name).length > 0);
      });
    },
    select: (dataset, column, row, event) => {
      const ctx = context();
      if (!ctx) return;
      const value = row[column.key];
      const actions = actionsFor(ctx, blockId, column, row, formatValue(value ?? null, column.format, locale()));
      if (!actions.length) return;
      if (actions.length === 1) return run(blockId, actions[0]!);
      const target = event?.target instanceof Element ? event.target.getBoundingClientRect() : undefined;
      const pointer = event && "clientX" in event && event.clientX ? { x: event.clientX, y: event.clientY } : undefined;
      setMenu({
        x: pointer?.x ?? target?.left ?? innerWidth / 2,
        y: pointer?.y ?? (target ? target.bottom : innerHeight / 2),
        blockId, title: `${dataset.label}: ${formatValue(value ?? null, column.format, locale())}`, actions,
      });
    },
    selection: (dataset) => {
      const current = shell();
      const origin = current?.crossFilters.find((o) => o.block === blockId);
      if (!current || !origin) return undefined;
      const column = dataset.columns.find((c) => columnTarget(c)?.name === origin.param);
      const target = column && columnTarget(column);
      if (!target) return undefined;
      return (row: Row) => isSelected(current.params, origin.param, row[target.from] ?? null);
    },
  });
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
              <button
                class="button secondary"
                onClick={() => void apply(shell()!.params, shell()!.crossFilters, true)}
              >
                Refresh
              </button>
            </Show>
          </div>
          <Show when={(definition()?.params?.length || 0) > 0}>
            <form
              class="filters"
              onSubmit={(event) => { event.preventDefault(); void apply(draft()); }}
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
    action.kind === "filter" ? `Filter by ${action.label}`
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
  const pageSize = 8;
  const pageCount = () =>
    Math.max(1, Math.ceil(props.result.rows.length / pageSize));
  // Keep the selected view across refreshes, but start new results on page one.
  createEffect(
    () => props.result,
    () => {
      setPage(0);
    },
  );
  const currentPage = () => Math.min(page(), pageCount() - 1);
  const pageRows = () =>
    props.result.rows.slice(
      currentPage() * pageSize,
      (currentPage() + 1) * pageSize,
    );
  const interactive = createMemo(() => new Set(props.interaction.columns(props.definition).map((c) => c.key)));
  const selection = createMemo(() => props.interaction.selection(props.definition));
  const chartTargets = createMemo(() =>
    props.definition.chart
      ? chartColumns(props.definition, chartKeyColumns(props.definition.chart)).filter((c) => interactive().has(c.key))
      : []);
  const chartSelect = (row: Row, event: MouseEvent | undefined) => {
    // The deepest identified column wins (e.g. a treemap leaf over its parent).
    const column = [...chartTargets()].reverse().find((c) => {
      const target = columnTarget(c);
      return target && row[target.from] !== undefined && row[target.from] !== null;
    });
    if (column) props.interaction.select(props.definition, column, row, event);
  };
  return (
    <>
      <div class="block-heading">
        <div>
          <h2>{props.definition.label}</h2>
          <Show when={props.definition.description}>
            <p>{props.definition.description}</p>
          </Show>
        </div>
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
                        {(column) => <th scope="col">{column.label}</th>}
                      </For>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={pageRows()}>
                      {(row) => (
                        <tr class={selection()?.(row) ? "is-selected" : ""}>
                          <For each={props.definition.columns}>
                            {(column) => {
                              const text = () => formatValue(row[column.key] ?? null, column.format, props.locale);
                              const target = columnTarget(column);
                              const clickable = () => interactive().has(column.key)
                                && target !== undefined && row[target.from] !== null && row[target.from] !== undefined;
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
                </table>
              </div>
              <div class="table-footer">
                <span>
                  {props.result.rows.length} rows
                  {props.result.truncated ? " · Row limit reached" : ""}
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
            result={props.result}
            locale={props.locale}
            selected={selection()}
            onSelect={chartTargets().length ? chartSelect : undefined}
          />
        </Show>
      </Show>
    </>
  );
}
