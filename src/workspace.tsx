import type { JSX } from "@solidjs/web";
import type { Catalog } from "../core/types";
import type { ThemeName } from "../core/theme";
import { Brand, DashboardNavigation } from "./navigation";
import { ThemePicker } from "./theme-picker";

export function Workspace(props: {
  catalog: Catalog; selected?: string; label?: string; kind: string; children: JSX.Element;
  theme?: ThemeName; onThemeChange?: (name: ThemeName) => void;
}) {
  return <div class="workspace">
    <a class="skip-link" href="#main">Skip to content</a>
    <aside class="sidebar">
      <Brand application={props.catalog.name} />
      <DashboardNavigation catalog={props.catalog} selected={props.selected} />
      <div class="sidebar-footer">
        {props.onThemeChange && <ThemePicker theme={props.catalog.theme} active={props.theme ?? props.catalog.theme.name} onChange={props.onThemeChange} />}
        <span class="sidebar-status"><span class="status-dot" />Read-only workspace</span>
      </div>
    </aside>
    <div class="main-column">
      <header class="topbar">
        <span class="breadcrumb">{props.kind} <span aria-hidden="true">/</span>{" "}<strong>{props.label || "Workspace"}</strong></span>
        <div class="mobile-brand"><Brand application={props.catalog.name} /></div>
        <DashboardNavigation catalog={props.catalog} selected={props.selected} mobile />
        <span class="workspace-badge">{props.catalog.name}</span>
      </header>
      <main id="main" tabindex={-1}>{props.children}</main>
    </div>
  </div>;
}
