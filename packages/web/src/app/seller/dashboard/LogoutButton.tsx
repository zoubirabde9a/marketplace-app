"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            try {
              await fetch("/api/seller/session", { method: "DELETE" });
            } catch {
              // Network-layer failure — without this catch the rejection
              // was unhandled and the button silently snapped back to
              // "Se déconnecter" with no signal to the seller.
              setError("Déconnexion impossible — réseau indisponible.");
              return;
            }
            router.push("/seller");
            router.refresh();
          });
        }}
        className="text-sm px-3.5 h-11 sm:h-9 inline-flex items-center rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40 transition disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {pending ? "Déconnexion…" : "Se déconnecter"}
      </button>
      {error && (
        <p className="text-xs text-bad text-right max-w-[200px]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
