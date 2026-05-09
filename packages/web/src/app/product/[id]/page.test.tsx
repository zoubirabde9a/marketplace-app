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
import ProductPage from "./page";

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
});
