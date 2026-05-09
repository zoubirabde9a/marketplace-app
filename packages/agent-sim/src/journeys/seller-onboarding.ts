// In-process seller onboarding journey realising scenarios/01-seller-onboarding.md
// step 5 (create_product) plus the cross-link with scenarios/11-counterfeit-handling.md
// (risk score on a fresh seller). Crosses the MCP `seller.preview_listing` and
// `catalog.score_counterfeit` tools end-to-end.

import { McpRegistry, type McpContext } from "@marketplace/mcp-server/registry";
import { registerSellerTools } from "@marketplace/mcp-server/tools/seller";
import { registerRiskTools } from "@marketplace/mcp-server/tools/risk";

export interface DraftListing {
  sellerOrgId: string;
  title: string;
  description?: string;
  attributes: Record<string, string>;
  /** Counterfeit-signal context that the catalog risk job would normally compute. */
  brandRegistryMismatch: boolean;
  priceVsAuthorizedFloorBps?: number;
  imageHashHits: number;
  descriptionAnomalies: number;
}

export interface SellerProfile {
  sellerOrgId: string;
  sellerAgeDays: number;
  sellerReputationBps?: number;
}

export interface OnboardingInput {
  seller: SellerProfile;
  listing: DraftListing;
}

export type ListingDecision =
  | { decision: "auto_publish"; risk: "low" }
  | { decision: "moderation_queue"; reasons: string[]; risk: "low" | "elevated" }
  | { decision: "review_block"; reasons: string[]; risk: "low" | "elevated" | "high" };

export interface OnboardingResult {
  /** The sanitised wrapped listing — what downstream catalog services would see. */
  sanitised: {
    title: { value: string; sanitized?: boolean; truncated?: boolean };
    description?: { value: string; sanitized?: boolean; truncated?: boolean };
    attributeKeys: string[];
  };
  routing: "auto_publish" | "moderation_queue" | "review_block";
  suspicionScore: number;
  riskBand: "low" | "elevated" | "high";
  riskScore: number;
  payoutHeld: boolean;
  reviewSlaHours?: number;
  /** The combined publish decision once both gates have run. */
  decision: ListingDecision;
}

function buildCtx(scopes: string[]): McpContext {
  return {
    agentId: "agt_seller",
    passportId: "psp_seller",
    scopes: new Set(scopes),
    ownerKind: "org",
    ownerId: "org_seller",
    requestId: "req-onboard",
    now: () => Date.now(),
    emitAudit: async () => {},
  };
}

export async function runSellerOnboarding(input: OnboardingInput): Promise<OnboardingResult> {
  const reg = new McpRegistry();
  registerSellerTools(reg);
  registerRiskTools(reg);

  // 1) Run the listing through the untrusted-content envelope.
  const preview = (await reg.invoke(
    "seller.preview_listing",
    {
      sellerOrgId: input.listing.sellerOrgId,
      title: input.listing.title,
      ...(input.listing.description !== undefined ? { description: input.listing.description } : {}),
      attributes: input.listing.attributes,
    },
    buildCtx(["seller:product:write"]),
  )) as {
    title: { value: string; sanitized?: boolean; truncated?: boolean };
    description?: { value: string; sanitized?: boolean; truncated?: boolean };
    attributes: Record<string, unknown>;
    flagged: boolean;
    suspicionScore: number;
    routing: "auto_publish" | "moderation_queue" | "review_block";
  };

  // 2) Run the same listing through the counterfeit risk model.
  const score = (await reg.invoke(
    "catalog.score_counterfeit",
    {
      listingId: `tmp-${input.listing.sellerOrgId}`,
      signals: {
        brandRegistryMismatch: input.listing.brandRegistryMismatch,
        ...(input.listing.priceVsAuthorizedFloorBps !== undefined
          ? { priceVsAuthorizedFloorBps: input.listing.priceVsAuthorizedFloorBps }
          : {}),
        sellerAgeDays: input.seller.sellerAgeDays,
        ...(input.seller.sellerReputationBps !== undefined
          ? { sellerReputationBps: input.seller.sellerReputationBps }
          : {}),
        imageHashHits: input.listing.imageHashHits,
        descriptionAnomalies: input.listing.descriptionAnomalies,
      },
    },
    buildCtx(["catalog:read"]),
  )) as {
    risk: "low" | "elevated" | "high";
    score: number;
    actions: { visible: boolean; payoutHeld: boolean; reviewSlaHours?: number };
  };

  // 3) Combine the two decisions. The strictest one wins:
  //   - Either gate at "review_block" / "high" → review_block.
  //   - Otherwise either at "moderation_queue" / "elevated" → moderation_queue.
  //   - Otherwise auto_publish.
  const reasons: string[] = [];
  if (preview.flagged) reasons.push("listing_text_flagged");
  if (score.risk === "elevated") reasons.push("counterfeit_risk_elevated");
  if (score.risk === "high") reasons.push("counterfeit_risk_high");
  if (preview.suspicionScore >= 60) reasons.push("listing_text_suspicion_high");

  let decision: ListingDecision;
  let routing: "auto_publish" | "moderation_queue" | "review_block";
  if (preview.routing === "review_block" || score.risk === "high") {
    routing = "review_block";
    decision = { decision: "review_block", reasons, risk: score.risk };
  } else if (preview.routing === "moderation_queue" || score.risk === "elevated") {
    routing = "moderation_queue";
    decision = {
      decision: "moderation_queue",
      reasons,
      risk: score.risk,
    };
  } else {
    routing = "auto_publish";
    decision = { decision: "auto_publish", risk: "low" };
  }

  return {
    sanitised: {
      title: preview.title,
      ...(preview.description ? { description: preview.description } : {}),
      attributeKeys: Object.keys(preview.attributes),
    },
    routing,
    suspicionScore: preview.suspicionScore,
    riskBand: score.risk,
    riskScore: score.score,
    payoutHeld: score.actions.payoutHeld,
    ...(score.actions.reviewSlaHours !== undefined ? { reviewSlaHours: score.actions.reviewSlaHours } : {}),
    decision,
  };
}
