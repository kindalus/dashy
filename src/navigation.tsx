import { createMemo, For, Show } from "solid-js";
import type { Catalog } from "../core/types";
import { groupNavigation } from "../core/navigation";
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
  const groups = createMemo(() => groupNavigation(props.catalog));
  return (
    <Show
      when={props.mobile}
      fallback={
        <nav class="dashboard-nav" aria-label="Workspace navigation">
          <For each={groups()}>
            {(group) => (
              <section class="nav-group" aria-label={group.label}>
                <h2 class="nav-label">{group.label}</h2>
                <For each={group.entries}>
                  {({ href, definition: dashboard }) => (
                    <a
                      class="nav-item"
                      aria-current={props.selected === href ? "page" : undefined}
                      href={href}
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
          Page
          <select
            name="dashboard"
            autocomplete="off"
            aria-label="Choose page"
            value={props.selected || ""}
            onChange={(event) => {
              location.href = event.currentTarget.value;
            }}
          >
            <For each={groups()}>
              {(group) => (
                <optgroup label={group.label}>
                  <For each={group.entries}>
                    {({ href, definition: dashboard }) => (
                      <option value={href}>{dashboard.label}</option>
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
