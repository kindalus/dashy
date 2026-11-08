import { createEffect, createSignal, onSettled, Show } from "solid-js";
import type { DatasetDefinition, QueryResult, Row } from "../core/types";
import type { Selection } from "./chart-options";
import { Spinner } from "./spinner";

export function Chart(props: {
  definition: DatasetDefinition;
  result: QueryResult;
  locale: string;
  selected?: Selection;
  /** Called with the clicked row and pointer event; omitted charts are not interactive. */
  onSelect?: (row: Row, event: MouseEvent | undefined) => void;
}) {
  let element!: HTMLDivElement;
  const [renderer, setRenderer] =
    createSignal<ReturnType<typeof import("./charts").createChart>>();
  const [error, setError] = createSignal("");
  const unavailable = () =>
    setError("Chart unavailable. Switch to Table to view the data.");

  onSettled(() => {
    let disposed = false;
    let chart: ReturnType<typeof import("./charts").createChart> | undefined;
    import("./charts")
      .then(({ createChart }) => {
        if (disposed) return;
        chart = createChart(element, (row, event) => props.onSelect?.(row, event));
        setRenderer(chart);
      })
      .catch(() => {
        if (!disposed) unavailable();
      });
    return () => {
      disposed = true;
      chart?.dispose();
    };
  });

  // Updates use the latest props, including changes while the module loads.
  createEffect(
    () => ({
      chart: renderer(),
      definition: props.definition,
      result: props.result,
      locale: props.locale,
      selected: props.selected,
    }),
    ({ chart, definition, result, locale, selected }) => {
      if (!chart) return;
      chart.update(definition, result, locale, selected)
        .then(() => setError(""))
        .catch(() => unavailable());
    },
  );
  return (
    <div
      class={`chart-frame${props.onSelect ? " is-interactive" : ""}`}
      aria-busy={!renderer() && !error() ? "true" : "false"}
    >
      <div
        class="chart"
        ref={element}
        role="img"
        aria-label={`${props.definition.label}. Use Table for the underlying values${props.onSelect ? " and actions" : ""}.`}
      />
      <Show when={!renderer() && !error()}>
        <div class="chart-loading" role="status">
          <Spinner />
          <span>Loading chart…</span>
        </div>
      </Show>
      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>
    </div>
  );
}
