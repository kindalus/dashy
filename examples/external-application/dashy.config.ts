import { defineConfig } from "dashy";

export default defineConfig({
  name: "Customer workspace",
  description: "Dashboards and custom pages in an independent implementation",
  theme: { name: "excel", corners: "rounded-sm" },
  locale: "pt",
  dataDir: "./data",
});
