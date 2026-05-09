// Pricing arrives as minor-unit strings (BigInt-serialized). Format defensively:
// callers pass `priceMinor`, `priceFromMinor`, or `priceToMinor` and a currency.

const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "HUF", "TWD"]);

export function minorToMajor(minor: string | number | bigint | null | undefined, currency: string): number | null {
  if (minor == null) return null;
  const n = typeof minor === "bigint" ? Number(minor) : typeof minor === "string" ? Number(minor) : minor;
  if (!Number.isFinite(n)) return null;
  const exp = ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
  return n / 10 ** exp;
}

export function formatPrice(minor: string | number | bigint | null | undefined, currency: string | null | undefined, locale = "en-US"): string {
  if (minor == null || !currency) return "—";
  const major = minorToMajor(minor, currency);
  if (major == null) return "—";
  const isZeroDecimal = ZERO_DECIMAL.has(currency.toUpperCase());
  const isWhole = !isZeroDecimal && Number.isInteger(major);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: isZeroDecimal ? 0 : 2,
      minimumFractionDigits: isZeroDecimal || isWhole ? 0 : 2,
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency}`;
  }
}

export function formatPriceRange(
  fromMinor: string | null | undefined,
  toMinor: string | null | undefined,
  currency: string | null | undefined,
): string {
  if (!currency) return "—";
  if (fromMinor && toMinor && fromMinor !== toMinor) {
    return `${formatPrice(fromMinor, currency)} – ${formatPrice(toMinor, currency)}`;
  }
  return formatPrice(fromMinor ?? toMinor, currency);
}

export function formatRating(rating?: number | null, count?: number | null): string {
  if (rating == null) return "No reviews yet";
  const stars = rating.toFixed(1);
  return count != null ? `${stars} ★ (${count.toLocaleString()})` : `${stars} ★`;
}

export function formatRelativeTime(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const diffMs = now.getTime() - t;
  if (diffMs < 0) return "just now";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return min === 1 ? "1 minute ago" : `${min} minutes ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr === 1 ? "1 hour ago" : `${hr} hours ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return day === 1 ? "1 day ago" : `${day} days ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return wk === 1 ? "1 week ago" : `${wk} weeks ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return mo === 1 ? "1 month ago" : `${mo} months ago`;
  const yr = Math.floor(day / 365);
  return yr === 1 ? "1 year ago" : `${yr} years ago`;
}
