import Fastify, { type FastifyInstance } from "fastify";
import { MarketplaceError, ValidationError } from "@marketplace/shared/errors";
import { registerHealth } from "./routes/health.js";
import { registerWellKnown } from "./routes/well-known.js";
import { registerAuth, type AuthDeps } from "./middleware/auth.js";
import { registerAudit } from "./middleware/audit.js";
import { InMemoryIdempotencyStore, registerIdempotency, type IdempotencyStore } from "./middleware/idempotency.js";
import { registerProductRoutes, registerProductWriteRoutes, type ProductReader } from "./routes/products.js";
import { registerSellerRoutes } from "./routes/sellers.js";
import { registerAuthRoutes, type AuthRouteDeps } from "./routes/auth.js";
import { registerCartRoutes } from "./routes/cart.js";
import { registerCheckoutRoutes } from "./routes/checkout.js";
import { registerOrderRoutes } from "./routes/orders.js";
import { registerMeRoutes } from "./routes/me.js";
import { registerSnapshotRoutes } from "./routes/snapshots.js";
import { registerSearchStatsRoutes } from "./routes/search-stats.js";
import { catalog } from "@marketplace/domain";
import type { Repos } from "./repos/index.js";

export interface BuildOptions {
  authDeps: AuthDeps;
  productReader: ProductReader;
  repos: Repos;
  /** Optional override; defaults to an in-memory cache for unit tests. */
  idempotencyStore?: IdempotencyStore;
  /** Optional override; defaults to in-memory store. Production should pass a Redis-backed impl. */
  snapshotStore?: catalog.SnapshotStore;
  /** Required when wiring auth routes — Google login + passport issuance. */
  authRouteDeps?: Omit<AuthRouteDeps, "users">;
}

export async function buildServer(opts: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { name: "api", level: process.env.LOG_LEVEL ?? "info" },
    disableRequestLogging: false,
    requestIdHeader: "x-request-id",
    genReqId: () => crypto.randomUUID(),
    ajv: { customOptions: { strict: false, removeAdditional: "all" } },
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof MarketplaceError) {
      void reply
        .code(err.status)
        .header("content-type", "application/problem+json")
        .send(err.toProblem(req.url));
      return;
    }
    const maybeZod = err as { name?: string; issues?: Array<{ path: Array<string | number>; message: string }> };
    if (maybeZod?.name === "ZodError" && Array.isArray(maybeZod.issues)) {
      const ve = new ValidationError(
        maybeZod.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      );
      void reply
        .code(ve.status)
        .header("content-type", "application/problem+json")
        .send(ve.toProblem(req.url));
      return;
    }
    req.log.error({ err }, "unhandled_error");
    void reply
      .code(500)
      .header("content-type", "application/problem+json")
      .send({
        type: "https://marketplace.dev/errors/internal",
        title: "Internal Server Error",
        status: 500,
        instance: req.url,
      });
  });

  await app.register(import("@fastify/sensible"));
  await app.register(import("@fastify/helmet"), { contentSecurityPolicy: false });
  await app.register(import("@fastify/cors"), { origin: false });

  await registerHealth(app);
  await registerWellKnown(app);
  await registerAuth(app, opts.authDeps);
  await registerAudit(app, { users: opts.repos.users });
  await registerIdempotency(app, {
    store: opts.idempotencyStore ?? new InMemoryIdempotencyStore(),
    exempt: (req) =>
      req.url === "/v1/auth/google" ||
      req.url === "/v1/auth/exchange-link" ||
      /^\/v1\/products\/[^/]+\/media(\/[^/]+)?(\?|$)/.test(req.url),
  });
  const snapshotStore = opts.snapshotStore ?? new catalog.MemorySnapshotStore();
  await registerProductRoutes(app, opts.productReader, snapshotStore, opts.repos.searchLog);
  await registerSellerRoutes(app, opts.repos.sellers);
  await registerProductWriteRoutes(app, { sellers: opts.repos.sellers, products: opts.repos.products });
  await registerCartRoutes(app, opts.repos.carts);
  await registerCheckoutRoutes(app, { carts: opts.repos.carts, orders: opts.repos.orders });
  await registerOrderRoutes(app, opts.repos.orders);
  if (opts.authRouteDeps) {
    await registerAuthRoutes(app, { ...opts.authRouteDeps, users: opts.repos.users });
  }
  await registerMeRoutes(app, { users: opts.repos.users });
  await registerSnapshotRoutes(app, { store: snapshotStore });
  await registerSearchStatsRoutes(app, { searchLog: opts.repos.searchLog });

  return app;
}
