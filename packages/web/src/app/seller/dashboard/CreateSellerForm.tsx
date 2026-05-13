"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function CreateSellerForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const displayName = String(data.get("displayName") ?? "").trim();
        const phone = String(data.get("phone") ?? "").trim();
        const countryCode = String(data.get("countryCode") ?? "DZ").trim().toUpperCase();
        if (!displayName) {
          setError("Le nom de la boutique est requis.");
          return;
        }
        if (!phone) {
          setError("Le numéro de téléphone est requis.");
          return;
        }
        setError(null);
        startTransition(async () => {
          const r = await fetch("/api/seller/sellers", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ displayName, phone, countryCode }),
          });
          if (!r.ok) {
            const j = (await r.json().catch(() => ({}))) as { error?: string; detail?: unknown };
            setError(j.error ?? `Échec (HTTP ${r.status})`);
            return;
          }
          router.refresh();
        });
      }}
      className="flex flex-col gap-3 max-w-md"
    >
      <label className="text-sm">
        <span className="block text-ink-soft mb-1">Nom de la boutique</span>
        <input
          name="displayName"
          required
          maxLength={120}
          className="w-full rounded-lg bg-bg border border-line px-3 py-2 text-ink focus:border-accent/60 outline-none"
          placeholder="ex. Téléphonie El Djazair"
        />
      </label>
      <label className="text-sm">
        <span className="block text-ink-soft mb-1">Téléphone</span>
        <input
          name="phone"
          type="tel"
          required
          maxLength={32}
          inputMode="tel"
          autoComplete="tel"
          className="w-full rounded-lg bg-bg border border-line px-3 py-2 text-ink focus:border-accent/60 outline-none"
          placeholder="+213 5 55 12 34 56"
        />
      </label>
      <input type="hidden" name="countryCode" value="DZ" />
      {error && <p className="text-sm text-bad">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="self-start inline-flex h-10 px-4 items-center rounded-lg bg-accent text-bg font-medium hover:bg-accent-hover transition disabled:opacity-60"
      >
        {pending ? "Création…" : "Créer ma boutique"}
      </button>
    </form>
  );
}
