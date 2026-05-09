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

export function computeReputation(c: ReputationComponents, now: Date, lastEventAt: Date): ReputationScore {
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

  // Time decay since last activity
  const daysSinceEvent = Math.max(0, (now.getTime() - lastEventAt.getTime()) / (24 * 3600 * 1000));
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
