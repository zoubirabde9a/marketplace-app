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
import {
  McpRegistry,
  registerMcpTransport,
  registerSellerWriteTools,
  registerBuyerTools,
  newRequestId,
  type McpContext,
} from "@marketplace/mcp-server";

// Pure classifier for the global error handler. Extracted from setErrorHandler
// so unit tests can exercise the branches without booting Fastify.
//   - `marketplace` → MarketplaceError instances expose their own status+problem
//   - `zod` → Zod validation errors become 400 ValidationError
//   - `fastify` → Fastify-native errors (e.g. FST_ERR_CTP_INVALID_CONTENT_LENGTH)
//                 carry their own 4xx statusCode; we preserve it instead of
//                 collapsing every malformed-body case into a 500 outage signal
//   - `internal` → everything else; logged + 500 problem+json
export type ErrorClassification =
  | { kind: "marketplace" | "zod" | "fastify" | "internal"; status: number; body: Record<string, unknown> };

export function classifyError(err: unknown, instance: string): ErrorClassification {
  if (err instanceof MarketplaceError) {
    return { kind: "marketplace", status: err.status, body: err.toProblem(instance) as Record<string, unknown> };
  }
  const maybeZod = err as { name?: string; issues?: Array<{ path: Array<string | number>; message: string }> };
  if (maybeZod?.name === "ZodError" && Array.isArray(maybeZod.issues)) {
    const ve = new ValidationError(
      maybeZod.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
    return { kind: "zod", status: ve.status, body: ve.toProblem(instance) as Record<string, unknown> };
  }
  const fastifyStatus = (err as { statusCode?: number }).statusCode;
  if (typeof fastifyStatus === "number" && fastifyStatus >= 400 && fastifyStatus < 500) {
    return {
      kind: "fastify",
      status: fastifyStatus,
      body: {
        type: `https://marketplace.dev/errors/${(err as { code?: string }).code ?? "bad-request"}`,
        title: (err as { message?: string }).message || "Bad Request",
        status: fastifyStatus,
        instance,
      },
    };
  }
  return {
    kind: "internal",
    status: 500,
    body: {
      type: "https://marketplace.dev/errors/internal",
      title: "Internal Server Error",
      status: 500,
      instance,
    },
  };
}

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
    // Honour X-Forwarded-* headers from the reverse proxy (Caddy on vps-eu).
    // Without this, req.protocol reflects the docker-internal http hop from
    // Caddy → API and resolveBaseUrl() in routes/products.ts builds viewUrl
    // values as 'http://api.teno-store.com/...' — every JSON consumer
    // (agents reading /v1/products, AI crawlers parsing the response) gets
    // an http URL on what is published as an https endpoint, causing an
    // unnecessary redirect hop and some strict clients to drop the URL
    // entirely. The API container is only reachable through Caddy on the
    // docker internal network (no direct internet ingress) so trusting all
    // proxy headers is safe here.
    trustProxy: true,
  });

  app.setErrorHandler((err, req, reply) => {
    const c = classifyError(err, req.url);
    if (c.kind === "internal") {
      req.log.error({ err }, "unhandled_error");
    }
    void reply.code(c.status).header("content-type", "application/problem+json").send(c.body);
  });

  await app.register(import("@fastify/sensible"));
  await app.register(import("@fastify/helmet"), { contentSecurityPolicy: false });
  await app.register(import("@fastify/cors"), {
    origin: false,
    // Custom response headers cross-origin browser JS needs to READ.
    // Without Access-Control-Expose-Headers, the browser hides these
    // from the fetch response object even when they're on the wire.
    // - x-mp-cart-id: cart route returns the resolved cart id on every
    //   call; web client tracks it for session-cart continuity. Without
    //   exposing it, cross-origin clients (teno-store.com → api.) get
    //   null on r.headers.get('x-mp-cart-id') even when present.
    // - x-request-id: useful for client-side error correlation.
    exposedHeaders: ["x-mp-cart-id", "x-request-id"],
  });

  await registerHealth(app);
  await registerWellKnown(app);
  await registerAuth(app, opts.authDeps);
  await registerAudit(app, { users: opts.repos.users });
  await registerIdempotency(app, {
    store: opts.idempotencyStore ?? new InMemoryIdempotencyStore(),
    exempt: (req) =>
      req.url === "/v1/auth/google" ||
      req.url === "/v1/auth/exchange-link" ||
      req.url === "/mcp" ||
      req.url === "/register" ||
      req.url === "/oauth/register" ||
      /^\/v1\/products\/[^/]+\/media(\/[^/]+)?(\?|$)/.test(req.url),
  });
  const snapshotStore = opts.snapshotStore ?? new catalog.MemorySnapshotStore();
  await registerProductRoutes(app, opts.productReader, snapshotStore, opts.repos.searchLog);
  await registerSellerRoutes(app, opts.repos.sellers);
  await registerProductWriteRoutes(app, { sellers: opts.repos.sellers, products: opts.repos.products });
  await registerCartRoutes(app, opts.repos.carts);
  await registerCheckoutRoutes(app, { carts: opts.repos.carts, orders: opts.repos.orders });
  await registerOrderRoutes(app, opts.repos.orders, opts.repos.sellers, opts.repos.carts);
  if (opts.authRouteDeps) {
    await registerAuthRoutes(app, { ...opts.authRouteDeps, users: opts.repos.users });
  }
  await registerMeRoutes(app, { users: opts.repos.users });
  await registerSnapshotRoutes(app, { store: snapshotStore });
  await registerSearchStatsRoutes(app, { searchLog: opts.repos.searchLog });

  // OAuth Dynamic Client Registration stub. We don't support RFC 7591 DCR but
  // the MCP TS SDK probes /register on first connect; without a parseable
  // response it crashes with a ZodError. Return an RFC 6749-shaped error so
  // the SDK gives up cleanly and uses the unauthenticated transport.
  const dcrStub = async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    return reply.code(400).send({
      error: "registration_not_supported",
      error_description: "Dynamic client registration is not supported; connect to /mcp without OAuth.",
    });
  };
  app.post("/register", dcrStub);
  app.post("/oauth/register", dcrStub);

  // OAuth 2.1 endpoint stubs. Both apex agents.json and api agent-card.json
  // declare these endpoint URLs as part of the documented auth posture, but
  // they returned bare 404 in production — AI agents following the discovery
  // doc and attempting the documented OAuth flow saw 'Not Found' and had no
  // signal that the endpoints exist-but-aren't-implemented vs the URL being
  // wrong. RFC 6749 §5.2 error responses make the failure mode explicit:
  // agents see a structured 'unsupported_grant_type' (or analogous) and
  // know to fall back to the Agent Passport / DPoP path that Teno actually
  // supports today.
  // Same pattern as the DCR stub above; both /POST and /GET on the auth
  // endpoint because some OAuth clients probe with GET first.
  const oauthNotImplemented = async (
    _req: unknown,
    reply: { code: (n: number) => unknown; header: (k: string, v: string) => unknown; send: (b: unknown) => unknown },
  ) => {
    reply.code(501);
    reply.header("content-type", "application/json");
    return reply.send({
      error: "unsupported_grant_type",
      error_description:
        "OAuth 2.1 token/authorize/introspection endpoints are not implemented on this host. Use the Agent Passport flow described in /.well-known/agent-card.json instead.",
    });
  };
  app.post("/oauth/token", oauthNotImplemented);
  app.post("/oauth/introspect", oauthNotImplemented);
  // Authorization endpoint is GET per RFC 6749 §3.1; agents that follow
  // the spec arrive here via redirect, not POST.
  app.get("/oauth/authorize", oauthNotImplemented);
  app.post("/oauth/authorize", oauthNotImplemented);

  // MCP streamable-HTTP transport. The registry holds tool defs; buildContext
  // resolves the calling agent from auth middleware's req.principal (synthesised
  // for DEV_BYPASS on /mcp — see middleware/auth.ts).
  const mcpRegistry = new McpRegistry();
  registerSellerWriteTools(
    mcpRegistry,
    {
      sellers: {
        create: (input) => opts.repos.sellers.create(input),
        get: async (id) => {
          const s = await opts.repos.sellers.get(id);
          return s ? { sellerId: s.sellerId, ownerAgentId: s.ownerAgentId } : undefined;
        },
      },
      products: {
        create: async (input) => {
          const p = await opts.repos.products.create(input);
          return {
            productId: p.productId,
            sellerId: p.sellerId,
            titleSanitized: p.titleSanitized,
            ...(p.brand !== undefined ? { brand: p.brand } : {}),
            variants: p.variants.map((v) => ({
              id: v.id,
              sku: v.sku,
              priceMinor: v.priceMinor,
              currency: v.currency,
              inStock: v.inStock,
            })),
            media: p.media.map((m) => ({ id: m.id, url: m.url })),
            ...(p.heroMediaId !== undefined ? { heroMediaId: p.heroMediaId } : {}),
            createdAt: p.createdAt,
          };
        },
      },
    },
    snapshotStore,
  );
  // Buyer-side tools: cart.*, checkout.confirm, order.get, seller.list_orders.
  // Mirrors the HTTP routes the web UI uses so agents can place COD orders
  // end-to-end via /mcp. Repos go through the same Drizzle code path; no
  // domain logic forks between MCP and REST.
  registerBuyerTools(mcpRegistry, {
    carts: {
      getOrCreate: (input) => opts.repos.carts.getOrCreate(input),
      get: (id) => opts.repos.carts.get(id),
      setLines: (id, lines) => opts.repos.carts.setLines(id, lines),
      setCurrency: (id, c) => opts.repos.carts.setCurrency(id, c),
      resolveLine: (vid, qty) => opts.repos.carts.resolveLine(vid, qty),
      enrichLines: (ids) => opts.repos.carts.enrichLines(ids),
    },
    orders: {
      create: (input) => opts.repos.orders.create(input),
      get: (id) => opts.repos.orders.get(id),
      listForSeller: (id) => opts.repos.orders.listForSeller(id),
    },
    sellers: {
      get: async (id) => {
        const s = await opts.repos.sellers.get(id);
        return s ? { sellerId: s.sellerId, ownerAgentId: s.ownerAgentId } : undefined;
      },
    },
  });
  await registerMcpTransport(app, {
    registry: mcpRegistry,
    buildContext: async (req): Promise<McpContext> => {
      const principal = req.principal;
      if (!principal) {
        // No auth + no DEV_BYPASS. Tool calls will fail scope checks; tools/list
        // and initialize still work so MCP clients can discover the surface.
        return {
          agentId: "anonymous",
          passportId: "psp_anonymous",
          scopes: new Set(),
          ownerKind: "user",
          ownerId: "anonymous",
          requestId: newRequestId(),
          now: () => Date.now(),
          emitAudit: async () => undefined,
        };
      }
      return {
        agentId: principal.agentId,
        passportId: principal.passportId,
        scopes: principal.scopes,
        ownerKind: principal.ownerKind,
        ownerId: principal.ownerId,
        ...(principal.mandateId !== undefined ? { mandateId: principal.mandateId } : {}),
        requestId: newRequestId(),
        now: () => Date.now(),
        emitAudit: async () => undefined,
      };
    },
  });

  return app;
}
