// Verifies the /.well-known/agent-card.json fallback closes the Host-header
// poisoning vector: when PUBLIC_BASE_URL is unset, the doc must build URLs
// from the trust-proxy hostname (which respects X-Forwarded-Host policy),
// not the raw Host header. Otherwise any caller could send `Host: evil.com`
// and the doc would return `capabilities.mcp.endpoint = "https://evil.com/mcp"`
// — steering AI agents that follow discovery to an attacker-controlled origin.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { registerWellKnown } from "../src/routes/well-known.js";

async function buildApp() {
  const app = Fastify({ trustProxy: true, logger: false });
  await registerWellKnown(app);
  return app;
}

describe("/.well-known/agent-card.json — host-header safety", () => {
  let prevEnv: string | undefined;
  beforeEach(() => {
    prevEnv = process.env.PUBLIC_BASE_URL;
    delete process.env.PUBLIC_BASE_URL;
  });
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = prevEnv;
  });

  it("uses x-forwarded-host (trusted) when present, not raw Host", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/.well-known/agent-card.json",
      headers: {
        host: "evil.example.com:80",
        "x-forwarded-host": "api.teno-store.com",
        "x-forwarded-proto": "https",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.url).toBe("https://api.teno-store.com");
    expect(body.capabilities.mcp.endpoint).toBe("https://api.teno-store.com/mcp");
    expect(body.auth.oauth2.token_endpoint).toBe("https://api.teno-store.com/oauth/token");
  });

  it("PUBLIC_BASE_URL wins over any request header", async () => {
    process.env.PUBLIC_BASE_URL = "https://api.teno-store.com/";
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/.well-known/agent-card.json",
      headers: { host: "evil.example.com", "x-forwarded-host": "also.evil.com" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.url).toBe("https://api.teno-store.com");
    expect(body.capabilities.mcp.endpoint).toBe("https://api.teno-store.com/mcp");
  });
});
