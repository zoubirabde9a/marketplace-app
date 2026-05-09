// In-process buyer-agent journey: discover a SKU, negotiate via A2A, commit to cart.
// Realises scenarios/04-a2a-negotiation.md end-to-end without an HTTP boundary.

import { A2ARegistry, type A2AContext } from "@marketplace/a2a-server";
import { negotiatePriceSkill } from "@marketplace/a2a-server/skills/negotiate";
import { addLine, type CartLine } from "@marketplace/domain/cart/cart";
import type { SellerOfferPolicy } from "@marketplace/domain/negotiation/negotiate";

export interface JourneyInput {
  buyerAgentId: string;
  sellerAgentId: string;
  policy: SellerOfferPolicy;
  qty: number;
  proposedUnitPriceMinor: bigint;
  /** Maximum the buyer is willing to accept on a counter-offer. */
  buyerMaxUnitPriceMinor: bigint;
  now?: Date;
}

export interface JourneyResult {
  outcome: "accepted" | "counter_accepted" | "walked_away";
  finalUnitPriceMinor?: bigint;
  effectiveDiscountBps?: number;
  cart: CartLine[];
  exchanges: number;
}

/**
 * Run the buyer journey using a fresh in-process A2A registry. Returns the resulting
 * cart and the negotiation outcome.
 */
export async function runNegotiateAndBuy(input: JourneyInput): Promise<JourneyResult> {
  const reg = new A2ARegistry();
  reg.register(negotiatePriceSkill);

  const ctx: A2AContext = {
    fromAgentId: input.buyerAgentId,
    toAgentId: input.sellerAgentId,
    dialogueId: `dlg-${input.buyerAgentId}-${Date.now()}`,
    now: () => Date.now(),
  };
  const now = (input.now ?? new Date()).toISOString();

  let exchanges = 0;
  const propose = async (priceMinor: bigint) => {
    exchanges++;
    return (await reg.invoke(
      "negotiate_price",
      {
        policy: input.policy,
        request: {
          buyerAgentId: input.buyerAgentId,
          buyerSegments: ["consumer"],
          qty: input.qty,
          proposedUnitPriceMinor: priceMinor,
          now,
        },
      },
      ctx,
    )) as {
      accepted: boolean;
      counterUnitPriceMinor?: bigint;
      reason: string;
      effectiveDiscountBps: number;
    };
  };

  const first = await propose(input.proposedUnitPriceMinor);
  if (first.accepted) {
    return finalize("accepted", input.proposedUnitPriceMinor, first.effectiveDiscountBps, exchanges);
  }

  if (first.counterUnitPriceMinor !== undefined && first.counterUnitPriceMinor <= input.buyerMaxUnitPriceMinor) {
    const second = await propose(first.counterUnitPriceMinor);
    if (second.accepted) {
      return finalize("counter_accepted", first.counterUnitPriceMinor, second.effectiveDiscountBps, exchanges);
    }
  }

  return { outcome: "walked_away", cart: [], exchanges };

  function finalize(
    outcome: "accepted" | "counter_accepted",
    priceMinor: bigint,
    bps: number,
    exch: number,
  ): JourneyResult {
    const line: CartLine = {
      variantId: input.policy.variantId,
      sellerId: input.policy.sellerOrgId,
      qty: input.qty,
      unitPriceMinor: priceMinor,
      listPriceMinor: input.policy.listPriceMinor,
      negotiatedQuoteId: ctx.dialogueId,
    };
    return {
      outcome,
      finalUnitPriceMinor: priceMinor,
      effectiveDiscountBps: bps,
      cart: addLine([], line),
      exchanges: exch,
    };
  }
}
