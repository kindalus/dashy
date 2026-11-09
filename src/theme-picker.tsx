import { createContext, Show, useContext } from "solid-js";
import { Select } from "./select";
import { useText } from "./language-picker";
import { themeCookie, viewerTheme, type ResolvedTheme, type ThemeName } from "../core/theme";

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
  // Project themes carry their base theme too ("excel acme"), so both stylesheets apply.
  root.dataset.theme = theme.attribute;
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
  const t = useText();
  return <Show when={props.theme.selectable.length > 1}>
    <div class="theme-picker">
      <span id="theme-picker-label">{t().theme}</span>
      <Select id="theme-picker" labelledBy="theme-picker-label" value={props.active}
        options={props.theme.selectable.map((name) => ({ value: name, label: props.theme.themes[name]?.label ?? name }))}
        onChange={(value) => props.onChange(value as ThemeName)} />
    </div>
  </Show>;
}
