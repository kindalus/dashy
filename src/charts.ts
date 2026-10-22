// Load only the chart types supported by DatasetDefinition.
import { use } from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";

use([
  BarChart,
  LineChart,
  AriaComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  SVGRenderer,
]);

export { init } from "echarts/core";

/** Read resolved CSS values so charts use the selected UI theme. */
export function readChartTheme(element: HTMLElement) {
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
