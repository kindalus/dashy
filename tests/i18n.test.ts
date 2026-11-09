import { expect, test } from "bun:test";
import {
  acceptedLanguage, formattingLocale, languageOf, languages, messages, readLanguageCookie, resolveLanguage, textFor, viewerLanguage,
} from "../core/i18n";
import { defineProject } from "../core/project";
import { DashyEngine } from "../core/engine";
import { createApiHandler, errorPage } from "../core/http";
import { createAuth } from "../core/auth";
import { DashyError } from "../core/params";
import { describeFilters, filterValue } from "../core/filters";
import { summaryLabel } from "../core/tables";
import { groupNavigation } from "../core/navigation";
import empty from "../dashy.config";

test("every language has every message, none empty, with the same arguments", () => {
  const reference = Object.keys(messages.en).sort();
  for (const language of languages) {
    const catalogue = messages[language] as Record<string, unknown>;
    expect({ language, keys: Object.keys(catalogue).sort() }).toEqual({ language, keys: reference });
    for (const key of reference) {
      const value = catalogue[key];
      const english = (messages.en as Record<string, unknown>)[key];
      expect({ key, type: typeof value }).toEqual({ key, type: typeof english });
      if (typeof value === "function") {
        expect({ key, arity: value.length }).toEqual({ key, arity: (english as (...args: never[]) => string).length });
        const text = (value as (...args: unknown[]) => string)(...Array.from({ length: value.length }, (_, i) => (i % 2 ? 2 : "X")));
        expect({ key, text: text.trim().length > 0 }).toEqual({ key, text: true });
      } else expect({ key, text: String(value).trim().length > 0 }).toEqual({ key, text: true });
    }
  }
  // Portuguese texts are not left in English by mistake (names that are the same in both are listed).
  const same = new Set(["dashboards", "dashboard", "total", "drillDown", "top"]);
  for (const key of reference)
    if (typeof (messages.pt as Record<string, unknown>)[key] === "string" && !same.has(key))
      expect({ key, pt: (messages.pt as Record<string, unknown>)[key] }).not.toEqual({ key, pt: (messages.en as Record<string, unknown>)[key] });
});

test("the project language defaults from the locale and can be limited or hidden", () => {
  expect(resolveLanguage()).toEqual({ name: "pt", selectable: ["en", "pt"] });
  expect(resolveLanguage({ locale: "pt-AO" }).name).toBe("pt");
  expect(resolveLanguage({ locale: "en-GB" }).name).toBe("en");
  expect(resolveLanguage({ locale: "fr" }).name).toBe("en");
  expect(resolveLanguage({ locale: "pt", language: "en" }).name).toBe("en");
  expect(resolveLanguage({ languages: false })).toEqual({ name: "pt", selectable: [] });
  expect(resolveLanguage({ languages: [] }).selectable).toEqual([]);
  expect(resolveLanguage({ language: "en", languages: ["pt", "en"] }).selectable).toEqual(["en", "pt"]);
  for (const config of [
    { language: "fr" }, { language: "PT" }, { languages: "all" }, { languages: ["en", "de"] }, { languages: ["en", "en"] },
    { language: "en", languages: ["pt"] }, { languages: null },
  ])
    expect(() => defineProject({ ...empty, ...(config as object) })).toThrow("Invalid Dashy language");
});

test("a viewer's choice applies only when offered, and formatting follows it", () => {
  const project = resolveLanguage({ locale: "pt-AO" });
  expect(viewerLanguage(project, undefined)).toBe("pt");
  expect(viewerLanguage(project, "en")).toBe("en");
  for (const choice of ["fr", "", "constructor", "EN"]) expect(viewerLanguage(project, choice)).toBe("pt");
  expect(viewerLanguage(resolveLanguage({ locale: "pt", languages: false }), "en")).toBe("pt");
  // The project locale stays when it is in the chosen language; otherwise the language's own.
  expect(formattingLocale("pt-AO", "pt")).toBe("pt-AO");
  expect(formattingLocale("pt-AO", "en")).toBe("en");
  expect(formattingLocale("en-GB", "pt")).toBe("pt");
  expect(languageOf("pt-BR")).toBe("pt");
  expect(textFor("pt-AO").applyFilters).toBe("Aplicar filtros");
  expect(textFor("en").applyFilters).toBe("Apply filters");
});

test("the language cookie and Accept-Language are read safely", () => {
  expect(readLanguageCookie("a=1; dashy_language=en; dashy_theme=excel")).toBe("en");
  expect(readLanguageCookie("dashy_theme=excel")).toBeUndefined();
  expect(readLanguageCookie("dashy_language=%E0%A4%A")).toBeUndefined();
  expect(readLanguageCookie(null)).toBeUndefined();
  expect(acceptedLanguage("pt-PT,pt;q=0.9,en;q=0.8")).toBe("pt");
  expect(acceptedLanguage("en-US,en;q=0.9")).toBe("en");
  expect(acceptedLanguage("de-DE")).toBeUndefined();
});

test("shared helpers translate filter values, subtotals and navigation fallbacks", () => {
  const params = { online: { label: "Online", type: "boolean" as const }, store: { label: "Loja", type: "string" as const } };
  expect(filterValue(true, params.online, messages.pt)).toBe("Sim");
  expect(filterValue(null, params.store, messages.pt)).toBe("Todos");
  expect(filterValue(null, params.store)).toBe("All");
  expect(describeFilters(["online", "store"], { online: false }, params, {}, messages.pt)).toBe("Online: Não · Loja: Todos");
  expect(summaryLabel("Toys", messages.pt)).toBe("Total Toys");
  expect(summaryLabel("Toys")).toBe("Toys total");
  const catalog = new DashyEngine({
    ...empty, dashboards: { a: { label: "A", blocks: [] } },
  }).catalog();
  expect(groupNavigation(catalog, messages.pt)[0]!.label).toBe("Dashboards");
  expect(groupNavigation({ ...catalog, dashboards: {}, pages: { p: { label: "P", component: "x" } } } as never, messages.pt)[0]!.label).toBe("Páginas");
});

test("the catalog exposes the language; error pages and exports follow the viewer", async () => {
  const engine = new DashyEngine({ ...empty, locale: "pt-AO", languages: ["pt", "en"] });
  const api = createApiHandler(engine);
  const catalog = await (await api(new Request("http://localhost/api/catalog"))).json();
  expect(catalog.locale).toBe("pt-AO");
  expect(catalog.language).toEqual({ name: "pt", selectable: ["en", "pt"] });
  const pt = await errorPage(new DashyError("Page not found", 404), undefined, "pt").text();
  expect(pt).toContain('<html lang="pt">');
  expect(pt).toContain("<h1>Não encontrado</h1><p>Página não encontrada</p>");
  expect(pt).toContain("Voltar à área de trabalho");
  const en = await errorPage(new DashyError("Page not found", 404)).text();
  expect(en).toContain("<h1>Not found</h1><p>Page not found</p>");
  // Project errors keep their own text.
  expect(await errorPage(new DashyError("Pick a customer", 400), undefined, "pt").text()).toContain("<p>Pick a customer</p>");
});

test("sign-in pages use the workspace choice, then the configured language, then the browser's", async () => {
  const secret = "s".repeat(32);
  const logout = (auth: ReturnType<typeof createAuth>, headers: Record<string, string> = {}) =>
    auth.authRoutes(new Request("http://localhost/auth/logout", { headers })).then((response) => response!.text());
  const plain = createAuth({ session: { secret } });
  expect(await logout(plain)).toContain("Signed out");
  expect(await logout(plain, { "Accept-Language": "pt-PT,pt;q=0.9" })).toContain("Sessão terminada");
  const portuguese = createAuth({ session: { secret }, language: "pt" });
  expect(await logout(portuguese)).toContain("Sessão terminada");
  expect(await logout(portuguese, { Cookie: "dashy_language=en" })).toContain("Signed out");
  expect(() => createAuth({ session: { secret }, language: "fr" as never })).toThrow("Invalid Dashy auth: language");
});
