"use client";

import { useState } from "react";

export function ShareButton({ title }: { title: string }) {
  const [state, setState] = useState<"idle" | "copied">("idle");

  async function onClick() {
    const url = typeof window !== "undefined" ? window.location.href : "";
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
      window.prompt("Copy this link:", url);
    }
  }

  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-bg-elev border border-line-soft text-xs text-ink-soft hover:border-accent/40 hover:text-ink transition"
      aria-label="Share this product"
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
      </svg>
      <span aria-live="polite">{state === "copied" ? "Link copied" : "Share"}</span>
    </button>
  );
}
