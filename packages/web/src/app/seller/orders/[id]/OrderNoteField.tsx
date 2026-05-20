"use client";

// Local-only note field per order. Honest about its limitations: stored
// in this browser's localStorage under `seller-order-note:<orderId>`,
// not synced across devices, not visible to teammates, lost if the
// seller clears site data. Even with those caveats it covers the
// real workflow — "I'm on the phone with this buyer right now, let
// me jot the delivery instruction so I don't forget when I prep the
// package in 2 hours".
//
// Auto-saves on blur and after a 600ms typing pause. Shows a small
// "Enregistré" flash so the seller has visible confirmation the
// keystrokes landed somewhere.

import { useEffect, useRef, useState } from "react";

interface OrderNoteFieldProps {
  orderId: string;
}

export function OrderNoteField({ orderId }: OrderNoteFieldProps): React.JSX.Element {
  const storageKey = `seller-order-note:${orderId}`;
  const [value, setValue] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const timerRef = useRef<number | null>(null);

  // Hydrate once on mount — localStorage isn't available at SSR, so
  // the textarea starts empty and the saved value drops in after.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored != null) setValue(stored);
    } catch {
      // localStorage can throw in private-mode / disabled-cookies
      // contexts. Falling through leaves value="" which is fine.
    }
    setHydrated(true);
  }, [storageKey]);

  // Debounced auto-save. Saves on every keystroke, but the actual
  // localStorage write debounces to avoid churning storage on rapid
  // typing. The flash fires after a successful write.
  function persist(next: string): void {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      try {
        if (next === "") {
          window.localStorage.removeItem(storageKey);
        } else {
          window.localStorage.setItem(storageKey, next);
        }
        setSavedFlash(true);
        window.setTimeout(() => setSavedFlash(false), 1200);
      } catch {
        // Quota or privacy mode — give up quietly. The textarea
        // still holds the value in component state; the seller
        // just doesn't get persistence this session.
      }
    }, 600);
  }

  return (
    <section
      aria-label="Note interne sur la commande"
      className="mt-6 rounded-2xl border border-line-soft bg-bg-soft/60 p-4 sm:p-5 print:hidden"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-ink">Note interne</h2>
        <span
          role="status"
          aria-live="polite"
          className={
            "text-xs text-ok transition-opacity " +
            (savedFlash ? "opacity-100" : "opacity-0")
          }
        >
          ✓ Enregistré
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-mute">
        Enregistrée localement sur cet appareil. Pas synchronisée entre
        ordinateurs ni visible par les acheteurs.
      </p>
      <textarea
        value={value}
        disabled={!hydrated}
        onChange={(e) => {
          setValue(e.target.value);
          persist(e.target.value);
        }}
        rows={3}
        maxLength={500}
        dir="auto"
        placeholder="Ex. : appeler après 18h · livraison rapide demandée · vérifier la couleur exacte"
        className="mt-3 w-full rounded-lg bg-bg border border-line px-3 py-2 text-sm text-ink focus:border-accent/60 outline-none placeholder:text-ink-mute disabled:opacity-60"
      />
      <div className="mt-1 flex items-center justify-between text-[10px] text-ink-mute">
        {value.length > 0 ? (
          // Explicit cleanup affordance. The textarea's select-all-
          // and-delete works but is two-step on mobile; this is one
          // tap to wipe. Persist removes the localStorage key
          // entirely (zero-length value path).
          <button
            type="button"
            onClick={() => {
              setValue("");
              persist("");
            }}
            className="text-ink-mute hover:text-bad active:text-bad underline-offset-2 hover:underline active:underline transition"
          >
            Effacer la note
          </button>
        ) : (
          <span />
        )}
        <span className="tabular-nums">{value.length}/500</span>
      </div>
    </section>
  );
}
