// Hand-curated query-time synonyms for catalog search. Applied as websearch
// tsquery OR-expansion in repo.searchIds. Keys and values must be in the
// search-index normal form (lowercased + unaccented), because that's what
// the tsvector tokens look like after f_unaccent.
//
// Seed entries cover Algerian-French slang & common abbreviations we expect
// before we have query-log data; expand from logs once we have it. Keep the
// list small and conservative — false synonyms ("samsung" ↔ "iphone") are a
// recall disaster, so we only add bidirectional pairs for terms we're certain
// users mean interchangeably.

export const SEARCH_SYNONYMS: Record<string, readonly string[]> = {
  // Cooling / appliances
  frigo: ["refrigerateur"],
  refrigerateur: ["frigo"],

  // Phones — the abbreviations Algerian users actually type. "phone" added
  // 2026-05-10 from search-stats data (7 occurrences in the prod query log
  // with avg 172 results — but a chunk of those 7 hits were probably lower
  // than they should have been, since "phone" tokens don't appear in many
  // FR-titled listings; mapping it to "telephone" recovers them).
  tlf: ["telephone"],
  tel: ["telephone"],
  phone: ["telephone"],
  telephone: ["tlf", "phone"],

  // Vehicles
  voiture: ["auto"],
  auto: ["voiture"],

  // Computers
  pc: ["ordinateur", "laptop"],
  ordinateur: ["pc", "laptop"],
  laptop: ["pc", "ordinateur"],

  // Audio
  casque: ["ecouteurs", "headset"],
  ecouteurs: ["casque", "headphones"],
  headset: ["casque"],

  // Tablets
  tablette: ["tablet"],
  tablet: ["tablette"],

  // Watches
  montre: ["watch"],
  watch: ["montre"],
};

/**
 * Build the websearch_to_tsquery input string with synonym expansion. For a
 * single-token query we OR the original with its synonyms. For multi-token
 * queries we expand the cartesian product of variants per token, capped to
 * keep the tsquery from blowing up.
 *
 * Returns the original `q` unchanged if no token has any registered synonym.
 *
 * @example
 * expandForWebsearch("frigo")        // "frigo OR refrigerateur"
 * expandForWebsearch("frigo blanc")  // "frigo blanc OR refrigerateur blanc"
 * expandForWebsearch("iphone 15")    // "iphone 15"  (no expansion)
 */
export function expandForWebsearch(q: string, syns: Record<string, readonly string[]> = SEARCH_SYNONYMS): string {
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return q;

  // Quick exit if no token is a synonym key — most queries.
  if (!tokens.some((t) => syns[t])) return q;

  // Cartesian product: phrases starts as one [original] phrase, expands per token.
  let phrases: string[][] = [tokens];
  for (let i = 0; i < tokens.length; i++) {
    const tokSyns = syns[tokens[i]!];
    if (!tokSyns?.length) continue;
    const next: string[][] = [];
    for (const phrase of phrases) {
      next.push(phrase); // keep original-token variant
      for (const syn of tokSyns) {
        const v = [...phrase];
        v[i] = syn;
        next.push(v);
      }
    }
    phrases = next;
    // Cap at 16 phrases — pathological inputs can't blow up the tsquery.
    if (phrases.length > 16) {
      phrases = phrases.slice(0, 16);
      break;
    }
  }

  // Deduplicate joined-string variants and join with OR (websearch_to_tsquery understands this keyword).
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of phrases) {
    const s = p.join(" ");
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out.join(" OR ");
}
