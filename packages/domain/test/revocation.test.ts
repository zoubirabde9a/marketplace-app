import { describe, expect, it } from "vitest";
import { RevocationCache, RevocationService, type RevocationStore } from "../src/identity/revocation.js";

class FakeStore implements RevocationStore {
  readonly map = new Map<string, { reason: string; revokedAtMs: number }>();
  private subs: Array<(e: { passportId: string; revokedAtMs: number; reason?: string }) => void> = [];

  async list(sinceMs: number) {
    return [...this.map.entries()]
      .filter(([, v]) => v.revokedAtMs >= sinceMs)
      .map(([passportId, v]) => ({ passportId, revokedAtMs: v.revokedAtMs, reason: v.reason }));
  }
  async isRevoked(id: string) {
    return this.map.has(id);
  }
  async revoke(id: string, reason: string, now: number) {
    this.map.set(id, { reason, revokedAtMs: now });
    for (const fn of this.subs) fn({ passportId: id, revokedAtMs: now, reason });
  }
  subscribe(handler: (e: { passportId: string; revokedAtMs: number }) => void) {
    this.subs.push(handler);
    return () => {
      this.subs = this.subs.filter((s) => s !== handler);
    };
  }
}

describe("RevocationCache", () => {
  it("evicts oldest when over capacity", () => {
    const c = new RevocationCache(2);
    c.add("a", 1);
    c.add("b", 2);
    c.add("c", 3);
    expect(c.has("a")).toBe(false);
    expect(c.has("b")).toBe(true);
    expect(c.has("c")).toBe(true);
  });

  it("readd refreshes recency", () => {
    const c = new RevocationCache(2);
    c.add("a", 1);
    c.add("b", 2);
    c.add("a", 3); // a moved to MRU
    c.add("c", 4); // evicts b
    expect(c.has("a")).toBe(true);
    expect(c.has("b")).toBe(false);
  });
});

describe("RevocationService", () => {
  it("warms cache from store on start and applies push updates", async () => {
    const store = new FakeStore();
    await store.revoke("p1", "test", 1);
    const svc = new RevocationService(store);
    await svc.start();
    expect(await svc.isRevoked("p1")).toBe(true);
    await svc.revoke("p2", "test", 2);
    expect(await svc.isRevoked("p2")).toBe(true);
    await svc.stop();
  });

  it("captures pushes that fire during the initial list() (no race window)", async () => {
    // Store whose list() takes a tick, simulating a Postgres round trip.
    // A revoke() called during that tick must end up in the cache after
    // start() resolves — previously the subscribe was installed AFTER
    // list() returned, so the in-flight push was dropped.
    class RacyStore extends FakeStore {
      override async list(sinceMs: number) {
        // Yield to the microtask queue so the test can call revoke() in
        // between subscribe() and list()-resolution.
        await Promise.resolve();
        return super.list(sinceMs);
      }
    }
    const store = new RacyStore();
    const svc = new RevocationService(store);
    const starting = svc.start();
    // Fire a revocation while start() is mid-flight.
    await store.revoke("p_racy", "test", 42);
    await starting;
    expect(await svc.isRevoked("p_racy")).toBe(true);
    await svc.stop();
  });

  it("promotes a store-side revocation to cache on the first miss", async () => {
    const store = new FakeStore();
    const svc = new RevocationService(store);
    await svc.start();
    // Insert directly via store, bypassing svc.revoke (simulates a slow
    // LISTEN/NOTIFY propagation: the authoritative store sees it before
    // the service's subscriber does).
    await store.revoke("p_slow_push", "test", 7);
    // Drop subscription so the push notification doesn't pre-populate
    // the cache (we want to test the cache-miss → store → promotion path).
    await svc.stop();
    // Fresh service that has only the snapshot from the racy moment.
    const svc2 = new RevocationService(store);
    // Avoid full start() (which would warm cache with p_slow_push); test
    // the isRevoked promotion path directly.
    expect(await svc2.isRevoked("p_slow_push")).toBe(true);
    // Second lookup hits the cache, not the store.
    let storeCalls = 0;
    const originalIsRevoked = store.isRevoked.bind(store);
    store.isRevoked = async (id: string) => {
      storeCalls += 1;
      return originalIsRevoked(id);
    };
    expect(await svc2.isRevoked("p_slow_push")).toBe(true);
    expect(storeCalls).toBe(0);
  });
});
