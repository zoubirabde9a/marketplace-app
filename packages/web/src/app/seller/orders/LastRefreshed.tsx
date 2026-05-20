"use client";

// Renders a small "Mis à jour il y a X" relative-time label. Pairs
// with AutoRefresh (385bb68) — without a visible "last fetched"
// timestamp, the seller has no signal that the page is actually
// polling. With it, they see the label tick up to "il y a 1 minute",
// auto-refresh fires, label snaps back to "à l'instant", and they
// know fresh data just arrived.
//
// Server passes `renderedAt` as an ISO string captured at render
// time. The component compares against `Date.now()` on a 10-second
// interval; when router.refresh() drops a new renderedAt prop in, the
// effect resets the comparison anchor.

import { useEffect, useRef, useState } from "react";
import { formatRelativeTime } from "@/lib/format";

interface LastRefreshedProps {
  /** ISO timestamp captured at server render. Changes whenever
   *  router.refresh() lands fresh data. */
  renderedAt: string;
}

export function LastRefreshed({ renderedAt }: LastRefreshedProps): React.JSX.Element {
  // Re-tick the displayed value every 10 seconds so the label ages
  // gracefully ("à l'instant" → "il y a 1 minute") even when no
  // refresh has fired. 10s is enough granularity for the seller to
  // sense liveness without burning a tight setInterval.
  const [, force] = useState(0);
  const renderedAtRef = useRef(renderedAt);
  // Keep the ref in sync with the prop so the relative-time math
  // anchors against the latest render's timestamp, not the first.
  renderedAtRef.current = renderedAt;

  useEffect(() => {
    const id = window.setInterval(() => force((x) => x + 1), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const label =
    formatRelativeTime(renderedAtRef.current) ??
    new Date(renderedAtRef.current).toLocaleString("fr-DZ");

  return (
    <span
      title={`Mise à jour automatique toutes les 60 secondes`}
      className="inline-flex items-center gap-1.5 text-[10px] text-ink-mute"
    >
      <span
        aria-hidden
        // Pulse dot — same visual language as the "Nouveau" chip on
        // fresh order rows; ties the "live" feel together.
        className="w-1.5 h-1.5 rounded-full bg-ok/70 animate-pulse"
      />
      Mis à jour {label}
    </span>
  );
}
