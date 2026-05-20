"use client";

// Robust confirmation modal built on the native <dialog> element. Native
// dialog gives us: focus trap, return-focus on close, ESC-to-close, and an
// always-on-top stacking context — all for free, no a11y guesswork.
//
// Designed for destructive actions (delete product, cancel order) where we
// want the seller to slow down. Optional `confirmPhrase` requires the
// seller to type a specific string (typically the product title) before
// the confirm button enables — same pattern GitHub uses for repo delete.
//
// Renders nothing (returns null) when `open` is false so the dialog is
// fully unmounted between uses — keeps useEffects clean and avoids stale
// internal state on reopen.

import { useEffect, useRef, useState } from "react";

export interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  /** Body text. Renders inside a <p> with text-ink-soft. */
  description?: React.ReactNode;
  /** Label of the confirm button. Default: "Confirmer". */
  confirmLabel?: string;
  /** Label of the cancel button. Default: "Annuler". */
  cancelLabel?: string;
  /** Visual treatment: "danger" = red confirm button. */
  tone?: "default" | "danger";
  /**
   * If set, seller must type this exact string before the confirm button
   * enables. Used for delete-product flow where we want the operator to
   * acknowledge *which* item they're about to lose.
   */
  confirmPhrase?: string;
  /** Disables the confirm button (e.g. while submitting). */
  busy?: boolean;
  /** Inline error to render under the form. */
  errorMessage?: string | null;
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  tone = "default",
  confirmPhrase,
  busy = false,
  errorMessage = null,
}: ConfirmModalProps): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [typed, setTyped] = useState("");

  // Drive the native showModal/close lifecycle from React state. Calling
  // showModal() unconditionally would throw if the dialog is already open
  // (chromium error), so guard with .open.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      try {
        el.showModal();
      } catch {
        // Some browsers refuse showModal() if the element is detached;
        // ignore so we don't crash the host page.
      }
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  // Reset the type-to-confirm field whenever we reopen so a previous
  // half-typed phrase doesn't leak across uses.
  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  if (!open) return null;

  const requirePhrase = confirmPhrase != null && confirmPhrase.length > 0;
  const phraseOk = !requirePhrase || typed.trim() === confirmPhrase.trim();
  const canConfirm = phraseOk && !busy;

  const confirmCls =
    tone === "danger"
      ? "bg-bad text-bg hover:brightness-110 active:brightness-90 disabled:bg-bad/50"
      : "bg-accent text-bg hover:bg-accent-hover active:brightness-90 disabled:bg-accent/50";

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={(e) => {
        // ESC fires `cancel` then `close`; intercepting cancel lets us
        // block ESC while a request is in flight so the seller doesn't
        // dismiss the modal mid-delete and lose the result.
        if (busy) e.preventDefault();
      }}
      onClick={(e) => {
        // Backdrop click — close. The dialog's content sits in an inner
        // <div>; clicks that hit the <dialog> element itself are on the
        // backdrop. Skipped while busy to avoid losing the in-flight
        // result.
        if (busy) return;
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby="confirm-modal-title"
      aria-describedby={description ? "confirm-modal-desc" : undefined}
      className="rounded-2xl bg-bg-soft text-ink border border-line-soft p-0 backdrop:bg-bg/70 backdrop:backdrop-blur-sm max-w-md w-[min(90vw,28rem)]"
      lang="fr"
    >
      <div className="p-5 sm:p-6">
        <h2 id="confirm-modal-title" className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {description && (
          <div id="confirm-modal-desc" className="mt-2 text-sm text-ink-soft">
            {description}
          </div>
        )}
        {requirePhrase && (
          <label className="mt-4 block text-sm">
            <span className="block text-ink-soft mb-1">
              Pour confirmer, tapez{" "}
              <span dir="auto" className="font-mono text-ink bg-bg-elev rounded px-1.5 py-0.5 border border-line">
                {confirmPhrase}
              </span>
            </span>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
              dir="auto"
              className="w-full rounded-lg bg-bg border border-line px-3 py-2 text-base sm:text-sm text-ink focus:border-accent/60 outline-none"
            />
          </label>
        )}
        {errorMessage && (
          <p className="mt-3 text-sm text-bad" role="alert">
            {errorMessage}
          </p>
        )}
        <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-11 sm:h-10 px-4 items-center justify-center rounded-lg border border-line text-ink-soft hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40 transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={!canConfirm}
            aria-busy={busy}
            className={
              "inline-flex h-11 sm:h-10 px-4 items-center justify-center rounded-lg font-medium transition disabled:cursor-not-allowed " +
              confirmCls
            }
          >
            {busy ? "Veuillez patienter…" : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
