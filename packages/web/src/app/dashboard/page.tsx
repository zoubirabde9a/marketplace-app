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
import { getCurrentUser, SELLER_COOKIE } from "@/lib/sellerSession";
import { getMyActivity } from "@/lib/api";
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
  return <AgentActivity data={activity} />;
}
