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
  if (rating == null) return "Pas encore d’avis";
  const stars = rating.toFixed(1);
  return count != null ? `${stars} ★ (${count.toLocaleString()})` : `${stars} ★`;
}

// French relative-time labels — the home page recent strip, every product card,
// and the product detail page render these. Previously English ("2 hours ago")
// on a French-locale catalog. Keeps the same bucketing logic; just the
// rendered words change.
export function formatRelativeTime(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const diffMs = now.getTime() - t;
  if (diffMs < 0) return "à l’instant";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "à l’instant";
  const min = Math.floor(sec / 60);
  if (min < 60) return min === 1 ? "il y a 1 minute" : `il y a ${min} minutes`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr === 1 ? "il y a 1 heure" : `il y a ${hr} heures`;
  const day = Math.floor(hr / 24);
  if (day < 7) return day === 1 ? "il y a 1 jour" : `il y a ${day} jours`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return wk === 1 ? "il y a 1 semaine" : `il y a ${wk} semaines`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return mo === 1 ? "il y a 1 mois" : `il y a ${mo} mois`;
  const yr = Math.floor(day / 365);
  return yr === 1 ? "il y a 1 an" : `il y a ${yr} ans`;
}

// Scraped product titles from Ouedkniss often duplicate the leading word
// ("Samsung Samsung a31", "Iphone11 Iphone11", "Karakou Karakou", "Samsong
// Galaxy Samsong"). Source quirk — the scraper sometimes concatenates a
// brand-style prefix with a title that already starts with that brand. We
// can't fix it server-side without rewriting stored data, so trim it at the
// display layer.
//
// Only trims when the first two whitespace-separated words are identical
// case-insensitively. Single-word titles or "Samsung Plus" stay untouched.
export function cleanProductTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) return trimmed;
  const m = trimmed.match(/^(\S+)\s+(\S+)(\s+|$)/);
  if (!m) return trimmed;
  if (m[1]!.toLowerCase() === m[2]!.toLowerCase()) {
    return trimmed.slice(m[1]!.length + 1).trimStart();
  }
  return trimmed;
}
