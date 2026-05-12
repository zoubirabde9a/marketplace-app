import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { OrderView } from "@/lib/cart";

vi.mock("@/lib/cart", () => ({
  getOrder: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import { getOrder } from "@/lib/cart";
import OrderPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeOrder(overrides: Partial<OrderView> = {}): OrderView {
  return {
    orderId: "01999999-9999-7999-9999-000000000123",
    publicNumber: "MP-260512-TEST01",
    status: "paid",
    currency: "DZD",
    totals: { subtotalMinor: "3500000", shippingMinor: "0", taxMinor: "0", totalMinor: "3500000" },
    lines: [
      {
        variantId: "v1",
        sellerId: "s1",
        qty: 1,
        unitPriceMinor: "3500000",
        productId: "p1",
        title: "Robe Karakou",
        sku: "sku-1",
        heroImageUrl: null,
      },
    ],
    customer: { name: "Amina K", phone: "+213555000111", region: "Alger" },
    ownerKind: "anonymous",
    createdAt: "2026-05-12T08:00:00.000Z",
    ...overrides,
  };
}

describe("OrderPage", () => {
  it("renders the singular COD blurb in French for a single-seller order", async () => {
    vi.mocked(getOrder).mockResolvedValueOnce(makeOrder());
    const tree = await OrderPage({ params: Promise.resolve({ id: "01999999-9999-7999-9999-000000000123" }) });
    const { container } = render(tree);
    const text = container.textContent ?? "";
    expect(text).toMatch(/Commande passée/);
    expect(text).toMatch(/Le vendeur vous appellera/);
    expect(text).not.toMatch(/Chacun des/);
  });

  it("uses the plural blurb naming the seller count for a multi-seller order", async () => {
    const order = makeOrder({
      lines: [
        { variantId: "v1", sellerId: "s1", qty: 1, unitPriceMinor: "3500000", productId: "p1", title: "Karakou", sku: "sku-1", heroImageUrl: null },
        { variantId: "v2", sellerId: "s2", qty: 1, unitPriceMinor: "3800000", productId: "p2", title: "Samsung A31", sku: "sku-2", heroImageUrl: null },
      ],
      totals: { subtotalMinor: "7300000", shippingMinor: "0", taxMinor: "0", totalMinor: "7300000" },
    });
    vi.mocked(getOrder).mockResolvedValueOnce(order);
    const tree = await OrderPage({ params: Promise.resolve({ id: order.orderId }) });
    const { container } = render(tree);
    const text = container.textContent ?? "";
    expect(text).toMatch(/Chacun des 2 vendeurs/);
    expect(text).not.toMatch(/Le vendeur vous appellera/);
  });

  it("renders the French delivery-contact chrome (Nom / Téléphone / Wilaya)", async () => {
    vi.mocked(getOrder).mockResolvedValueOnce(makeOrder());
    const tree = await OrderPage({ params: Promise.resolve({ id: "01999999-9999-7999-9999-000000000123" }) });
    const { container } = render(tree);
    const text = container.textContent ?? "";
    expect(text).toMatch(/Contact de livraison/);
    expect(text).toMatch(/Nom/);
    expect(text).toMatch(/Téléphone/);
    expect(text).toMatch(/Wilaya/);
  });

  it("shows 'Gratuite (paiement à la livraison)' when shippingMinor is 0", async () => {
    vi.mocked(getOrder).mockResolvedValueOnce(makeOrder());
    const tree = await OrderPage({ params: Promise.resolve({ id: "01999999-9999-7999-9999-000000000123" }) });
    const { container } = render(tree);
    expect(container.textContent).toMatch(/Gratuite \(paiement à la livraison\)/);
  });

  it("strips a duplicated leading word from the line-item title (cleanProductTitle)", async () => {
    vi.mocked(getOrder).mockResolvedValueOnce(
      makeOrder({
        lines: [
          { variantId: "v1", sellerId: "s1", qty: 1, unitPriceMinor: "1000", productId: "p1", title: "Samsung Samsung a31", sku: "sku-1", heroImageUrl: null },
        ],
      }),
    );
    const tree = await OrderPage({ params: Promise.resolve({ id: "01999999-9999-7999-9999-000000000123" }) });
    const { container } = render(tree);
    expect(container.textContent).toMatch(/Samsung a31/);
    expect(container.textContent).not.toMatch(/Samsung Samsung a31/);
  });
});
