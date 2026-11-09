import { createContext, Show, useContext } from "solid-js";
import { Select } from "./select";
import {
  languageCookie, languageNames, textFor, viewerLanguage, type Language, type Messages, type ResolvedLanguage,
} from "../core/i18n";

/**
 * The locale numbers and dates use on screen. Its language is the interface
 * language (see formattingLocale), so components read both from here. Outside a
 * provider (for example in tests) it is English.
 */
export const LocaleContext = createContext<() => string>(() => "en");
export const useLocale = () => useContext(LocaleContext);
/** Interface text for the active language, as an accessor so it follows a change. */
export function useText(): () => Messages {
  const locale = useLocale();
  return () => textFor(locale());
}

/** Applies a language to the document and remembers it for the next SSR. */
export function applyLanguage(project: ResolvedLanguage, name: Language): Language {
  const language = viewerLanguage(project, name);
  document.documentElement.lang = language;
  // The project language needs no cookie: clearing it follows future project changes.
  document.cookie = language === project.name
    ? `${languageCookie}=; Path=/; Max-Age=0; SameSite=Lax`
    : `${languageCookie}=${encodeURIComponent(language)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  return language;
}

export function LanguagePicker(props: { language: ResolvedLanguage; active: Language; onChange: (name: Language) => void }) {
  const t = useText();
  return <Show when={props.language.selectable.length > 1}>
    <div class="theme-picker language-picker">
      <span id="language-picker-label">{t().language}</span>
      <Select id="language-picker" labelledBy="language-picker-label" value={props.active}
        options={props.language.selectable.map((name) => ({ value: name, label: languageNames[name] }))}
        onChange={(value) => props.onChange(value as Language)} />
    </div>
  </Show>;
}
