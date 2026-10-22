declare module "virtual:dashy-pages" {
  export const pages: Record<string, {
    component: string;
    load(): Promise<{ default: import("solid-js").Component<import("./extension-api").PageProps> }>;
  }>;
}
