// ECharts runtime. Chart modules load on demand, so dashboards pay only for the types they use.
import { init, use } from "echarts/core";
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { DatasetDefinition, QueryResult, Row } from "../core/types";
import { buildChart, type ChartModule, type ChartTheme, type Selection } from "./chart-options";

use([AriaComponent, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);

const loaders: Record<ChartModule, () => Promise<unknown>> = {
  line: () => import("echarts/lib/chart/line/install.js").then((m) => m.install),
  bar: () => import("echarts/lib/chart/bar/install.js").then((m) => m.install),
  scatter: () => import("echarts/lib/chart/scatter/install.js").then((m) => m.install),
  pie: () => import("echarts/lib/chart/pie/install.js").then((m) => m.install),
  funnel: () => import("echarts/lib/chart/funnel/install.js").then((m) => m.install),
  treemap: () => import("echarts/lib/chart/treemap/install.js").then((m) => m.install),
  sunburst: () => import("echarts/lib/chart/sunburst/install.js").then((m) => m.install),
  heatmap: () => import("echarts/lib/chart/heatmap/install.js").then((m) => m.install),
  gauge: () => import("echarts/lib/chart/gauge/install.js").then((m) => m.install),
  radar: () => import("echarts/lib/chart/radar/install.js").then((m) => m.install),
  sankey: () => import("echarts/lib/chart/sankey/install.js").then((m) => m.install),
  boxplot: () => import("echarts/lib/chart/boxplot/install.js").then((m) => m.install),
  visualMap: () => import("echarts/lib/component/visualMap/install.js").then((m) => m.install),
  markLine: () => import("echarts/lib/component/marker/installMarkLine.js").then((m) => m.install),
};
const loaded = new Map<ChartModule, Promise<void>>();
function ensure(modules: ChartModule[]): Promise<void> {
  return Promise.all(modules.map((name) => {
    if (!loaded.has(name))
      loaded.set(name, loaders[name]().then((install) => use(install as Parameters<typeof use>[0])).catch((error) => {
        loaded.delete(name);
        throw error;
      }));
    return loaded.get(name)!;
  })).then(() => undefined);
}

/** Read resolved CSS values so charts use the selected UI theme. */
function readChartTheme(element: HTMLElement): ChartTheme {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    palette: Array.from({ length: 6 }, (_, index) => token(`--chart-${index + 1}`)),
    text: token("--text"),
    muted: token("--muted"),
    border: token("--line"),
    grid: token("--chart-grid"),
    surface: token("--surface"),
    // ECharts writes the font unescaped into SVG attributes, so double quotes would
    // break exported SVG; CSS accepts single quotes equally.
    font: style.fontFamily.replaceAll('"', "'"),
    danger: token("--danger"),
    warning: token("--warning"),
    success: token("--success"),
  };
}

/**
 * Own one renderer and observer for the lifetime of a visible chart. ECharts
 * captures registered layouts and visuals at init(), so the instance is created
 * only after its chart modules load, and recreated if a later update needs more.
 */
export function createChart(element: HTMLElement, onSelect?: (row: Row, event: MouseEvent | undefined) => void) {
  let chart: ReturnType<typeof init> | undefined;
  let installed = new Set<ChartModule>();
  const observer = new ResizeObserver(() => chart?.resize());
  observer.observe(element);
  let rowAt: ReturnType<typeof buildChart>["rowAt"] = () => undefined;
  let last: Record<string, unknown> | undefined;
  /**
   * Re-applying an option with notMerge resets component state; keep the series the
   * user hid with the legend, across data updates, printing and image snapshots.
   */
  const keepLegend = (option: Record<string, unknown>) => {
    const selected = (chart?.getOption() as { legend?: { selected?: Record<string, boolean> }[] } | undefined)?.legend?.[0]?.selected;
    const legend = option.legend as Record<string, unknown> | undefined;
    return selected && legend && Object.keys(selected).length ? { ...option, legend: { ...legend, selected } } : option;
  };
  let version = 0;
  const create = (modules: ChartModule[]) => {
    chart?.dispose();
    chart = init(element, undefined, { renderer: "svg" });
    installed = new Set(modules);
    chart.on("click", (event) => {
      const row = rowAt(event as Parameters<typeof rowAt>[0]);
      if (row && onSelect) onSelect(row, (event as { event?: { event?: MouseEvent } }).event?.event);
    });
  };
  return {
    /**
     * Renders the chart and resolves to its notes (analyses that could not be drawn),
     * or undefined when a newer update superseded this one.
     */
    async update(
      definition: DatasetDefinition, result: QueryResult, locale: string, selected?: Selection,
      /** Printing: render the final frame at once and let print CSS scale it. */
      print = false,
    ): Promise<string[] | undefined> {
      const current = ++version;
      const built = buildChart(definition, result, locale, readChartTheme(element), selected);
      await ensure(built.modules);
      if (current !== version) return undefined;
      // Read the legend state before a new chart module forces a new instance.
      const option = keepLegend(built.option);
      if (!chart || built.modules.some((name) => !installed.has(name))) create(built.modules);
      rowAt = built.rowAt;
      last = built.option;
      chart!.setOption(print ? { ...option, animation: false } : option, { notMerge: true });
      // ECharts draws a fixed-size SVG; a viewBox lets print CSS scale it to the page.
      const svg = element.querySelector("svg");
      if (svg && print) svg.setAttribute("viewBox", `0 0 ${chart!.getWidth()} ${chart!.getHeight()}`);
      else svg?.removeAttribute("viewBox");
      return built.notes ?? [];
    },
    /** The rendered chart as standalone SVG markup, for image export. */
    snapshot(): { svg: string; width: number; height: number } | undefined {
      if (!chart) return undefined;
      // Settle any running animation, so the image shows the final frame.
      if (last) chart.setOption({ ...keepLegend(last), animation: false }, { notMerge: true });
      return { svg: chart.renderToSVGString(), width: chart.getWidth(), height: chart.getHeight() };
    },
    dispose() {
      version++;
      observer.disconnect();
      chart?.dispose();
    },
  };
}
