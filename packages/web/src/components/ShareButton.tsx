"use client";

import { useState } from "react";

export function ShareButton({ title, url: urlProp }: { title: string; url?: string }) {
  const [state, setState] = useState<"idle" | "copied">("idle");

  async function onClick() {
    // Prefer the canonical URL from the parent (no tracking params, no
    // analytics fragments). Fall back to the current location for callers
    // that haven't passed one.
    const url = urlProp ?? (typeof window !== "undefined" ? window.location.href : "");
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // user cancelled or share unavailable — fall through to clipboard.
      }
    }
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(url);
        setState("copied");
        setTimeout(() => setState("idle"), 2000);
        return;
      } catch {
        // clipboard blocked — last resort: prompt.
      }
    }
    if (typeof window !== "undefined") {
      window.prompt("Copier ce lien :", url);
    }
  }

  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3.5 h-11 sm:h-8 rounded-full bg-bg-elev border border-line-soft text-sm sm:text-xs text-ink-soft hover:border-accent/40 hover:text-ink active:border-accent/40 active:text-ink transition"
      aria-label="Partager cette annonce"
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
      </svg>
      <span aria-live="polite">{state === "copied" ? "Lien copié" : "Partager"}</span>
    </button>
  );
}
