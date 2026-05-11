// Cart aggregate — owned by a logged-in user or an anonymous session.

import type { cart as cartDomain } from "@marketplace/domain";
import type { StoredCart } from "../types/store-types.js";

export type CartRecord = StoredCart;

/** Per-variant lookup info used to render cart/order line item rows. */
export interface CartLineInfo {
  variantId: string;
  productId: string;
  title: string;
  heroImageUrl: string | null;
  sku: string;
}

export interface CartRepo {
  /**
   * Resolve a cart given (userId | cartId). When a logged-in user is present,
   * a per-user cart is created on demand. Anonymous callers must supply the
   * cartId returned by the first POST.
   */
  getOrCreate(input: {
    userId?: string;
    cartId?: string;
    currency?: string;
  }): Promise<CartRecord>;

  get(cartId: string): Promise<CartRecord | undefined>;

  setLines(cartId: string, lines: cartDomain.CartLine[]): Promise<CartRecord>;

  /** Adopt a currency for an empty cart (first add-to-cart anchors it). */
  setCurrency(cartId: string, currency: string): Promise<CartRecord>;

  /** Resolve product+variant to a CartLine plus its currency. */
  resolveLine(variantId: string, qty: number): Promise<{ line: cartDomain.CartLine; currency: string }>;

  /**
   * Bulk-look up product titles + hero images for a set of variant ids.
   * Used to enrich cart/order line responses so the UI can render a meaningful
   * row (title, thumbnail) without N+1 round-trips. Missing ids are simply
   * absent from the result; callers must handle the gap (e.g. show "removed").
   */
  enrichLines(variantIds: string[]): Promise<CartLineInfo[]>;
}
