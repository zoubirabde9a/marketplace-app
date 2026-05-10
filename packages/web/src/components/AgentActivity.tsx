// Server component: renders the user's agents + recent action feed. Used on
// the signed-in home page. Accepts pre-fetched data from the API so the home
// page can fetch once and pass through.

import Link from "next/link";
import type { MyActivityResponse } from "@/lib/api";
import { CopyButton } from "./CopyButton";

const MCP_URL = "https://api.teno-store.com/mcp";

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
    <div className="text-sm text-ink-soft space-y-6">
      <div>
        <h3 className="text-ink font-medium text-base mb-1">Set up your shopping agent</h3>
        <p className="text-ink-mute">
          Teno Store is shopped by AI agents on your behalf. You watch what they do here.
          You&apos;ll need an AI app that can connect to outside services — most popular is{" "}
          <strong className="text-ink-soft">Claude Desktop</strong>. Pick one below.
        </p>
      </div>

      {/* Primary path: Claude Desktop */}
      <div className="rounded-xl border border-line-soft bg-bg-elev/40 p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h4 className="text-ink font-medium">Use with Claude Desktop</h4>
            <p className="text-xs text-ink-mute mt-0.5">Recommended · free · 5 minutes</p>
          </div>
          <a
            href="https://claude.ai/download"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-bg-soft border border-line-soft text-xs hover:border-accent/40 transition shrink-0"
          >
            Download Claude →
          </a>
        </div>

        <ol className="space-y-3 text-ink-soft">
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-bg-soft border border-line-soft text-xs font-medium flex items-center justify-center text-ink-mute">1</span>
            <span>
              Install <strong className="text-ink">Claude Desktop</strong> (link above) and sign in.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-bg-soft border border-line-soft text-xs font-medium flex items-center justify-center text-ink-mute">2</span>
            <span>
              In Claude Desktop, open <strong className="text-ink">Settings → Connectors → Add custom connector</strong>{" "}
              and paste this address:
            </span>
          </li>
          <li className="ml-9 flex items-center gap-2">
            <code className="flex-1 font-mono text-xs bg-bg/60 border border-line-soft rounded-md px-3 py-2 text-ink truncate">
              {MCP_URL}
            </code>
            <CopyButton value={MCP_URL} label="Copy" copiedLabel="Copied" />
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-bg-soft border border-line-soft text-xs font-medium flex items-center justify-center text-ink-mute">3</span>
            <span>
              Claude will pop up a sign-in window for Teno Store and ask you to approve.
              Click <strong className="text-ink">Allow</strong>. That&apos;s it — your agent is connected.
            </span>
          </li>
        </ol>

        <p className="mt-4 text-xs text-ink-mute">
          Now ask Claude things like <em>&quot;Find me a Samsung phone under 50,000 DZD&quot;</em> or{" "}
          <em>&quot;What&apos;s the cheapest iPhone available?&quot;</em>. Every search and click will show up
          on this page in real time.
        </p>
      </div>

      {/* Secondary path: any other MCP-compatible app */}
      <div className="rounded-xl border border-line-soft bg-bg-elev/40 p-4">
        <h4 className="text-ink font-medium mb-1">Use with another AI app</h4>
        <p className="text-ink-mute text-xs mb-3">
          Any app that supports the Model Context Protocol (MCP) works the same way —
          ChatGPT desktop, Cursor, Zed, custom assistants. Add this as a new MCP server:
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 font-mono text-xs bg-bg/60 border border-line-soft rounded-md px-3 py-2 text-ink truncate">
            {MCP_URL}
          </code>
          <CopyButton value={MCP_URL} label="Copy" copiedLabel="Copied" />
        </div>
      </div>

      {/* Hidden until needed */}
      <details className="group">
        <summary className="cursor-pointer text-xs text-ink-mute hover:text-ink-soft list-none flex items-center gap-1.5">
          <span className="transition group-open:rotate-90">▸</span>
          For developers · build your own agent
        </summary>
        <div className="mt-3 pl-4 space-y-3 text-xs text-ink-mute">
          <p>
            The full protocol surface (REST / MCP / A2A / AP2) is documented at{" "}
            <a href="/.well-known/agents.json" className="text-accent hover:underline">
              /.well-known/agents.json
            </a>. To mint an Agent Passport directly:
          </p>
          <pre className="bg-bg/60 border border-line-soft rounded-lg p-3 overflow-x-auto font-mono text-ink whitespace-pre">
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
          <p>
            Returns a DPoP-bound Passport JWT. Send it as{" "}
            <code className="font-mono">Authorization: DPoP &lt;jwt&gt;</code> on calls to{" "}
            <code className="font-mono">/v1/...</code>, <code className="font-mono">/mcp</code>, or{" "}
            <code className="font-mono">/a2a</code>.
          </p>
        </div>
      </details>
    </div>
  );
}
