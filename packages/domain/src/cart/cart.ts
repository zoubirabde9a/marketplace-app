// Cart domain — line-item math, totals, currency consistency.
// Real persistence lives in @marketplace/db; this module owns deterministic logic.

import { ConflictError, MarketplaceError, ValidationError } from "@marketplace/shared/errors";

// Per-line qty cap. The MCP buyer.cart.add_item / cart.update_qty surfaces cap
// at 999, but the domain accepts up to MAX_QTY_PER_LINE for adapters that bulk-
// import seller-side. The cap exists because (a) DB integer columns are int4 in
// practice, (b) `existing.qty + line.qty` is a JS Number — safe up to 2^53 but
// only a fool relies on that, and (c) a runaway agent looping `add_item` with
// `qty: 1` should be bounded by the schema, not by the database overflowing.
export const MAX_QTY_PER_LINE = 10_000;

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
  // Number.isInteger rejects NaN, Infinity, and non-integers (1.5). Pre-fix
  // `NaN <= 0` evaluated to `false`, `NaN > MAX_QTY_PER_LINE` likewise, so
  // a non-integer qty slipped past both gates — then `existing.qty + NaN`
  // produced a NaN-qty cart line that crashed totalsFor's `BigInt(qty)`
  // coercion downstream. Fail loudly at the entry point.
  if (!Number.isInteger(line.qty)) {
    throw new ValidationError([{ path: "qty", message: "must be a finite integer" }]);
  }
  if (line.qty <= 0) throw new ValidationError([{ path: "qty", message: "must be > 0" }]);
  if (line.qty > MAX_QTY_PER_LINE) {
    throw new ValidationError([
      { path: "qty", message: `must be ≤ ${MAX_QTY_PER_LINE}` },
    ]);
  }
  if (line.unitPriceMinor <= 0n) {
    // A 0 or negative unit price would let an agent build a cart that totals
    // 0 (or negative — which crashes the checkout invariant). The domain
    // refuses to accept such a line at all rather than relying on later
    // surfaces to filter it.
    throw new ValidationError([
      { path: "unitPriceMinor", message: "must be > 0" },
    ]);
  }
  const found = lines.findIndex((l) => l.variantId === line.variantId);
  if (found === -1) return [...lines, line];
  const existing = lines[found]!;
  if (existing.sellerId !== line.sellerId) {
    throw new ValidationError([{ path: "sellerId", message: "variant<->seller mismatch" }]);
  }
  if (existing.unitPriceMinor !== line.unitPriceMinor) {
    // The catalog price changed between the first add and this one. Silently
    // re-pricing the already-added units (previous behaviour) would make the
    // buyer pay more than the price they agreed to when they first added it.
    // Force the caller to handle this explicitly — typically by surfacing
    // the new price to the buyer and re-adding once they accept it.
    throw new ConflictError(
      `cart_line_price_changed: existing=${existing.unitPriceMinor} new=${line.unitPriceMinor}`,
    );
  }
  const mergedQty = existing.qty + line.qty;
  if (mergedQty > MAX_QTY_PER_LINE) {
    throw new ValidationError([
      { path: "qty", message: `merged qty ${mergedQty} exceeds ${MAX_QTY_PER_LINE}` },
    ]);
  }
  const updated: CartLine[] = [...lines];
  updated[found] = {
    ...existing,
    qty: mergedQty,
    ...(line.negotiatedQuoteId !== undefined ? { negotiatedQuoteId: line.negotiatedQuoteId } : {}),
  };
  return updated;
}

export function updateLineQty(lines: ReadonlyArray<CartLine>, variantId: string, qty: number): CartLine[] {
  // Same Number.isInteger gate as addLine — without it NaN/Infinity/floats
  // bypass the `< 0` and `> MAX` checks and land a non-integer qty on the
  // cart line.
  if (!Number.isInteger(qty)) {
    throw new ValidationError([{ path: "qty", message: "must be a finite integer" }]);
  }
  if (qty < 0) throw new ValidationError([{ path: "qty", message: "must be ≥ 0" }]);
  if (qty > MAX_QTY_PER_LINE) {
    throw new ValidationError([
      { path: "qty", message: `must be ≤ ${MAX_QTY_PER_LINE}` },
    ]);
  }
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
