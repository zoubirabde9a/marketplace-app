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
  // Fail-loud on Invalid Date for `now`. Pre-fix `now.getTime() = NaN`
  // made `NaN - e.at.getTime() <= windowMs` evaluate `false` for every
  // event → `recent` was always empty → the scan returned `[]` with no
  // findings, silently exempting the entire run from collusion
  // detection. Treat a broken clock as a hard error rather than a
  // quiet pass — the caller (job runner / oncall tool) should surface
  // the bug, not get a clean "all good" report.
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError("scanForCollusion:now_invalid");
  }
  // Skip per-event NaN at.getTime() rather than crashing — those events
  // are ill-formed but the scan should still examine the others.
  const recent = events.filter((e) => {
    const atMs = e.at.getTime();
    if (!Number.isFinite(atMs)) return false;
    return now.getTime() - atMs <= opts.windowMs;
  });
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

  // 2. Identical-sequence detection per variant. Sort each buyer's price
  //    series in submission order first — the caller might pass `events`
  //    in any order (DB results, async ingest), and comparing arbitrary-
  //    order arrays would produce spurious matches OR miss real ones.
  const byVariant = new Map<string, NegotiationEvent[]>();
  for (const e of recent) {
    const arr = byVariant.get(e.variantId) ?? [];
    arr.push(e);
    byVariant.set(e.variantId, arr);
  }
  for (const [variant, evts] of byVariant.entries()) {
    const byBuyer = new Map<string, NegotiationEvent[]>();
    for (const e of evts) {
      const arr = byBuyer.get(e.buyerOrgId) ?? [];
      arr.push(e);
      byBuyer.set(e.buyerOrgId, arr);
    }
    // Sort each buyer's events by time so identical-sequence comparison is
    // order-independent for the caller.
    for (const arr of byBuyer.values()) {
      arr.sort((x, y) => x.at.getTime() - y.at.getTime());
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
          const av = a[1][k]!.proposedUnitPriceMinor;
          const bv = b[1][k]!.proposedUnitPriceMinor;
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

    // 3. Cyclic-counterparty detection. Two distinct buyer orgs taking turns
    //    on the same variant within the window (A_1 < B_1 < A_2 …) suggests
    //    coordinated price probing — one tests the seller's floor, the
    //    other re-checks the response. Pre-fix this signal type existed in
    //    the CollusionFinding union but was never emitted; the interface
    //    promised a heuristic that didn't run.
    //
    //    Heuristic: for each pair of buyer orgs on the same variant, count
    //    the number of times their event streams alternate (a buyer-A event
    //    followed by a buyer-B event followed by another buyer-A event).
    //    Two or more such "A→B→A" sandwiches in the window is a real signal;
    //    a single one could be coincidence.
    for (let i = 0; i < buyers.length; i++) {
      for (let j = i + 1; j < buyers.length; j++) {
        const a = buyers[i]!;
        const b = buyers[j]!;
        // Need at least 2 events from one and 1 from the other to form a sandwich.
        if (a[1].length < 1 || b[1].length < 1) continue;
        // Build a time-ordered, role-tagged sequence of just these two buyers' events.
        const merged = [
          ...a[1].map((e) => ({ at: e.at, who: "A" as const })),
          ...b[1].map((e) => ({ at: e.at, who: "B" as const })),
        ].sort((x, y) => x.at.getTime() - y.at.getTime());
        let alternations = 0;
        for (let k = 2; k < merged.length; k++) {
          // A→B→A or B→A→B
          if (merged[k - 2]!.who === merged[k]!.who && merged[k - 1]!.who !== merged[k]!.who) {
            alternations += 1;
          }
        }
        if (alternations >= 2) {
          findings.push({
            buyerOrgIds: [a[0], b[0]],
            variantId: variant,
            signal: "cyclic_counterparty",
            evidence: { alternations, eventsA: a[1].length, eventsB: b[1].length },
          });
        }
      }
    }
  }

  return findings;
}
