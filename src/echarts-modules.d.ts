// ECharts ships per-type installers without declarations; they share one shape.
declare module "echarts/lib/chart/*/install.js" {
  export const install: import("echarts/core").EChartsExtensionInstaller;
}
declare module "echarts/lib/chart/bar/installPictorialBar.js" {
  export const install: import("echarts/core").EChartsExtensionInstaller;
}
declare module "echarts/lib/component/marker/installMarkLine.js" {
  export const install: import("echarts/core").EChartsExtensionInstaller;
}
declare module "echarts/lib/component/*/install.js" {
  export const install: import("echarts/core").EChartsExtensionInstaller;
}
