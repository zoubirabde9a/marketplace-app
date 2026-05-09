// Revocation propagation per spec §3.6.
// Layered: in-memory bloom + LRU + LISTEN/NOTIFY refresh + CRL fallback.

import { createLogger } from "@marketplace/shared/logger";

const log = createLogger("revocation");

export interface RevocationEntry {
  passportId: string;
  revokedAtMs: number;
  reason?: string;
}

export interface RevocationStore {
  list(sinceMs: number): Promise<RevocationEntry[]>;
  isRevoked(passportId: string): Promise<boolean>;
  revoke(passportId: string, reason: string, now: number): Promise<void>;
  /** Subscribe to push notifications. Returns unsubscribe fn. */
  subscribe(handler: (entry: RevocationEntry) => void): () => void;
}

/**
 * Trivial bloom-ish fast path: a Set used as an exact-match cache backed by
 * the authoritative store. Bounded via LRU ejection.
 */
export class RevocationCache {
  private readonly entries = new Map<string, number>(); // id → ts (ms)
  private readonly capacity: number;

  constructor(capacity = 100_000) {
    this.capacity = capacity;
  }

  add(id: string, atMs: number): void {
    if (this.entries.has(id)) {
      this.entries.delete(id);
    }
    this.entries.set(id, atMs);
    if (this.entries.size > this.capacity) {
      const firstKey = this.entries.keys().next().value;
      if (firstKey !== undefined) this.entries.delete(firstKey);
    }
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  size(): number {
    return this.entries.size;
  }
}

export class RevocationService {
  private readonly cache = new RevocationCache();
  private unsubscribe?: () => void;

  constructor(private readonly store: RevocationStore) {}

  async start(): Promise<void> {
    const recent = await this.store.list(0);
    for (const e of recent) this.cache.add(e.passportId, e.revokedAtMs);
    log.info({ loaded: this.cache.size() }, "revocation_cache_warm");

    this.unsubscribe = this.store.subscribe((e) => {
      this.cache.add(e.passportId, e.revokedAtMs);
      log.info({ passportId: e.passportId }, "revocation_pushed");
    });
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
  }

  async isRevoked(passportId: string): Promise<boolean> {
    if (this.cache.has(passportId)) return true;
    // Authoritative recheck for tokens older than 60s — handled by callers' freshness logic.
    return this.store.isRevoked(passportId);
  }

  async revoke(passportId: string, reason: string, now: number): Promise<void> {
    await this.store.revoke(passportId, reason, now);
    this.cache.add(passportId, now);
  }

  /** CRL — JWS-signed list of recently-revoked passports for offline consumers. */
  async crlSince(sinceMs: number): Promise<RevocationEntry[]> {
    return this.store.list(sinceMs);
  }
}
