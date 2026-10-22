import type { ProjectDefinition } from "./types";

export function assertCompiledPages(project: ProjectDefinition, compiled: Record<string, { component: string }>) {
  for (const [id, page] of Object.entries(project.pages ?? {})) {
    if (!Object.hasOwn(compiled, id) || compiled[id]?.component !== page.component.replace(/^\.\//, ""))
      throw new Error(`Page '${id}' is not in this build. Rebuild Dashy with the selected implementation.`);
  }
}
