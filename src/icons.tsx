import {
  LayoutDashboard,
  PanelsTopLeft,
  ChartNoAxesCombined,
  ChartLine,
  ChartColumn,
  ChartPie,
  CircleDollarSign,
  Wallet,
  ShieldCheck,
  Users,
  UserSearch,
  Contact,
  Package,
  Boxes,
  Shapes,
  PawPrint,
  ShoppingCart,
  Store,
  Globe,
  Database,
  Table,
  FileChartColumn,
  Activity,
  Settings,
  type IconNode,
} from "lucide";
import { defaultDashboardIcon, type DashboardIconName } from "../core/icons";

// Named imports keep the unused Lucide icons out of the client bundle.
const nodes: Record<DashboardIconName, IconNode> = {
  "layout-dashboard": LayoutDashboard,
  "panels-top-left": PanelsTopLeft,
  "chart-no-axes-combined": ChartNoAxesCombined,
  "chart-line": ChartLine,
  "chart-column": ChartColumn,
  "chart-pie": ChartPie,
  "circle-dollar-sign": CircleDollarSign,
  wallet: Wallet,
  "shield-check": ShieldCheck,
  users: Users,
  "user-search": UserSearch,
  contact: Contact,
  package: Package,
  boxes: Boxes,
  shapes: Shapes,
  "paw-print": PawPrint,
  "shopping-cart": ShoppingCart,
  store: Store,
  globe: Globe,
  database: Database,
  table: Table,
  "file-chart-column": FileChartColumn,
  activity: Activity,
  settings: Settings,
};
// Only trusted, pinned library geometry reaches innerHTML. Project input selects
// a key; it never supplies markup, attributes, URLs or paths.
const markup = Object.fromEntries(
  Object.entries(nodes).map(([name, node]) => [
    name,
    node
      .map(
        ([tag, attrs]) =>
          `<${tag} ${Object.entries(attrs)
            .map(
              ([key, value]) =>
                `${key}="${String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;")}"`,
            )
            .join(" ")}/>`,
      )
      .join(""),
  ]),
);

export function Icon(props: { name?: DashboardIconName; class?: string }) {
  return (
    <svg
      class={props.class || "icon"}
      data-icon={props.name || defaultDashboardIcon}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      innerHTML={markup[props.name || defaultDashboardIcon]}
    />
  );
}
