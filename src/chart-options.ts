/** Pure ECharts option builders. No DOM and no echarts import, so they are unit-tested. */
import { boxplotStats, isCartesian, seriesKind } from "../core/charts";
import type { ChartDefinition, DatasetDefinition, Format, QueryResult, Row, Scalar } from "../core/types";
import { formatValue } from "./format";
import { buildAnalytics } from "./chart-analytics";
import { isOtherRow } from "../core/tables";

export interface ChartTheme {
  palette: string[];
  text: string;
  muted: string;
  border: string;
  grid: string;
  surface: string;
  font: string;
  danger: string;
  warning: string;
  success: string;
}
/** The subset of an ECharts click event used to recover the clicked row. */
export interface ChartEvent {
  seriesIndex?: number;
  dataIndex?: number;
  dataType?: string;
  name?: string;
  data?: unknown;
}
export type ChartModule =
  | "line" | "bar" | "scatter" | "pie" | "funnel" | "treemap" | "sunburst"
  | "heatmap" | "gauge" | "radar" | "sankey" | "boxplot" | "visualMap" | "markLine";
export interface BuiltChart {
  option: Record<string, unknown>;
  modules: ChartModule[];
  /** Full or partial row identified by a click, or undefined. */
  rowAt(event: ChartEvent): Row | undefined;
  /** Explanations shown under the chart, e.g. why a forecast could not be drawn. */
  notes?: string[];
}
/** Returns true for rows matching the active cross-filter, or undefined without one. */
export type Selection = ((row: Row) => boolean) | undefined;

const number = (value: Scalar | undefined) =>
  value === null || value === undefined || value === "" ? null : Number(value);
const text = (value: Scalar | undefined) => (value === null || value === undefined ? "" : String(value));
const dim = (selected: Selection, row: Row) => (selected && !selected(row) ? { opacity: 0.3 } : undefined);

function axisFormat(format: Format | undefined): Format {
  return format?.style === "percent" ? { style: "percent", decimals: 0 } : { decimals: 0 };
}
function baseOption(theme: ChartTheme, colors: string[]) {
  return {
    animation: typeof matchMedia === "function" ? !matchMedia("(prefers-reduced-motion: reduce)").matches : false,
    aria: { enabled: true },
    color: colors,
    textStyle: { fontFamily: theme.font, color: theme.text },
    tooltip: {
      renderMode: "richText",
      backgroundColor: theme.surface,
      borderColor: theme.border,
      textStyle: { color: theme.text, fontFamily: theme.font },
    },
  };
}
function legend(theme: ChartTheme, show: boolean) {
  return {
    type: "scroll", show, top: 0,
    textStyle: { color: theme.muted },
    pageTextStyle: { color: theme.muted, fontFamily: theme.font },
    pageIconColor: theme.muted, pageIconInactiveColor: theme.border,
  };
}
const toneColor = (theme: ChartTheme, tone: string) =>
  tone === "danger" ? theme.danger : tone === "warning" ? theme.warning : tone === "success" ? theme.success : theme.muted;

export function buildChart(
  definition: DatasetDefinition,
  result: QueryResult,
  locale: string,
  theme: ChartTheme,
  selected?: Selection,
): BuiltChart {
  const chart = definition.chart as ChartDefinition;
  const rows = result.rows;
  const palette = (index: number) => theme.palette[index % theme.palette.length]!;
  const valueFormatter = (format?: Format) => (value: number) => formatValue(value, format, locale);
  const byIndex = (event: ChartEvent) => (event.dataIndex === undefined ? undefined : rows[event.dataIndex]);

  if (isCartesian(chart)) {
    const horizontal = chart.orientation === "horizontal";
    const xType = chart.xType ?? "category";
    const right = chart.series.some((s) => s.axis === "right");
    const leftFormat = chart.series.find((s) => s.axis !== "right")?.format;
    const rightFormat = chart.series.find((s) => s.axis === "right")?.format;
    const kinds = chart.series.map((s) => seriesKind(chart, s));
    const colors = chart.series.map((s, i) => s.color || palette(i));
    const analytics = buildAnalytics({
      // Top N's synthetic Other row (always last) is not a data point for statistics.
      rows: rows.filter((row) => !isOtherRow(row)), x: chart.x, xType, horizontal, series: chart.series, colors, locale, muted: theme.muted,
      axisIndex: (s) => (right && !horizontal ? (s.axis === "right" ? 1 : 0) : undefined),
    });
    const valueAxis = (format: Format | undefined, position?: "left" | "right") => ({
      type: "value",
      ...(position ? { position } : {}),
      axisLabel: { color: theme.muted, formatter: (n: number) => formatValue(n, axisFormat(format), locale) },
      splitLine: { show: position !== "right", lineStyle: { color: theme.grid } },
    });
    // Date drill-down levels label periods (2024, Q1 2024, Jan 2024) rather than raw dates.
    const xFormat = definition.columns.find((column) => column.key === chart.x)?.format;
    const periodLabel = xType === "category" && xFormat?.style === "date" && xFormat.grain
      ? (value: string) => formatValue(value, xFormat, locale) : undefined;
    const categoryAxis = {
      type: xType,
      ...(xType === "category" ? { data: [...rows.map((row) => text(row[chart.x])), ...analytics.future] } : {}),
      boundaryGap: xType === "category" && kinds.includes("bar"),
      axisLine: { lineStyle: { color: theme.border } },
      axisTick: { show: false },
      axisLabel: { color: theme.muted, hideOverlap: true, ...(periodLabel ? { formatter: periodLabel } : {}) },
      ...(horizontal ? { inverse: true } : {}),
    };
    const point = (row: Row, key: string) => {
      const y = number(row[key]);
      const value = xType === "category" ? y : [xType === "value" ? number(row[chart.x]) : text(row[chart.x]), y];
      const style = dim(selected, row);
      return style ? { value, itemStyle: style } : value;
    };
    return {
      modules: [...new Set([...kinds.map((kind) => (kind === "area" ? "line" : kind)),
        ...(analytics.extra.length ? ["line"] : []), ...(analytics.markLines.some(Boolean) ? ["markLine"] : [])])] as ChartModule[],
      // Trend and forecast series follow the real ones; clicking them selects nothing.
      rowAt: (event) => (event.seriesIndex !== undefined && event.seriesIndex >= chart.series.length ? undefined : byIndex(event)),
      notes: analytics.notes,
      option: {
        ...baseOption(theme, colors),
        grid: { left: 12, right: 20, top: 30, bottom: 10, outerBoundsMode: "same" },
        tooltip: { ...baseOption(theme, []).tooltip, trigger: kinds.every((k) => k === "scatter") ? "item" : "axis" },
        legend: legend(theme, chart.series.length + analytics.extra.length > 1),
        [horizontal ? "yAxis" : "xAxis"]: categoryAxis,
        [horizontal ? "xAxis" : "yAxis"]: right && !horizontal
          ? [valueAxis(leftFormat, "left"), valueAxis(rightFormat, "right")]
          : valueAxis(leftFormat),
        series: [...chart.series.map((series, index) => {
          const kind = kinds[index]!;
          return {
            name: series.label,
            type: kind === "area" ? "line" : kind,
            data: rows.map((row) => point(row, series.key)),
            ...(right && !horizontal ? { yAxisIndex: series.axis === "right" ? 1 : 0 } : {}),
            ...(series.stack ? { stack: series.stack } : {}),
            ...(kind === "area" ? { areaStyle: { opacity: 0.18 } } : {}),
            smooth: Boolean(series.smooth),
            symbolSize: kind === "scatter" ? 9 : 6,
            lineStyle: { width: 2.5 },
            barMaxWidth: 56,
            ...(kind === "bar" && series.stack ? { emphasis: { focus: "series" } } : {}),
            ...(analytics.markLines[index] ? { markLine: analytics.markLines[index] } : {}),
            tooltip: { valueFormatter: valueFormatter(series.format) },
          };
        }), ...analytics.extra],
      },
    };
  }

  switch (chart.type) {
    case "pie":
    case "funnel": {
      const data = rows.map((row, i) => ({
        name: text(row[chart.category]),
        value: number(row[chart.value]),
        itemStyle: { color: palette(i), ...dim(selected, row) },
      }));
      return {
        modules: [chart.type],
        rowAt: byIndex,
        option: {
          ...baseOption(theme, theme.palette),
          tooltip: { ...baseOption(theme, []).tooltip, trigger: "item", valueFormatter: valueFormatter(chart.format) },
          legend: legend(theme, rows.length > 1),
          series: [chart.type === "pie"
            ? { type: "pie", radius: chart.donut ? ["45%", "70%"] : "70%", center: ["50%", "56%"], data,
                label: { color: theme.muted }, itemStyle: { borderColor: theme.surface, borderWidth: 2 } }
            : { type: "funnel", top: 34, bottom: 8, left: "10%", width: "80%", sort: "none", data,
                label: { color: theme.text }, itemStyle: { borderColor: theme.surface, borderWidth: 1 } }],
        },
      };
    }
    case "treemap":
    case "sunburst": {
      interface Node { name: string; value: number; children?: Node[]; dashyRow: Row; itemStyle?: object }
      const roots: Node[] = [];
      for (const row of rows) {
        let level = roots;
        chart.path.forEach((column, depth) => {
          const name = text(row[column]);
          let node = level.find((n) => n.name === name);
          const partial: Row = Object.fromEntries(chart.path.slice(0, depth + 1).map((c) => [c, row[c] ?? null]));
          if (!node) {
            node = { name, value: 0, dashyRow: depth === chart.path.length - 1 ? row : partial };
            level.push(node);
          }
          node.value += number(row[chart.value]) ?? 0;
          if (depth === chart.path.length - 1) {
            const style = dim(selected, row);
            if (style) node.itemStyle = style;
          } else level = node.children ??= [];
        });
      }
      return {
        modules: [chart.type],
        rowAt: (event) => (event.data as { dashyRow?: Row } | undefined)?.dashyRow,
        option: {
          ...baseOption(theme, theme.palette),
          tooltip: { ...baseOption(theme, []).tooltip, trigger: "item", valueFormatter: valueFormatter(chart.format) },
          series: [chart.type === "treemap"
            ? { type: "treemap", data: roots, top: 10, bottom: 10, left: 10, right: 10, roam: false, nodeClick: false,
                breadcrumb: { show: false }, label: { color: theme.surface },
                levels: [{ itemStyle: { borderColor: theme.surface, borderWidth: 2, gapWidth: 2 } }] }
            : { type: "sunburst", data: roots, radius: ["12%", "92%"], nodeClick: false,
                itemStyle: { borderColor: theme.surface, borderWidth: 1 }, label: { color: theme.surface, minAngle: 8 } }],
        },
      };
    }
    case "heatmap": {
      const xs = [...new Set(rows.map((row) => text(row[chart.x])))];
      const ys = [...new Set(rows.map((row) => text(row[chart.y])))];
      const values = rows.map((row) => number(row[chart.value])).filter((v): v is number => v !== null);
      return {
        modules: ["heatmap", "visualMap"],
        rowAt: byIndex,
        option: {
          ...baseOption(theme, theme.palette),
          tooltip: { ...baseOption(theme, []).tooltip, trigger: "item", valueFormatter: valueFormatter(chart.format) },
          grid: { left: 12, right: 20, top: 10, bottom: 70, outerBoundsMode: "same" },
          xAxis: { type: "category", data: xs, axisLabel: { color: theme.muted, hideOverlap: true }, axisLine: { lineStyle: { color: theme.border } } },
          yAxis: { type: "category", data: ys, axisLabel: { color: theme.muted }, axisLine: { lineStyle: { color: theme.border } } },
          visualMap: {
            min: values.length ? Math.min(...values) : 0, max: values.length ? Math.max(...values) : 1,
            calculable: true, orient: "horizontal", left: "center", bottom: 0, itemHeight: 120,
            inRange: { color: [theme.surface, theme.palette[0]!] }, textStyle: { color: theme.muted },
            formatter: (n: number) => formatValue(n, axisFormat(chart.format), locale),
          },
          series: [{
            type: "heatmap",
            data: rows.map((row) => {
              const value = [xs.indexOf(text(row[chart.x])), ys.indexOf(text(row[chart.y])), number(row[chart.value])];
              const style = dim(selected, row);
              return style ? { value, itemStyle: style } : value;
            }),
            itemStyle: { borderColor: theme.surface, borderWidth: 1 },
          }],
        },
      };
    }
    case "gauge": {
      const min = chart.min ?? 0;
      const max = chart.max ?? 100;
      const bands = (chart.bands ?? []).map((band) => [(band.until - min) / (max - min), toneColor(theme, band.tone)]);
      if (!bands.length || (bands.at(-1)![0] as number) < 1) bands.push([1, theme.palette[0]!]);
      return {
        modules: ["gauge"],
        rowAt: () => rows[0],
        option: {
          ...baseOption(theme, theme.palette),
          series: [{
            type: "gauge", min, max, center: ["50%", "58%"], radius: "88%",
            data: [{ value: number(rows[0]?.[chart.value]) ?? 0, name: definition.label }],
            axisLine: { lineStyle: { width: 14, color: bands } },
            pointer: { itemStyle: { color: theme.text } },
            axisTick: { lineStyle: { color: theme.border } },
            splitLine: { lineStyle: { color: theme.border } },
            axisLabel: { color: theme.muted, formatter: (n: number) => formatValue(n, axisFormat(chart.format), locale) },
            title: { show: false },
            detail: { color: theme.text, fontSize: 22, offsetCenter: [0, "70%"], formatter: (n: number) => formatValue(n, chart.format, locale) },
          }],
        },
      };
    }
    case "radar": {
      const all = rows.flatMap((row) => chart.series.map((s) => number(row[s.key]) ?? 0));
      const max = chart.max ?? Math.max(1, ...all) * 1.1;
      return {
        modules: ["radar"],
        rowAt: () => undefined,
        option: {
          ...baseOption(theme, chart.series.map((s, i) => s.color || palette(i))),
          tooltip: { ...baseOption(theme, []).tooltip, trigger: "item" },
          legend: legend(theme, chart.series.length > 1),
          radar: {
            indicator: rows.map((row) => ({ name: text(row[chart.category]), max })),
            center: ["50%", "56%"], radius: "68%",
            axisName: { color: theme.muted }, splitLine: { lineStyle: { color: theme.grid } }, axisLine: { lineStyle: { color: theme.border } },
            splitArea: { show: false },
          },
          series: [{
            type: "radar",
            data: chart.series.map((series) => ({ name: series.label, value: rows.map((row) => number(row[series.key]) ?? 0), areaStyle: { opacity: 0.12 } })),
          }],
        },
      };
    }
    case "sankey": {
      const sources = new Set(rows.map((row) => text(row[chart.source])));
      const names = [...new Set(rows.flatMap((row) => [text(row[chart.source]), text(row[chart.target])]))];
      return {
        modules: ["sankey"],
        rowAt: (event) => {
          if (event.dataType === "edge") return (event.data as { dashyRow?: Row } | undefined)?.dashyRow;
          const name = event.name ?? (event.data as { name?: string } | undefined)?.name;
          if (name === undefined) return undefined;
          const column = sources.has(name) ? chart.source : chart.target;
          return rows.find((row) => text(row[column]) === name);
        },
        option: {
          ...baseOption(theme, theme.palette),
          tooltip: { ...baseOption(theme, []).tooltip, trigger: "item", valueFormatter: valueFormatter(chart.format) },
          series: [{
            type: "sankey", top: 10, bottom: 10, left: 8, right: 90, nodeGap: 10, emphasis: { focus: "adjacency" },
            data: names.map((name, i) => ({ name, itemStyle: { color: palette(i) } })),
            links: rows.map((row) => ({
              source: text(row[chart.source]), target: text(row[chart.target]),
              value: number(row[chart.value]) ?? 0, dashyRow: row,
              ...(dim(selected, row) ? { lineStyle: { opacity: 0.08 } } : {}),
            })),
            lineStyle: { color: "gradient", opacity: 0.35 },
            label: { color: theme.text },
          }],
        },
      };
    }
    case "boxplot": {
      const groups = new Map<string, Row[]>();
      for (const row of rows) {
        const key = text(row[chart.category]);
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }
      const categories = [...groups.keys()];
      return {
        modules: ["boxplot"],
        rowAt: (event) => (event.dataIndex === undefined ? undefined : groups.get(categories[event.dataIndex]!)?.[0]),
        option: {
          ...baseOption(theme, theme.palette),
          tooltip: { ...baseOption(theme, []).tooltip, trigger: "item" },
          grid: { left: 12, right: 20, top: 20, bottom: 10, outerBoundsMode: "same" },
          xAxis: { type: "category", data: categories, axisLabel: { color: theme.muted, hideOverlap: true }, axisLine: { lineStyle: { color: theme.border } } },
          yAxis: { type: "value", axisLabel: { color: theme.muted, formatter: (n: number) => formatValue(n, axisFormat(chart.format), locale) }, splitLine: { lineStyle: { color: theme.grid } } },
          series: [{
            type: "boxplot",
            data: categories.map((category) => {
              const group = groups.get(category)!;
              const value = boxplotStats(group.map((row) => number(row[chart.value])).filter((v): v is number => v !== null));
              const style = selected && !group.some(selected) ? { opacity: 0.3 } : undefined;
              return style ? { value, itemStyle: style } : value;
            }),
            itemStyle: { color: theme.surface, borderColor: theme.palette[0] },
          }],
        },
      };
    }
  }
}
