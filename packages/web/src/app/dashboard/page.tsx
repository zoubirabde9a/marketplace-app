// /dashboard — the signed-in agent-activity view. Was previously the
// signed-in branch of `/`, but mixing per-request cookie reads with the
// SEO landing prevented Next + Cloudflare from edge-caching the homepage.
// Splitting routes lets `/` be fully ISR-cached for crawlers while the
// authenticated experience lives here with its own dynamic policy.
//
// Routing: anonymous users hitting `/dashboard` get bounced to /login with
// a next=/dashboard hint; users with an invalid/expired cookie get the
// cookie cleared on the way out (otherwise the middleware redirect of
// `/` → `/dashboard` would loop).

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser, SELLER_COOKIE, syntheticAgentId } from "@/lib/sellerSession";
import { getMyActivity, listMySellers, type SellerRecord } from "@/lib/api";
import { AgentActivity } from "@/components/AgentActivity";

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
    // If we got here via the middleware redirect, the session cookie was
    // present but invalid. Clear it so the next hit on `/` doesn't bounce
    // back into the same redirect loop, then send the user to /login.
    const jar = await cookies();
    if (jar.has(SELLER_COOKIE)) jar.delete(SELLER_COOKIE);
    redirect("/login?next=/dashboard");
  }

  let activity;
  try {
    activity = await getMyActivity(me.jwt);
  } catch {
    // API hiccup — degrade gracefully to the empty-state view rather than
    // failing the dashboard render.
    activity = {
      user: {
        id: me.user.id,
        email: me.user.email,
        displayName: me.user.displayName,
        picture: me.user.picture,
      },
      agents: [],
      recentActions: [],
    };
  }

  // Sellers the signed-in user owns. The agent-activity view doesn't surface
  // these, so a user who created a store on /seller/dashboard had no way to
  // discover it from the main /dashboard. Best-effort fetch — if it fails
  // we just hide the section.
  let sellers: SellerRecord[] = [];
  try {
    const r = await listMySellers(me.jwt, syntheticAgentId(me.user.id));
    sellers = r.data;
  } catch {
    sellers = [];
  }

  return (
    <>
      <YourStores sellers={sellers} />
      <AgentActivity data={activity} />
    </>
  );
}

function YourStores({ sellers }: { sellers: SellerRecord[] }) {
  return (
    <section className="pt-10 pb-2 max-w-5xl mx-auto">
      <div className="rounded-2xl border border-line-soft bg-bg-soft/60 p-5">
        <header className="flex items-baseline justify-between mb-3">
          <h2 className="text-xs uppercase tracking-widest text-ink-mute font-semibold">
            Your stores
          </h2>
          <Link
            href="/seller/dashboard"
            className="inline-flex items-center h-8 text-xs text-ink-soft hover:text-accent transition"
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
              className="text-sm px-4 h-10 sm:h-9 inline-flex items-center justify-center rounded-md bg-accent text-bg font-medium hover:bg-accent-hover transition sm:shrink-0"
            >
              Open a store
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-line-soft">
            {sellers.map((s) => (
              <li key={s.sellerId} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
                <div className="min-w-0">
                  <div className="text-ink truncate font-medium">{s.displayName}</div>
                  <div className="text-xs text-ink-mute">
                    {s.productCount} product{s.productCount === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs sm:shrink-0">
                  <Link
                    href={`/seller/products/new?sellerId=${encodeURIComponent(s.sellerId)}`}
                    className="px-3 h-9 sm:h-7 inline-flex items-center rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 transition"
                  >
                    Add product
                  </Link>
                  <Link
                    href="/seller/dashboard"
                    className="px-3 h-9 sm:h-7 inline-flex items-center rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 transition"
                  >
                    Manage
                  </Link>
                  <Link
                    href={`/store/${encodeURIComponent(s.sellerId)}`}
                    className="px-3 h-9 sm:h-7 inline-flex items-center rounded-md border border-line text-ink-soft hover:text-ink hover:border-accent/40 transition"
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
