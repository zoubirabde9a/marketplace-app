// Algerian phone-number normalization to E.164 (+213XXXXXXXXX).
//
// Algerian numbers are 9 digits after the country code (213). The leading
// "subscriber" digit indicates network class:
//   5, 6, 7  → mobile (most listings)
//   2, 3, 4  → fixed line (governorate-coded)
// In national notation Algerians write the same number with a leading 0:
// "0556 68 51 95" ⇄ "+213 556 68 51 95".
//
// We accept the messy real-world inputs Ouedkniss returns — mixed E.164,
// national form, and strings with spaces/dashes/parens — and produce one
// canonical form so downstream code (DB unique index, WhatsApp deep-links,
// tel: hrefs) can compare and link safely.
//
// Anything we can't confidently map to a 9-digit DZ subscriber number
// returns undefined. We do NOT accept arbitrary international numbers
// because (a) the dataset is Algeria-only and (b) silently passing through
// a malformed foreign string would defeat the canonicalization.

const DZ_SUBSCRIBER = /^[2-7]\d{8}$/;

export function normalizeAlgerianPhone(input: string | null | undefined): string | undefined {
  if (input == null) return undefined;
  const raw = String(input).trim();
  if (!raw) return undefined;

  // Strip everything that isn't a digit or a leading '+'. Algerian listings
  // commonly include spaces, dashes, dots, and parentheses.
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (!cleaned) return undefined;

  let digits: string;
  if (cleaned.startsWith("+213")) {
    digits = cleaned.slice(4);
  } else if (cleaned.startsWith("+")) {
    // Some other country code — out of scope.
    return undefined;
  } else if (cleaned.startsWith("00213")) {
    digits = cleaned.slice(5);
  } else if (cleaned.startsWith("213") && cleaned.length === 12) {
    digits = cleaned.slice(3);
  } else if (cleaned.startsWith("0") && cleaned.length === 10) {
    digits = cleaned.slice(1);
  } else if (cleaned.length === 9) {
    digits = cleaned;
  } else {
    return undefined;
  }

  if (!DZ_SUBSCRIBER.test(digits)) return undefined;
  return `+213${digits}`;
}

// Render an E.164 Algerian number in the local national format buyers
// recognise: "+213556685195" → "0556 68 51 95". Falls back to the input
// for non-Algerian or unparseable values.
export function formatAlgerianPhoneNational(e164: string | null | undefined): string {
  if (!e164) return "";
  if (!e164.startsWith("+213")) return e164;
  const d = e164.slice(4);
  if (d.length !== 9) return e164;
  return `0${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`;
}
