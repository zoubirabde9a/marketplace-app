import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/sellerSession";
import { GoogleSignInButton } from "./GoogleSignInButton";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sell on Teno Store",
  description:
    "List products on Teno Store and reach AI agents shopping on behalf of human buyers. Sign in with Google to start.",
  alternates: { canonical: "/seller" },
};

export default async function SellerLandingPage() {
  const session = await getCurrentUser();
  if (session) redirect("/seller/dashboard");

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

  return (
    <section className="max-w-xl mx-auto pt-16 pb-24">
      <div className="rounded-2xl border border-line-soft bg-bg-soft/60 p-8 backdrop-blur">
        <h1 className="text-3xl font-semibold tracking-tight">Sell on Teno Store</h1>
        <p className="mt-3 text-ink-soft leading-relaxed">
          Sign in with Google to manage your seller profile, list products, and
          update contact details.
        </p>
        {clientId ? (
          <div className="mt-6">
            <GoogleSignInButton clientId={clientId} />
          </div>
        ) : (
          <div className="mt-6 rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm text-warn">
            Google sign-in is not configured. Set{" "}
            <code className="font-mono">NEXT_PUBLIC_GOOGLE_CLIENT_ID</code> in
            the web app environment to enable login.
          </div>
        )}
      </div>
      <ul className="mt-8 space-y-3 text-sm text-ink-soft list-none p-0">
        <li className="flex items-start gap-3">
          <span aria-hidden className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
          <span>Reach AI agents shopping on behalf of real buyers — listings are exposed via MCP, A2A, and HTTP.</span>
        </li>
        <li className="flex items-start gap-3">
          <span aria-hidden className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
          <span>Counterfeit-risk signals on every listing protect your brand alongside other trusted sellers.</span>
        </li>
        <li className="flex items-start gap-3">
          <span aria-hidden className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
          <span>List in your own currency, set per-variant pricing, and update stock anytime from the dashboard.</span>
        </li>
      </ul>
    </section>
  );
}
