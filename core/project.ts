import type { ProjectDefinition, ProjectConfig } from "./types.ts";
import { dashboardIconNames } from "./icons.ts";
import { resolveTheme } from "./theme.ts";

export function defineProject<const T extends ProjectDefinition>(
  project: T,
): T {
  resolveTheme(project.theme);
  if (project.locale !== undefined) {
    try {
      if (typeof project.locale !== "string" || !project.locale)
        throw new Error();
      Intl.getCanonicalLocales(project.locale);
    } catch {
      throw new Error("Invalid Dashy project: locale must be a language tag such as pt, en or pt-AO.");
    }
  }
  const assert = (condition: unknown, message: string) => {
    if (!condition) throw new Error(`Invalid Dashy project: ${message}`);
  };
  const names = (kind: string, entries: Record<string, unknown>) => {
    for (const name of Object.keys(entries))
      assert(
        /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name),
        `${kind} name '${name}' must be an identifier`,
      );
  };
  for (const kind of [
    "params",
    "sources",
    "queries",
    "metrics",
    "datasets",
    "dashboards",
  ] as const)
    names(kind, project[kind]);
  const params = (owner: string, list: readonly string[] = []) => {
    for (const name of list)
      assert(
        Object.hasOwn(project.params, name),
        `${owner} references unknown parameter ${name}`,
      );
  };
  for (const [name, query] of Object.entries(project.queries)) {
    params(name, query.params);
    for (const source of query.sources)
      assert(
        Object.hasOwn(project.sources, source),
        `${name} references unknown source ${source}`,
      );
    assert(
      query.maxRows === undefined ||
        (Number.isInteger(query.maxRows) &&
          query.maxRows > 0 &&
          query.maxRows <= 100_000),
      `${name} has invalid maxRows`,
    );
  }
  for (const [name, metric] of Object.entries(project.metrics))
    assert(
      Object.hasOwn(project.queries, metric.query),
      `${name} references unknown query ${metric.query}`,
    );
  for (const [name, dataset] of Object.entries(project.datasets)) {
    assert(
      Object.hasOwn(project.queries, dataset.query),
      `${name} references unknown query ${dataset.query}`,
    );
    const columns = dataset.columns.map((column) => column.key);
    assert(
      new Set(columns).size === columns.length,
      `${name} has duplicate columns`,
    );
    if (dataset.chart) {
      assert(
        columns.includes(dataset.chart.x),
        `${name} chart has unknown x column`,
      );
      for (const series of dataset.chart.series)
        assert(
          columns.includes(series.key),
          `${name} chart has unknown series ${series.key}`,
        );
    }
  }
  names("pages", project.pages ?? {});
  for (const [name, page] of Object.entries(project.pages ?? {})) {
    assert(typeof page.label === "string" && page.label.trim(), `${name} page requires a label`);
    assert(typeof page.component === "string" && /\.(tsx|jsx)$/.test(page.component)
      && !page.component.startsWith("/") && !page.component.includes("\\")
      && !page.component.split("/").includes(".."), `${name} component must be a relative .tsx or .jsx path inside extensions`);
    params(name, page.params);
    for (const key of Object.keys(page.defaults ?? {}))
      assert(page.params?.includes(key), `${name} default ${key} is not a page parameter`);
    assert(page.icon === undefined || dashboardIconNames.includes(page.icon), `${name} has unknown icon '${page.icon}'`);
    assert(page.group === undefined || (typeof page.group === "string" && page.group.trim() && page.group.trim() === page.group), `${name} group must be a non-empty label without surrounding whitespace`);
    assert(page.roles === undefined || (Array.isArray(page.roles) && page.roles.every(role => typeof role === "string")), `${name} roles must be strings`);
  }
  for (const [name, dashboard] of Object.entries(project.dashboards)) {
    assert(
      dashboard.icon === undefined ||
        dashboardIconNames.includes(dashboard.icon),
      `${name} has unknown icon '${dashboard.icon}'. Use a supported Lucide name.`,
    );
    assert(
      dashboard.group === undefined ||
        (typeof dashboard.group === "string" &&
          dashboard.group.trim().length > 0 &&
          dashboard.group === dashboard.group.trim()),
      `${name} group must be a non-empty label without surrounding whitespace`,
    );
    params(name, dashboard.params);
    assert(
      new Set(dashboard.blocks.map((block) => block.id)).size ===
        dashboard.blocks.length,
      `${name} has duplicate block IDs`,
    );
    for (const key of Object.keys(dashboard.defaults || {}))
      assert(
        dashboard.params?.includes(key),
        `${name} default ${key} is not a dashboard parameter`,
      );
    for (const block of dashboard.blocks) {
      assert(
        block.width === undefined ||
          (Number.isInteger(block.width) &&
            block.width >= 1 &&
            block.width <= 12),
        `${name} block width must be 1–12`,
      );
      const target =
        block.type === "metric"
          ? project.metrics[block.metric]
          : project.datasets[block.dataset];
      assert(target, `${name} references an unknown ${block.type}`);
      const query = project.queries[target!.query]!;
      for (const param of query.params || []) {
        if (
          project.params[param]?.required &&
          project.params[param]?.default === undefined
        )
          assert(
            dashboard.params?.includes(param),
            `${name} must expose required parameter ${param}`,
          );
      }
    }
  }
  return project;
}

/** Compose external registries at runtime before validating cross-references. */
export function defineConfig<const T extends ProjectConfig>(config: T): T & ProjectDefinition {
  return { params: {}, sources: {}, queries: {}, datasets: {}, metrics: {}, dashboards: {}, ...config };
}
