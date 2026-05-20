"use client";

// Tiny chip rendered on an order row when this device has a saved
// local note for that order (set via OrderNoteField on the detail
// page). Mirrors the note's storage scope: it's per-device, so the
// indicator is per-device too — different sellers / browsers see
// different chips.
//
// Renders nothing during the hydration window so the server-rendered
// list shape doesn't shift after mount. Reads from the same
// localStorage key the editor writes to (`seller-order-note:<id>`).
//
// Storage events: when the seller updates the note on the detail
// page and navigates back, the indicator on the list should reflect
// the new state on next view. Doing a fresh read on mount handles
// that — the route navigation triggers a re-mount of the row.

import { useEffect, useState } from "react";

export function OrderNoteIndicator({ orderId }: { orderId: string }): React.JSX.Element | null {
  const [present, setPresent] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      const value = window.localStorage.getItem(`seller-order-note:${orderId}`);
      setPresent(value != null && value.length > 0);
    } catch {
      setPresent(false);
    }
  }, [orderId]);

  if (!present) return null;

  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border border-line text-ink-soft bg-bg/40"
      aria-label="Note interne enregistrée"
      title="Une note interne est enregistrée pour cette commande sur cet appareil"
    >
      <span aria-hidden>📝</span>
      Note
    </span>
  );
}
