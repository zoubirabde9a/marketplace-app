"use client";

// Inline price editor — tap the formatted price on a product row to
// swap it for a number input, type the new value, press Enter (or click
// "OK") to save. Companion to the StockToggle: both inline edits cover
// the two highest-frequency seller ops (re-stock and re-price) without
// a round-trip to the full edit page.
//
// Guards: parent dashboard row only renders this when the product has
// a single variant AND already carries a single-number priceMinor.
// Multi-variant pricing and price ranges still go to the edit page.
//
// Click bubbling: the parent row is a Link to /seller/products/<id>/edit
// (whole-row click target). The editor's button and input both
// stopPropagation so neither tap navigates away.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatPrice } from "@/lib/format";

interface PriceEditorProps {
  productId: string;
  /** Initial price as the marketplace stores it — minor-currency integer. */
  initialPriceMinor: string;
  /** ISO 4217 currency for formatting the display value. */
  currency: string;
}

function minorToMajor(minor: string): string {
  // Mirrors the helper in EditProductForm. Two-dp currencies only; the
  // marketplace runs DZD which fits that assumption today.
  const s = minor.replace(/^0+(?=\d)/, "");
  if (s.length <= 2) return `0.${s.padStart(2, "0")}`;
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

export function PriceEditor({
  productId,
  initialPriceMinor,
  currency,
}: PriceEditorProps): React.JSX.Element {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [optimisticMinor, setOptimisticMinor] = useState(initialPriceMinor);
  const [draft, setDraft] = useState(minorToMajor(initialPriceMinor));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Focus + select the input when the editor opens so the seller can
  // type the new price without first clearing the existing one.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function openEdit(e: React.MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    setDraft(minorToMajor(optimisticMinor));
    setError(null);
    setEditing(true);
  }

  function cancel(): void {
    setEditing(false);
    setError(null);
    setDraft(minorToMajor(optimisticMinor));
  }

  function submit(): void {
    const trimmed = draft.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
      setError("Format invalide");
      return;
    }
    // Build the same priceMinor the server will compute, for the
    // optimistic update — saves an extra render after router.refresh()
    // catches up.
    const [whole, frac = ""] = trimmed.split(".");
    const newMinor = `${whole}${frac.padEnd(2, "0").slice(0, 2)}`.replace(/^0+(?=\d)/, "");
    if (newMinor === "0" || newMinor === "") {
      setError("Doit être positif");
      return;
    }
    const previousMinor = optimisticMinor;
    setOptimisticMinor(newMinor);
    setError(null);
    startTransition(async () => {
      let res: Response;
      // 30s safety timeout — same pattern as OrderActions and
      // StockToggle. Without it a stuck network would leave the
      // useTransition pending forever, the editor disabled with
      // no feedback.
      const ctrl = new AbortController();
      const timeoutId = window.setTimeout(() => ctrl.abort(), 30_000);
      try {
        res = await fetch(`/api/seller/products/${encodeURIComponent(productId)}/price`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ priceMajor: trimmed }),
          signal: ctrl.signal,
        });
      } catch (e) {
        const aborted = (e as { name?: string }).name === "AbortError";
        setOptimisticMinor(previousMinor);
        setError(aborted ? "Délai dépassé" : "Connexion impossible");
        return;
      } finally {
        window.clearTimeout(timeoutId);
      }
      if (!res.ok) {
        setOptimisticMinor(previousMinor);
        const j = (await res.json().catch(() => ({}))) as { detail?: string; error?: string };
        setError(j.detail || j.error || `Échec (HTTP ${res.status})`);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={openEdit}
        title={error ?? "Modifier le prix"}
        className={
          "text-ink hover:text-accent active:text-accent transition tabular-nums " +
          (error ? "text-bad" : "")
        }
      >
        {formatPrice(optimisticMinor, currency, "fr-DZ")}
      </button>
    );
  }

  return (
    // The editor sits inline with the row's right-hand chip cluster.
    // form > input + buttons so Enter submits naturally (and Escape
    // cancels via the input's onKeyDown).
    <form
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        submit();
      }}
      className="inline-flex items-center gap-1.5"
    >
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            cancel();
          }
        }}
        onBlur={() => {
          // Auto-cancel on outside click via blur — only if nothing
          // pending. Without this the editor would linger if the
          // seller taps elsewhere on the row.
          if (!pending) cancel();
        }}
        // Prevent the parent Link's navigation if the seller mouse-
        // downs on the input.
        onMouseDown={(e) => e.stopPropagation()}
        inputMode="decimal"
        autoComplete="off"
        disabled={pending}
        size={8}
        className="rounded-md bg-bg border border-line px-2 h-7 text-xs text-ink focus:border-accent/60 outline-none tabular-nums disabled:opacity-60"
      />
      <span className="text-[10px] text-ink-mute">{currency}</span>
      <button
        type="submit"
        // onMouseDown fires before the input's onBlur — without it,
        // tapping OK would blur the input first and cancel the edit.
        onMouseDown={(e) => e.preventDefault()}
        disabled={pending}
        aria-busy={pending}
        className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-accent text-bg hover:bg-accent-hover active:brightness-90 transition disabled:opacity-60"
        aria-label="Enregistrer le prix"
      >
        {pending ? (
          <span className="inline-block w-3 h-3 border-2 border-bg/40 border-t-bg rounded-full animate-spin" />
        ) : (
          <span aria-hidden>✓</span>
        )}
      </button>
    </form>
  );
}
