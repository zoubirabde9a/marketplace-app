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
      // Reject an Invalid Date for `event.at` explicitly. JS Date comparison
      // with `<` coerces to numbers, and `Invalid Date.getTime() === NaN`
      // makes `event.at < hold.releaseAt` evaluate to `false` — so a caller
      // passing `new Date("not-a-date")` would silently bypass the
      // release-premature guard and release the hold immediately. Same
      // NaN-exemption pattern as the velocity / review-window fixes
      // (passes #93 / #120).
      if (!Number.isFinite(event.at.getTime())) {
        throw new ConflictError("escrow_release_at_invalid");
      }
      if (event.at < hold.releaseAt) throw new ConflictError("escrow_release_premature");
      return { ...hold, status: "released" };
    case "claw_back":
      if (hold.status !== "held" && hold.status !== "in_dispute") {
        throw new ConflictError(`escrow_not_clawbackable:${hold.status}`);
      }
      if (event.reason.length === 0) {
        throw new ConflictError("escrow_clawback_reason_required");
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

/**
 * Derive the standard releaseAt for a hold reason starting at `now`. Lets
 * callers stop computing `now + N * 24 * 3600 * 1000` ad-hoc — every escrow
 * write surface (REST, MCP, the dispute-resolution path) now goes through one
 * source of truth, so a window change here propagates everywhere.
 */
export function computeReleaseAt(reason: EscrowHold["reason"], now: Date): Date {
  return new Date(now.getTime() + ESCROW_RELEASE_DAYS[reason] * 24 * 3600 * 1000);
}

/**
 * Read-only predicate: does the event apply cleanly given the current hold
 * state? Lets agents/UIs preview which transitions are available without
 * try/catching applyEscrowEvent — the order state machine has the same
 * parity (canTransition / allowed_events).
 */
export function canApplyEscrowEvent(
  hold: EscrowHold,
  eventKind: EscrowEvent["kind"],
  at?: Date,
): boolean {
  switch (eventKind) {
    case "release":
      if (hold.status !== "held") return false;
      if (at !== undefined && at < hold.releaseAt) return false;
      return true;
    case "claw_back":
      return hold.status === "held" || hold.status === "in_dispute";
    case "open_dispute":
      return hold.status === "held";
    case "close_dispute":
      return hold.status === "in_dispute";
  }
}

/** Enumerate every event kind that would currently apply cleanly. */
export function allowedEscrowEventKinds(
  hold: EscrowHold,
  at?: Date,
): ReadonlyArray<EscrowEvent["kind"]> {
  const all: ReadonlyArray<EscrowEvent["kind"]> = [
    "release",
    "claw_back",
    "open_dispute",
    "close_dispute",
  ];
  return all.filter((k) => canApplyEscrowEvent(hold, k, at));
}
