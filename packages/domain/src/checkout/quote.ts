// Checkout quote: priced cart + tax + shipping options + restricted-items gate.

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
  const selectedShipping =
    input.preferredShipping !== undefined
      ? input.shippingOptions.find(
          (o) => o.carrier === input.preferredShipping!.carrier && o.service === input.preferredShipping!.service,
        ) ?? input.shippingOptions[0]
      : input.shippingOptions[0];
  const shippingMinor = selectedShipping?.costMinor ?? 0n;
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
