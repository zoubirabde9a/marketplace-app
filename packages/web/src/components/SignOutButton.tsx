"use client";

// DELETE /api/auth/session clears the cookie. After success, refresh to
// re-render the header without the user menu.

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      aria-busy={busy}
      aria-label={busy ? "Déconnexion en cours" : "Se déconnecter"}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/auth/session", { method: "DELETE" });
        } finally {
          router.push("/");
          router.refresh();
        }
      }}
      className="px-3 h-9 inline-flex items-center gap-1.5 rounded-md text-sm text-ink-soft hover:text-ink hover:bg-bg-elev transition disabled:opacity-50"
    >
      {/* Logout icon — always rendered, paired with text from sm: up so the
          header doesn't claim 110+ px on phones for the "Se déconnecter" label
          (squeezing the SearchBar). aria-label covers screen-reader users. */}
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span aria-live="polite" className="hidden sm:inline">{busy ? "Déconnexion…" : "Se déconnecter"}</span>
    </button>
  );
}
