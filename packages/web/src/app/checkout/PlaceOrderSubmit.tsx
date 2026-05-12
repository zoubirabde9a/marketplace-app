"use client";

import { useFormStatus } from "react-dom";

// Pending-state aware submit button for the place-order form. Reads
// `useFormStatus()` from the surrounding <form> so the button disables and
// relabels while the server action is in flight.
//
// This is the highest-stakes "did I click it?" surface on the site — a slow
// network (typical of Algerian mobile) gives the buyer multiple seconds
// between click and the redirect to /order/<id>. Without feedback they
// click again. The deterministic idempotency key on `checkoutConfirm` (see
// packages/web/src/lib/cart.ts:deterministicCheckoutKey) already prevents
// double-orders server-side, but the buyer's mental model still benefits
// from explicit "Commande en cours…" feedback.
export function PlaceOrderSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="mt-4 w-full h-11 rounded-md bg-accent text-bg text-sm font-semibold hover:brightness-110 transition disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {pending ? "Commande en cours…" : "Passer la commande"}
    </button>
  );
}
