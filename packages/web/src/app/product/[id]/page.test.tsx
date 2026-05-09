import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { ProductDetail } from "@/lib/api";

// Mock the API module so the server component doesn't hit the network.
vi.mock("@/lib/api", () => ({
  getProduct: vi.fn(),
}));

// notFound() throws — easier to test by mocking it to a known error.
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import { getProduct } from "@/lib/api";
import ProductPage, { generateMetadata } from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const baseProduct = (overrides: Partial<ProductDetail> = {}): ProductDetail => ({
  productId: "p-123",
  viewUrl: "/p/p-123",
  title: { role: "untrusted_content", origin: "seller", value: "Test Widget 9000" },
  description: { role: "untrusted_content", origin: "seller", value: "A description." },
  brand: "Acme",
  attributes: {},
  variants: [
    { id: "v1", sku: "SKU-1", priceMinor: "1000", currency: "USD", inStock: true },
  ],
  sellerId: "s-1",
  sellerDisplayName: "Acme Storefront",
  sellerPhone: "+15551234567",
  sellerWhatsapp: "+15559876543",
  sellerWebsite: "https://acme.example.com",
  categoryIds: [],
  shipsTo: ["US", "CA"],
  counterfeitRisk: "low",
  images: [{ id: "m1", url: "https://cdn.example.com/m1.jpg", contentType: "image/jpeg" }],
  heroImageUrl: "https://cdn.example.com/m1.jpg",
  heroMediaId: "m1",
  ...overrides,
});

describe("ProductPage", () => {
  it("renders product name into the JSON-LD script and shows seller contact links", async () => {
    const product = baseProduct();
    vi.mocked(getProduct).mockResolvedValueOnce(product);

    // ProductPage is an async server component — invoke it as a function and
    // render the returned JSX via React Testing Library.
    const tree = await ProductPage({ params: Promise.resolve({ id: "p-123" }) });
    const { container } = render(tree);

    // JSON-LD script contains the product name.
    const ld = container.querySelector('script[type="application/ld+json"]');
    expect(ld).not.toBeNull();
    const payload = JSON.parse(ld!.innerHTML);
    expect(payload["@type"]).toBe("Product");
    expect(payload.name).toBe("Test Widget 9000");
    expect(payload.productID).toBe("p-123");
    expect(payload.brand).toEqual({ "@type": "Brand", name: "Acme" });

    // Seller contact links render.
    const phone = container.querySelector('a[href="tel:+15551234567"]');
    expect(phone).not.toBeNull();
    const wa = container.querySelector('a[href^="https://wa.me/"]');
    expect(wa).not.toBeNull();
    expect(wa!.getAttribute("href")).toBe("https://wa.me/15559876543");
    const site = container.querySelector('a[href="https://acme.example.com"]');
    expect(site).not.toBeNull();
  });

  it("omits seller contact links when none are provided", async () => {
    const product = baseProduct({
      sellerPhone: null,
      sellerWhatsapp: null,
      sellerWebsite: null,
    });
    vi.mocked(getProduct).mockResolvedValueOnce(product);

    const tree = await ProductPage({ params: Promise.resolve({ id: "p-123" }) });
    const { container } = render(tree);

    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
    expect(container.querySelector('a[href^="https://wa.me/"]')).toBeNull();
  });

  it("calls notFound() when the product is missing", async () => {
    vi.mocked(getProduct).mockResolvedValueOnce(null);
    await expect(
      ProductPage({ params: Promise.resolve({ id: "missing" }) }),
    ).rejects.toThrowError("NEXT_NOT_FOUND");
  });

  it("emits BreadcrumbList JSON-LD with Home → Catalog → product trail", async () => {
    const product = baseProduct();
    vi.mocked(getProduct).mockResolvedValueOnce(product);

    const tree = await ProductPage({ params: Promise.resolve({ id: "p-123" }) });
    const { container } = render(tree);

    const scripts = container.querySelectorAll('script[type="application/ld+json"]');
    const bc = Array.from(scripts)
      .map((s) => JSON.parse(s.innerHTML))
      .find((o) => o["@type"] === "BreadcrumbList");
    expect(bc).toBeDefined();
    expect(bc.itemListElement).toHaveLength(3);
    expect(bc.itemListElement[0].name).toBe("Home");
    expect(bc.itemListElement[1].name).toBe("Catalog");
    expect(bc.itemListElement[2].name).toBe("Test Widget 9000");
  });

  it("includes SKU on single-variant Offer and at the Product level", async () => {
    const product = baseProduct();
    vi.mocked(getProduct).mockResolvedValueOnce(product);

    const tree = await ProductPage({ params: Promise.resolve({ id: "p-123" }) });
    const { container } = render(tree);

    const scripts = container.querySelectorAll('script[type="application/ld+json"]');
    const prod = Array.from(scripts)
      .map((s) => JSON.parse(s.innerHTML))
      .find((o) => o["@type"] === "Product");
    expect(prod).toBeDefined();
    expect(prod.sku).toBe("SKU-1");
    expect(prod.offers["@type"]).toBe("Offer");
    expect(prod.offers.sku).toBe("SKU-1");
    expect(prod.offers.itemCondition).toBe("https://schema.org/NewCondition");
    expect(prod.offers.priceValidUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("ProductPage generateMetadata", () => {
  it("emits per-product canonical, OpenGraph and Twitter Card with hero image dimensions", async () => {
    const product = baseProduct({
      images: [
        {
          id: "m1",
          url: "https://cdn.example.com/m1.jpg",
          contentType: "image/jpeg",
          width: 800,
          height: 600,
          altText: "Test Widget hero shot",
        },
      ],
    });
    vi.mocked(getProduct).mockResolvedValueOnce(product);

    const m = await generateMetadata({ params: Promise.resolve({ id: "p-123" }) });

    expect(m.title).toBe("Test Widget 9000");
    expect(m.alternates?.canonical).toBe("/product/p-123");
    // OG image carries dimensions and alt for fast social previews.
    const ogImg = (m.openGraph?.images as Array<Record<string, unknown>>)[0];
    expect(ogImg).toMatchObject({
      url: "https://cdn.example.com/m1.jpg",
      width: 800,
      height: 600,
      alt: "Test Widget hero shot",
    });
    expect(m.twitter?.card).toBe("summary_large_image");
  });

  it("falls back to summary card and product title alt when there is no hero image", async () => {
    const product = baseProduct({ heroImageUrl: null, images: [] });
    vi.mocked(getProduct).mockResolvedValueOnce(product);

    const m = await generateMetadata({ params: Promise.resolve({ id: "p-123" }) });

    expect(m.openGraph?.images).toBeUndefined();
    expect(m.twitter?.card).toBe("summary");
  });
});
