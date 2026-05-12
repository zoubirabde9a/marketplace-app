import { describe, expect, it } from "vitest";
import { syntheticAgentId, SELLER_COOKIE } from "./sellerSession";

describe("syntheticAgentId", () => {
  it("formats a session-derived agent id as `user:<userId>`", () => {
    // This is a wire-format contract: the API derives the same identifier
    // server-side from session-authenticated requests, so any drift here
    // silently breaks ownership checks on seller-scoped routes.
    expect(syntheticAgentId("01999999-9999-7999-9999-000000000001")).toBe(
      "user:01999999-9999-7999-9999-000000000001",
    );
  });

  it("passes the userId through verbatim (no normalization)", () => {
    expect(syntheticAgentId("abc")).toBe("user:abc");
    expect(syntheticAgentId("with spaces")).toBe("user:with spaces");
  });
});

describe("SELLER_COOKIE", () => {
  it("is the unified buyer + seller + agent-link session cookie name", () => {
    // The cookie name is shared with the API: don't rename without updating
    // packages/api/src/middleware/auth.ts session-cookie expectation.
    expect(SELLER_COOKIE).toBe("mp_session");
  });
});
