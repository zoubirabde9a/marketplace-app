// Stale-while-revalidate behavior on the browse-path cache. The cache lives
// inside makeProductReader and isn't exported directly, so we test it through
// the public search() interface, counting loadAll invocations across time
// windows.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeProductReader } from "../src/routes/products.js";
import type { StoredProduct, StoredSeller } from "../src/types/store-types.js";

function blankCatalog(): { products: StoredProduct[]; sellers: Map<string, StoredSeller> } {
  return { products: [], sellers: new Map() };
}

describe("browse-path SWR cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T00:00:00Z"));
  });

  it("serves the cached value without re-loading during the fresh window (<300s)", async () => {
    const loadAll = vi.fn(async () => blankCatalog());
    const reader = makeProductReader({
      loadAll,
      loadOne: vi.fn(),
      getProductsByIds: vi.fn(),
    });
    await reader.search({ query: "", filters: { includeOutOfStock: false } });
    expect(loadAll).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000); // 1min in
    await reader.search({ query: "", filters: { includeOutOfStock: false } });
    await reader.search({ query: "", filters: { includeOutOfStock: false } });
    expect(loadAll).toHaveBeenCalledTimes(1);
  });

  it("serves stale value AND kicks off a background refresh in the stale window (300s–25min)", async () => {
    const loadAll = vi.fn(async () => blankCatalog());
    const reader = makeProductReader({
      loadAll,
      loadOne: vi.fn(),
      getProductsByIds: vi.fn(),
    });
    await reader.search({ query: "", filters: { includeOutOfStock: false } });
    expect(loadAll).toHaveBeenCalledTimes(1);

    // Jump past the fresh window into the stale window.
    vi.advanceTimersByTime(400_000); // 6m40s

    const t0 = performance.now();
    await reader.search({ query: "", filters: { includeOutOfStock: false } });
    const elapsed = performance.now() - t0;
    // Stale value returned immediately — should NOT have awaited a fresh load.
    expect(elapsed).toBeLessThan(50);
    // But a background refresh was scheduled (called twice now: initial + bg).
    expect(loadAll).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent stale-window refreshes onto a single in-flight loadAll", async () => {
    let resolveLoad: ((v: ReturnType<typeof blankCatalog>) => void) | null = null;
    const loadAll = vi.fn(() => new Promise<ReturnType<typeof blankCatalog>>((res) => { resolveLoad = res; }));
    const reader = makeProductReader({
      loadAll,
      loadOne: vi.fn(),
      getProductsByIds: vi.fn(),
    });

    // Prime the cache.
    const p0 = reader.search({ query: "", filters: { includeOutOfStock: false } });
    resolveLoad!(blankCatalog());
    await p0;
    expect(loadAll).toHaveBeenCalledTimes(1);

    // Move into the stale window and fire two concurrent searches.
    vi.advanceTimersByTime(400_000);
    const [a, b] = await Promise.all([
      reader.search({ query: "", filters: { includeOutOfStock: false } }),
      reader.search({ query: "", filters: { includeOutOfStock: false } }),
    ]);
    // Both got results without waiting; only one extra loadAll fired.
    expect(a.hits).toEqual([]);
    expect(b.hits).toEqual([]);
    expect(loadAll).toHaveBeenCalledTimes(2);
  });

  it("does NOT hammer loadAll after a failed background refresh (cooldown)", async () => {
    // Prime the cache with a successful load, then in the stale window
    // simulate a sustained DB outage by failing every subsequent loadAll.
    // The first stale request should attempt one refresh; further stale
    // requests inside the 30s cooldown must NOT trigger more attempts.
    let calls = 0;
    const loadAll = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return blankCatalog();
      throw new Error("db_down");
    });
    const reader = makeProductReader({
      loadAll,
      loadOne: vi.fn(),
      getProductsByIds: vi.fn(),
    });
    await reader.search({ query: "", filters: { includeOutOfStock: false } });
    expect(loadAll).toHaveBeenCalledTimes(1);

    // Cross into the stale window.
    vi.advanceTimersByTime(400_000);
    // First stale request → kicks off a background refresh that will fail.
    await reader.search({ query: "", filters: { includeOutOfStock: false } });
    // Let the in-flight refresh settle + the .catch run.
    await vi.runOnlyPendingTimersAsync();
    expect(loadAll).toHaveBeenCalledTimes(2);

    // Three more requests inside the 30s cooldown — none should trigger
    // another refresh. Previously each request fired one loadAll.
    vi.advanceTimersByTime(5_000);
    await reader.search({ query: "", filters: { includeOutOfStock: false } });
    vi.advanceTimersByTime(5_000);
    await reader.search({ query: "", filters: { includeOutOfStock: false } });
    vi.advanceTimersByTime(5_000);
    await reader.search({ query: "", filters: { includeOutOfStock: false } });
    expect(loadAll).toHaveBeenCalledTimes(2); // still 2, cooldown held
  });

  it("waits synchronously on the very first call (cold cache)", async () => {
    let resolveLoad: ((v: ReturnType<typeof blankCatalog>) => void) | null = null;
    const loadAll = vi.fn(() => new Promise<ReturnType<typeof blankCatalog>>((res) => { resolveLoad = res; }));
    const reader = makeProductReader({
      loadAll,
      loadOne: vi.fn(),
      getProductsByIds: vi.fn(),
    });

    const p = reader.search({ query: "", filters: { includeOutOfStock: false } });
    // The promise must not resolve until loadAll resolves.
    let resolved = false;
    p.then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false);
    resolveLoad!(blankCatalog());
    await p;
    expect(resolved).toBe(true);
  });
});
