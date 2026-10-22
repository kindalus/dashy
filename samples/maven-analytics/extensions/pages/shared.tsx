import { createSignal, For, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { fetchDataset, paramsSearch, Spinner, type PageProps, type Params, type QueryResult } from "dashy/ui";
import "./pages.css";

/** Explicit clears must survive a second parameter parse at the dataset endpoint. */
export function pageParams(props: PageProps): Params {
  return Object.fromEntries((props.page.definition.params ?? []).map(name => [name, props.params[name] ?? null]));
}

/** One request per page; every view on that page shares the same result. */
export function useDataset(name: string, params: Params) {
  const [result, setResult] = createSignal<QueryResult>();
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  let controller: AbortController | undefined;
  async function load() {
    controller?.abort();
    const current = controller = new AbortController();
    setLoading(true);
    setError("");
    try {
      const data = await fetchDataset(name, params, current.signal);
      if (!current.signal.aborted) setResult(data);
    } catch (failure) {
      if (!current.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to load data");
    } finally {
      if (!current.signal.aborted) setLoading(false);
    }
  }
  onSettled(() => { void load(); return () => controller?.abort(); });
  return { result, loading, error, load };
}

export function Results(props: { data: ReturnType<typeof useDataset>; children: JSX.Element }) {
  return <section aria-busy={props.data.loading() ? "true" : "false"}>
    <Show when={props.data.loading()}><div class="block block-loading" role="status"><Spinner /> Loading data…</div></Show>
    <Show when={props.data.error()}><div class="block maven-notice" role="alert">
      <p>{props.data.error()}</p>
      <button class="button secondary" onClick={() => void props.data.load()}>Try again</button>
    </div></Show>
    <Show when={!props.data.loading() && !props.data.error()}>
      <Show when={props.data.result()?.rows.length} fallback={<div class="block maven-notice"><h2>No results</h2><p>Change the period or clear the filters to see sales.</p></div>}>
        {props.children}
      </Show>
    </Show>
  </section>;
}

export function PageFilters(props: PageProps) {
  const period = props.params.period as { from?: string; until?: string } | undefined;
  return <form class="filters" method="get">
    <div class="filter-field"><fieldset><legend>Period</legend><div class="range-inputs">
      <input aria-label="Period from" type="date" name="period.from" value={period?.from ?? ""} />
      <span>to</span>
      <input aria-label="Period until" type="date" name="period.until" value={period?.until ?? ""} />
    </div></fieldset></div>
    <For each={props.page.definition.params?.filter(name => name !== "period") ?? []}>{name => {
      const definition = props.catalog.params[name]!;
      return <div class="filter-field"><label for={`maven-${name}`}>{definition.label}</label>
        <select id={`maven-${name}`} name={name} value={String(props.params[name] ?? "")}>
          <option value="">All</option>
          <For each={definition.options ?? []}>{option => <option value={String(option.value)}>{option.label}</option>}</For>
        </select>
      </div>;
    }}</For>
    <button class="button primary" type="submit">Apply filters</button>
    <a class="button text" href={`/pages/${props.page.id}`}>Reset</a>
  </form>;
}

export function dashboardLink(id: string, params: Params) {
  return `/dashboards/${id}?${paramsSearch(params)}`;
}
