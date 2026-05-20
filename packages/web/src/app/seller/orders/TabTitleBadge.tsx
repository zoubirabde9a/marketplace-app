"use client";

// Mounts a side-effect that prefixes the browser tab title with the
// actionable order count — `(3) Toutes les commandes`. Sellers who keep
// the orders page pinned in a background tab catch incoming work in the
// tab strip without switching to it. Same pattern as Gmail's "(N) Inbox"
// and Slack's unread badge.
//
// Pure client side-effect — renders no DOM. Captures the original
// document.title on mount so the cleanup restores it cleanly when the
// seller navigates away (and the title doesn't bleed onto whatever
// other Next page they end up on).
//
// Re-runs when `count` changes so router.refresh() after an order
// transition updates the badge live without a full page reload.

import { useEffect } from "react";

interface TabTitleBadgeProps {
  count: number;
}

export function TabTitleBadge({ count }: TabTitleBadgeProps): null {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const original = document.title;
    // Strip any existing leading "(N) " so repeated updates don't pile
    // up into "(3) (3) (5) Title" when the effect re-runs.
    const base = original.replace(/^\(\d+\)\s+/, "");
    document.title = count > 0 ? `(${count}) ${base}` : base;
    return () => {
      // Restore exactly what we found. Don't reset to `base` — another
      // component (Next metadata system, future widgets) might have
      // legitimately changed the title between mount and unmount.
      document.title = original;
    };
  }, [count]);

  return null;
}
