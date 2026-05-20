"use client";

// Polls the server for fresh data on a fixed interval by calling
// router.refresh(). Server components re-run, the orders list lands
// with whatever's new (or transitioned), and the tab-title badge
// (TabTitleBadge) plus the stats and bucket counts all update live.
//
// Two pause conditions so the polling doesn't fight the seller or
// burn API quota for nothing:
//
//   1. Tab is hidden (document.visibilityState !== "visible") —
//      no point fetching for an unwatched page. A visibilitychange
//      listener resumes when the seller flips back.
//
//   2. An input/textarea is focused — refreshing mid-type would not
//      blow away client-side input state (router.refresh is component-
//      preserving) but it might still reorder the surrounding DOM and
//      lose the seller's place. Safer to skip the tick when they're
//      actively typing (cancel reason, search box, price editor) and
//      let the next interval pick up.
//
// Renders nothing — pure side effect.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface AutoRefreshProps {
  /** Poll interval in milliseconds. Defaults to 60s — enough latency
   *  reduction over manual F5 to feel live, low enough write that the
   *  per-seller API load stays trivial. */
  intervalMs?: number;
}

export function AutoRefresh({ intervalMs = 60_000 }: AutoRefreshProps): null {
  const router = useRouter();

  useEffect(() => {
    if (typeof document === "undefined") return;

    function tick(): void {
      if (document.visibilityState !== "visible") return;
      const ae = document.activeElement as HTMLElement | null;
      const inField =
        ae != null &&
        (ae.tagName === "INPUT" ||
          ae.tagName === "TEXTAREA" ||
          ae.tagName === "SELECT" ||
          ae.isContentEditable);
      if (inField) return;
      router.refresh();
    }

    const id = window.setInterval(tick, intervalMs);
    // Also fire immediately on visibilitychange → visible so a seller
    // returning from another tab gets fresh data without waiting up
    // to a full interval. Same skip-when-focused-input guard applies.
    function onVisibility(): void {
      if (document.visibilityState === "visible") tick();
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, intervalMs]);

  return null;
}
