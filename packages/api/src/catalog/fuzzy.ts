// Token-level fuzzy matching for catalog text search.
//
// Default catalog search is a cheap case-insensitive substring match, which is
// fast and predictable but useless for typos ("widgit" should still find
// "widget"). When `?fuzzy=true` is passed we tokenize both query and target
// and accept tokens that are within a small Levenshtein distance — scaled by
// token length so single-letter typos in short words still match without
// turning long-word matches into noise.

/** Standard iterative Levenshtein. O(n*m) where n,m = string lengths. */
export function editDistance(x: string, y: string): number {
  if (x === y) return 0;
  const n = x.length;
  const m = y.length;
  if (n === 0) return m;
  if (m === 0) return n;
  let prev = new Array<number>(m + 1);
  let next = new Array<number>(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    next[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = x.charCodeAt(i - 1) === y.charCodeAt(j - 1) ? 0 : 1;
      next[j] = Math.min(next[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    [prev, next] = [next, prev];
  }
  return prev[m]!;
}

/**
 * How many edits we tolerate in a token of this length.
 *
 * Very short tokens (≤3 chars) get tolerance 0 — a 1-edit window on a 3-char
 * token is mostly noise ("tea"→"sea"/"the"/"yea"/"ten", "and"→"end", …).
 * The old code returned 1 here and 1 for ≤6 (two branches with the same
 * return), which was almost certainly a leftover from an earlier refactor
 * and silently turned short-word queries into false-positive generators.
 */
function toleranceFor(token: string): number {
  if (token.length <= 3) return 0;
  if (token.length <= 6) return 1;
  return 2;
}

const TOKEN_RE = /[\p{L}\p{N}]+/gu;

function tokenize(s: string): string[] {
  return s.toLowerCase().match(TOKEN_RE) ?? [];
}

/**
 * Returns a non-zero score if every query token matches some text token within
 * its tolerance. Score is the count of matched tokens — higher means more of
 * the query was satisfied. Returns 0 if any query token is unmatched.
 */
export function fuzzyMatch(query: string, text: string): number {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return 0;
  const tTokens = tokenize(text);
  if (tTokens.length === 0) return 0;
  let score = 0;
  for (const q of qTokens) {
    const tol = toleranceFor(q);
    let best = Infinity;
    for (const t of tTokens) {
      // Cheap pre-filters before paying the O(n*m) edit-distance cost.
      if (Math.abs(t.length - q.length) > tol) continue;
      // Substring containment is a free-match SHORTCUT, but only when the
      // query token is long enough to be discriminating. Previously a 1-2
      // char query token would `t.includes(q)` against essentially every
      // text token containing those letters — a query of "a" matched any
      // product with any token containing 'a'. Require the query token to
      // be ≥4 chars before allowing the substring shortcut.
      if (q.length >= 4 && (t.includes(q) || q.includes(t))) {
        best = 0;
        break;
      }
      const d = editDistance(q, t);
      if (d < best) best = d;
      if (best === 0) break;
    }
    if (best > tol) return 0;
    score += 1;
  }
  return score;
}
