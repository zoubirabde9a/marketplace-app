import { describe, expect, it } from "vitest";
import { InMemoryIdempotencyStore } from "../src/middleware/idempotency.js";

describe("InMemoryIdempotencyStore", () => {
  it("reserves a fresh key", async () => {
    const s = new InMemoryIdempotencyStore();
    expect(await s.reserve("k1", "POST:/v1/orders", "h1", 60)).toBe(true);
    expect(await s.reserve("k1", "POST:/v1/orders", "h1", 60)).toBe(true); // same payload re-ok
    expect(await s.reserve("k1", "POST:/v1/orders", "h2", 60)).toBe(false); // different payload
  });

  it("returns finalized response on replay", async () => {
    const s = new InMemoryIdempotencyStore();
    await s.reserve("k2", "POST:/v1/orders", "h1", 60);
    await s.finalize("k2", "POST:/v1/orders", 201, { id: "o_1" });
    const cached = await s.get("k2", "POST:/v1/orders");
    expect(cached?.status).toBe(201);
    expect(cached?.body).toEqual({ id: "o_1" });
  });

  it("scopes by method+path", async () => {
    const s = new InMemoryIdempotencyStore();
    await s.reserve("kx", "POST:/v1/a", "h", 60);
    expect(await s.get("kx", "POST:/v1/b")).toBeNull();
  });
});
