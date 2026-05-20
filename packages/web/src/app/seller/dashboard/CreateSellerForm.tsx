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
          let r: Response;
          try {
            r = await fetch("/api/seller/sellers", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ displayName, phone, countryCode }),
            });
          } catch {
            setError("Connexion impossible. Vérifiez votre réseau et réessayez.");
            return;
          }
          if (!r.ok) {
            // Prefer `detail` over `error` — validation responses put the
            // specific reason in detail (e.g. "displayName already taken")
            // while error is the generic code. Matches the pattern used by
            // the other seller forms (NewProductForm, EditProductForm,
            // ContactForm) so sellers see the same level of feedback no
            // matter which write surface they're on.
            const j = (await r.json().catch(() => ({}))) as { error?: string; detail?: string };
            setError(j.detail || j.error || `Échec (HTTP ${r.status})`);
            return;
          }
          router.refresh();
        });
      }}
      className="flex flex-col gap-3 max-w-md"
    >
      {/* Asterisks mark required fields — same convention as the
          new-product form so sellers see the same visual cue across
          all four seller forms. */}
      <label className="text-sm">
        <span className="block text-ink-soft mb-1">
          Nom de la boutique<span className="ml-1 text-ink-mute" aria-hidden>*</span>
        </span>
        <input
          name="displayName"
          required
          aria-required="true"
          maxLength={120}
          dir="auto"
          className="w-full rounded-lg bg-bg border border-line px-3 py-2 text-base sm:text-sm text-ink focus:border-accent/60 outline-none"
          placeholder="ex. Téléphonie El Djazair"
        />
      </label>
      <label className="text-sm">
        <span className="block text-ink-soft mb-1">
          Téléphone<span className="ml-1 text-ink-mute" aria-hidden>*</span>
        </span>
        <input
          name="phone"
          type="tel"
          required
          aria-required="true"
          maxLength={32}
          inputMode="tel"
          autoComplete="tel"
          aria-describedby="create-seller-phone-hint"
          className="w-full rounded-lg bg-bg border border-line px-3 py-2 text-base sm:text-sm text-ink focus:border-accent/60 outline-none"
          placeholder="+213 5 55 12 34 56"
        />
        <span id="create-seller-phone-hint" className="mt-1 block text-xs text-ink-mute">
          Affiché aux acheteurs sur votre boutique — ils vous contactent
          directement après une commande.
        </span>
      </label>
      <input type="hidden" name="countryCode" value="DZ" />
      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="self-stretch sm:self-start inline-flex h-11 sm:h-10 px-4 items-center justify-center rounded-lg bg-accent text-bg font-medium hover:bg-accent-hover active:brightness-90 transition disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {pending ? "Création…" : "Créer ma boutique"}
      </button>
    </form>
  );
}
