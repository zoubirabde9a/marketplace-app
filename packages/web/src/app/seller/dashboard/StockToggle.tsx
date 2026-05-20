"use client";

// Inline one-click stock toggle rendered in place of the static stock chip
// on each product row in the dashboard. Optimistic UI: flip the visible
// state immediately, then revert if the request fails.
//
// Sits inside a parent <Link> (the product row is a click-to-edit
// affordance). The button captures click + key events with stopPropagation
// so toggling stock doesn't also navigate to the edit page — without that
// guard, every toggle would land the seller on the edit screen, defeating
// the point of the inline action.
//
// The component intentionally only handles a single-variant product. The
// dashboard row guards on `variantCount <= 1` before rendering this — for
// multi-variant products we leave the static chip + click-through-to-edit
// so the seller picks which variant to toggle.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface StockToggleProps {
  productId: string;
  initialInStock: boolean;
}

export function StockToggle({ productId, initialInStock }: StockToggleProps): React.JSX.Element {
  const router = useRouter();
  const [optimistic, setOptimistic] = useState(initialInStock);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(e: React.MouseEvent | React.KeyboardEvent): void {
    // Block the parent <Link>'s click — without this the row navigates to
    // the edit page on every toggle.
    e.preventDefault();
    e.stopPropagation();
    const next = !optimistic;
    setOptimistic(next);
    setError(null);
    startTransition(async () => {
      let res: Response;
      try {
        res = await fetch(`/api/seller/products/${encodeURIComponent(productId)}/stock`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ inStock: next }),
        });
      } catch {
        setOptimistic(!next);
        setError("Connexion impossible.");
        return;
      }
      if (!res.ok) {
        setOptimistic(!next);
        const j = (await res.json().catch(() => ({}))) as { detail?: string; error?: string };
        setError(j.detail || j.error || `Échec (HTTP ${res.status})`);
        return;
      }
      // Pull a fresh server render so the dashboard's aggregate counts
      // (e.g. revenue, à-traiter chip) re-derive with the new state.
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      onKeyDown={(e) => {
        // Block Enter/Space from bubbling to the parent <Link> too.
        if (e.key === "Enter" || e.key === " ") toggle(e);
      }}
      disabled={pending}
      aria-pressed={optimistic}
      aria-label={
        optimistic
          ? "Disponible — cliquez pour marquer en rupture"
          : "En rupture — cliquez pour remettre en stock"
      }
      title={error ?? undefined}
      className={
        "px-2 py-0.5 rounded-full border text-xs inline-flex items-center gap-1.5 transition disabled:opacity-60 disabled:cursor-not-allowed " +
        (optimistic
          ? "border-ok/40 text-ok bg-ok/10 hover:border-ok/60 hover:bg-ok/15 active:bg-ok/20"
          : "border-line text-ink-mute hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40")
      }
    >
      <span
        aria-hidden
        className={
          "w-1.5 h-1.5 rounded-full " + (optimistic ? "bg-ok" : "bg-ink-mute")
        }
      />
      {optimistic ? "en stock" : "rupture de stock"}
    </button>
  );
}
