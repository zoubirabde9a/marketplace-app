// Redis-backed SnapshotStore — spec §8.4.
//
// Snapshots are write-once, expire after 24h via Redis EX. We serialise as
// JSON. Bigints are converted to strings inline because the MCP transport
// stringifies them on the wire (transport.ts) — but the snapshot captures
// the tool INPUT pre-serialization, which can still carry bigints from a
// Zod schema's coercion (e.g. price-range filters). Without the replacer
// the raw JSON.stringify would throw `Do not know how to serialize a
// BigInt` and the entire tool call would fail.

import { Redis } from "ioredis";
import { catalog } from "@marketplace/domain";

const KEY_PREFIX = "snap:";

const bigintAwareReplacer = (_key: string, value: unknown): unknown =>
  typeof value === "bigint" ? value.toString() : value;

// Allow-list of valid Snapshot.kind values. Matches the domain
// `SnapshotKind` union exactly. Validating against this set keeps a junk
// row at the snap:* key (manual Redis edit, key-prefix collision with a
// future subsystem, hand-edited debug content) from surfacing as a
// "valid" snapshot to the public /v1/snapshots/:id route — clients
// downstream switch on `kind` to render the snapshot view, so an
// unknown kind that the shape check passed would either crash the
// renderer or be silently treated as the default fallback.
const VALID_SNAPSHOT_KINDS: ReadonlySet<string> = new Set([
  "search",
  "product",
  "compare",
  "recommend",
  "seller_create",
  "product_create",
]);

function isSnapshotShape(v: unknown): v is catalog.Snapshot {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s["id"] === "string" &&
    typeof s["kind"] === "string" &&
    VALID_SNAPSHOT_KINDS.has(s["kind"] as string) &&
    typeof s["createdAt"] === "number" &&
    Number.isFinite(s["createdAt"]) &&
    typeof s["expiresAt"] === "number" &&
    Number.isFinite(s["expiresAt"])
  );
}

export class RedisSnapshotStore implements catalog.SnapshotStore {
  constructor(private readonly redis: Redis) {}

  async put(snap: catalog.Snapshot): Promise<void> {
    // Validate id shape before composing the Redis key. Pre-fix the
    // caller's type was trusted — a non-ASCII id (or one containing the
    // `:` delimiter we use as a key-prefix separator) would compose a
    // junk key like `snap:foo:bar` that the get() path can't address
    // back, leaving an orphan entry sitting in Redis until TTL. The
    // route-side regex `^[A-Za-z0-9_-]{16,64}$` is the contract; enforce
    // it at the store boundary too. Same id format as `newSnapshotId`
    // (base64url 16-byte → 22-char) produces.
    // Allow-list alphanumeric + `_` + `-`. Length range covers both
    // production ids (newSnapshotId produces 22-char base64url) and
    // shorter test fixtures. The route handler enforces the tighter
    // `{16,64}` minimum at the public-read boundary.
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(snap.id)) {
      throw new Error("snapshot_id_invalid");
    }
    // Reject non-finite expiresAt — Math.floor(NaN) = NaN and Redis
    // rejects NaN EX values with a confusing driver error. Force a
    // bounded positive TTL.
    if (!Number.isFinite(snap.expiresAt)) {
      throw new Error("snapshot_expires_at_invalid");
    }
    const ttlSec = Math.max(1, Math.floor((snap.expiresAt - Date.now()) / 1000));
    await this.redis.set(
      KEY_PREFIX + snap.id,
      JSON.stringify(snap, bigintAwareReplacer),
      "EX",
      ttlSec,
    );
  }

  async get(id: string): Promise<catalog.Snapshot | null> {
    const raw = await this.redis.get(KEY_PREFIX + id);
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Corrupt JSON at this key (manual edit, mixed-key collision,
      // partial write). Treat as missing rather than crashing the
      // public /v1/snapshots/:id route with an uncaught SyntaxError.
      return null;
    }
    // Defensive shape validation. A snapshot that fails the structural
    // check is junk (wrong key collision, prefix overlap with another
    // subsystem, hand-edited debug content) — refuse rather than
    // pretending it's a valid snapshot for downstream consumers.
    if (!isSnapshotShape(parsed)) return null;
    return parsed;
  }
}
