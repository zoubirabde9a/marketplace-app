// Human-friendly public order numbers: MP-YYMMDD-XXXXXX (Crockford base32 random).
// Independent of the UUIDv7 internal id; both stored on the orders row.

import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford — no I, L, O, U

export function generatePublicNumber(at: Date = new Date()): string {
  // Fail-loud on Invalid Date. Pre-fix `at.getUTCFullYear() = NaN` and
  // `NaN.toString().padStart(2, "0") = "NaN"` produced a malformed
  // public number like `MP-NaNNaNNaN-XXXXXX` that the regex (and any
  // caller reading the column) would reject — but only AFTER the order
  // row was already inserted with the bad value. Throw at the boundary
  // so the caller's transaction fails cleanly instead of writing junk.
  if (!Number.isFinite(at.getTime())) {
    throw new RangeError("generatePublicNumber:invalid_date");
  }
  const yy = (at.getUTCFullYear() % 100).toString().padStart(2, "0");
  const mm = (at.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = at.getUTCDate().toString().padStart(2, "0");
  const random = encodeBase32(randomBytes(4)).slice(0, 6);
  return `MP-${yy}${mm}${dd}-${random}`;
}

function encodeBase32(buf: Buffer): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 0x1f];
  return out;
}

export const PUBLIC_NUMBER_REGEX = /^MP-\d{6}-[0-9A-HJKMNP-TV-Z]{6}$/;
