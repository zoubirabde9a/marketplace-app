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
      className="text-sm px-3 py-1.5 rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 transition disabled:opacity-60"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
