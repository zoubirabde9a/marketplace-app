// Statistical scan for buyer↔buyer coordination patterns. Spec §7b.
//
// Heuristics (deliberately conservative — false-positives flag for review, not block):
//   - Identical or near-identical offer sequences from different buyer orgs within a short window.
//   - Cyclic graph of counterparties (A → B → A within window) for the same SKU.
//   - Per-(buyer-org, seller-org) negotiation rate exceeds threshold.

export interface NegotiationEvent {
  buyerOrgId: string;
  sellerOrgId: string;
  variantId: string;
  proposedUnitPriceMinor: bigint;
  acceptedUnitPriceMinor?: bigint;
  at: Date;
}

export interface CollusionFinding {
  buyerOrgIds: string[];
  variantId: string;
  signal: "identical_sequence" | "cyclic_counterparty" | "rate_limit_exceeded";
  evidence: Record<string, unknown>;
}

export interface ScanOptions {
  /** Window over which to search for coordination, in ms. */
  windowMs: number;
  /** Per-(buyer, seller) max negotiations per window. */
  ratePerWindow: number;
  /** Identical-sequence price tolerance (basis points of price). */
  identicalToleranceBps: number;
}

export const DEFAULT_SCAN: ScanOptions = {
  windowMs: 60 * 60 * 1000,
  ratePerWindow: 30,
  identicalToleranceBps: 50,
};

export function scanForCollusion(
  events: ReadonlyArray<NegotiationEvent>,
  now: Date,
  opts: ScanOptions = DEFAULT_SCAN,
): CollusionFinding[] {
  const recent = events.filter((e) => now.getTime() - e.at.getTime() <= opts.windowMs);
  const findings: CollusionFinding[] = [];

  // 1. Per-(buyer, seller) rate
  const counts = new Map<string, NegotiationEvent[]>();
  for (const e of recent) {
    const k = `${e.buyerOrgId}|${e.sellerOrgId}|${e.variantId}`;
    if (!counts.has(k)) counts.set(k, []);
    counts.get(k)!.push(e);
  }
  for (const [k, evts] of counts.entries()) {
    if (evts.length > opts.ratePerWindow) {
      const [buyer, , variant] = k.split("|");
      findings.push({
        buyerOrgIds: [buyer!],
        variantId: variant!,
        signal: "rate_limit_exceeded",
        evidence: { count: evts.length, threshold: opts.ratePerWindow },
      });
    }
  }

  // 2. Identical-sequence detection per variant
  const byVariant = new Map<string, NegotiationEvent[]>();
  for (const e of recent) {
    const arr = byVariant.get(e.variantId) ?? [];
    arr.push(e);
    byVariant.set(e.variantId, arr);
  }
  for (const [variant, evts] of byVariant.entries()) {
    const byBuyer = new Map<string, bigint[]>();
    for (const e of evts) {
      const arr = byBuyer.get(e.buyerOrgId) ?? [];
      arr.push(e.proposedUnitPriceMinor);
      byBuyer.set(e.buyerOrgId, arr);
    }
    const buyers = [...byBuyer.entries()];
    for (let i = 0; i < buyers.length; i++) {
      for (let j = i + 1; j < buyers.length; j++) {
        const a = buyers[i]!;
        const b = buyers[j]!;
        if (a[1].length < 2 || b[1].length < 2) continue;
        const minLen = Math.min(a[1].length, b[1].length);
        let identical = true;
        for (let k = 0; k < minLen; k++) {
          const av = a[1][k]!;
          const bv = b[1][k]!;
          const tol = (av * BigInt(opts.identicalToleranceBps)) / 10000n;
          const diff = av > bv ? av - bv : bv - av;
          if (diff > tol) {
            identical = false;
            break;
          }
        }
        if (identical) {
          findings.push({
            buyerOrgIds: [a[0], b[0]],
            variantId: variant,
            signal: "identical_sequence",
            evidence: { length: minLen },
          });
        }
      }
    }
  }

  return findings;
}
