import { expect, test } from "bun:test";
import { DashyEngine } from "../core/engine";
import { defineConfig, defineProject } from "../core/project";
import { groupNavigation } from "../core/navigation";
import { createApiHandler } from "../core/http";

const project = defineProject(defineConfig({
  name: "Pages",
  params: { customer: { label: "Customer", type: "number", integer: true, min: 1, default: 1 } },
  queries: { private_query: { label: "Private", sources: [], roles: ["admin"], build: () => ({ text: "SELECT 1 AS n", values: [] }) } },
  datasets: { private_data: { label: "Private", query: "private_query", columns: [{ key: "n", label: "N" }] } },
  dashboards: { customer: { label: "Sales", group: "Customers", blocks: [] } },
  pages: {
    customer: { label: "Customer", component: "pages/customer.tsx", group: "Customers", icon: "users", params: ["customer"] },
    private: { label: "Private", component: "pages/private.tsx", group: "Administration", roles: ["admin"] },
  },
}));
const engine = new DashyEngine(project);

test("catalog exposes authorized metadata without implementation paths and groups mixed navigation", () => {
  const catalog = engine.catalog();
  expect(Object.keys(catalog.pages ?? {})).toEqual(["customer"]);
  expect(JSON.stringify(catalog)).not.toContain("component");
  expect(JSON.stringify(catalog)).not.toContain("Administration");
  const groups = groupNavigation(catalog);
  expect(groups.map(g => g.label)).toEqual(["Customers"]);
  expect(groups[0]?.entries.map(e => e.href)).toEqual(["/dashboards/customer", "/pages/customer"]);
  expect(engine.catalog({ roles: ["admin"] }).pages?.private).toBeDefined();
});

test("page shells authorize before parsing inputs and validate defaults and filters", () => {
  expect(engine.pageShell("customer").params.customer).toBe(1);
  expect(engine.pageShell("customer", { customer: "2" }).params.customer).toBe(2);
  expect(() => engine.pageShell("customer", { customer: "0" })).toThrow("allowed range");
  expect(() => engine.pageShell("customer", { unknown: 1 })).toThrow("Unknown parameter");
  expect(() => engine.pageShell("private", { unknown: 1 })).toThrow("Access denied");
  expect(() => engine.pageShell("constructor")).toThrow("Page not found");
  expect(() => engine.pageShell("missing")).toThrow("Page not found");
  expect(engine.pageShell("private", {}, { roles: ["admin"] }).id).toBe("private");
});

test("public pages do not grant access to protected queries through datasets", async () => {
  const api = createApiHandler(engine);
  expect((await api(new Request("http://localhost/api/datasets/private_data"))).status).toBe(403);
});

test("page definitions reject unsupported icons, paths, references and malformed roles", () => {
  for (const component of ["../private.tsx", "/tmp/page.tsx", "pages/../page.tsx", "C:\\page.tsx", "page.ts", ""]) {
    expect(() => defineProject({ ...project, pages: { bad: { label: "Bad", component } } })).toThrow("component must be");
  }
  expect(() => defineProject({ ...project, pages: { bad: { label: "Bad", component: "page.tsx", params: ["missing"] } } })).toThrow("unknown parameter");
  expect(() => defineProject({ ...project, pages: { bad: { label: "Bad", component: "page.tsx", defaults: { customer: 1 } } } })).toThrow("not a page parameter");
});

test("page validation rejects unknown icons, malformed groups and roles", () => {
  for (const extra of [{ icon: "unknown" }, { group: " " }, { group: " Customers" }, { roles: "admin" }, { roles: [null] }]) {
    expect(() => defineProject({ ...project, pages: { bad: { label: "Bad", component: "page.tsx", ...extra } } } as unknown as typeof project)).toThrow();
  }
});
