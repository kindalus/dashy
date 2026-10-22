import type { DashboardDefinition, Catalog, PageMetadata } from "./types";

/** Input must be the authorized catalog, so hidden dashboards cannot create groups. */
export function groupDashboards(
  dashboards: Record<string, DashboardDefinition>,
) {
  const groups = new Map<string, [string, DashboardDefinition][]>();
  for (const entry of Object.entries(dashboards)) {
    const label = entry[1].group ?? "Dashboards";
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(entry);
  }
  return Array.from(groups, ([label, dashboards]) => ({ label, dashboards }));
}

/** Routes, rather than bare IDs, distinguish a page and dashboard sharing an ID. */
export function groupNavigation(catalog: Catalog) {
  const groups = new Map<string, { href: string; definition: PageMetadata }[]>();
  for (const [kind, entries, fallback] of [
    ["dashboards", catalog.dashboards, "Dashboards"],
    ["pages", catalog.pages ?? {}, "Pages"],
  ] as const) {
    for (const [id, definition] of Object.entries(entries)) {
      const label = definition.group ?? fallback;
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push({ href: `/${kind}/${encodeURIComponent(id)}`, definition });
    }
  }
  return Array.from(groups, ([label, entries]) => ({ label, entries }));
}
