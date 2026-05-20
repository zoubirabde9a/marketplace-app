// /dashboard — signed-in landing. Routes anonymous hits to /login; clears
// invalid session cookies on the way out to break any redirect loop from
// the middleware's `/` → `/dashboard` rewrite.

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser, SELLER_COOKIE, syntheticAgentId } from "@/lib/sellerSession";
import { listMySellers, type SellerRecord } from "@/lib/api";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your dashboard",
  // Signed-in surface — keep it out of search indexes; nothing here is
  // useful to crawlers and the URL is per-user-state-dependent.
  robots: { index: false, follow: false },
};

export default async function Dashboard() {
  const me = await getCurrentUser();
  if (!me) {
    const jar = await cookies();
    if (jar.has(SELLER_COOKIE)) jar.delete(SELLER_COOKIE);
    redirect("/login?next=/dashboard");
  }

  const displayName = me.user.displayName ?? me.user.email?.split("@")[0] ?? "there";

  let sellers: SellerRecord[] = [];
  try {
    const r = await listMySellers(me.jwt, syntheticAgentId(me.user.id));
    sellers = r.data;
  } catch {
    sellers = [];
  }

  return (
    <section className="pt-6 sm:pt-10 pb-12 max-w-5xl mx-auto">
      <header className="mb-6 sm:mb-8 px-1">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight break-words">
          Hi, {displayName}.
        </h1>
      </header>
      <YourStores sellers={sellers} />
      <div className="mt-6 px-1">
        <Link
          href="/search"
          className="inline-flex h-11 px-5 items-center justify-center rounded-xl bg-accent text-bg font-medium hover:bg-accent-hover active:brightness-90 transition shadow-glow"
        >
          Browse the catalog →
        </Link>
      </div>
    </section>
  );
}

function YourStores({ sellers }: { sellers: SellerRecord[] }) {
  return (
    <section className="pt-6 sm:pt-10 pb-2 max-w-5xl mx-auto">
      <div className="rounded-2xl border border-line-soft bg-bg-soft/60 p-4 sm:p-5">
        <header className="flex items-baseline justify-between mb-3">
          <h2 className="text-xs uppercase tracking-widest text-ink-mute font-semibold">
            Your stores
          </h2>
          <Link
            href="/seller/dashboard"
            className="inline-flex items-center h-8 text-xs text-ink-soft hover:text-accent active:text-accent transition"
          >
            Manage all →
          </Link>
        </header>
        {sellers.length === 0 ? (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm text-ink-soft">
              You don&apos;t have a store yet.
            </p>
            <Link
              href="/seller/dashboard"
              className="text-sm px-4 h-10 sm:h-9 inline-flex items-center justify-center rounded-md bg-accent text-bg font-medium hover:bg-accent-hover active:brightness-90 transition sm:shrink-0"
            >
              Open a store
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-line-soft">
            {sellers.map((s) => (
              <li key={s.sellerId} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
                <div className="min-w-0 sm:flex-1">
                  <div className="text-ink truncate font-medium">{s.displayName}</div>
                  <div className="text-xs text-ink-mute">
                    {s.productCount} product{s.productCount === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs sm:shrink-0">
                  <Link
                    href={`/seller/products/new?sellerId=${encodeURIComponent(s.sellerId)}`}
                    className="px-3 h-9 sm:h-7 inline-flex items-center rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40 transition"
                  >
                    Add product
                  </Link>
                  <Link
                    href="/seller/dashboard"
                    className="px-3 h-9 sm:h-7 inline-flex items-center rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40 transition"
                  >
                    Manage
                  </Link>
                  <Link
                    href={`/store/${encodeURIComponent(s.sellerId)}`}
                    className="px-3 h-9 sm:h-7 inline-flex items-center rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 active:text-ink active:border-accent/40 transition"
                  >
                    View public
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
