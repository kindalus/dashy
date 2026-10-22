declare module "virtual:dashy-pages" {
  export const pages: Record<string, {
    component: string;
    assets: { entry?: string; css: { href: string }[]; js: { href: string }[] };
    load(): Promise<{ default: import("solid-js").Component<import("./extension-api").PageProps> }>;
  }>;
}
