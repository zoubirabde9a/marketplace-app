// Checkout quote: priced cart + tax + shipping options + restricted-items gate.

import { ValidationError } from "@marketplace/shared/errors";
import { totalsFor, type PriceableCart, type CartTotals } from "../cart/cart.js";
import { canonicalCartHash } from "../payment/mandate.js";
import {
  enforceListingShippability,
  type BuyerContext,
  type ListingClassification,
  type RestrictedItemRule,
} from "../catalog/restricted-items.js";

export interface ShippingOption {
  carrier: string;
  service: string;
  costMinor: bigint;
  estDeliveryDays: number;
}

export interface TaxBreakdownLine {
  variantId: string;
  taxMinor: bigint;
  zoneId: string;
  rateBps: number;
}

export interface CheckoutQuote {
  cart: PriceableCart;
  totals: CartTotals;
  shippingOptions: ShippingOption[];
  selectedShipping?: ShippingOption;
  taxBreakdown: TaxBreakdownLine[];
  cartHash: string;
  /** Per-listing restricted-items results; if any are blocked, the quote is rejected. */
  restrictedItemsAllowed: boolean;
  restrictedItemsReason?: string;
}

export interface QuoteInputs {
  cart: PriceableCart;
  shippingOptions: ShippingOption[];
  preferredShipping?: { carrier: string; service: string };
  taxBreakdown: TaxBreakdownLine[];
  classifications: ListingClassification[];
  buyer: BuyerContext;
  rules: RestrictedItemRule[];
  now: Date;
}

export function priceQuote(input: QuoteInputs): CheckoutQuote {
  for (const cls of input.classifications) {
    enforceListingShippability(cls, input.buyer, input.rules, input.now);
  }
  let selectedShipping: ShippingOption | undefined;
  if (input.preferredShipping !== undefined) {
    selectedShipping = input.shippingOptions.find(
      (o) =>
        o.carrier === input.preferredShipping!.carrier &&
        o.service === input.preferredShipping!.service,
    );
    // Silent fallback to shippingOptions[0] was a real correctness defect:
    // an agent that asked for "express" but couldn't find it (stale options,
    // typo, regional carrier) used to silently get billed for "standard" —
    // or vice versa. The cart-hash / mandate-bound flow then computed a
    // total the agent never agreed to. Fail loud so the caller re-fetches
    // options and picks a real one.
    if (!selectedShipping) {
      throw new ValidationError([
        {
          path: "preferredShipping",
          message: `unknown_shipping_option:${input.preferredShipping.carrier}/${input.preferredShipping.service}`,
        },
      ]);
    }
  } else {
    selectedShipping = input.shippingOptions[0];
  }
  // Same non-negative guard for shipping cost as the tax-line check below.
  // Pre-fix `selectedShipping?.costMinor` was trusted to be ≥ 0 because the
  // platform's FLAT_SHIPPING_OPTIONS always is — but the domain function is
  // callable from any surface, and a caller passing a negative cost would
  // credit the buyer at checkout (hidden discount the seller didn't
  // authorise) or drive the total negative when summed with the subtotal.
  if (selectedShipping && selectedShipping.costMinor < 0n) {
    throw new ValidationError([
      {
        path: "shippingOptions",
        message: `negative_shipping_cost:${selectedShipping.carrier}/${selectedShipping.service}`,
      },
    ]);
  }
  const shippingMinor = selectedShipping?.costMinor ?? 0n;
  // Tax line amounts must be non-negative — a negative tax line would credit
  // the buyer (effectively a hidden discount the seller didn't authorise)
  // and could even drive the total negative when summed with other lines.
  for (const line of input.taxBreakdown) {
    if (line.taxMinor < 0n) {
      throw new ValidationError([
        { path: "taxBreakdown", message: `negative_tax:${line.variantId}` },
      ]);
    }
  }
  const taxMinor = input.taxBreakdown.reduce((sum, l) => sum + l.taxMinor, 0n);

  const priced: PriceableCart = {
    ...input.cart,
    shippingMinor,
    taxMinor,
  };
  const totals = totalsFor(priced);
  const cartHash = canonicalCartHash({
    cartId: priced.cartId,
    currency: priced.currency,
    items: priced.lines.map((l) => ({
      variantId: l.variantId,
      qty: l.qty,
      unitPriceMinor: l.unitPriceMinor,
      sellerId: l.sellerId,
    })),
    shippingMinor,
    taxMinor,
    totalMinor: totals.totalMinor,
  });
  return {
    cart: priced,
    totals,
    shippingOptions: input.shippingOptions,
    ...(selectedShipping ? { selectedShipping } : {}),
    taxBreakdown: input.taxBreakdown,
    cartHash,
    restrictedItemsAllowed: true,
  };
}
