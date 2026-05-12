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
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/auth/session", { method: "DELETE" });
        } finally {
          router.push("/");
          router.refresh();
        }
      }}
      className="px-3 py-1.5 rounded-md text-sm text-ink-soft hover:text-ink hover:bg-bg-elev transition disabled:opacity-50"
    >
      <span aria-live="polite">{busy ? "Déconnexion…" : "Se déconnecter"}</span>
    </button>
  );
}
