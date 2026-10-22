import { createEffect, createSignal, onSettled, Show } from "solid-js";
import type { DatasetDefinition, QueryResult } from "../core/types";

export function Chart(props: {
  definition: DatasetDefinition;
  result: QueryResult;
  locale: string;
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
        chart = createChart(element);
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
    }),
    ({ chart, definition, result, locale }) => {
      if (!chart) return;
      try {
        chart.update(definition, result, locale);
        setError("");
      } catch {
        unavailable();
      }
    },
  );
  return (
    <>
      <div
        class="chart"
        ref={element}
        role="img"
        aria-label={`${props.definition.label}. Use Table for the underlying values.`}
      />
      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>
    </>
  );
}
