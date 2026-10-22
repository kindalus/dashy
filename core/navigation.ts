import type { DashboardDefinition } from "./types";

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
