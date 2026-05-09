// Escrow holds for high-risk categories or new sellers.
// Spec §7: held until fulfillment confirmation or release timer; converted to seller payout
// at release. If a counterfeit finding lands during the hold window, the funds are clawed back.

import { ConflictError } from "@marketplace/shared/errors";

export type EscrowStatus = "held" | "released" | "clawed_back" | "in_dispute";

export interface EscrowHold {
  holdId: string;
  orderId: string;
  sellerOrgId: string;
  amountMinor: bigint;
  currency: string;
  reason: "high_risk_category" | "new_seller" | "elevated_counterfeit_risk" | "unverified_kyb";
  releaseAt: Date;
  status: EscrowStatus;
}

export type EscrowEvent =
  | { kind: "release"; at: Date }
  | { kind: "claw_back"; reason: string }
  | { kind: "open_dispute" }
  | { kind: "close_dispute"; favoredSeller: boolean };

export function applyEscrowEvent(hold: EscrowHold, event: EscrowEvent): EscrowHold {
  switch (event.kind) {
    case "release":
      if (hold.status !== "held") throw new ConflictError(`escrow_not_held:${hold.status}`);
      if (event.at < hold.releaseAt) throw new ConflictError("escrow_release_premature");
      return { ...hold, status: "released" };
    case "claw_back":
      if (hold.status !== "held" && hold.status !== "in_dispute") {
        throw new ConflictError(`escrow_not_clawbackable:${hold.status}`);
      }
      return { ...hold, status: "clawed_back" };
    case "open_dispute":
      if (hold.status !== "held") throw new ConflictError(`escrow_not_held:${hold.status}`);
      return { ...hold, status: "in_dispute" };
    case "close_dispute":
      if (hold.status !== "in_dispute") throw new ConflictError(`escrow_not_in_dispute:${hold.status}`);
      return { ...hold, status: event.favoredSeller ? "released" : "clawed_back" };
  }
}

/** Standard release windows by reason. */
export const ESCROW_RELEASE_DAYS: Record<EscrowHold["reason"], number> = {
  high_risk_category: 14,
  new_seller: 30,
  elevated_counterfeit_risk: 21,
  unverified_kyb: 60,
};
