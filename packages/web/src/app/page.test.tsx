import { describe, expect, it, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

// Mock the session reader so the home component never hits cookies/API.
vi.mock("@/lib/sellerSession", () => ({
  getCurrentUser: vi.fn(async () => null),
}));
// Activity API isn't called in the signed-out branch, but keep the import safe.
vi.mock("@/lib/api", () => ({
  getMyActivity: vi.fn(),
  searchProducts: vi.fn(async () => ({
    data: [],
    pagination: { cursor: null, totalEstimate: 0 },
    facets: { brands: [], currencies: [], sellers: [], categories: [] },
  })),
}));

import Home from "./page";

afterEach(() => cleanup());

describe("Home (signed-out landing)", () => {
  it("emits a WebSite + Organization @graph with the @id anchors AboutPage references", async () => {
    const tree = await Home();
    const { container } = render(tree);
    const ld = container.querySelector('script[type="application/ld+json"]');
    expect(ld).not.toBeNull();
    const payload = JSON.parse(ld!.innerHTML);
    expect(Array.isArray(payload["@graph"])).toBe(true);

    const website = payload["@graph"].find((n: { "@type": string }) => n["@type"] === "WebSite");
    const org = payload["@graph"].find((n: { "@type": string }) => n["@type"] === "Organization");
    expect(website).toBeDefined();
    expect(org).toBeDefined();

    // The AboutPage JSON-LD references these exact @id suffixes; renaming them
    // here without updating /about/page.tsx would break the entity graph.
    expect(website["@id"]).toMatch(/#website$/);
    expect(org["@id"]).toMatch(/#organization$/);

    // SearchAction qualifies us for Google's sitelinks search box.
    expect(website.potentialAction?.["@type"]).toBe("SearchAction");
    expect(website.potentialAction?.target?.urlTemplate).toMatch(/\/search\?q=\{search_term_string\}$/);

    // publisher cross-reference back to the Organization node.
    expect(website.publisher?.["@id"]).toBe(org["@id"]);
  });

  it("shows the marketing CTAs (Sign in / Browse) on the signed-out landing", async () => {
    const tree = await Home();
    const { container } = render(tree);
    const links = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(links).toContain("/login");
    expect(links).toContain("/search");
  });
});
