import { defineApiRoutes, DashyError } from "dashy";

export default defineApiRoutes({
  markets: {
    method: "GET", path: "/markets", params: ["period", "category", "channel"],
    async handler({ data, params }) { return Response.json(await data.dataset("countries", params)); },
  },
  marketOrders: {
    method: "GET", path: "/markets/:country/orders", params: ["period", "category", "channel"],
    async handler({ data, params, pathParams }) {
      return Response.json(await data.dataset("orders", { ...params, country: pathParams.country }));
    },
  },
  calculateMargin: {
    method: "POST", path: "/calculate-margin", params: [], maxBodyBytes: 4096,
    async handler({ readJson }) {
      const body = await readJson();
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new DashyError("Expected revenue and cost", 422);
      const { revenue, cost } = body as Record<string, unknown>;
      if (Object.keys(body).some(key => key !== "revenue" && key !== "cost")
        || typeof revenue !== "number" || !Number.isFinite(revenue) || revenue < 0
        || typeof cost !== "number" || !Number.isFinite(cost) || cost < 0)
        throw new DashyError("Revenue and cost must be finite, non-negative numbers", 422);
      // A stateless calculation: the sample never changes its source data.
      const margin = revenue ? (revenue - cost) / revenue : null;
      if (margin !== null && !Number.isFinite(margin)) throw new DashyError("Values are outside the supported range", 422);
      return Response.json({ profit: revenue - cost, margin });
    },
  },
});
