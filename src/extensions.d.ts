declare module "virtual:dashy-pages" {
  export const pages: Record<string, {
    component: string;
    assets: { entry?: string; css: { href: string }[]; js: { href: string }[] };
    load(): Promise<{ default: import("solid-js").Component<import("./extension-api").PageProps> }>;
  }>;
}

/** The project's theme stylesheets; importing it bundles them. */
declare module "virtual:dashy-themes" {}
