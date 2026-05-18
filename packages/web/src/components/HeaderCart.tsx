// Header cart icon + count. Reads the cart cookie on the server and shows the
// total line quantity. Wrapped in Suspense by the Header so a slow API call
// doesn't block the shell — and absent a cart cookie we skip the API entirely.

import Link from "next/link";
import { getCart } from "@/lib/cart";

export async function HeaderCart() {
  const cart = await getCart().catch(() => null);
  const count = cart?.lines.reduce((acc, l) => acc + l.qty, 0) ?? 0;
  return (
    <Link
      href="/cart"
      aria-label={
        count > 0
          ? `Panier (${count} article${count === 1 ? "" : "s"})`
          : "Panier (vide)"
      }
      className="relative inline-flex items-center px-3 h-9 rounded-md hover:text-ink hover:bg-bg-elev active:bg-bg-elev transition"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
        <path d="M3 3h2l2.4 12.5A2 2 0 0 0 9.4 17h8.2a2 2 0 0 0 2-1.5L21 7H6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="10" cy="20" r="1.4" />
        <circle cx="17" cy="20" r="1.4" />
      </svg>
      {count > 0 && (
        <span
          className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-bg text-[10px] font-semibold leading-[18px] text-center"
          aria-hidden
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
