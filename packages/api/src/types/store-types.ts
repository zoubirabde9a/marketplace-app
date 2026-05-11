// DTO shapes used at the repository boundary. The HTTP routes consume these;
// repository implementations (Drizzle-backed) translate between these shapes
// and the underlying SQL tables. Names retain the `Stored*` prefix for
// continuity with the now-deleted in-memory implementation, but the types are
// no longer tied to any particular storage backend.

import type { catalog } from "@marketplace/domain";
import type { cart as cartDomain, order as orderDomain } from "@marketplace/domain";

export interface StoredUser {
  id: string;
  googleSub: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
  picture?: string;
  status: "active" | "suspended" | "deleted";
  createdAt: number;
  updatedAt: number;
}

export interface StoredCart {
  cartId: string;
  ownerKind: "user" | "anonymous";
  ownerId: string;
  currency: string;
  lines: cartDomain.CartLine[];
  createdAt: number;
  updatedAt: number;
}

/** Buyer-supplied contact details, captured at checkout. */
export interface OrderCustomer {
  name: string;
  phone: string;
  region: string;
}

export interface StoredOrder {
  orderId: string;
  publicNumber: string;
  ownerKind: "user" | "anonymous";
  ownerId: string;
  cartId: string;
  status: orderDomain.OrderStatus;
  currency: string;
  totalMinor: bigint;
  shippingMinor: bigint;
  taxMinor: bigint;
  subtotalMinor: bigint;
  lines: cartDomain.CartLine[];
  /** Buyer name/phone/region supplied at checkout. Required for anonymous COD orders. */
  customer: OrderCustomer | null;
  /** Token returned on confirm so an anonymous buyer can re-fetch the order. */
  accessToken: string;
  createdAt: number;
}

export interface StoredVariant {
  id: string;
  sku: string;
  priceMinor: bigint;
  currency: string;
  inStock: boolean;
}

export interface StoredMedia {
  id: string;
  url: string;
  contentType: string;
  byteSize?: number;
  width?: number;
  height?: number;
  altText?: string;
}

export interface StoredProduct {
  productId: string;
  sellerId: string;
  titleSanitized: string;
  descriptionSanitized?: string;
  brand?: string;
  attributes: Record<string, string>;
  variants: StoredVariant[];
  media: StoredMedia[];
  heroMediaId?: string;
  rating?: number;
  ratingCount?: number;
  /** Free-form category tags. Used for the `category` filter and facet. */
  categoryIds?: string[];
  /** ISO 3166-1 alpha-2 country codes the product can ship to. */
  shipsTo?: string[];
  counterfeitRisk: catalog.CounterfeitRiskT;
  createdAt: number;
}

export interface StoredSellerPhone {
  /** E.164 form, e.g. "+213556685195". */
  phoneE164: string;
  isWhatsapp: boolean;
  isViber: boolean;
  isPrimary: boolean;
  position: number;
}

export interface StoredSeller {
  sellerId: string;
  displayName: string;
  ownerAgentId: string;
  /** Convenience alias for the primary number in `phones`. */
  phone?: string;
  /** All known phones for the seller, primary first. */
  phones: StoredSellerPhone[];
  whatsapp?: string;
  website?: string;
  /** Short store bio shown on the storefront. */
  description?: string;
  supportEmail?: string;
  /** Free-text locality (e.g. "Algiers"). City lives on the seller profile; country on the org row. */
  city?: string;
  /** ISO 3166-1 alpha-2. */
  countryCode?: string;
  createdAt: number;
}

export interface StoredMediaBlob {
  /** Owning product (used for ownership checks on delete and for cleanup). */
  productId: string;
  contentType: string;
  bytes: Buffer;
}
