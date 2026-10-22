import { createMemo, For, Show } from "solid-js";
import type { Catalog } from "../core/types";
import { groupDashboards } from "../core/navigation";
import { Icon } from "./icons";

export function Brand(props: { application: string }) {
  return (
    <a class="brand" href="/" aria-label={`Dashy · ${props.application} home`}>
      <span class="brand-mark">
        <Icon name="chart-no-axes-combined" />
      </span>
      <span class="brand-copy">
        <span class="brand-name">Dashy</span>
        <span class="brand-application">{props.application}</span>
      </span>
    </a>
  );
}

export function DashboardNavigation(props: {
  catalog: Catalog;
  selected?: string;
  mobile?: boolean;
}) {
  const groups = createMemo(() => groupDashboards(props.catalog.dashboards));
  return (
    <Show
      when={props.mobile}
      fallback={
        <nav class="dashboard-nav" aria-label="Dashboards">
          <For each={groups()}>
            {(group) => (
              <section class="nav-group" aria-label={group.label}>
                <h2 class="nav-label">{group.label}</h2>
                <For each={group.dashboards}>
                  {([id, dashboard]) => (
                    <a
                      class="nav-item"
                      aria-current={props.selected === id ? "page" : undefined}
                      href={`/dashboards/${encodeURIComponent(id)}`}
                    >
                      <Icon name={dashboard.icon} />
                      <span>{dashboard.label}</span>
                    </a>
                  )}
                </For>
              </section>
            )}
          </For>
        </nav>
      }
    >
      <Show when={groups().length > 0}>
        <label class="mobile-nav">
          Dashboard
          <select
            name="dashboard"
            autocomplete="off"
            aria-label="Choose dashboard"
            value={props.selected || ""}
            onChange={(event) => {
              location.href = `/dashboards/${encodeURIComponent(event.currentTarget.value)}`;
            }}
          >
            <For each={groups()}>
              {(group) => (
                <optgroup label={group.label}>
                  <For each={group.dashboards}>
                    {([id, dashboard]) => (
                      <option value={id}>{dashboard.label}</option>
                    )}
                  </For>
                </optgroup>
              )}
            </For>
          </select>
        </label>
      </Show>
    </Show>
  );
}
