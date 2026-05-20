"use client";

import { useState } from "react";

// Tiny icon-only sibling for inline-with-text contexts (next to an order
// number, a phone number, a SKU — anywhere a labelled CTA button would
// dominate the line). Same clipboard behavior as CopyButton, no label.
// Briefly swaps the clipboard icon for a checkmark on success so the
// seller has visual confirmation the tap registered.
export function CopyIconButton({
  value,
  ariaLabel,
}: {
  value: string;
  /** Accessible label, e.g. "Copier le numéro de commande". */
  ariaLabel: string;
}): React.JSX.Element {
  const [state, setState] = useState<"idle" | "copied">("idle");

  async function onClick(e: React.MouseEvent | React.KeyboardEvent): Promise<void> {
    // Inline copy buttons may sit inside a parent link or summary —
    // suppress propagation so the click doesn't also navigate or toggle.
    e.stopPropagation();
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(value);
        setState("copied");
        setTimeout(() => setState("idle"), 1500);
        return;
      } catch {
        // fall through to prompt fallback
      }
    }
    if (typeof window !== "undefined") window.prompt("Copy:", value);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={state === "copied" ? "Copié" : ariaLabel}
      title={state === "copied" ? "Copié" : ariaLabel}
      className="inline-flex items-center justify-center w-7 h-7 rounded-full text-ink-mute hover:text-accent hover:bg-bg-elev active:text-accent active:bg-bg-elev transition shrink-0"
    >
      {state === "copied" ? (
        <svg className="w-3.5 h-3.5 text-ok" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 12.5l5 5L20 7" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

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
      className="inline-flex items-center gap-1.5 px-3.5 h-10 sm:h-8 rounded-full bg-accent text-bg text-sm sm:text-xs font-medium hover:bg-accent/90 active:brightness-90 transition shrink-0"
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      <span aria-live="polite">{state === "copied" ? copiedLabel : label}</span>
    </button>
  );
}
