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

export function decodeCursor(cursor: string | undefined): StableCursor | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<StableCursor>;
    if (typeof parsed.k === "string" && typeof parsed.id === "string") {
      return { k: parsed.k, id: parsed.id };
    }
    return undefined;
  } catch {
    return undefined;
  }
}
