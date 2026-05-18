"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        start(async () => {
          await fetch("/api/seller/session", { method: "DELETE" });
          router.push("/seller");
          router.refresh();
        });
      }}
      className="text-sm px-3.5 h-9 inline-flex items-center rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 transition disabled:opacity-60 shrink-0"
    >
      {pending ? "Déconnexion…" : "Se déconnecter"}
    </button>
  );
}
