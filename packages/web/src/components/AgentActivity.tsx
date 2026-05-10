// Server component: renders the user's agents + recent action feed. Used on
// the signed-in home page. Accepts pre-fetched data from the API so the home
// page can fetch once and pass through.

import Link from "next/link";
import type { MyActivityResponse } from "@/lib/api";

const STATUS_STYLE: Record<string, string> = {
  ok: "text-ok bg-ok/10 border-ok/30",
  denied: "text-warn bg-warn/10 border-warn/30",
  error: "text-bad bg-bad/10 border-bad/30",
};
// Neutral fallback for unrecognized status values — better than rendering an
// unknown status as 'ok' (success-green) when it might actually be a new
// failure mode. Operators eyeballing the feed should notice unknowns.
const STATUS_STYLE_UNKNOWN = "text-ink-mute bg-bg-elev border-line-soft";

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export function AgentActivity({ data }: { data: MyActivityResponse }) {
  const displayName = data.user?.displayName ?? data.user?.email?.split("@")[0] ?? "there";
  const agentCount = data.agents.length;
  const actionCount = data.recentActions.length;

  return (
    <section className="pt-12 pb-8 max-w-5xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
          Hi, {displayName}.
        </h1>
        <p className="mt-2 text-ink-soft">
          {agentCount === 0
            ? "No agents linked to your account yet."
            : `Watching ${agentCount} agent${agentCount === 1 ? "" : "s"} on your behalf.`}
        </p>
      </header>

      {/* Agents */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-10">
        <div className="lg:col-span-1 rounded-2xl border border-line-soft bg-bg-soft/60 p-5">
          <h2 className="text-xs uppercase tracking-widest text-ink-mute font-semibold mb-3">
            Your agents
          </h2>
          {agentCount === 0 ? (
            <p className="text-sm text-ink-soft">
              No agent linked yet. See <em>How to connect an agent</em> on the right.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.agents.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line-soft bg-bg-elev/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{a.name}</div>
                    <div className="text-xs text-ink-mute font-mono truncate">{a.id}</div>
                  </div>
                  <span className="text-[10px] uppercase tracking-wider text-ink-mute">
                    {a.kind}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Activity feed */}
        <div className="lg:col-span-2 rounded-2xl border border-line-soft bg-bg-soft/60 p-5">
          <header className="flex items-baseline justify-between mb-3">
            <h2 className="text-xs uppercase tracking-widest text-ink-mute font-semibold">
              Recent activity
            </h2>
            <span className="text-xs text-ink-mute">
              {actionCount === 0 ? "no actions yet" : `${actionCount} actions`}
            </span>
          </header>
          {actionCount === 0 ? (
            agentCount === 0 ? <ConnectAgentEmptyState /> : <NoActivityYet />
          ) : (
            <ul className="divide-y divide-line-soft">
              {data.recentActions.map((a) => {
                const styleClass = STATUS_STYLE[a.status] ?? STATUS_STYLE_UNKNOWN;
                return (
                  <li key={a.id} className="py-3 flex items-start gap-3">
                    <span
                      className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md border font-medium ${styleClass}`}
                      title={a.status}
                    >
                      {a.status}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium font-mono truncate">
                        {a.toolName}
                      </div>
                      <div className="text-xs text-ink-mute truncate">
                        <span className="text-ink-soft">{a.agentName}</span>
                        {" · "}
                        <span>{a.scope}</span>
                        {a.errorCode ? <span className="text-bad"> · {a.errorCode}</span> : null}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <time
                        dateTime={a.occurredAt}
                        title={a.occurredAt}
                        className="text-xs text-ink-soft"
                      >
                        {relTime(a.occurredAt)}
                      </time>
                      <div className="text-[10px] text-ink-mute font-mono" aria-label={`Latency ${a.latencyMs} milliseconds`}>
                        {a.latencyMs}ms
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="text-sm text-ink-mute">
        <Link href="/search" className="hover:text-accent">
          Browse the catalog →
        </Link>
      </div>
    </section>
  );
}

function NoActivityYet() {
  return (
    <div className="text-sm text-ink-soft space-y-2">
      <p>Nothing here yet.</p>
      <p className="text-ink-mute">
        Once your agent searches or browses on Teno Store, you&apos;ll see every step it took right here.
      </p>
    </div>
  );
}

function ConnectAgentEmptyState() {
  return (
    <div className="text-sm text-ink-soft space-y-4">
      <div>
        <h3 className="text-ink font-medium mb-1">How to connect an agent</h3>
        <p className="text-ink-mute">
          Teno Store is agent-first: an AI agent shops on your behalf, you watch the
          activity here. To get started, you grant the agent an{" "}
          <strong className="text-ink-soft">Agent Passport</strong> — a delegated,
          scoped, time-limited token bound to the agent&apos;s own keypair.
        </p>
      </div>

      <div>
        <h4 className="text-ink-soft font-medium mb-1">
          Option A · MCP-compatible client (Claude Desktop, etc.)
        </h4>
        <p className="text-ink-mute mb-2">
          Add a new MCP server pointing at the endpoint below. The client handles
          OAuth + DPoP automatically; approve the consent screen and the agent
          shows up here.
        </p>
        <pre className="text-xs bg-bg-elev/80 border border-line-soft rounded-lg p-3 overflow-x-auto font-mono text-ink">
          https://api.teno-store.com/mcp
        </pre>
      </div>

      <div>
        <h4 className="text-ink-soft font-medium mb-1">
          Option B · Custom agent or script
        </h4>
        <p className="text-ink-mute mb-2">
          Have your agent generate a DPoP keypair, then mint a passport against
          your account (you must be signed in — this call uses your session
          cookie):
        </p>
        <pre className="text-xs bg-bg-elev/80 border border-line-soft rounded-lg p-3 overflow-x-auto font-mono text-ink whitespace-pre">
{`curl -X POST https://api.teno-store.com/v1/auth/passports \\
  -H "content-type: application/json" \\
  --cookie "session=<your-session-jwt>" \\
  -d '{
    "agentId": "my-shopper",
    "scopes": ["catalog:read", "cart:write", "checkout:write"],
    "spendCaps": { "currency": "DZD", "perDayMinor": "5000000" },
    "ttlSeconds": 86400,
    "cnfJwk": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." }
  }'`}
        </pre>
        <p className="text-ink-mute mt-2">
          The response is a Passport JWT bound to your agent&apos;s key. The agent
          sends it as <code className="font-mono">Authorization: DPoP &lt;jwt&gt;</code>{" "}
          (with a fresh DPoP proof per request) on calls to{" "}
          <code className="font-mono">/v1/...</code>, <code className="font-mono">/mcp</code>,
          or <code className="font-mono">/a2a</code>.
        </p>
      </div>

      <p className="text-ink-mute">
        Full protocol surface (REST / MCP / A2A / AP2):{" "}
        <a
          href="/.well-known/agents.json"
          className="text-accent hover:underline"
        >
          /.well-known/agents.json
        </a>
        . Once the agent makes its first call, you&apos;ll see every step — tool,
        scope, latency, status — in this feed.
      </p>
    </div>
  );
}
