import { For } from "solid-js";
import { fetchDataset, formatValue, type PageProps, type Scalar } from "dashy/ui";
import { dashboardLink, pageParams, PageFilters, Results, usePageData } from "./shared";

export default function ProductExplorer(props: PageProps) {
  const params = pageParams(props);
  const data = usePageData(signal => fetchDataset("products", params, signal));
  const money = (value: Scalar | undefined) => formatValue(value, { style: "currency", currency: "USD", decimals: 0 }, props.locale);
  return <div class="maven-page">
    <PageFilters {...props} />
    <Results data={data}>
      <div class="maven-section-heading"><h2>Top {data.result()?.rows.length ?? 0} products by revenue</h2>
        <a href={dashboardLink("products", params)}>View category analysis</a>
      </div>
      <p class="maven-caption">Ranked within the selected filters. Revenue and gross profit use published USD list prices.</p>
      <ol class="maven-products"><For each={data.result()?.rows ?? []}>{(row, index) => <li class="block maven-product">
        <div class="maven-product-heading"><span class="maven-rank">#{index() + 1}</span><span>{String(row.brand)}</span></div>
        <h3>{String(row.product)}</h3><p class="maven-caption">{String(row.category)}</p>
        <dl class="maven-values">
          <div><dt>Revenue</dt><dd class="maven-money">{money(row.revenue)}</dd></div>
          <div><dt>Gross profit</dt><dd>{money(row.profit)}</dd></div>
          <div><dt>Units sold</dt><dd>{formatValue(row.units, { decimals: 0 }, props.locale)}</dd></div>
          <div><dt>Gross margin</dt><dd>{formatValue(row.margin, { style: "percent", decimals: 1 }, props.locale)}</dd></div>
        </dl>
        <a href={dashboardLink("orders", { ...params, product: String(row.product) })}>View order lines<span class="sr-only"> for {String(row.product)}</span></a>
      </li>}</For></ol>
    </Results>
  </div>;
}
