// Shared helpers for capturing tool-result snapshots and rendering links.
//
// Used by catalog read tools (search/get_product/compare/recommend) and seller
// write tools (seller.create_account, product.create_listing). The web origin
// for snapshot links is taken from MARKETPLACE_WEB_BASE_URL; when unset, the
// helpers return undefined and callers omit snapshot fields from the response.

import { catalog } from "@marketplace/domain";
import type { McpContext } from "../registry.js";

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
}
