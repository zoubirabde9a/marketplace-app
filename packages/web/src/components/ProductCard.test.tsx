import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { SearchHit } from "@/lib/api";
import { ProductCard } from "./ProductCard";

afterEach(() => cleanup());

function baseHit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    productId: "p-1",
    viewUrl: "/p/p-1",
    title: { role: "untrusted_content", origin: "seller:s1", value: "Test Widget 9000" },
    brand: "Acme",
    priceMinor: "1999",
    currency: "USD",
    inStock: true,
    sellerId: "s-1",
    sellerDisplayName: "Acme Storefront",
    categoryIds: [],
    counterfeitRisk: "low",
    relevanceScore: 0.9,
    heroImageUrl: "https://cdn.example.com/h.jpg",
    heroImage: { id: "m1", url: "https://cdn.example.com/h.jpg", contentType: "image/jpeg", altText: "A widget" },
    ...overrides,
  };
}

describe("ProductCard", () => {
  it("links to /product/<id> with the productId encoded", () => {
    const { container } = render(<ProductCard hit={baseHit({ productId: "p with space" })} />);
    const a = container.querySelector("a");
    expect(a?.getAttribute("href")).toBe("/product/p%20with%20space");
  });

  it("renders the title as an h3 with the line-clamp class", () => {
    // Cards live nested under a page-level H1/H2 everywhere they render
    // (home / slice landings / product detail's "More from seller").
    // h3 keeps hierarchy clean — see comment in ProductCard.tsx.
    const { container } = render(<ProductCard hit={baseHit()} />);
    const h = container.querySelector("h3");
    expect(h?.textContent).toContain("Test Widget 9000");
    expect(h?.className).toMatch(/line-clamp-2/);
  });

  it("renders the hero image with seller alt text and async-decoding hints", () => {
    const { container } = render(<ProductCard hit={baseHit()} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("alt")).toBe("A widget");
    expect(img!.getAttribute("loading")).toBe("lazy");
    expect(img!.getAttribute("decoding")).toBe("async");
  });

  it("falls back to the product title as alt when seller did not provide alt text", () => {
    const { container } = render(
      <ProductCard hit={baseHit({ heroImage: { id: "m1", url: "x", contentType: "image/jpeg" } })} />,
    );
    const img = container.querySelector("img");
    expect(img!.getAttribute("alt")).toBe("Test Widget 9000");
  });

  it("renders a brand-initial placeholder (no <img>) when there is no hero image URL", () => {
    const { container } = render(
      <ProductCard hit={baseHit({ heroImageUrl: null, heroImage: null, brand: "Acme" })} />,
    );
    expect(container.querySelector("img")).toBeNull();
    // Placeholder shows the brand's first letter so the catalog grid is
    // visually differentiable when no images are seeded.
    expect(container.textContent).toContain("A");
  });

  it("falls back to the title's first letter when no brand", () => {
    const { container } = render(
      <ProductCard
        hit={baseHit({ heroImageUrl: null, heroImage: null, brand: undefined, title: { role: "untrusted_content", origin: "s", value: "Z-Widget" } })}
      />,
    );
    // First letter of title 'Z'
    const placeholder = container.querySelector('[aria-hidden="true"] span');
    expect(placeholder?.textContent).toBe("Z");
  });

  it("shows an out-of-stock indicator when inStock is false", () => {
    const { container } = render(<ProductCard hit={baseHit({ inStock: false })} />);
    expect(container.textContent?.toLowerCase()).toContain("rupture de stock");
  });

  it("renders a price for a single-variant hit using formatPrice", () => {
    const { container } = render(<ProductCard hit={baseHit({ priceMinor: "1999", currency: "USD" })} />);
    expect(container.textContent).toMatch(/19\.99/);
  });

  it("renders a price range when only priceFrom/priceTo are present", () => {
    const { container } = render(
      <ProductCard
        hit={baseHit({
          priceMinor: undefined,
          priceFromMinor: "1000",
          priceToMinor: "2000",
          variantCount: 2,
        })}
      />,
    );
    // formatPriceRange yields "<low> – <high>"
    expect(container.textContent).toMatch(/10/);
    expect(container.textContent).toMatch(/20/);
    expect(container.textContent).toContain("–");
  });
});
