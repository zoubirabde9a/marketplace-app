// Shared helpers for capturing tool-result snapshots and rendering links.
//
// Used by catalog read tools (search/get_product/compare/recommend) and seller
// write tools (seller.create_account, product.create_listing). The web origin
// for snapshot links is taken from MARKETPLACE_WEB_BASE_URL; when unset, the
// helpers return undefined and callers omit snapshot fields from the response.

import { catalog } from "@marketplace/domain";
import { createLogger } from "@marketplace/shared/logger";
import type { McpContext } from "../registry.js";

const log = createLogger("mcp-snapshots");

export function webBase(): string | null {
  const v = process.env.MARKETPLACE_WEB_BASE_URL;
  return v ? v.replace(/\/$/, "") : null;
}

export function snapshotWebUrl(id: string): string | undefined {
  const base = webBase();
  return base ? `${base}/s/${id}` : undefined;
}

export async function captureSnapshot(
  store: catalog.SnapshotStore | undefined,
  ctx: McpContext,
  kind: catalog.SnapshotKind,
  input: unknown,
  output: unknown,
): Promise<{ id: string; createdAt: number; expiresAt: number } | null> {
  if (!store) return null;
  const id = catalog.newSnapshotId();
  const createdAt = ctx.now();
  const expiresAt = createdAt + catalog.SNAPSHOT_TTL_MS;
  // Snapshots are observational — losing one breaks the audit trail for that
  // call, not the call itself. A snapshot-store outage (Redis down, disk full)
  // must NOT take down search/checkout/listing-create. Log + return null so
  // the tool response just omits the snapshot fields.
  try {
    await store.put({
      id,
      kind,
      input,
      output,
      principalId: ctx.ownerId,
      agentId: ctx.agentId,
      createdAt,
      expiresAt,
    });
    return { id, createdAt, expiresAt };
  } catch (err) {
    log.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        kind,
        agentId: ctx.agentId,
        requestId: ctx.requestId,
      },
      "snapshot_capture_failed",
    );
    return null;
  }
}
