import type { PageDefinition } from "dashy/types";

export default {
  customer: {
    label: "Customer 360", description: "A custom page sharing Dashy's theme and data APIs.",
    icon: "users", group: "Customers", params: ["customer"], component: "pages/customer.tsx",
  },
} satisfies Record<string, PageDefinition>;
