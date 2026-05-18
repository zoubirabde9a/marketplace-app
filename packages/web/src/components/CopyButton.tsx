"use client";

import { useState } from "react";

// Defaults are French ("Copier" / "Copié") so a caller that doesn't pass
// explicit labels lands consistently on the French-locale site. Existing
// callers (AgentActivity's intentionally English MCP setup steps) already
// override these props — the defaults exist only for the next caller.
export function CopyButton({
  value,
  label = "Copier",
  copiedLabel = "Copié",
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
}) {
  const [state, setState] = useState<"idle" | "copied">("idle");

  async function onClick() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(value);
        setState("copied");
        setTimeout(() => setState("idle"), 2000);
        return;
      } catch {
        // fall through
      }
    }
    if (typeof window !== "undefined") {
      window.prompt("Copy:", value);
    }
  }

  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3.5 h-10 sm:h-8 rounded-full bg-accent text-bg text-sm sm:text-xs font-medium hover:bg-accent/90 transition shrink-0"
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      <span aria-live="polite">{state === "copied" ? copiedLabel : label}</span>
    </button>
  );
}
