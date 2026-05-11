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
  constructor(private readonly now: () => number = Date.now) {}

  async put(snap: Snapshot): Promise<void> {
    this.entries.set(snap.id, snap);
  }

  async get(id: string): Promise<Snapshot | null> {
    const s = this.entries.get(id);
    if (!s) return null;
    if (s.expiresAt <= this.now()) {
      this.entries.delete(id);
      return null;
    }
    return s;
  }
}
