// Result snapshots — spec §8.4.
//
// When an agent calls a catalog tool (read: search/get_product/compare/recommend,
// or write: seller.create_account/product.create_listing) the marketplace freezes
// the exact tool input+output and stores it under a public, unguessable token.
// The MCP response carries `snapshotUrl` pointing at /s/{id} on the web origin
// so the agent can hand the link to a human to verify what was seen or created.
//
// Storage TTL is 24h. Snapshots are immutable; reading after expiry returns 410.

import { randomBytes } from "node:crypto";

export type SnapshotKind =
  | "search"
  | "product"
  | "compare"
  | "recommend"
  | "seller_create"
  | "product_create";

export interface Snapshot {
  id: string;
  kind: SnapshotKind;
  /** Tool input (filters, ids, etc.) — captured for human display. */
  input: unknown;
  /** Frozen tool output exactly as returned to the agent. */
  output: unknown;
  /** Principal who issued the originating request, for audit/debug only. Not used for access control — links are public. */
  principalId?: string;
  agentId?: string;
  createdAt: number;
  expiresAt: number;
}

export interface SnapshotStore {
  put(snap: Snapshot): Promise<void>;
  get(id: string): Promise<Snapshot | null>;
}

export const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

/** 128 bits of entropy, base64url. ~22 chars, URL-safe, unguessable. */
export function newSnapshotId(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * In-memory store for tests and single-process dev. Production wires the
 * Redis-backed implementation (see packages/api/src/repos).
 */
export class MemorySnapshotStore implements SnapshotStore {
  private readonly entries = new Map<string, Snapshot>();
  // Hard upper bound on entry count. Prevents an unbounded-growth scenario
  // when no one ever reads back the snapshots — `get` was the only place
  // expired entries got GC'd previously, so unread expired entries stayed
  // pinned in memory forever. At steady-state traffic of ~10 catalog
  // captures/sec, a 24h TTL produces ~864K entries; the cap forces eviction
  // of the oldest insertion (LRU-by-insertion-order via Map iteration) once
  // the bound is hit, even before TTL elapses. 100K covers test/dev needs
  // comfortably; production uses the Redis-backed store with native TTL.
  private static readonly MAX_ENTRIES = 100_000;
  // Budget for opportunistic GC on each put: walk this many entries from
  // the head of the Map and drop any that have expired. Bounded so a put
  // is always O(1)-ish; full-table GC is the wrong granularity for hot path.
  private static readonly GC_BUDGET = 32;

  constructor(private readonly now: () => number = Date.now) {}

  async put(snap: Snapshot): Promise<void> {
    // Opportunistic expiry sweep. Walks up to GC_BUDGET oldest entries and
    // drops the expired ones. Map iteration is insertion-ordered, so the
    // oldest entries (which are most likely to be expired) come first.
    const now = this.now();
    let budget = MemorySnapshotStore.GC_BUDGET;
    for (const [k, v] of this.entries) {
      if (budget-- <= 0) break;
      if (v.expiresAt <= now) this.entries.delete(k);
    }
    this.entries.set(snap.id, snap);
    // Hard cap fallback: if the store has grown past the bound even after
    // the GC sweep (high write burst), evict the oldest entry (Map keeps
    // insertion order, so .keys().next() is the LRU-by-insertion entry).
    while (this.entries.size > MemorySnapshotStore.MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  async get(id: string): Promise<Snapshot | null> {
    const s = this.entries.get(id);
    if (!s) return null;
    // Fail-closed on Invalid Date/clock — pre-fix `expiresAt <= NaN`
    // evaluated false and a stale snapshot would be returned forever.
    // Also fail-closed if the stored expiresAt is itself non-finite
    // (defense against a stub-typed caller that put() a Snapshot whose
    // type lies about its number field). Same NaN-bypass family closed
    // across the domain.
    const now = this.now();
    if (!Number.isFinite(now) || !Number.isFinite(s.expiresAt) || s.expiresAt <= now) {
      this.entries.delete(id);
      return null;
    }
    return s;
  }
}
