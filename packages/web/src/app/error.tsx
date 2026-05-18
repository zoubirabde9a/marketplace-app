"use client";

// Buyer-facing fallback when a server component throws. Previous copy was
// English ("Something broke / We couldn't load that.") on a French-locale
// site, and rendered `error.message` directly — which can leak internal
// detail (stack fragments, internal error codes, env var names) to anyone
// who triggers an exception. Now: French chrome, generic message, keep the
// digest as a support reference. Raw message stays in the browser/server
// console for ops correlation.
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (typeof console !== "undefined") {
      console.error("[error-boundary]", error);
    }
  }, [error]);
  return (
    <div className="py-16 sm:py-32 px-4 text-center" lang="fr">
      <p className="text-xs uppercase tracking-widest text-bad font-semibold mb-3">Erreur</p>
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-2 break-words">Cette page n’a pas pu se charger.</h1>
      <p className="text-ink-soft max-w-md mx-auto">
        Un problème est survenu de notre côté. Réessayez dans un instant, ou revenez au catalogue.
      </p>
      {error.digest && <p className="text-xs text-ink-mute mt-2 font-mono break-all">réf {error.digest}</p>}
      <button
        onClick={reset}
        className="inline-flex mt-6 h-11 sm:h-10 px-4 items-center rounded-md bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 active:bg-accent/30 transition"
      >
        Réessayer
      </button>
    </div>
  );
}
