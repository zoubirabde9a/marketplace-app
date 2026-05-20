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
import { useRouter } from "next/navigation";
import { formatRelativeTime } from "@/lib/format";

interface LastRefreshedProps {
  /** ISO timestamp captured at server render. Changes whenever
   *  router.refresh() lands fresh data. */
  renderedAt: string;
}

export function LastRefreshed({ renderedAt }: LastRefreshedProps): React.JSX.Element {
  const router = useRouter();
  // Re-tick the displayed value every 10 seconds so the label ages
  // gracefully ("à l'instant" → "il y a 1 minute") even when no
  // refresh has fired. 10s is enough granularity for the seller to
  // sense liveness without burning a tight setInterval.
  const [, force] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const renderedAtRef = useRef(renderedAt);
  // Keep the ref in sync with the prop so the relative-time math
  // anchors against the latest render's timestamp, not the first.
  renderedAtRef.current = renderedAt;

  // Clear the spin animation as soon as a new renderedAt prop lands
  // — that's the proxy signal that the manual refresh actually
  // completed.
  useEffect(() => {
    if (spinning) setSpinning(false);
    // We intentionally depend on renderedAt only — the local
    // spinning state shouldn't drive its own reset, otherwise we'd
    // loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderedAt]);

  // Safety timeout: if router.refresh() never lands a new
  // renderedAt prop (offline mid-refresh, server timeout, etc.),
  // the spinning state would persist forever. Cap it at 5
  // seconds — long enough for the refresh to win in normal
  // conditions, short enough that the seller doesn't stare at a
  // broken-looking spinner indefinitely.
  useEffect(() => {
    if (!spinning) return;
    const t = window.setTimeout(() => setSpinning(false), 5000);
    return () => window.clearTimeout(t);
  }, [spinning]);

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
      {/* Manual refresh — for the seller who wants to know RIGHT NOW
          whether anything new came in instead of waiting up to 60
          seconds for the next polling tick. Spinning until the
          renderedAt prop changes (server re-render landed). */}
      <button
        type="button"
        onClick={() => {
          setSpinning(true);
          router.refresh();
        }}
        disabled={spinning}
        aria-label="Recharger maintenant"
        title="Recharger maintenant"
        className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full text-ink-mute hover:text-ink hover:bg-bg-elev active:text-ink active:bg-bg-elev transition disabled:cursor-not-allowed"
      >
        <svg
          className={"w-3 h-3 " + (spinning ? "animate-spin" : "")}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 3v5h-5" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 21v-5h5" />
        </svg>
      </button>
    </span>
  );
}
