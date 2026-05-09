import type { FastifyInstance } from "fastify";

export async function registerHealth(app: FastifyInstance): Promise<void> {
  app.get("/livez", async () => ({ status: "ok" }));

  app.get("/readyz", async () => {
    // TODO: ping db, redis, downstream gateways once wired
    return { status: "ready", checks: { db: "skipped", redis: "skipped" } };
  });
}
