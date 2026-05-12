import { describe, expect, it } from "vitest";
import { classifyError } from "../src/server.js";
import { NotFoundError, ValidationError } from "@marketplace/shared/errors";

describe("classifyError", () => {
  it("forwards a MarketplaceError's own status and problem body", () => {
    const c = classifyError(new NotFoundError("seller", "abc"), "/v1/sellers/abc");
    expect(c.kind).toBe("marketplace");
    expect(c.status).toBe(404);
    expect(c.body).toMatchObject({ status: 404, instance: "/v1/sellers/abc" });
  });

  it("converts ZodError-like shapes into a 400 ValidationError problem", () => {
    const zodLike = { name: "ZodError", issues: [{ path: ["body", "name"], message: "Required" }] };
    const c = classifyError(zodLike, "/v1/checkout/confirm");
    expect(c.kind).toBe("zod");
    expect(c.status).toBe(400);
  });

  it("preserves Fastify-native 4xx statusCode (e.g. malformed body)", () => {
    // Mirrors a FastifyError shape: { statusCode: 400, code: '...', message: '...' }
    const fastifyErr = {
      statusCode: 400,
      code: "FST_ERR_CTP_INVALID_CONTENT_LENGTH",
      message: "Request body size did not match Content-Length",
    };
    const c = classifyError(fastifyErr, "/v1/checkout/confirm");
    expect(c.kind).toBe("fastify");
    expect(c.status).toBe(400);
    expect(c.body.type).toBe("https://marketplace.dev/errors/FST_ERR_CTP_INVALID_CONTENT_LENGTH");
    expect(c.body.title).toContain("Content-Length");
  });

  it("does NOT pass through 5xx statusCode through the 4xx branch", () => {
    const fastifyErr = { statusCode: 503, code: "FST_X", message: "down" };
    const c = classifyError(fastifyErr, "/v1/anything");
    expect(c.kind).toBe("internal");
    expect(c.status).toBe(500);
  });

  it("falls through to 500 internal for unknown errors", () => {
    const c = classifyError(new Error("oops"), "/v1/anything");
    expect(c.kind).toBe("internal");
    expect(c.status).toBe(500);
    expect(c.body.title).toBe("Internal Server Error");
  });

  it("uses 'bad-request' type when Fastify error has no `code`", () => {
    const fastifyErr = { statusCode: 413, message: "Payload too large" };
    const c = classifyError(fastifyErr, "/v1/up");
    expect(c.kind).toBe("fastify");
    expect(c.status).toBe(413);
    expect(c.body.type).toBe("https://marketplace.dev/errors/bad-request");
  });

  it("regression: an exception with a numeric `statusCode` of 401 stays 401, not 500", () => {
    const c = classifyError({ statusCode: 401, code: "FST_AUTH", message: "no" }, "/x");
    expect(c.kind).toBe("fastify");
    expect(c.status).toBe(401);
  });
});

// Sanity that the existing happy paths haven't drifted.
describe("classifyError — adjacency", () => {
  it("ValidationError instance (not raw Zod) goes through marketplace branch", () => {
    const ve = new ValidationError([{ path: "cart", message: "empty" }]);
    const c = classifyError(ve, "/v1/checkout/confirm");
    expect(c.kind).toBe("marketplace");
    expect(c.status).toBe(400);
  });
});
