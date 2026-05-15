// Stable cursor for paginating sorted product lists.
//
// We pin the *last item* shown on the previous page; resuming finds the first
// item strictly after that point in the current sorted view. This survives
// inserts and deletes between fetches: a deleted cursor item still resolves
// (we land at its old position via the saved sort key), and an insert before
// the cursor item never causes us to skip the item we already saw. The
// trade-off is the standard stable-cursor one — items inserted *between* the
// cursor and the next page boundary may surface twice, which is preferable to
// silently skipping.

export interface StableCursor {
  /** String form of the sort key. BigInt prices are stringified. */
  k: string;
  /** Product id used as the deterministic tie-breaker. */
  id: string;
}

export function encodeCursor(c: StableCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

// Cursors we issue are ~100B (small sort key + UUID + JSON braces, base64url'd).
// Cap at 1KB so a malicious client can't submit a multi-megabyte "cursor" that
// the server happily JSON.parses (CPU + heap waste). Anything over the cap is
// not a cursor we produced; treat it as a malformed first-page request.
const MAX_CURSOR_LEN = 1024;
// Sort key and id sub-fields likewise bounded. The largest legitimate `k` is a
// BigInt price as a decimal string — 128 chars is comfortable headroom past
// any conceivable retail/stablecoin amount. The `id` is a UUID-like string.
const MAX_K_LEN = 128;
const MAX_ID_LEN = 128;

export function decodeCursor(cursor: string | undefined): StableCursor | undefined {
  if (!cursor) return undefined;
  if (cursor.length > MAX_CURSOR_LEN) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<StableCursor>;
    if (
      typeof parsed.k === "string" &&
      typeof parsed.id === "string" &&
      parsed.k.length <= MAX_K_LEN &&
      parsed.id.length <= MAX_ID_LEN
    ) {
      return { k: parsed.k, id: parsed.id };
    }
    return undefined;
  } catch {
    return undefined;
  }
}
