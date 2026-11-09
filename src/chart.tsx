import { createEffect, createSignal, onSettled, Show } from "solid-js";
import type { DatasetDefinition, QueryResult, Row } from "../core/types";
import type { Selection } from "./chart-options";
import { printing } from "./print";

export interface ChartSnapshot {
  svg: string;
  width: number;
  height: number;
  background: string;
  text: string;
  muted: string;
  font: string;
}
import { Spinner } from "./spinner";

export function Chart(props: {
  definition: DatasetDefinition;
  result: QueryResult;
  locale: string;
  selected?: Selection;
  /** Called with the clicked row and pointer event; omitted charts are not interactive. */
  onSelect?: (row: Row, event: MouseEvent | undefined) => void;
  /** Receives a function returning the rendered chart and its theme colours, for image export. */
  register?: (snapshot: () => ChartSnapshot | undefined) => void;
}) {
  let element!: HTMLDivElement;
  const [renderer, setRenderer] =
    createSignal<ReturnType<typeof import("./charts").createChart>>();
  const [error, setError] = createSignal("");
  const [notes, setNotes] = createSignal<string[]>([]);
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
        props.register?.(() => {
          const shot = chart?.snapshot();
          if (!shot) return undefined;
          const style = getComputedStyle(element);
          const token = (name: string) => style.getPropertyValue(name).trim();
          return { ...shot, background: token("--surface") || "#fff", text: token("--text") || "#000", muted: token("--muted") || "#666", font: style.fontFamily };
        });
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
      print: printing(),
    }),
    ({ chart, definition, result, locale, selected, print }) => {
      if (!chart) return;
      chart.update(definition, result, locale, selected, print)
        .then((next) => {
          if (next === undefined) return; // superseded by a newer update
          setError("");
          setNotes(next);
        })
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
      <Show when={notes().length}>
        <p class="chart-note">{notes().join(" ")}</p>
      </Show>
    </div>
  );
}
