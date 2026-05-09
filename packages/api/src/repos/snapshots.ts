// Redis-backed SnapshotStore — spec §8.4.
//
// Snapshots are write-once, expire after 24h via Redis EX. We serialise as
// JSON; bigints are not part of catalog tool outputs (priceMinor is already
// stringified by the MCP layer) so plain JSON.stringify is sufficient.

import { Redis } from "ioredis";
import { catalog } from "@marketplace/domain";

const KEY_PREFIX = "snap:";

export class RedisSnapshotStore implements catalog.SnapshotStore {
  constructor(private readonly redis: Redis) {}

  async put(snap: catalog.Snapshot): Promise<void> {
    const ttlSec = Math.max(1, Math.floor((snap.expiresAt - Date.now()) / 1000));
    await this.redis.set(KEY_PREFIX + snap.id, JSON.stringify(snap), "EX", ttlSec);
  }

  async get(id: string): Promise<catalog.Snapshot | null> {
    const raw = await this.redis.get(KEY_PREFIX + id);
    if (!raw) return null;
    return JSON.parse(raw) as catalog.Snapshot;
  }
}
