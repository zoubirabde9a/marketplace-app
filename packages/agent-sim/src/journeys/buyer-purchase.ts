// In-process buyer journey realising scenarios/03-buyer-purchase.md plus the post-
// purchase review path from scenarios/12-review-moderation.md. Crosses three real
// surfaces: the MCP cart restriction gate, the cart domain module, and the MCP
// review.write tool.

import { McpRegistry, type McpContext } from "@marketplace/mcp-server/registry";
import { registerCartTools } from "@marketplace/mcp-server/tools/cart";
import { registerReviewTools } from "@marketplace/mcp-server/tools/review";
import { addLine, type CartLine } from "@marketplace/domain/cart/cart";

export interface PurchaseLine {
  productId: string;
  listingId: string;
  variantId: string;
  sellerId: string;
  unitPriceMinor: bigint;
  qty: number;
  taxonomyKeys: string[];
  isHazmat: boolean;
  isAgeRestricted: boolean;
  minAge?: number;
  exportControlClass?: string;
  countryOfOrigin: string;
}

export interface PurchaseInput {
  buyerUserId: string;
  buyerAgentId?: string;
  shipToCountry: string;
  shipToSubdivision?: string;
  buyerVerifiedAge?: number;
  buyerHasLicense?: boolean;
  isSanctionedParty: boolean;
  carriersAvailable: Array<{ key: string; prohibitedItems: string[] }>;
  rules: Array<{
    taxonomyKey: string;
    countryCode: string;
    subdivisionCode?: string;
    restrictionKind:
      | "prohibited"
      | "age_restricted"
      | "license_required"
      | "carrier_prohibited"
      | "export_controlled"
      | "hazmat";
    minAge?: number;
    licenseRequiredOf?: "seller" | "buyer" | "both";
    effectiveFrom: Date;
    effectiveTo?: Date;
    registryVersion: string;
  }>;
  candidates: PurchaseLine[];
  reviewWindowDays: number;
  /** Coordination signals the moderation classifier should see post-purchase. */
  reviewSignals?: {
    burstCount?: number;
    burstThreshold?: number;
    incentiveDetected?: boolean;
    selfReview?: boolean;
    honeypotEcho?: boolean;
    linguisticSimilarity?: number;
    brandConcentrationBps?: number;
  };
  /** Body of the review submitted after settlement. */
  reviewBody: string;
  reviewRating: number;
  now: Date;
}

export interface PurchaseResult {
  /** Lines that passed the restricted-items gate and were added to the cart. */
  cart: CartLine[];
  /** Lines that the gate dropped (with the reason). */
  blockedLines: Array<{ listingId: string; reason: string; reasonClass: "hard" | "recoverable" }>;
  /** Pseudo "settled" state — in-process journey, no DB. */
  settledOrderItems: Array<{ orderItemId: string; productId: string; settledAt: Date }>;
  reviewOutcome:
    | { posted: true; status: "visible" | "excluded_from_avg" | "suppressed"; suspicionScore: number }
    | { posted: false; reason: string };
}

function buildCtx(scopes: string[]): McpContext {
  return {
    agentId: "agt_buyer",
    passportId: "psp_buyer",
    scopes: new Set(scopes),
    ownerKind: "user",
    ownerId: "usr_buyer",
    requestId: "req-purchase",
    now: () => Date.now(),
    emitAudit: async () => {},
  };
}

export async function runBuyerPurchase(input: PurchaseInput): Promise<PurchaseResult> {
  // 1) Build a single MCP registry with both tools — this is the same wiring
  // a real MCP server would use; the journey just runs it in-process.
  const reg = new McpRegistry();
  registerCartTools(reg);
  registerReviewTools(reg);

  // 2) Restricted-items gate.
  const gate = (await reg.invoke(
    "cart.check_restrictions",
    {
      lines: input.candidates.map((c) => ({
        productId: c.productId,
        listingId: c.listingId,
        taxonomyKeys: c.taxonomyKeys,
        isHazmat: c.isHazmat,
        isAgeRestricted: c.isAgeRestricted,
        ...(c.minAge !== undefined ? { minAge: c.minAge } : {}),
        ...(c.exportControlClass !== undefined ? { exportControlClass: c.exportControlClass } : {}),
        countryOfOrigin: c.countryOfOrigin,
      })),
      buyer: {
        shipToCountry: input.shipToCountry,
        ...(input.shipToSubdivision !== undefined ? { shipToSubdivision: input.shipToSubdivision } : {}),
        ...(input.buyerVerifiedAge !== undefined ? { buyerVerifiedAge: input.buyerVerifiedAge } : {}),
        ...(input.buyerHasLicense !== undefined ? { buyerHasLicense: input.buyerHasLicense } : {}),
        isSanctionedParty: input.isSanctionedParty,
        carriersAvailable: input.carriersAvailable,
      },
      rules: input.rules,
      now: input.now.toISOString(),
    },
    buildCtx(["cart:write"]),
  )) as {
    allowed: boolean;
    results: Array<{
      productId: string;
      listingId: string;
      allowed: boolean;
      reason?: string;
      reasonClass?: "hard" | "recoverable";
    }>;
  };

  // 3) Build the cart from passing lines.
  let cart: CartLine[] = [];
  const blockedLines: PurchaseResult["blockedLines"] = [];
  for (const line of input.candidates) {
    const res = gate.results.find((r) => r.listingId === line.listingId);
    if (!res || !res.allowed) {
      blockedLines.push({
        listingId: line.listingId,
        reason: res?.reason ?? "unknown",
        reasonClass: res?.reasonClass ?? "hard",
      });
      continue;
    }
    cart = addLine(cart, {
      variantId: line.variantId,
      sellerId: line.sellerId,
      qty: line.qty,
      unitPriceMinor: line.unitPriceMinor,
    });
  }

  // 4) Refuse to settle if every line blocked — maps to "checkout cannot proceed".
  if (cart.length === 0) {
    return {
      cart,
      blockedLines,
      settledOrderItems: [],
      reviewOutcome: { posted: false, reason: "no_eligible_cart_lines" },
    };
  }

  // 5) Pseudo-settle. Real surface would persist via the order state machine; the
  // E2E here just produces deterministic order-item rows for the review step.
  const settledOrderItems = cart.map((line, idx) => ({
    orderItemId: `oi-${idx + 1}`,
    productId: input.candidates.find((c) => c.variantId === line.variantId)!.productId,
    settledAt: input.now,
  }));

  // 6) Review one of the settled items.
  const reviewTarget = settledOrderItems[0]!;
  const reviewInput = {
    ...(input.buyerUserId !== undefined ? { reviewerUserId: input.buyerUserId } : {}),
    ...(input.buyerAgentId !== undefined ? { reviewerAgentId: input.buyerAgentId } : {}),
    productId: reviewTarget.productId,
    reviewerSettledItems: settledOrderItems.map((s) => ({
      productId: s.productId,
      orderItemId: s.orderItemId,
      settledAt: s.settledAt.toISOString(),
      outcome: "kept" as const,
    })),
    reviewWindowDays: input.reviewWindowDays,
    existingReviewsOnItem: 0,
    now: input.now.toISOString(),
    body: input.reviewBody,
    rating: input.reviewRating,
    ...(input.reviewSignals
      ? {
          signals: {
            burstCount: input.reviewSignals.burstCount ?? 0,
            burstThreshold: input.reviewSignals.burstThreshold ?? 5,
            incentiveDetected: input.reviewSignals.incentiveDetected ?? false,
            selfReview: input.reviewSignals.selfReview ?? false,
            honeypotEcho: input.reviewSignals.honeypotEcho ?? false,
            ...(input.reviewSignals.linguisticSimilarity !== undefined
              ? { linguisticSimilarity: input.reviewSignals.linguisticSimilarity }
              : {}),
            ...(input.reviewSignals.brandConcentrationBps !== undefined
              ? { brandConcentrationBps: input.reviewSignals.brandConcentrationBps }
              : {}),
          },
        }
      : {}),
  };

  try {
    const review = (await reg.invoke("review.write", reviewInput, buildCtx(["review:write"]))) as {
      moderation: { status: "visible" | "excluded_from_avg" | "suppressed"; suspicionScore: number };
    };
    return {
      cart,
      blockedLines,
      settledOrderItems,
      reviewOutcome: {
        posted: true,
        status: review.moderation.status,
        suspicionScore: review.moderation.suspicionScore,
      },
    };
  } catch (err) {
    return {
      cart,
      blockedLines,
      settledOrderItems,
      reviewOutcome: {
        posted: false,
        reason: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
