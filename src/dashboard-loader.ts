import type { DashboardData, DashboardShell } from "../core/types";

export interface DataState {
  loading: boolean;
  error: string;
  data?: DashboardData;
}
export type DashboardLoads = Record<string, DataState>;

/** Include defaults and explicitly cleared filters in every initial request. */
export function dashboardSearchParams(dashboard: DashboardShell): URLSearchParams {
  const query = new URLSearchParams();
  for (const name of dashboard.definition.params || []) {
    const value = dashboard.params[name];
    if (Array.isArray(value) && value.length)
      value.forEach((item) => query.append(name, String(item)));
    else if (value && typeof value === "object" && !Array.isArray(value)) {
      query.set(`${name}.from`, String(value.from));
      query.set(`${name}.until`, String(value.until));
    } else query.set(name, value == null || Array.isArray(value) ? "" : String(value));
  }
  return query;
}

/** Shares each data request across its blocks; different requests settle independently. */
export class DashboardLoader {
  state: DashboardLoads;
  private generation = 0;
  private controllers = new Map<string, AbortController>();
  private params = new URLSearchParams();

  constructor(
    private dashboard: DashboardShell,
    private changed: (state: DashboardLoads) => void,
    private request: typeof fetch = fetch,
  ) {
    this.state = Object.fromEntries(dashboard.requests.map(({ id }) => [
      id, { loading: true, error: "" },
    ]));
  }

  async load(params: URLSearchParams): Promise<void> {
    this.dispose();
    this.params = new URLSearchParams(params);
    this.state = Object.fromEntries(this.dashboard.requests.map(({ id }) => [
      id, { ...this.state[id], loading: true, error: "" },
    ]));
    this.changed(this.state);
    const generation = this.generation;
    await Promise.all(this.dashboard.requests.map(({ id }) => this.run(id, generation)));
  }

  async retry(id: string): Promise<void> {
    if (!Object.hasOwn(this.state, id) || this.state[id]!.loading) return;
    this.update(id, { ...this.state[id]!, loading: true, error: "" });
    await this.run(id, this.generation);
  }

  dispose(): void {
    this.generation++;
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }

  private update(id: string, state: DataState): void {
    this.state = { ...this.state, [id]: state };
    this.changed(this.state);
  }

  private async run(id: string, generation: number): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(id, controller);
    try {
      // Native browser fetch must not receive the loader as its `this` value.
      const request = this.request;
      const response = await request(
        `/api/dashboard-data/${encodeURIComponent(this.dashboard.id)}/${encodeURIComponent(id)}?${this.params}`,
        { signal: controller.signal },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load data");
      if (generation !== this.generation) return;
      this.update(id, { loading: false, error: "", data: body });
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) return;
      this.update(id, {
        ...this.state[id]!,
        loading: false,
        error: error instanceof Error ? error.message : "Unable to load data",
      });
    } finally {
      if (this.controllers.get(id) === controller) this.controllers.delete(id);
    }
  }
}
