// Server-side enforcement of mandate constraints against an actual purchase request.

import { MandateError } from "@marketplace/shared/errors";
import type { MandateClaims } from "./mandate.js";

export interface MandateCheckRequest {
  agentId: string;
  amountMinor: bigint;
  currency: string;
  merchantIds: ReadonlyArray<string>;
  categoryIds: ReadonlyArray<string>;
  skus?: ReadonlyArray<string>;
  shipToCountry?: string;
  itemCount: number;
  cartHash?: string; // required for cart mandates
  paymentMethodHandle?: string; // required for payment mandates
  now: number;
}

export function enforceMandate(claims: MandateClaims, req: MandateCheckRequest): void {
  if (claims.sub !== req.agentId) {
    throw new MandateError("agent_mismatch", "mandate_agent_mismatch");
  }
  if (claims.cap.currency !== req.currency) {
    throw new MandateError("currency_mismatch", "mandate_currency_mismatch");
  }
  if (BigInt(claims.cap.amount_minor) < req.amountMinor) {
    throw new MandateError("amount_exceeds_cap", "mandate_amount_exceeds_cap");
  }

  const c = claims.constraints;
  if (c) {
    if (c.merchants && c.merchants.length > 0) {
      const allowed = new Set(c.merchants);
      for (const m of req.merchantIds) {
        if (!allowed.has(m)) {
          throw new MandateError(`merchant_not_allowed:${m}`, "mandate_merchant_not_allowed");
        }
      }
    }
    if (c.categories && c.categories.length > 0) {
      const allowed = c.categories;
      for (const cat of req.categoryIds) {
        if (!allowed.some((a) => cat === a || cat.startsWith(`${a}/`))) {
          throw new MandateError(`category_not_allowed:${cat}`, "mandate_category_not_allowed");
        }
      }
    }
    if (c.skus && c.skus.length > 0 && req.skus) {
      const allowed = new Set(c.skus);
      for (const sku of req.skus) {
        if (!allowed.has(sku)) {
          throw new MandateError(`sku_not_allowed:${sku}`, "mandate_sku_not_allowed");
        }
      }
    }
    if (
      c.jurisdictions &&
      c.jurisdictions.length > 0 &&
      req.shipToCountry &&
      !c.jurisdictions.includes(req.shipToCountry)
    ) {
      throw new MandateError(
        `jurisdiction_not_allowed:${req.shipToCountry}`,
        "mandate_jurisdiction_not_allowed",
      );
    }
    if (c.maxItems !== undefined && req.itemCount > c.maxItems) {
      throw new MandateError("max_items_exceeded", "mandate_max_items_exceeded");
    }
  }

  if (claims.kind === "cart") {
    if (!claims.cart_hash || !req.cartHash || claims.cart_hash !== req.cartHash) {
      throw new MandateError("cart_hash_mismatch", "mandate_cart_hash_mismatch");
    }
  }
  if (claims.kind === "payment") {
    if (
      !claims.payment_method_handle ||
      !req.paymentMethodHandle ||
      claims.payment_method_handle !== req.paymentMethodHandle
    ) {
      throw new MandateError("payment_method_mismatch", "mandate_payment_method_mismatch");
    }
  }
}
