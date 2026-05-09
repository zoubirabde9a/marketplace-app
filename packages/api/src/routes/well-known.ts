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
}
