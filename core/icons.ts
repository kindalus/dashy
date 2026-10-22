/** Supported Lucide names. Keep the renderer's registry in sync with this list. */
export const dashboardIconNames = [
  "layout-dashboard",
  "panels-top-left",
  "chart-no-axes-combined",
  "chart-line",
  "chart-column",
  "chart-pie",
  "circle-dollar-sign",
  "wallet",
  "shield-check",
  "users",
  "user-search",
  "contact",
  "package",
  "boxes",
  "shapes",
  "paw-print",
  "shopping-cart",
  "store",
  "globe",
  "database",
  "table",
  "file-chart-column",
  "activity",
  "settings",
] as const;
export type DashboardIconName = (typeof dashboardIconNames)[number];
export const defaultDashboardIcon: DashboardIconName = "layout-dashboard";
