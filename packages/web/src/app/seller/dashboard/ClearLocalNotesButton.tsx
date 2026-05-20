"use client";

// Wipes every locally-stored order note in one shot. Sellers on
// shared devices or finishing their day need this — the note
// indicator chip is honest about "this device only" but eventually
// the seller wants the device to forget.
//
// Hidden when there's nothing to clear; the dashboard footer
// stays uncluttered on first-load and quiet days. Shows the count
// when present so the seller knows the scale before confirming.
// ConfirmModal gates the wipe so a stray tap doesn't lose notes
// the seller still wanted.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmModal } from "@/components/ConfirmModal";

const NOTE_PREFIX = "seller-order-note:";

function countNotes(): number {
  if (typeof window === "undefined") return 0;
  try {
    let n = 0;
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(NOTE_PREFIX)) n++;
    }
    return n;
  } catch {
    return 0;
  }
}

function clearAllNotes(): number {
  if (typeof window === "undefined") return 0;
  try {
    const toDelete: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(NOTE_PREFIX)) toDelete.push(key);
    }
    toDelete.forEach((k) => window.localStorage.removeItem(k));
    return toDelete.length;
  } catch {
    return 0;
  }
}

export function ClearLocalNotesButton(): React.JSX.Element | null {
  const router = useRouter();
  const [count, setCount] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    setCount(countNotes());
  }, []);

  if (count == null || count === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className="text-xs text-ink-mute hover:text-bad active:text-bad underline-offset-2 hover:underline active:underline transition"
      >
        Effacer mes {count} note{count === 1 ? "" : "s"} locale
        {count === 1 ? "" : "s"}
      </button>
      <ConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          const removed = clearAllNotes();
          setCount(0);
          setConfirmOpen(false);
          // Tell the rest of the dashboard to repaint — the note
          // chips on each order row need to disappear too.
          if (removed > 0) router.refresh();
        }}
        tone="danger"
        title={`Effacer ${count} note${count === 1 ? "" : "s"} locale${count === 1 ? "" : "s"} ?`}
        description={
          <p>
            Les notes enregistrées localement sur cet appareil seront
            supprimées définitivement. Cette action n’affecte pas les autres
            appareils ni les acheteurs.
          </p>
        }
        confirmLabel="Effacer les notes"
        cancelLabel="Annuler"
      />
    </>
  );
}
