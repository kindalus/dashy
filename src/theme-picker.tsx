import { createContext, For, Show, useContext } from "solid-js";
import { themeCookie, themeLabels, viewerTheme, type ResolvedTheme, type ThemeName } from "../core/theme";

/**
 * The active theme name. Charts read it so they redraw with the new palette;
 * outside a provider (for example in tests) it is always undefined.
 */
export const ThemeContext = createContext<() => ThemeName | undefined>(() => undefined);
export const useActiveTheme = () => useContext(ThemeContext);

/** Applies a theme to the document and remembers it for the next SSR. */
export function applyTheme(project: ResolvedTheme, name: ThemeName) {
  const theme = viewerTheme(project, name);
  const root = document.documentElement;
  root.dataset.theme = theme.name;
  root.dataset.cornersInputs = theme.corners.inputs;
  root.dataset.cornersButtons = theme.corners.buttons;
  root.dataset.cornersPanels = theme.corners.panels;
  // The project theme needs no cookie: clearing it follows future project changes.
  document.cookie = theme.name === project.name
    ? `${themeCookie}=; Path=/; Max-Age=0; SameSite=Lax`
    : `${themeCookie}=${encodeURIComponent(theme.name)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  return theme.name;
}

export function ThemePicker(props: { theme: ResolvedTheme; active: ThemeName; onChange: (name: ThemeName) => void }) {
  return <Show when={props.theme.selectable.length > 1}>
    <label class="theme-picker">
      <span>Theme</span>
      <select value={props.active} onChange={(event) => props.onChange(event.currentTarget.value as ThemeName)}>
        <For each={props.theme.selectable}>
          {(name) => <option value={name} selected={name === props.active}>{themeLabels[name]}</option>}
        </For>
      </select>
    </label>
  </Show>;
}
