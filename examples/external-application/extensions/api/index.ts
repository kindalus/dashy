import { defineApiRoutes } from "dashy";

export default defineApiRoutes({
  customerOrders: {
    method: "GET",
    path: "/customers/:id/orders",
    params: [],
    async handler({ data, pathParams }) {
      // Dataset validation checks the ID; its roles and query roles still apply.
      return Response.json(await data.dataset("customer_orders", { customer: pathParams.id }));
    },
  },
});
