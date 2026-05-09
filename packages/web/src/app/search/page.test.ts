import { describe, expect, it } from "vitest";
import { generateMetadata } from "./page";

const M = (sp: Record<string, string | string[] | undefined>) =>
  generateMetadata({ searchParams: Promise.resolve(sp) });

describe("search page generateMetadata", () => {
  it("bare /search → indexable, canonical /search, generic title", async () => {
    const m = await M({});
    expect(m.alternates?.canonical).toBe("/search");
    expect(m.robots).toEqual({ index: true, follow: true });
    expect(m.title).toBe("Browse the marketplace");
  });

  it("?q=phone → indexable, canonical /search?q=phone", async () => {
    const m = await M({ q: "phone" });
    expect(m.alternates?.canonical).toBe("/search?q=phone");
    expect(m.robots).toEqual({ index: true, follow: true });
    expect(m.title).toBe("Search: phone");
  });

  it("?brand=Acme alone → indexable as a brand page", async () => {
    const m = await M({ brand: "Acme" });
    expect(m.alternates?.canonical).toBe("/search?brand=Acme");
    expect(m.robots).toEqual({ index: true, follow: true });
    expect(m.title).toBe("Acme products");
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

  it("?sellerId=abc → noindex,follow (filter slice)", async () => {
    const m = await M({ sellerId: "abc" });
    expect(m.alternates?.canonical).toBe("/search");
    expect(m.robots).toEqual({ index: false, follow: true });
  });

  it("URL-encodes the query in the canonical", async () => {
    const m = await M({ q: "café & cream" });
    expect(m.alternates?.canonical).toBe("/search?q=caf%C3%A9%20%26%20cream");
  });
});
