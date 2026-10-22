// Load only the chart types supported by DatasetDefinition.
import { init, use } from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { DatasetDefinition, QueryResult } from "../core/types";
import { formatValue } from "./format";

use([
  BarChart,
  LineChart,
  AriaComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  SVGRenderer,
]);

/** Read resolved CSS values so charts use the selected UI theme. */
function readChartTheme(element: HTMLElement) {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    palette: Array.from({ length: 6 }, (_, index) =>
      token(`--chart-${index + 1}`),
    ),
    text: token("--text"),
    muted: token("--muted"),
    border: token("--line"),
    grid: token("--chart-grid"),
    surface: token("--surface"),
    font: style.fontFamily,
  };
}

/** Own one renderer and observer for the lifetime of a visible chart. */
export function createChart(element: HTMLElement) {
  const chart = init(element, undefined, { renderer: "svg" });
  const observer = new ResizeObserver(() => chart.resize());
  observer.observe(element);
  return {
    update(definition: DatasetDefinition, result: QueryResult, locale: string) {
      const config = definition.chart!;
      const theme = readChartTheme(element);
      chart.setOption(
        {
          animation: !matchMedia("(prefers-reduced-motion: reduce)").matches,
          aria: { enabled: true },
          color: config.series.map(
            (s, index) =>
              s.color || theme.palette[index % theme.palette.length]!,
          ),
          textStyle: { fontFamily: theme.font, color: theme.text },
          grid: {
            left: 12,
            right: 20,
            top: 30,
            bottom: 10,
            outerBoundsMode: "same",
          },
          tooltip: {
            trigger: "axis",
            renderMode: "richText",
            backgroundColor: theme.surface,
            borderColor: theme.border,
            textStyle: { color: theme.text, fontFamily: theme.font },
          },
          legend: {
            type: "scroll",
            show: config.series.length > 1,
            top: 0,
            textStyle: { color: theme.muted },
            pageTextStyle: { color: theme.muted, fontFamily: theme.font },
            pageIconColor: theme.muted,
            pageIconInactiveColor: theme.border,
          },
          xAxis: {
            type: "category",
            data: result.rows.map((row) => String(row[config.x] ?? "")),
            boundaryGap: config.type === "bar",
            axisLine: { lineStyle: { color: theme.border } },
            axisTick: { show: false },
            axisLabel: { color: theme.muted, hideOverlap: true },
          },
          yAxis: {
            type: "value",
            axisLabel: {
              color: theme.muted,
              formatter: (n: number) =>
                formatValue(n, { decimals: 0 }, locale),
            },
            splitLine: { lineStyle: { color: theme.grid } },
          },
          series: config.series.map((series) => ({
            name: series.label,
            type: config.type,
            data: result.rows.map((row) =>
              row[series.key] === null ? null : Number(row[series.key]),
            ),
            symbolSize: 6,
            smooth: false,
            lineStyle: { width: 2.5 },
            barMaxWidth: 56,
            tooltip: {
              valueFormatter: (value: number) =>
                formatValue(value, series.format, locale),
            },
          })),
        },
        { notMerge: true },
      );
    },
    dispose() {
      observer.disconnect();
      chart.dispose();
    },
  };
}
