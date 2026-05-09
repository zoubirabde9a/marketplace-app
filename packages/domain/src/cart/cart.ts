// Cart domain — line-item math, totals, currency consistency.
// Real persistence lives in @marketplace/db; this module owns deterministic logic.

import { MarketplaceError, ValidationError } from "@marketplace/shared/errors";

export interface CartLine {
  variantId: string;
  sellerId: string;
  qty: number;
  unitPriceMinor: bigint;
  listPriceMinor?: bigint;
  /** Optional negotiated quote id from a/an A2A negotiation skill. */
  negotiatedQuoteId?: string;
}

export interface CartTotals {
  subtotalMinor: bigint;
  discountMinor: bigint;
  shippingMinor: bigint;
  taxMinor: bigint;
  tipMinor: bigint;
  totalMinor: bigint;
}

export interface PriceableCart {
  cartId: string;
  currency: string;
  lines: ReadonlyArray<CartLine>;
  shippingMinor?: bigint;
  taxMinor?: bigint;
  discountMinor?: bigint;
  tipMinor?: bigint;
}

export function totalsFor(cart: PriceableCart): CartTotals {
  const subtotalMinor = cart.lines.reduce((sum, l) => sum + l.unitPriceMinor * BigInt(l.qty), 0n);
  const discountMinor = cart.discountMinor ?? 0n;
  const shippingMinor = cart.shippingMinor ?? 0n;
  const taxMinor = cart.taxMinor ?? 0n;
  const tipMinor = cart.tipMinor ?? 0n;
  if (discountMinor > subtotalMinor) {
    throw new ValidationError([{ path: "discountMinor", message: "discount cannot exceed subtotal" }]);
  }
  const totalMinor = subtotalMinor - discountMinor + shippingMinor + taxMinor + tipMinor;
  return { subtotalMinor, discountMinor, shippingMinor, taxMinor, tipMinor, totalMinor };
}

export function addLine(lines: ReadonlyArray<CartLine>, line: CartLine): CartLine[] {
  if (line.qty <= 0) throw new ValidationError([{ path: "qty", message: "must be > 0" }]);
  const found = lines.findIndex((l) => l.variantId === line.variantId);
  if (found === -1) return [...lines, line];
  const existing = lines[found]!;
  if (existing.sellerId !== line.sellerId) {
    throw new ValidationError([{ path: "sellerId", message: "variant<->seller mismatch" }]);
  }
  const updated: CartLine[] = [...lines];
  updated[found] = {
    ...existing,
    qty: existing.qty + line.qty,
    unitPriceMinor: line.unitPriceMinor,
    ...(line.negotiatedQuoteId !== undefined ? { negotiatedQuoteId: line.negotiatedQuoteId } : {}),
  };
  return updated;
}

export function updateLineQty(lines: ReadonlyArray<CartLine>, variantId: string, qty: number): CartLine[] {
  if (qty < 0) throw new ValidationError([{ path: "qty", message: "must be ≥ 0" }]);
  if (qty === 0) return lines.filter((l) => l.variantId !== variantId);
  const idx = lines.findIndex((l) => l.variantId === variantId);
  if (idx === -1) throw new MarketplaceError({
    type: "https://marketplace.dev/errors/not-found",
    title: "cart_line_not_found",
    status: 404,
    detail: variantId,
  });
  const out: CartLine[] = [...lines];
  out[idx] = { ...lines[idx]!, qty };
  return out;
}

export function removeLine(lines: ReadonlyArray<CartLine>, variantId: string): CartLine[] {
  return lines.filter((l) => l.variantId !== variantId);
}

export function distinctSellers(cart: PriceableCart): string[] {
  return [...new Set(cart.lines.map((l) => l.sellerId))];
}

export function distinctCurrencies(cart: PriceableCart): string[] {
  return [cart.currency];
}
