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
    // Subscribe BEFORE listing — otherwise a revocation that fires between
    // `list()` returning and `subscribe()` registering would be missed
    // entirely (it isn't in the snapshot, and the handler isn't installed
    // yet to receive the push). A revoked passport silently slipping
    // through the kill-switch is exactly the failure mode this service
    // exists to prevent.
    //
    // Pushes that arrive *during* the initial list() are buffered, then
    // drained into the cache after the snapshot is loaded. Adding the same
    // passport twice (once from the list, once from the buffer) is a safe
    // no-op — cache.add is idempotent on the id.
    const buffer: RevocationEntry[] = [];
    let bootstrapping = true;
    this.unsubscribe = this.store.subscribe((e) => {
      if (bootstrapping) {
        buffer.push(e);
        return;
      }
      this.cache.add(e.passportId, e.revokedAtMs);
      log.info({ passportId: e.passportId }, "revocation_pushed");
    });

    const recent = await this.store.list(0);
    for (const e of recent) this.cache.add(e.passportId, e.revokedAtMs);
    // Drain any pushes that landed during list().
    for (const e of buffer) this.cache.add(e.passportId, e.revokedAtMs);
    bootstrapping = false;
    log.info(
      { loaded: this.cache.size(), drained: buffer.length },
      "revocation_cache_warm",
    );
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
  }

  async isRevoked(passportId: string): Promise<boolean> {
    if (this.cache.has(passportId)) return true;
    // Authoritative recheck for tokens older than 60s — handled by callers' freshness logic.
    const revoked = await this.store.isRevoked(passportId);
    if (revoked) {
      // Promote to cache so subsequent requests for the same revoked
      // passport short-circuit on the in-memory path instead of round-
      // tripping the authoritative store on every request — without this,
      // a revocation that arrives via the authoritative-fallback path
      // (slow propagation of LISTEN/NOTIFY) stays cold forever.
      this.cache.add(passportId, Date.now());
    }
    return revoked;
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
