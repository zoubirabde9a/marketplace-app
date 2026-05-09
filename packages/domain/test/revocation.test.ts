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
});
