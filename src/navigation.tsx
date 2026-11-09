import { createMemo, For, Show } from "solid-js";
import type { Catalog } from "../core/types";
import { groupNavigation } from "../core/navigation";
import { Icon } from "./icons";
import { useText } from "./language-picker";

export function Brand(props: { application: string }) {
  const t = useText();
  return (
    <a class="brand" href="/" aria-label={t().brandHome(props.application)}>
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
  const t = useText();
  const groups = createMemo(() => groupNavigation(props.catalog, t()));
  return (
    <Show
      when={props.mobile}
      fallback={
        <nav class="dashboard-nav" aria-label={t().workspaceNavigation}>
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
          {t().page}
          <select
            name="dashboard"
            autocomplete="off"
            aria-label={t().choosePage}
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
