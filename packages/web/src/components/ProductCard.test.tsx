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

  it("renders the title as an h2 with the line-clamp class", () => {
    const { container } = render(<ProductCard hit={baseHit()} />);
    const h = container.querySelector("h2");
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

  it("renders a placeholder SVG (no <img>) when there is no hero image URL", () => {
    const { container } = render(
      <ProductCard hit={baseHit({ heroImageUrl: null, heroImage: null })} />,
    );
    expect(container.querySelector("img")).toBeNull();
    // The placeholder SVG remains (an inline icon).
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("shows an out-of-stock indicator when inStock is false", () => {
    const { container } = render(<ProductCard hit={baseHit({ inStock: false })} />);
    expect(container.textContent?.toLowerCase()).toContain("out of stock");
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
