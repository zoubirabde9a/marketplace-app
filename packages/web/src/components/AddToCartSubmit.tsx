"use client";

import { useFormStatus } from "react-dom";

// Pending-state aware submit button for the AddToCart form. Reads
// `useFormStatus()` from the nearest <form> so we can disable + relabel the
// button while the server action is in flight. Without this the buyer saw
// no feedback between click and the post-add redirect; on slow networks
// that's a multi-second silent gap that produced double-submits.
//
// Server-component AddToCart.tsx renders this client component inside the
// plain <form action={addAction}>; the form itself still submits without JS.
export function AddToCartSubmit({
  inStock,
  label,
  pendingLabel = "Ajout en cours…",
}: {
  inStock: boolean;
  label: string;
  // Override the in-flight label per surface. The default ("Ajout en cours…")
  // matches the default "Ajouter au panier" caller. The "Buy now" instance on
  // the product detail page passes "Achat en cours…" so the semantics match
  // (the user clicked "Acheter maintenant", not "Ajouter au panier").
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={!inStock || pending}
      aria-busy={pending}
      className="inline-flex items-center justify-center h-11 sm:h-10 px-5 rounded-md bg-accent text-bg text-sm font-medium hover:brightness-110 active:brightness-90 disabled:opacity-40 disabled:cursor-not-allowed transition"
    >
      {!inStock ? "Rupture de stock" : pending ? pendingLabel : label}
    </button>
  );
}
