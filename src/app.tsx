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
  DashboardShell,
  DatasetDefinition,
  ParamDefinition,
  Params,
  QueryResult,
} from "../core/types";
import { Chart } from "./chart";
import { formatValue } from "./format";
import { Brand, DashboardNavigation } from "./navigation";
import { Spinner } from "./spinner";
import {
  DashboardLoader, dashboardSearchParams, type DashboardLoads,
} from "./dashboard-loader";

export interface AppProps {
  catalog: Catalog;
  dashboard: DashboardShell | null;
}
export function App(props: AppProps) {
  const loader = props.dashboard
    ? new DashboardLoader(props.dashboard, (state) => setLoads(state))
    : undefined;
  const [loads, setLoads] = createSignal<DashboardLoads>(loader?.state || {});
  let form!: HTMLFormElement;
  const definition = () => props.dashboard?.definition;
  const locale = () => props.catalog.locale;
  const params = () => props.dashboard?.params || {};
  const groupIds = new Map(props.dashboard?.requests.flatMap(
    (group) => group.blockIds.map((id) => [id, group.id] as const),
  ));
  const stateFor = (id: string) => loads()[groupIds.get(id)!];
  const blocks = createMemo(() => new Map(
    Object.values(loads()).flatMap((group) => group.data?.blocks || [])
      .map((block) => [block.id, block]),
  ));
  const updateStatus = createMemo(() => {
    if (!props.dashboard) return "No dashboards configured";
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
  function load(query: URLSearchParams) {
    if (!loader) return;
    history.replaceState(
      null, "", `${location.pathname}${query.size ? `?${query}` : ""}`,
    );
    void loader.load(query);
  }
  onSettled(() => {
    if (props.dashboard) load(dashboardSearchParams(props.dashboard));
    return () => loader?.dispose();
  });
  function submit(event: SubmitEvent) {
    event.preventDefault();
    const query = new URLSearchParams();
    const data = new FormData(form);
    for (const name of definition()?.params || []) {
      const def = props.catalog.params[name]!;
      if (def.type === "range") {
        for (const key of [`${name}.from`, `${name}.until`])
          query.set(key, String(data.get(key) || ""));
      } else if (def.type === "array") {
        const values = String(data.get(name) || "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
        if (!values.length) query.set(name, "");
        else values.forEach((value) => query.append(name, value));
      } else query.set(name, String(data.get(name) || ""));
    }
    void load(query);
  }
  return (
    <div class="workspace">
      <a class="skip-link" href="#main">
        Skip to dashboard
      </a>
      <aside class="sidebar">
        <Brand application={props.catalog.name} />
        <DashboardNavigation
          catalog={props.catalog}
          selected={props.dashboard?.id}
        />
        <div class="sidebar-footer">
          <span class="status-dot" />
          Read-only workspace
        </div>
      </aside>
      <div class="main-column">
        <header class="topbar">
          <span class="breadcrumb">
            Dashboards <span aria-hidden="true">/</span>{" "}
            <strong>{definition()?.label || "Workspace"}</strong>
          </span>
          <div class="mobile-brand">
            <Brand application={props.catalog.name} />
          </div>
          <DashboardNavigation
            catalog={props.catalog}
            selected={props.dashboard?.id}
            mobile
          />
          <span class="workspace-badge">{props.catalog.name}</span>
        </header>
        <main id="main" tabindex={-1}>
          <div class="page-heading">
            <div>
              <h1>{definition()?.label || "Your dashboards"}</h1>
              <p>
                {definition()
                  ? definition()?.description
                  : "Add a dashboard to your project configuration to get started."}
              </p>
            </div>
            <Show when={props.dashboard}>
              <button
                class="button secondary"
                onClick={() => void load(new URLSearchParams(location.search))}
              >
                Refresh
              </button>
            </Show>
          </div>
          <Show when={(definition()?.params?.length || 0) > 0}>
            <form
              class="filters"
              ref={form}
              onSubmit={submit}
              autocomplete="off"
            >
              <For each={definition()?.params || []}>
                {(name) => (
                  <Parameter
                    name={name}
                    definition={props.catalog.params[name]!}
                    value={params()[name]}
                  />
                )}
              </For>
              <div class="filter-actions">
                <button
                  class="button primary"
                  type="submit"
                >
                  Apply filters
                </button>
                <button
                  class="button text"
                  type="button"
                  onClick={() => {
                    location.href = location.pathname;
                  }}
                >
                  Reset
                </button>
              </div>
            </form>
          </Show>
          <div class="update-status" role="status" aria-live="polite">
            {updateStatus()}
          </div>
          <noscript>Enable JavaScript to load dashboard data.</noscript>
          <section
            class="dashboard-grid"
            aria-label="Dashboard results"
          >
            <For each={definition()?.blocks || []} keyed={(block) => block.id}>
              {(layout) => (
                <DashboardCard
                  block={blocks().get(layout().id)}
                  layout={layout()}
                  label={props.dashboard!.labels[layout().id]!}
                  loading={stateFor(layout().id)?.loading ?? false}
                  loadError={stateFor(layout().id)?.error || ""}
                  retry={() => void loader?.retry(groupIds.get(layout().id)!)}
                  locale={locale()}
                />
              )}
            </For>
          </section>
        </main>
      </div>
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
              definition={block().definition}
              result={block().result}
              initialView={
                props.layout?.type === "dataset" ? props.layout.view : undefined
              }
              locale={props.locale}
            />
          )}
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
function Parameter(props: {
  name: string;
  definition: ParamDefinition;
  value: Params[string] | undefined;
}) {
  const def = () => props.definition;
  const id = () => `param-${props.name}`;
  const value = () => props.value ?? "";
  const inputType = () =>
    def().type === "number" || def().valueType === "number"
      ? "number"
      : def().type === "date" || def().valueType === "date"
        ? "date"
        : "text";
  return (
    <div class={`filter-field ${def().type === "range" ? "range-field" : ""}`}>
      <Show
        when={def().type === "range"}
        fallback={
          <>
            <label for={id()}>{def().label}</label>
            {def().type === "select" || def().type === "boolean" ? (
              <select
                id={id()}
                autocomplete="off"
                name={props.name}
                required={def().required}
                value={String(value())}
              >
                <option value="">All</option>
                {def().type === "boolean" ? (
                  <>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </>
                ) : (
                  <For each={def().options || []}>
                    {(option) => (
                      <option value={String(option.value)}>
                        {option.label}
                      </option>
                    )}
                  </For>
                )}
              </select>
            ) : (
              <input
                id={id()}
                autocomplete="off"
                name={props.name}
                type={def().type === "array" ? "text" : inputType()}
                value={
                  Array.isArray(value())
                    ? (value() as unknown[]).join(", ")
                    : String(value())
                }
                required={def().required}
                min={def().min}
                max={def().max}
                step={def().integer ? 1 : "any"}
                placeholder={
                  def().type === "array" ? "Comma-separated values" : undefined
                }
              />
            )}
          </>
        }
      >
        <fieldset>
          <legend>{def().label}</legend>
          <div class="range-inputs">
            <input
              aria-label={`${def().label} from`}
              autocomplete="off"
              name={`${props.name}.from`}
              type={inputType()}
              value={(value() as { from?: string | number }).from ?? ""}
              required={def().required}
              min={def().min}
              max={def().max}
              step={def().integer ? 1 : "any"}
            />
            <span aria-hidden="true">to</span>
            <input
              aria-label={`${def().label} until`}
              autocomplete="off"
              name={`${props.name}.until`}
              type={inputType()}
              value={(value() as { until?: string | number }).until ?? ""}
              required={def().required}
              min={def().min}
              max={def().max}
              step={def().integer ? 1 : "any"}
            />
          </div>
        </fieldset>
      </Show>
    </div>
  );
}
function Dataset(props: {
  definition: DatasetDefinition;
  result: QueryResult;
  initialView?: "chart" | "table";
  locale: string;
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
                        <tr>
                          <For each={props.definition.columns}>
                            {(column) => (
                              <td>
                                {formatValue(
                                  row[column.key],
                                  column.format,
                                  props.locale,
                                )}
                              </td>
                            )}
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
          />
        </Show>
      </Show>
    </>
  );
}
