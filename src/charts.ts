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
    font: style.fontFamily,
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
    async update(definition: DatasetDefinition, result: QueryResult, locale: string, selected?: Selection) {
      const current = ++version;
      const built = buildChart(definition, result, locale, readChartTheme(element), selected);
      await ensure(built.modules);
      if (current !== version) return;
      if (!chart || built.modules.some((name) => !installed.has(name))) create(built.modules);
      rowAt = built.rowAt;
      chart!.setOption(built.option, { notMerge: true });
    },
    dispose() {
      version++;
      observer.disconnect();
      chart?.dispose();
    },
  };
}
