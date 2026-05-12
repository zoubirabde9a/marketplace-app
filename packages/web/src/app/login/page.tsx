// /login — unified buyer + seller + agent-link landing page.
//
// Three states:
//   1. ?code=<link-token>   — agent-issued one-time login. Auto-exchange on
//                             mount; on success, redirect to ?next=… (or "/").
//   2. ?next=<path>         — generic sign-in (e.g. clicked "Sign in" on a
//                             page that requires auth). After Google success,
//                             redirect to that path.
//   3. (no params)          — user just visited /login directly. Generic
//                             sign-in landing.

import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/sellerSession";
import { GoogleSignInButton } from "../seller/GoogleSignInButton";
import { ExchangeLinkClient } from "./ExchangeLinkClient";

// NEXT_PUBLIC_* because this client ID is shipped to the browser, and Next
// inlines it into the bundle at build time. Mirror of seller/page.tsx so
// both surfaces use the same Google OAuth client.
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

interface LoginSearchParams {
  code?: string | string[];
  next?: string | string[];
  reason?: string | string[];
}

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function safeNext(raw: string | undefined): string {
  // Default destination after sign-in is /dashboard (the agent-activity
  // view). Previously defaulted to /, which is now a static marketing
  // landing — landing a freshly-signed-in user on the marketing page
  // would feel wrong. Callers that pass an explicit `next` (e.g. links
  // from gated pages) override this default.
  if (!raw) return "/dashboard";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<LoginSearchParams>;
}) {
  const sp = await searchParams;
  const code = one(sp.code);
  const next = safeNext(one(sp.next));
  const reason = one(sp.reason);

  // Already signed in? Send them home.
  const me = await getCurrentUser();
  if (me && !code) redirect(next);

  return (
    <div className="pt-16 pb-24 max-w-md mx-auto" lang="fr">
      <h1 className="text-3xl font-semibold tracking-tight mb-2 text-center">Connexion</h1>
      <p className="text-ink-soft text-center mb-8">
        Consultez ce que votre agent a cherché, comparé et acheté.
      </p>

      {code ? (
        <div className="rounded-2xl border border-accent/40 bg-accent/5 p-5 mb-6">
          <h2 className="font-medium text-accent mb-1">Un agent vous a invité</h2>
          <p className="text-sm text-ink-soft mb-4">
            L’un de vos agents IA a généré ce lien. Cliquez ci-dessous
            pour réclamer votre session.
          </p>
          <Suspense fallback={<p className="text-sm text-ink-mute">Échange en cours…</p>}>
            <ExchangeLinkClient code={code} next={next} />
          </Suspense>
        </div>
      ) : null}

      {reason === "session-required" ? (
        <p className="rounded-xl border border-line-soft bg-bg-soft/60 px-4 py-3 text-sm text-ink-soft mb-6">
          Cette page nécessite une connexion.
        </p>
      ) : null}

      <div className="rounded-2xl border border-line-soft bg-bg-soft/60 p-6">
        {GOOGLE_CLIENT_ID ? (
          <>
            <GoogleSignInButton
              clientId={GOOGLE_CLIENT_ID}
              apiPath="/api/auth/session"
              nextHref={next}
            />
            <noscript>
              <p className="mt-3 text-sm text-warn">
                La connexion nécessite JavaScript. La navigation publique
                du catalogue fonctionne sans — essayez{" "}
                <a href="/search" className="text-accent hover:underline">
                  /search
                </a>
                .
              </p>
            </noscript>
          </>
        ) : (
          <p className="text-sm text-bad" role="alert">
            La connexion est mal configurée. Merci de contacter l’opérateur.
          </p>
        )}
      </div>
    </div>
  );
}

export const metadata = {
  title: "Connexion",
  description: "Connectez-vous à Teno Store — le marketplace d’agent à agent.",
  alternates: { canonical: "/login" },
  robots: { index: false, follow: false },
};
