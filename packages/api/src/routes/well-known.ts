import type { FastifyInstance } from "fastify";

export async function registerWellKnown(app: FastifyInstance): Promise<void> {
  app.get("/.well-known/agent-card.json", async (req, reply) => {
    // 5-min edge cache + 24-hour SWR. Agent-card content changes only at
    // deploy time (capabilities + endpoint URLs); without this every
    // MCP/A2A SDK first-connect probe re-fetched from origin. Matches
    // the apex .well-known/agents.json cache policy.
    void reply.header(
      "cache-control",
      "public, max-age=300, s-maxage=300, stale-while-revalidate=86400",
    );
    // Derive the absolute base URL from the incoming request. Previously
    // this fell back to `http://${HOST}:${PORT}` when PUBLIC_BASE_URL was
    // unset, which leaked the docker-internal bind address
    // 'http://0.0.0.0:3100' in production responses — every AI agent
    // reading the discovery doc would try to connect to an unreachable
    // URL. trustProxy=true (server.ts) makes req.protocol / req.hostname
    // reflect the public origin from X-Forwarded-* headers.
    const envBase = process.env.PUBLIC_BASE_URL;
    // Use `req.hostname` (not `req.headers.host`). With trustProxy=true,
    // `req.hostname` resolves through X-Forwarded-Host, while the raw Host
    // header is attacker-controlled — feeding it into the agent-card would
    // let any caller poison the discovery doc and steer AI agents that
    // follow capabilities.mcp.endpoint / auth.oauth2.token_endpoint to an
    // attacker-controlled origin. The fallback is only reachable when
    // PUBLIC_BASE_URL is unset (dev / misconfig), but the bound still has
    // to be safe.
    const base = envBase
      ? envBase.replace(/\/$/, "")
      : `${req.protocol}://${req.hostname}`;
    return {
      name: "Teno Store",
      description:
        "Teno Store — agent-to-agent marketplace. API-first commerce for AI agents via MCP, A2A, AP2. Humans participate via delegated authorization.",
      url: base,
      // Pointer to the human-readable apex (catalog, discovery surfaces,
      // policies). AI agents that connect to the API first via this
      // agent-card can follow homepage to find /sitemap.xml, /feed.xml,
      // /llms.txt, /.well-known/agents.json (the richer apex discovery
      // doc with catalog + policies blocks).
      homepage: process.env.MARKETPLACE_WEB_BASE_URL?.replace(/\/$/, "") ?? "https://teno-store.com",
      // Capabilities here mirror the human-readable agents.json on the apex.
      // ACP is intentionally omitted — not currently implemented; if it gets
      // added later, list it in BOTH this file and packages/web/public/.well-known/agents.json.
      // Absolute URLs everywhere so agents don't need to URL-join against base.
      capabilities: {
        mcp: { transport: "streamable-http", endpoint: `${base}/mcp` },
        a2a: { endpoint: `${base}/a2a` },
        // REST surface — was missing from this agent-card while the apex
        // agents.json declared it. AI agents reading agent-card.json (the
        // canonical machine-readable discovery doc) couldn't discover REST
        // without cross-referencing the apex JSON.
        rest: {
          base: `${base}/v1`,
          public_endpoints: ["GET /v1/products", "GET /v1/products/{id}"],
        },
        ap2: { version: "0.2.0", mandates: "supported" },
      },
      auth: {
        oauth2: {
          token_endpoint: `${base}/oauth/token`,
          authorization_endpoint: `${base}/oauth/authorize`,
          introspection_endpoint: `${base}/oauth/introspect`,
          dpop_required: true,
          pkce_required: true,
        },
      },
      version: "0.1.0",
    };
  });

  app.get("/.well-known/agent-passport-revocations", async (_req, reply) => {
    void reply.header("cache-control", "max-age=30, public");
    return { revocations: [], updated_at: new Date().toISOString(), signature: null };
  });

  // /favicon.ico — browsers always probe favicon when a user pastes an
  // API URL into the address bar (e.g. for debugging a JSON response).
  // Without this the auth middleware returns 401, which fills production
  // logs with noise + makes the address-bar tab icon flicker as the
  // browser keeps retrying. 204 No Content is the standard "no favicon
  // here" response — browsers cache the empty response and stop asking.
  // 7-day cache: favicon policy doesn't change.
  app.get("/favicon.ico", async (_req, reply) => {
    void reply
      .code(204)
      .header("cache-control", "public, max-age=604800, immutable")
      .header("content-length", "0");
    return reply.send();
  });

  // /robots.txt — without this the auth middleware caught the request and
  // returned 401 Unauthorized, which is confusing to crawlers (they expect
  // an unauthed robots policy before doing anything else on a host). The
  // api host serves no human-readable content: every URL is either an
  // authenticated agent endpoint, an OAuth/MCP/A2A protocol surface, or a
  // public well-known discovery file referenced from teno-store.com's
  // agents.json. Tell web crawlers to skip the host entirely; AI/MCP
  // agents discover endpoints via /.well-known/agent-card.json regardless.
  app.get("/robots.txt", async (_req, reply) => {
    void reply
      .header("content-type", "text/plain; charset=utf-8")
      .header("cache-control", "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400");
    return [
      "# Teno Store API host — programmatic surface only.",
      "# Catalog browsing for crawlers and humans lives at https://teno-store.com",
      "User-Agent: *",
      "Disallow: /",
      "",
      "# Sitemap, llms.txt, agents.json all live on the apex.",
      "Sitemap: https://teno-store.com/sitemap.xml",
      "",
    ].join("\n");
  });
}
