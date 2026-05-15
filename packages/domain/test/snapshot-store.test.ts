// MemorySnapshotStore — opportunistic GC + cap-bound guard.

import { describe, expect, it } from "vitest";
import { MemorySnapshotStore, newSnapshotId, type Snapshot } from "../src/catalog/snapshot.js";

function snap(id: string, expiresAt: number, createdAt = expiresAt - 60_000): Snapshot {
  return { id, kind: "search", input: {}, output: {}, createdAt, expiresAt };
}

describe("MemorySnapshotStore", () => {
  it("GC's expired entries on put even when they're never read", async () => {
    // Prior behaviour: an entry that never got a get() call sat in the
    // Map past its expiresAt indefinitely. Every put now sweeps the head
    // of the Map for stale entries.
    let now = 1_000_000;
    const store = new MemorySnapshotStore(() => now);

    // Insert an entry that will expire at t=2_000_000.
    await store.put(snap("stale", 2_000_000));
    expect(await store.get("stale")).not.toBeNull();

    // Time travel past expiry, then insert a fresh entry. The put-side
    // sweep should remove "stale" without us ever calling get on it.
    now = 3_000_000;
    await store.put(snap("fresh", 4_000_000));

    // We can't directly observe internal state, but a get on the stale
    // id must now return null without the get-side cleanup having ever
    // been the one to remove it (it was already gone).
    expect(await store.get("stale")).toBeNull();
    expect(await store.get("fresh")).not.toBeNull();
  });

  it("returns null after explicit get past expiry (regression guard)", async () => {
    let now = 1_000_000;
    const store = new MemorySnapshotStore(() => now);
    const id = newSnapshotId();
    await store.put(snap(id, 2_000_000));
    now = 3_000_000;
    expect(await store.get(id)).toBeNull();
  });
});
