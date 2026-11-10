/**
 * Server-side SVG of a dataset chart, with ECharts' SSR renderer and the same
 * option builder as the browser, framed with its title and filter caption.
 * Server-only: loaded on demand by the API handler.
 */
import { init, use } from "echarts/core";
import {
  BarChart, BoxplotChart, FunnelChart, GaugeChart, HeatmapChart, LineChart, PictorialBarChart,
  PieChart, RadarChart, SankeyChart, ScatterChart, SunburstChart, TreemapChart,
} from "echarts/charts";
import { AriaComponent, GridComponent, LegendComponent, MarkLineComponent, VisualMapComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { buildChart } from "../src/chart-options.ts";
import { composeSvg, imageSize } from "../src/chart-image.ts";
import { applyTopN, topNChoices } from "./tables.ts";
import type { DatasetDefinition, QueryResult } from "./types.ts";
import type { ServerChartTheme } from "./theme-tokens.ts";

// Every chart type up front: a server renders whichever dataset is asked for.
// Tooltips need a pointer, so the static image leaves them out.
use([
  BarChart, BoxplotChart, FunnelChart, GaugeChart, HeatmapChart, LineChart, PictorialBarChart, PieChart,
  RadarChart, SankeyChart, ScatterChart, SunburstChart, TreemapChart,
  AriaComponent, GridComponent, LegendComponent, MarkLineComponent, VisualMapComponent, SVGRenderer,
]);

export interface ChartSvgInput {
  definition: DatasetDefinition;
  result: QueryResult;
  /** Formatting locale for numbers and dates. */
  locale: string;
  theme: ServerChartTheme;
  title: string;
  caption: string;
  /** Name of Top N's "Other" row in the interface language. */
  otherLabel: string;
  /** Size of the whole image, title and caption included. */
  width: number;
  height: number;
}

/** The chart as a standalone SVG document of exactly `width` × `height`. */
export function renderChartSvg(input: ChartSvgInput): string {
  const { definition, result, theme } = input;
  // The rows the block first shows: Top N's initial choice, with its Other row.
  const ranked = definition.topN
    ? applyTopN(result.rows, definition, topNChoices(definition.topN).initial, !result.truncated, input.otherLabel)
    : undefined;
  const shown = ranked && ranked.rows !== result.rows ? { ...result, rows: [...ranked.rows] } : result;
  const built = buildChart(definition, shown, input.locale, theme);
  const chartWidth = input.width - (imageSize({ width: 0, height: 0, title: "", caption: "" }).width);
  const frame = imageSize({ width: chartWidth, height: 0, title: input.title, caption: input.caption }).height;
  const chartHeight = Math.max(60, input.height - frame);
  const { tooltip: _tooltip, ...option } = built.option;
  const chart = init(null, null, { renderer: "svg", ssr: true, width: chartWidth, height: chartHeight });
  try {
    chart.setOption({ ...option, animation: false });
    return composeSvg({
      svg: chart.renderToSVGString(), width: chartWidth, height: chartHeight,
      title: input.title, caption: input.caption,
      background: theme.background, text: theme.text, muted: theme.muted, font: theme.font,
    });
  } finally {
    chart.dispose();
  }
}
