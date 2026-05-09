// Full-lifecycle buyer journey crossing every now-wired MCP tool: spend-cap +
// velocity dry-run → restricted-items gate → order state-machine transitions all
// the way through fulfillment → review. Realises SOP 03 + SOP 05 + SOP 12.

import { McpRegistry, type McpContext } from "@marketplace/mcp-server/registry";
import { registerCartTools } from "@marketplace/mcp-server/tools/cart";
import { registerReviewTools } from "@marketplace/mcp-server/tools/review";
import { registerOrderTools } from "@marketplace/mcp-server/tools/order";
import { registerPaymentTools } from "@marketplace/mcp-server/tools/payment";
import { addLine, type CartLine } from "@marketplace/domain/cart/cart";

export type LifecycleOutcome =
  | { stage: "blocked_spend_cap"; reason: string }
  | { stage: "blocked_velocity"; reasons: string[] }
  | { stage: "blocked_restrictions"; blocked: Array<{ listingId: string; reason: string; reasonClass: "hard" | "recoverable" }> }
  | {
      stage: "delivered";
      orderTrace: Array<{ from: string; event: string; to: string }>;
      cart: CartLine[];
      reviewStatus: "visible" | "excluded_from_avg" | "suppressed";
    };

export interface LifecycleInput {
  buyerUserId: string;
  passportId: string;
  /** Spend caps and current usage (rolling 24h). */
  caps: {
    currency: string;
    perTxMinor?: bigint;
    perDayMinor?: bigint;
    perMerchantMinor?: bigint;
  };
  usage: { todayMinor: bigint; perMerchantMinor: Array<[string, bigint]> };
  velocity: {
    rolling30dMedianMinor: bigint;
    txLastHour: number;
    /** Set both `lastLocation` and `currentLocation` to exercise the geo-jump signal. */
    lastLocation?: { lat: number; lng: number; atMs: number };
    currentLocation?: { lat: number; lng: number; atMs: number };
  };
  /** If anomalies are present, the journey aborts with `blocked_velocity` rather than stepping up. */
  abortOnVelocityAnomaly: boolean;
  shipToCountry: string;
  isSanctionedParty: boolean;
  carriersAvailable: Array<{ key: string; prohibitedItems: string[] }>;
  rules: Array<{
    taxonomyKey: string;
    countryCode: string;
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
    registryVersion: string;
  }>;
  candidates: Array<{
    productId: string;
    listingId: string;
    variantId: string;
    sellerId: string;
    unitPriceMinor: bigint;
    qty: number;
    taxonomyKeys: string[];
    isHazmat: boolean;
    isAgeRestricted: boolean;
    countryOfOrigin: string;
  }>;
  reviewWindowDays: number;
  reviewBody: string;
  reviewRating: number;
  now: Date;
}

function buildCtx(scopes: string[]): McpContext {
  return {
    agentId: "agt_buyer",
    passportId: "psp_buyer",
    scopes: new Set(scopes),
    ownerKind: "user",
    ownerId: "usr_buyer",
    requestId: "req-lc",
    now: () => Date.now(),
    emitAudit: async () => {},
  };
}

export async function runFullLifecycle(input: LifecycleInput): Promise<LifecycleOutcome> {
  const reg = new McpRegistry();
  registerPaymentTools(reg);
  registerCartTools(reg);
  registerOrderTools(reg);
  registerReviewTools(reg);

  const totalAmount = input.candidates.reduce(
    (s, c) => s + c.unitPriceMinor * BigInt(c.qty),
    0n,
  );
  const merchantId = input.candidates[0]!.sellerId;

  // 1) Spend-cap dry-run.
  const cap = (await reg.invoke(
    "payment.check_spend_cap",
    {
      passportId: input.passportId,
      caps: input.caps,
      usage: input.usage,
      amountMinor: totalAmount,
      currency: input.caps.currency,
      merchantId,
    },
    buildCtx(["checkout:execute"]),
  )) as { allowed: boolean; reason?: string };
  if (!cap.allowed) {
    return { stage: "blocked_spend_cap", reason: cap.reason ?? "unknown" };
  }

  // 2) Velocity / step-up dry-run.
  const vel = (await reg.invoke(
    "payment.check_velocity",
    {
      passportId: input.passportId,
      rolling30dMedianMinor: input.velocity.rolling30dMedianMinor,
      amountMinor: totalAmount,
      txLastHour: input.velocity.txLastHour,
      ...(input.velocity.lastLocation ? { lastLocation: input.velocity.lastLocation } : {}),
      ...(input.velocity.currentLocation ? { currentLocation: input.velocity.currentLocation } : {}),
    },
    buildCtx(["checkout:execute"]),
  )) as { anomaly: boolean; reasons: string[] };
  if (vel.anomaly && input.abortOnVelocityAnomaly) {
    return { stage: "blocked_velocity", reasons: vel.reasons };
  }

  // 3) Restricted-items gate.
  const gate = (await reg.invoke(
    "cart.check_restrictions",
    {
      lines: input.candidates.map((c) => ({
        productId: c.productId,
        listingId: c.listingId,
        taxonomyKeys: c.taxonomyKeys,
        isHazmat: c.isHazmat,
        isAgeRestricted: c.isAgeRestricted,
        countryOfOrigin: c.countryOfOrigin,
      })),
      buyer: {
        shipToCountry: input.shipToCountry,
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
  if (!gate.allowed) {
    return {
      stage: "blocked_restrictions",
      blocked: gate.results
        .filter((r) => !r.allowed)
        .map((r) => ({
          listingId: r.listingId,
          reason: r.reason ?? "unknown",
          reasonClass: r.reasonClass ?? "hard",
        })),
    };
  }

  // 4) Build cart from passing lines.
  let cart: CartLine[] = [];
  for (const line of input.candidates) {
    cart = addLine(cart, {
      variantId: line.variantId,
      sellerId: line.sellerId,
      qty: line.qty,
      unitPriceMinor: line.unitPriceMinor,
    });
  }

  // 5) Walk the order through the state machine.
  const orderTrace: Array<{ from: string; event: string; to: string }> = [];
  let status = "created";
  const transitions: Array<{ kind: string; reason?: string; refundMinor?: bigint }> = [
    { kind: "authorize" },
    { kind: "capture" },
    { kind: "begin_fulfillment" },
    { kind: "ship" },
    { kind: "deliver" },
  ];
  for (const t of transitions) {
    const out = (await reg.invoke(
      "order.apply_event",
      { orderId: "o-lc", current: status, event: t },
      buildCtx(["order:cancel"]),
    )) as { previous: string; next: string };
    orderTrace.push({ from: out.previous, event: t.kind, to: out.next });
    status = out.next;
  }

  // 6) Submit review.
  const review = (await reg.invoke(
    "review.write",
    {
      reviewerUserId: input.buyerUserId,
      productId: input.candidates[0]!.productId,
      reviewerSettledItems: [
        {
          productId: input.candidates[0]!.productId,
          orderItemId: "oi-1",
          settledAt: input.now.toISOString(),
          outcome: "kept",
        },
      ],
      reviewWindowDays: input.reviewWindowDays,
      existingReviewsOnItem: 0,
      now: input.now.toISOString(),
      body: input.reviewBody,
      rating: input.reviewRating,
    },
    buildCtx(["review:write"]),
  )) as { moderation: { status: "visible" | "excluded_from_avg" | "suppressed" } };

  return { stage: "delivered", orderTrace, cart, reviewStatus: review.moderation.status };
}
