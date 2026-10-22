import { expect, test } from "bun:test";
import { defineProject } from "../core/project";
import { groupDashboards } from "../core/navigation";
import { dashboardIconNames } from "../core/icons";
import { DashyEngine } from "../core/engine";
import empty from "../dashy.config";
import type { ProjectDefinition } from "../core/types";

test("groups follow first appearance and preserve dashboard order within sections", () => {
  const groups = groupDashboards({
    summary: { label: "Summary", blocks: [] },
    clients: { label: "Clients", group: "Visualizações", blocks: [] },
    financial: { label: "Financial", group: "Dashboards", blocks: [] },
    products: { label: "Products", group: "Visualizações", blocks: [] },
  });
  expect(groups.map((g) => [g.label, g.dashboards.map(([id]) => id)])).toEqual([
    ["Dashboards", ["summary", "financial"]],
    ["Visualizações", ["clients", "products"]],
  ]);
  expect(groupDashboards({})).toEqual([]);
});

test("validates Lucide names and group labels before startup", () => {
  for (const icon of dashboardIconNames) {
    expect(() =>
      defineProject({
        ...empty,
        dashboards: {
          demo: { label: "Demo", icon, group: "Analysis", blocks: [] },
        },
      }),
    ).not.toThrow();
  }
  const project: ProjectDefinition = {
    ...empty,
    dashboards: { demo: { label: "Demo", blocks: [] } },
  };
  for (const icon of ["missing", "toString", "<svg>"]) {
    expect(() =>
      defineProject({
        ...project,
        dashboards: { demo: { ...project.dashboards.demo!, icon } },
      } as ProjectDefinition),
    ).toThrow("unknown icon");
  }
  for (const group of ["", " ", " Analysis "]) {
    expect(() =>
      defineProject({
        ...project,
        dashboards: { demo: { ...project.dashboards.demo!, group } },
      }),
    ).toThrow("group must be");
  }
});

test("authorized catalog retains icons and groups without exposing hidden sections", () => {
  const engine = new DashyEngine({
    ...empty,
    dashboards: {
      public: {
        label: "Public",
        icon: "users",
        group: "Customers",
        blocks: [],
      },
      secret: {
        label: "Secret",
        icon: "shield-check",
        group: "Internal",
        roles: ["admin"],
        blocks: [],
      },
    },
  });
  const catalog = engine.catalog();
  expect(catalog.dashboards.public?.icon).toBe("users");
  expect(groupDashboards(catalog.dashboards).map((g) => g.label)).toEqual([
    "Customers",
  ]);
  expect(
    groupDashboards(engine.catalog({ roles: ["admin"] }).dashboards).map(
      (g) => g.label,
    ),
  ).toEqual(["Customers", "Internal"]);
});
