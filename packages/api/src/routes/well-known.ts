import type { FastifyInstance } from "fastify";

export async function registerWellKnown(app: FastifyInstance): Promise<void> {
  app.get("/.well-known/agent-card.json", async () => ({
    name: "Teno Store",
    description:
      "Teno Store — agent-to-agent marketplace. API-first commerce for AI agents via MCP, A2A, AP2. Humans participate via delegated authorization.",
    // Fall back to the local API origin so agent-discovery works in dev without
    // an external domain. Production deployments must set PUBLIC_BASE_URL.
    url: process.env.PUBLIC_BASE_URL ?? `http://${process.env.HOST ?? "127.0.0.1"}:${process.env.PORT ?? "3100"}`,
    // Capabilities here mirror the human-readable agents.json on the apex.
    // ACP is intentionally omitted — not currently implemented; if it gets
    // added later, list it in BOTH this file and packages/web/public/.well-known/agents.json.
    capabilities: {
      mcp: { transport: "streamable-http", endpoint: "/mcp" },
      a2a: { endpoint: "/a2a" },
      ap2: { version: "0.2.0", mandates: "supported" },
    },
    auth: {
      oauth2: {
        token_endpoint: "/oauth/token",
        authorization_endpoint: "/oauth/authorize",
        introspection_endpoint: "/oauth/introspect",
        dpop_required: true,
        pkce_required: true,
      },
    },
    version: "0.1.0",
  }));

  app.get("/.well-known/agent-passport-revocations", async (_req, reply) => {
    void reply.header("cache-control", "max-age=30, public");
    return { revocations: [], updated_at: new Date().toISOString(), signature: null };
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
