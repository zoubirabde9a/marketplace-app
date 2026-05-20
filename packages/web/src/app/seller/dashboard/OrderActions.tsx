"use client";

// Client-side action bar for a single seller order. Renders the state-machine
// transitions that apply to the current status:
//   paid       → "Marquer en préparation"            (begin_fulfillment)
//   fulfilling → "Marquer expédié" + "Annuler"       (ship / cancel)
//   shipped    → "Marquer livré"                     (deliver)
//   anything else → nothing (terminal or pre-payment states have no seller-
//                    driven transitions exposed today)
//
// The "Annuler" path opens a small inline prompt for a cancel reason —
// the API rejects empty reasons (see domain/order/state-machine.ts), so we
// gate the actual fetch behind a non-empty value. We don't use a modal
// here; the order list can carry many rows and modal stack management
// would be heavy. Inline expansion keeps the gesture local.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type OrderStatus =
  | "created"
  | "authorized"
  | "paid"
  | "fulfilling"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded"
  | "disputed";

type Event = "begin_fulfillment" | "ship" | "deliver" | "cancel";

interface ButtonSpec {
  event: Event;
  label: string;
  tone: "primary" | "neutral" | "danger";
}

function actionsFor(status: OrderStatus): ButtonSpec[] {
  switch (status) {
    case "paid":
      return [
        { event: "begin_fulfillment", label: "Marquer en préparation", tone: "primary" },
        { event: "cancel", label: "Annuler", tone: "danger" },
      ];
    case "fulfilling":
      return [
        { event: "ship", label: "Marquer expédié", tone: "primary" },
        { event: "cancel", label: "Annuler", tone: "danger" },
      ];
    case "shipped":
      return [
        { event: "deliver", label: "Marquer livré", tone: "primary" },
      ];
    default:
      return [];
  }
}

const TONE_CLASS: Record<ButtonSpec["tone"], string> = {
  primary:
    "bg-accent text-bg font-medium hover:bg-accent-hover active:brightness-90 disabled:bg-accent/50",
  neutral:
    "border border-line text-ink-soft hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40 disabled:opacity-60",
  danger:
    "border border-bad/40 text-bad hover:bg-bad/10 active:bg-bad/15 disabled:opacity-60",
};

export function OrderActions({
  sellerId,
  orderId,
  status,
}: {
  sellerId: string;
  orderId: string;
  status: OrderStatus;
}): React.JSX.Element | null {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Inline cancel-reason prompt — null = not open, "" = open but empty.
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  // Brief "✓ Marqué …" confirmation after a successful transition.
  // router.refresh() updates the chip and buttons but doesn't itself
  // tell the seller the action landed — positive feedback closes the
  // loop. Auto-dismisses after a couple of seconds; cleared if the
  // component unmounts mid-wait.
  const [successLabel, setSuccessLabel] = useState<string | null>(null);
  useEffect(() => {
    if (!successLabel) return;
    const t = setTimeout(() => setSuccessLabel(null), 2200);
    return () => clearTimeout(t);
  }, [successLabel]);

  const buttons = actionsFor(status);
  if (buttons.length === 0) return null;

  async function applyEvent(spec: ButtonSpec): Promise<void> {
    if (spec.event === "cancel") {
      // Open the reason prompt instead of submitting immediately.
      setCancelReason("");
      return;
    }
    setError(null);
    start(async () => {
      let res: Response;
      // 30s timeout on the transition fetch via AbortController.
      // Without this, a stuck network leaves the useTransition's
      // pending state forever — the action buttons stay disabled
      // and the seller has no feedback. The cap is generous
      // (transitions normally complete in 1-3s) so happy-path
      // requests never trip it.
      const ctrl = new AbortController();
      const timeoutId = window.setTimeout(() => ctrl.abort(), 30_000);
      try {
        res = await fetch(
          `/api/seller/sellers/${encodeURIComponent(sellerId)}/orders/${encodeURIComponent(orderId)}/transition`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ event: spec.event }),
            signal: ctrl.signal,
          },
        );
      } catch (e) {
        const aborted = (e as { name?: string }).name === "AbortError";
        setError(
          aborted
            ? "Le serveur ne répond pas — réessayez dans un instant."
            : "Connexion impossible. Vérifiez votre réseau et réessayez.",
        );
        return;
      } finally {
        window.clearTimeout(timeoutId);
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { detail?: string; error?: string };
        setError(j.detail || j.error || `Échec (HTTP ${res.status})`);
        return;
      }
      // The button label is past-tense-y enough ("Marquer en préparation"
      // → confirmation "Marqué en préparation") that we can reuse it
      // verbatim with the verb swapped to the participle.
      setSuccessLabel(spec.label.replace(/^Marquer /, "Marqué "));
      router.refresh();
    });
  }

  async function submitCancel(reason: string): Promise<void> {
    setError(null);
    start(async () => {
      let res: Response;
      const ctrl = new AbortController();
      const timeoutId = window.setTimeout(() => ctrl.abort(), 30_000);
      try {
        res = await fetch(
          `/api/seller/sellers/${encodeURIComponent(sellerId)}/orders/${encodeURIComponent(orderId)}/transition`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ event: "cancel", reason }),
            signal: ctrl.signal,
          },
        );
      } catch (e) {
        const aborted = (e as { name?: string }).name === "AbortError";
        setError(
          aborted
            ? "Le serveur ne répond pas — réessayez dans un instant."
            : "Connexion impossible. Vérifiez votre réseau et réessayez.",
        );
        return;
      } finally {
        window.clearTimeout(timeoutId);
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { detail?: string; error?: string };
        setError(j.detail || j.error || `Échec (HTTP ${res.status})`);
        return;
      }
      setCancelReason(null);
      setSuccessLabel("Commande annulée");
      router.refresh();
    });
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {buttons.map((b) => (
          <button
            key={b.event}
            type="button"
            disabled={pending}
            aria-busy={pending}
            onClick={() => void applyEvent(b)}
            className={
              "inline-flex h-9 px-3.5 items-center justify-center rounded-md text-xs transition disabled:cursor-not-allowed " +
              TONE_CLASS[b.tone]
            }
          >
            {b.label}
          </button>
        ))}
        {successLabel && (
          // role=status + aria-live=polite so screen readers also get
          // confirmation. Visually a small green check + label that
          // sits inline with the buttons and fades after ~2 seconds.
          <span
            role="status"
            aria-live="polite"
            className="inline-flex items-center gap-1.5 text-xs text-ok"
          >
            <span aria-hidden>✓</span>
            {successLabel}
          </span>
        )}
      </div>
      {cancelReason !== null && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const reason = cancelReason.trim();
            if (reason.length === 0) {
              setError("Veuillez indiquer un motif d’annulation.");
              return;
            }
            void submitCancel(reason);
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <label className="text-xs text-ink-soft flex-1 min-w-0 flex flex-col gap-1">
            <span>Motif</span>
            {/* textarea instead of single-line input: gives the
                seller more room to explain at length when needed
                ("client a refusé après vérification de l'IMEI" type
                multi-line stories), and Enter creates a newline
                instead of accidentally submitting the form while
                the seller is still composing. Explicit confirm
                button click is the only submit path. */}
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="ex. acheteur injoignable · rupture de stock · adresse hors zone"
              autoFocus
              maxLength={200}
              rows={2}
              dir="auto"
              className="w-full min-w-0 rounded-md bg-bg border border-line px-2 py-1.5 text-xs text-ink focus:border-accent/60 outline-none resize-y"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            className="inline-flex h-9 px-3.5 items-center justify-center rounded-md border border-bad/40 text-bad hover:bg-bad/10 active:bg-bad/15 transition text-xs font-medium disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {pending ? "Annulation…" : "Confirmer l’annulation"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!pending) {
                setCancelReason(null);
                setError(null);
              }
            }}
            disabled={pending}
            className="inline-flex h-9 px-3.5 items-center justify-center rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40 transition text-xs disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Retour
          </button>
        </form>
      )}
      {error && (
        <p className="text-xs text-bad" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
