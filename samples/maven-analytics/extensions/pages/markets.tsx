import { For } from "solid-js";
import { formatValue, paramsSearch, type PageProps } from "dashy/ui";
import { dashboardLink, pageParams, PageFilters, Results, usePageData } from "./shared";

export default function MarketExplorer(props: PageProps) {
  const params = pageParams(props);
  const data = usePageData(async signal => {
    const response = await fetch(`/api/custom/markets?${paramsSearch(params)}`, { signal, credentials: "same-origin" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Unable to load markets");
    return body;
  });
  const totalRevenue = () => (data.result()?.rows ?? []).reduce((sum, row) => sum + Number(row.revenue), 0);
  const share = (revenue: number) => totalRevenue() ? revenue / totalRevenue() : 0;
  const money = (value: number) => formatValue(value, { style: "currency", currency: "USD", decimals: 0 }, props.locale);
  return <div class="maven-page">
    <PageFilters {...props} />
    <Results data={data}>
      <div class="maven-section-heading"><h2>Revenue by customer country</h2>
        <a href={dashboardLink("customers", params)}>View customer dashboard</a>
      </div>
      <p class="maven-caption">{money(totalRevenue())} across {data.result()?.rows.length ?? 0} markets. Shares use the full filtered sales, not the order detail limit.</p>
      <ol class="block maven-markets"><For each={data.result()?.rows ?? []}>{row => <li>
        <div class="maven-market-title"><h3>{String(row.country)}</h3><strong class="maven-money">{money(Number(row.revenue))}</strong></div>
        <div class="maven-share"><meter min="0" max="1" value={share(Number(row.revenue))} aria-label={`${row.country} revenue share`} />
          <span>{formatValue(share(Number(row.revenue)), { style: "percent", decimals: 1 }, props.locale)}</span>
        </div>
        <dl class="maven-values">
          <div><dt>Customers</dt><dd>{formatValue(row.customers, { decimals: 0 }, props.locale)}</dd></div>
          <div><dt>Orders</dt><dd>{formatValue(row.orders, { decimals: 0 }, props.locale)}</dd></div>
          <div><dt>Average order</dt><dd>{money(Number(row.orders) ? Number(row.revenue) / Number(row.orders) : 0)}</dd></div>
        </dl>
        <a href={dashboardLink("orders", { ...params, country: String(row.country) })}>Explore orders<span class="sr-only"> in {String(row.country)}</span></a>
      </li>}</For></ol>
    </Results>
  </div>;
}
