// Spend-cap enforcement against agent passports. Spec §3.2.

import { ForbiddenError } from "@marketplace/shared/errors";

export interface SpendCaps {
  currency: string;
  perTxMinor?: bigint;
  perDayMinor?: bigint;
  perMerchantMinor?: bigint;
}

export interface SpendUsage {
  /** Amount already spent in current rolling 24h window. */
  todayMinor: bigint;
  /** Per-merchant usage map (rolling 24h or scoped per the passport policy). */
  perMerchantMinor: Map<string, bigint>;
}

export interface SpendCheckInput {
  caps: SpendCaps;
  usage: SpendUsage;
  amountMinor: bigint;
  currency: string;
  merchantId: string;
}

export function checkSpendCap(input: SpendCheckInput): void {
  if (input.caps.currency !== input.currency) {
    throw new ForbiddenError(`spend_cap_currency_mismatch:${input.caps.currency}!=${input.currency}`);
  }
  if (input.caps.perTxMinor !== undefined && input.amountMinor > input.caps.perTxMinor) {
    throw new ForbiddenError(`spend_cap_per_tx_exceeded:${input.amountMinor}>${input.caps.perTxMinor}`);
  }
  if (
    input.caps.perDayMinor !== undefined &&
    input.usage.todayMinor + input.amountMinor > input.caps.perDayMinor
  ) {
    throw new ForbiddenError(
      `spend_cap_per_day_exceeded:${input.usage.todayMinor + input.amountMinor}>${input.caps.perDayMinor}`,
    );
  }
  const merchantSpend = input.usage.perMerchantMinor.get(input.merchantId) ?? 0n;
  if (
    input.caps.perMerchantMinor !== undefined &&
    merchantSpend + input.amountMinor > input.caps.perMerchantMinor
  ) {
    throw new ForbiddenError(
      `spend_cap_per_merchant_exceeded:${merchantSpend + input.amountMinor}>${input.caps.perMerchantMinor}`,
    );
  }
}

export interface VelocityCheckInput {
  /** Spend over last 30 days, median minor units. */
  rolling30dMedianMinor: bigint;
  /** This transaction in same units. */
  amountMinor: bigint;
  /** Transactions in last hour. */
  txLastHour: number;
  /** Last known location lat/lng (degrees). */
  lastLocation?: { lat: number; lng: number; atMs: number };
  /** Current request location. */
  currentLocation?: { lat: number; lng: number; atMs: number };
}

export interface VelocitySignal {
  anomaly: boolean;
  reasons: string[];
}

export function checkVelocity(input: VelocityCheckInput): VelocitySignal {
  const reasons: string[] = [];
  if (input.rolling30dMedianMinor > 0n && input.amountMinor > input.rolling30dMedianMinor * 3n) {
    reasons.push("amount_3x_median");
  }
  if (input.txLastHour > 10) reasons.push("tx_velocity_10x_per_hour");
  if (input.lastLocation && input.currentLocation) {
    const km = haversineKm(input.lastLocation, input.currentLocation);
    const hours = (input.currentLocation.atMs - input.lastLocation.atMs) / 3_600_000;
    if (hours > 0 && km > 1000 && hours < 1) reasons.push("geo_jump_1000km_under_1h");
  }
  return { anomaly: reasons.length > 0, reasons };
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(x));
}
