import type { JSX } from "@solidjs/web";
import type { Catalog } from "../core/types";
import { For, Show } from "solid-js";
import type { ThemeName } from "../core/theme";
import { Brand, DashboardNavigation } from "./navigation";
import { ThemePicker } from "./theme-picker";

/** What the page reports for the top bar and the terminal status line. */
export interface PageStatus {
  text: string;
  requests?: number;
  ms?: number;
}

export function Workspace(props: {
  catalog: Catalog; selected?: string; label?: string; kind: string; children: JSX.Element;
  theme?: ThemeName; onThemeChange?: (name: ThemeName) => void; status?: PageStatus;
}) {
  // Every page a viewer can open directly: dashboards without required parameters, then custom
  // pages. The current page is always listed, so its tab can be marked.
  const tabs = () => [
    ...Object.entries(props.catalog.dashboards)
      .map(([id, d]) => ({ href: `/dashboards/${encodeURIComponent(id)}`, label: d.label, required: Boolean(d.required?.length) })),
    ...Object.entries(props.catalog.pages ?? {})
      .map(([id, p]) => ({ href: `/pages/${encodeURIComponent(id)}`, label: p.label, required: false })),
  ].filter((tab) => !tab.required || tab.href === props.selected);
  // Dashboards that open on their own (detail pages need a value first): MicroStrategy shows them as chapters.
  const chapters = () => props.selected?.startsWith("/dashboards/")
    ? Object.entries(props.catalog.dashboards).filter(([, d]) => !d.required?.length)
    : [];
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
        {/* Theme variants of the bar; each theme shows the parts its style uses. */}
        <span class="topbar-title" aria-hidden="true">{props.label || "Workspace"}</span>
        <span class="topbar-product" aria-hidden="true">{props.catalog.name}</span>
        <Show when={chapters().length > 1}>
          <nav class="topbar-chapters" aria-label="Chapters">
            <For each={chapters()}>
              {([id, dashboard]) => (
                <a href={`/dashboards/${encodeURIComponent(id)}`} aria-current={props.selected === `/dashboards/${encodeURIComponent(id)}` ? "page" : undefined}>{dashboard.label}</a>
              )}
            </For>
          </nav>
        </Show>
        <div class="mobile-brand"><Brand application={props.catalog.name} /></div>
        <DashboardNavigation catalog={props.catalog} selected={props.selected} mobile />
        <span class="topbar-status" aria-hidden="true">{props.status?.text ?? ""}</span>
        <span class="workspace-badge">{props.catalog.name}</span>
      </header>
      <main id="main" tabindex={-1}>{props.children}</main>
      {/* Bottom bars of the layout, below the content on every page: sheet or page tabs
          (Excel, Power BI) and a terminal status line (Claude Code). Other themes hide them. */}
      <Show when={tabs().length > 1}>
        <nav class="page-tabs" aria-label="Pages">
          <For each={tabs()}>
            {(tab) => <a href={tab.href} aria-current={tab.href === props.selected ? "page" : undefined}>{tab.label}</a>}
          </For>
        </nav>
      </Show>
      <Show when={props.status?.text}>
        <div class="status-line" aria-hidden="true">
          <span class="status-ok">●</span>
          <span>{props.status!.text}</span>
          <Show when={props.status!.requests}>
            <span>{props.status!.requests} requests{props.status!.ms !== undefined ? ` · ${props.status!.ms} ms` : ""}</span>
          </Show>
          <span>{props.catalog.name}</span>
        </div>
      </Show>
    </div>
  </div>;
}
