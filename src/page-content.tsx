import type { Component } from "solid-js";
import type { Catalog, PageShell } from "../core/types";
import type { PageProps } from "./extension-api";
import { useLocale } from "./language-picker";
import { languageOf } from "../core/i18n";

export function PageContent(props: { page: PageShell; catalog: Catalog; component: Component<PageProps> }) {
  const Page = props.component;
  const locale = useLocale();
  return <>
    <div class="page-heading"><div>
      <h1>{props.page.definition.label}</h1>
      <p>{props.page.definition.description}</p>
    </div></div>
    <Page page={props.page} params={props.page.params} catalog={props.catalog} locale={locale()} language={languageOf(locale())} />
  </>;
}
