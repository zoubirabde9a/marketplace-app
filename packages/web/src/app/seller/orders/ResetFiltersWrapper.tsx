"use client";

// "Tout effacer" affordance for the orders page filter stack. Five
// independent filter components (search, status tabs, range, shop,
// density) each manage their own local state — useful for
// composability, hard to coordinate "reset everything" across.
//
// This wrapper sidesteps the coordination problem: the button bumps
// a `version` state, the inner div uses `key={version}` so React
// unmounts and remounts the entire subtree on each bump. Every
// filter inside is freshly mounted with its default initial state.
// No prop drilling, no context, no callback registration —
// remounting IS the reset.
//
// Tradeoff: the button is always visible, even when no filter is
// active (clicking it then is a no-op). Showing it conditionally
// would require lifting each filter's state up to detect
// "any-active"; not worth the complexity for a tiny UX wart on the
// rare empty case.

import { useState } from "react";

export function ResetFiltersWrapper({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [version, setVersion] = useState(0);

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={() => setVersion((v) => v + 1)}
          className="text-xs text-ink-mute hover:text-ink active:text-ink underline-offset-2 hover:underline active:underline transition"
        >
          Tout effacer les filtres
        </button>
      </div>
      <div key={version}>{children}</div>
    </div>
  );
}
