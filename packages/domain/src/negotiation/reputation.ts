// Agent reputation per spec §7a.
// Bayesian-smoothed score with 90-day half-life decay; portable via signed VDC.

import { sign, type KeyObject } from "node:crypto";
import { base64url } from "../identity/dpop.js";

export interface ReputationComponents {
  settledTxCount: number;
  settledValueMinor: bigint;
  disputesAgainst: number;
  chargebackRateBps: number;
  refundRateBps: number;
  cancellationRateBps: number;
  counterpartyAvgBps: number; // 0..10000 of 1.0
  daysOfHistory: number;
}

export interface ReputationScore {
  scoreBps: number; // 0..10000 of 1.0
  insufficientData: boolean;
  components: ReputationComponents;
  lastUpdatedAt: Date;
}

const MIN_TX_FOR_DISPLAY = 10;
const MIN_DAYS_FOR_DISPLAY = 30;
const HALF_LIFE_DAYS = 90;

// Sanity-check the input. The final score is bounded by Math.min/max in
// the return, so junk inputs produce a "plausible" number rather than an
// obvious error — but a negative `disputesAgainst` would mathematically
// INCREASE the observed score (via `Math.min(negative, 4000) = negative`,
// then `10000 - (negative) > 10000`), and a chargeback rate well past
// 10000 bps masks the actual fraud signal under the Math.min cap.
// Surfacing the bad input as a clear NaN-score with insufficientData
// would be one option; for now we clamp at the function boundary so a
// caller passing slightly-noisy data still gets a sensible result, but
// the bounds are explicit and a future audit can grep for them.
function clampNonNeg(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function clampBps(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(10000, n)) : 0;
}

export function computeReputation(c: ReputationComponents, now: Date, lastEventAt: Date): ReputationScore {
  // Defensive clamps. Counterparts of these were previously implicit via
  // Math.min(...) caps on the deductions, but the input shape was unchecked
  // — a NaN `disputesAgainst` propagated NaN through every arithmetic step
  // and `Math.round(Math.max(0, Math.min(10000, NaN)))` came out as `NaN`
  // (Math.min with NaN returns NaN), producing an invalid `scoreBps` field
  // that downstream consumers serialised and persisted.
  const clamped: ReputationComponents = {
    settledTxCount: clampNonNeg(c.settledTxCount),
    settledValueMinor: c.settledValueMinor < 0n ? 0n : c.settledValueMinor,
    disputesAgainst: clampNonNeg(c.disputesAgainst),
    chargebackRateBps: clampBps(c.chargebackRateBps),
    refundRateBps: clampBps(c.refundRateBps),
    cancellationRateBps: clampBps(c.cancellationRateBps),
    counterpartyAvgBps: clampBps(c.counterpartyAvgBps),
    daysOfHistory: clampNonNeg(c.daysOfHistory),
  };
  // Use the clamped values below; the original `c` is preserved in the
  // returned `components` only when it was already in range. Replace c with
  // the clamped copy from here on so the score reflects sanitised input.
  c = clamped;
  const insufficient = c.settledTxCount < MIN_TX_FOR_DISPLAY || c.daysOfHistory < MIN_DAYS_FOR_DISPLAY;

  // Prior: 0.85 reliability with N=20 pseudo-observations (Bayesian smoothing)
  const priorMass = 20;
  const priorMean = 8500;
  const observedScore =
    10000 -
    Math.min(c.disputesAgainst * 200, 4000) -
    Math.min(c.chargebackRateBps, 3000) -
    Math.min(c.refundRateBps / 2, 1000) -
    Math.min(c.cancellationRateBps / 4, 500);
  const blended =
    (priorMean * priorMass + observedScore * c.settledTxCount) / (priorMass + c.settledTxCount);

  // Counterparty rating averaged in (capped influence at 30%)
  const withCounterparty = blended * 0.7 + c.counterpartyAvgBps * 0.3;

  // Time decay since last activity. Reject Invalid Date here so the NaN
  // doesn't propagate through `Math.pow(0.5, NaN/90) → NaN → decayed →
  // scoreBps: NaN` and land a non-numeric score in the result that
  // downstream consumers (signed VDCs, audit storage) serialise. The
  // earlier input-clamp block already sanitised `daysOfHistory`, but the
  // Date arithmetic here is computed at use, not from `c`, so it needed
  // its own guard. Treat "no usable last-event" as "no decay" (the
  // safer of the two: assume fresh, since penalty for inactivity is
  // separately captured by `insufficientData`).
  const nowMs = now.getTime();
  const lastMs = lastEventAt.getTime();
  const daysSinceEvent = Number.isFinite(nowMs) && Number.isFinite(lastMs)
    ? Math.max(0, (nowMs - lastMs) / (24 * 3600 * 1000))
    : 0;
  const decay = Math.pow(0.5, daysSinceEvent / HALF_LIFE_DAYS);
  const decayed = withCounterparty * decay;

  return {
    scoreBps: Math.round(Math.max(0, Math.min(10000, decayed))),
    insufficientData: insufficient,
    components: c,
    lastUpdatedAt: now,
  };
}

export interface ReputationExportPayload {
  agentId: string;
  marketplaceId: string;
  scoreBps: number;
  components: ReputationComponents;
  period: { from: string; to: string };
  expiresAt: number;
  iat: number;
}

export interface SignedReputationExport {
  vdc: string; // JWT
  payload: ReputationExportPayload;
}

export function signReputationExport(
  payload: ReputationExportPayload,
  privateKey: KeyObject,
  kid: string,
): SignedReputationExport {
  const header = { alg: "EdDSA", typ: "agent-reputation-vdc+jwt", kid };
  // BigInt-safe JSON serializer
  const serialize = (v: unknown): unknown =>
    typeof v === "bigint"
      ? v.toString()
      : Array.isArray(v)
        ? v.map(serialize)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, serialize(x)]))
          : v;
  const headerB64 = base64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64url(Buffer.from(JSON.stringify(serialize(payload))));
  const sig = sign(null, Buffer.from(`${headerB64}.${payloadB64}`), privateKey);
  return { vdc: `${headerB64}.${payloadB64}.${base64url(sig)}`, payload };
}
