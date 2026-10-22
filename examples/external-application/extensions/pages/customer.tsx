import { createSignal, For, onSettled, Show } from "solid-js";
import { fetchDataset, formatValue, Spinner, type PageProps, type QueryResult } from "dashy/ui";
import "./customer.css";

export default function Customer(props: PageProps) {
  const [result, setResult] = createSignal<QueryResult>();
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  let controller: AbortController | undefined;
  async function load() {
    controller?.abort();
    const current = controller = new AbortController();
    setLoading(true);
    setError("");
    try {
      const data = await fetchDataset("customer_orders", { customer: props.params.customer ?? null }, current.signal);
      if (!current.signal.aborted) setResult(data);
    } catch (failure) {
      if (!current.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to load orders");
    } finally {
      if (!current.signal.aborted) setLoading(false);
    }
  }
  onSettled(() => { void load(); return () => controller?.abort(); });
  return <section class="customer-page" aria-label="Customer details">
    <form class="filters" method="get">
      <label>Customer<input name="customer" type="number" min="1" step="1" required value={String(props.params.customer ?? 1)} /></label>
      <button class="button primary" type="submit">Open customer</button>
    </form>
    <article class="block customer-orders" aria-busy={loading() ? "true" : "false"}>
      <h2>Orders for customer {String(props.params.customer)}</h2>
      <Show when={loading()}><div role="status"><Spinner /> Loading orders…</div></Show>
      <Show when={error()}><p role="alert">{error()}</p></Show>
      <Show when={!loading() && !error()}>
        <ul><For each={result()?.rows ?? []}>{row => <li>
          <span>{String(row.product)}</span>
          <strong>{formatValue(row.amount, { style: "currency", currency: "EUR" }, props.locale)}</strong>
        </li>}</For></ul>
        <Show when={!result()?.rows.length}><p>No orders for this customer.</p></Show>
      </Show>
      <button class="button secondary" disabled={loading()} onClick={() => void load()}>Reload orders</button>
    </article>
  </section>;
}
