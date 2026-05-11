import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateMetadata } from "./page";
import { __resetSearchCacheForTests } from "@/lib/searchCache";

// Stub the slice-metadata fetch to return a positive count so the
// generateMetadata robots logic doesn't trip the new "noindex on zero
// hits" rule (added to keep empty /search?q=garbage URLs out of Google's
// index — see search/page.tsx). Tests here are about the canonical /
// robots logic, not the count plumbing, so a successful response with
// 1 hit is the right fixture.
beforeEach(() => {
  __resetSearchCacheForTests();
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(
      JSON.stringify({
        data: [{ productId: "p1", title: { value: "x", role: "untrusted_content", origin: "x" }, sellerDisplayName: "Acme Sellers Ltd" }],
        pagination: { totalEstimate: 42 },
        facets: { sellers: [{ value: "abc", displayName: "Acme Sellers Ltd", count: 42 }] },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  ));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const M = (sp: Record<string, string | string[] | undefined>) =>
  generateMetadata({ searchParams: Promise.resolve(sp) });

describe("search page generateMetadata", () => {
  it("bare /search → indexable, canonical /search, generic title", async () => {
    const m = await M({});
    expect(m.alternates?.canonical).toBe("/search");
    expect(m.robots).toEqual({ index: true, follow: true });
    expect(m.title).toBe("Browse the marketplace");
  });

  it("?q=phone → noindex,follow (free-text search results not indexable)", async () => {
    // Open-ended internal search results are noindex-by-default: spam-link
    // injection risk + duplicate of curated brand/category landings.
    // Canonical still points at the q URL so internal links don't fragment.
    const m = await M({ q: "phone" });
    expect(m.alternates?.canonical).toBe("/search?q=phone");
    expect(m.robots).toEqual({ index: false, follow: true });
    expect(m.title).toBe("Search: phone");
  });

  it("?brand=Acme alone → indexable as a brand page", async () => {
    const m = await M({ brand: "Acme" });
    expect(m.alternates?.canonical).toBe("/search?brand=Acme");
    expect(m.robots).toEqual({ index: true, follow: true });
    // Brand title is bare "{brand}" — the layout appends " · Teno Store"
    // so adding "products" would double-up brand context. Description
    // carries the brand-pitch wording in French.
    expect(m.title).toBe("Acme");
  });

  it("?brand=Acme&minRating=4 → multi-filter, noindex,follow, canonical /search", async () => {
    const m = await M({ brand: "Acme", minRating: "4" });
    expect(m.alternates?.canonical).toBe("/search");
    expect(m.robots).toEqual({ index: false, follow: true });
  });

  it("?cursor=XYZ → noindex,follow (transient pagination slice)", async () => {
    const m = await M({ cursor: "XYZ" });
    expect(m.alternates?.canonical).toBe("/search");
    expect(m.robots).toEqual({ index: false, follow: true });
  });

  it("?sellerId=abc alone → indexable single-seller landing", async () => {
    const m = await M({ sellerId: "abc" });
    expect(m.alternates?.canonical).toBe("/search?sellerId=abc");
    expect(m.robots).toEqual({ index: true, follow: true });
  });

  it("?sellerId=a&sellerId=b (two values) → noindex, canonical /search", async () => {
    const m = await M({ sellerId: ["a", "b"] });
    expect(m.alternates?.canonical).toBe("/search");
    expect(m.robots).toEqual({ index: false, follow: true });
  });

  it("URL-encodes the query in the canonical", async () => {
    const m = await M({ q: "café & cream" });
    expect(m.alternates?.canonical).toBe("/search?q=caf%C3%A9%20%26%20cream");
  });

  it("?q=phone&brand=Acme → both indexable individually, together noindex with canonical pinned to q", async () => {
    const m = await M({ q: "phone", brand: "Acme" });
    expect(m.alternates?.canonical).toBe("/search?q=phone");
    expect(m.robots).toEqual({ index: false, follow: true });
    expect(m.title).toBe("Search: phone");
  });
});
