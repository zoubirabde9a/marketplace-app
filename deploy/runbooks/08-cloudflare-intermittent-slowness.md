# Runbook 08 — `teno-store.com` intermittent slowness / hangs

## Symptom

Users report the site "sometimes doesn't work": some requests hang for many seconds, then either load late, surface a Cloudflare 522/524, or fail entirely. Healthy requests are ~200 ms. Refresh sometimes fixes it.

There are **two separate causes**, both real, both producing similar symptoms. Don't conflate them.

| | Cause A — netcup SYN drops | Cause B — client-ISP route to one CF anycast block |
|---|---|---|
| Where | Between netcup edge and vps-eu's NIC | Between specific client ISPs (e.g. Algerie Telecom AS36947) and one of Cloudflare's anycast /16 blocks |
| Affects | Everyone, ~5–25 % of requests | Only users on the affected ISP, ~50 % of requests (those whose OS/browser draws the bad CF IP for that lookup) |
| Signature | ~7.7 s wall clock through CF (5 s CF→origin connect_timeout + retry) | Outright connection timeout; trace dies inside the ISP at hop ~8 |
| Reproduces from vps-eu | Yes (same loss when hitting origin directly from outside) | No (vps-eu hits CF from a different ASN — works fine) |
| Fix | netcup support ticket | ISP-side route fix; or temporarily grey-cloud the CF records; or wait for BGP self-heal |

## Reproduce

From a laptop:

```powershell
node scripts/probe-cf.mjs --count 100
```

When the bug is active you'll see a small subset of requests at ~7.7 s while everything else is sub-second.

## Cause A — netcup SYN drops to vps-eu (verified 2026-05-09)

**Not Cloudflare. Not Caddy. Not the app. It's upstream of vps-eu's NIC.**

A diagnostic session on 2026-05-09 narrowed it to TCP SYN packet loss between the netcup network and the VPS itself:

| Test | Result |
|---|---|
| Direct origin IPv4 (`152.53.147.77`) HTTPS, bypassing Cloudflare, 30 samples | 4/30 timed out at 15 s |
| Direct origin IPv4 SSH (`ssh vps-eu`), 20 samples | 5/20 timed out at 5 s — **same loss rate, different port** |
| Origin reachable from inside the box (`localhost`), 30 samples | 30/30 succeed in 1–7 ms — **app is healthy** |
| Cloudflare-edge `cf-cache-status` on slow samples | `DYNAMIC` — CF can't cache so it inherits the loss |

The 7.7 s figure people see through Cloudflare is the natural consequence: Cloudflare's edge `connect_timeout` to origin is 5 s; on a dropped SYN it retries once, and the retry succeeds in ~2.7 s ≈ **5 + 2.7 = 7.7 s** wall clock at the user.

**Origin-side rules out:**

- `fail2ban-client status` → only `sshd` jail, no Cloudflare /24 banned.
- `ufw status verbose` → simple `ALLOW` on 22/80/443 (v4+v6), no `LIMIT` rate-limit.
- `nstat -az | grep Tcp` → `TcpExtListenDrops=0`, `TcpExtListenOverflows=0`, `TcpExtTCPBacklogDrop=0`, `TcpExtSyncookiesSent=0`. **The kernel never sees the dropped SYNs.**
- `nf_conntrack_count`: 251 of 262144 — nowhere near saturation.
- `ip -s link show eth0` → RX errors 0, dropped 5 (lifetime), TX errors 0.
- `docker compose ps` → all containers healthy.
- `caddy logs` → no upstream timeouts, no errors.
- `traceroute` from outside ends at `213.248.93.169` (Telia → netcup edge); subsequent hops are ICMP-filtered inside netcup.

### Action for cause A: netcup support ticket

The operator has to do this — it requires the netcup customer login.

Suggested ticket text:

> **Subject:** Random TCP SYN packet loss to VPS (152.53.147.77) — affecting all ports
>
> I'm seeing reproducible TCP SYN packet loss to my VPS at IPv4 `152.53.147.77` (server v2202605356582457645, Nuremberg). The loss rate is roughly 5–25 % and is independent of port — both `:22` and `:443` show the same drop rate when probed from external clients.
>
> What I've ruled out on the VPS side: `nf_conntrack` not saturated (251/262144), kernel sees `TcpExtListenDrops=0` / `TcpExtTCPBacklogDrop=0`, NIC RX errors 0, no `ufw` rate-limit rule, no fail2ban ban affecting external clients. From inside the box, the app responds in <10 ms; the dropped SYNs do not appear to reach the host kernel at all.
>
> Reproducer (from outside): `for i in $(seq 1 30); do curl -sS -k -o /dev/null --resolve example:443:152.53.147.77 -w "%{http_code} %{time_total}s\n" --max-time 15 https://152.53.147.77; done` — expect ~10 % to time out at 15 s.
>
> Could you check the hypervisor/network path for this VPS for asymmetric routing, neighbor saturation, or stochastic SYN drops? Sample timestamps available on request.

## Cause B — client ISP has a broken route to one CF anycast /16 (verified 2026-05-09)

While debugging from a laptop on **Algerie Telecom (AS36947)**, multiple Cloudflare anycast IP blocks were intermittently unreachable. The exact block that was broken **shifted over the course of one debugging session**:

| Time (2026-05-09) | Working from laptop | Broken from laptop |
|---|---|---|
| Earlier in the session | `104.21.84.29` (104.16.0.0/13) | `172.67.185.97` (172.64.0.0/13) |
| Two hours later | both above worked | `188.114.96.5` and `188.114.97.5` (188.114.96.0/20) |

`tracert` to a broken IP died at hop 8 inside Algerie Telecom's edge (`41.110.38.3 → blackhole`); the same trace to a working IP completed cleanly to Cloudflare in ~100 ms.

DNS for `teno-store.com` returns two A records and two AAAA records, picked by Cloudflare from a wider anycast pool. The pool **rotates over time** — at different moments DNS returns different IPs from different /16 or /20 blocks. Whichever block the client draws is the one the connection has to traverse. If that block happens to be the one currently broken on the user's ISP, every request fails. If they refresh DNS (or just wait a few minutes for the resolver TTL) and draw a different block, the site works again.

This explains:
- "Sometimes it works, sometimes it doesn't" — depends on which CF block the OS drew.
- "It worked yesterday but is broken today" — the broken block shifted.
- "Refresh fixes it eventually" — DNS expiry hands a fresh roll of the dice.

**Reproducing cause B from the affected network** — which block is broken changes over time, so test current candidates:

```bash
# 1. Find what the resolver currently returns:
nslookup -type=A teno-store.com 1.1.1.1
nslookup -type=AAAA teno-store.com 1.1.1.1

# 2. Force-resolve to each returned A and compare. One or more will hang at -m,
#    while others return 200 in ~200 ms:
for ip in <ip1> <ip2> 104.21.84.29 172.67.185.97 188.114.96.5; do
  echo "--- $ip ---"
  curl -sS -o /dev/null --resolve teno-store.com:443:$ip -w "%{http_code} %{time_total}s\n" -m 8 https://teno-store.com
done

# 3. tracert to a hanging IP — packets should die inside the ISP, not at CF:
tracert -d -h 12 <hanging-ip>
```

If the same probes from `ssh vps-eu` work fine, cause B is confirmed (it's an ISP-to-CF path issue, not Cloudflare and not origin).

### Action for cause B (when it appears)

There is **no server-side fix.** The broken hop is in the affected ISP's network, between the user and Cloudflare. Options:

1. **Wait for BGP self-heal.** AT-style routing flaps usually clear within hours-to-days.
2. **Grey-cloud the Cloudflare records temporarily.** DNS then returns vps-eu's origin IP directly. Caveats: exposes origin IP permanently (can be archived even after re-orange), gives up DDoS/WAF, gives up edge caching. See the 2026-05-09 CHANGELOG entry for the full pro/con. **Default is to keep orange and accept the intermittency** unless impact is severe.
3. **Report to the affected ISP's NOC** that they have a broken route to `172.67.0.0/16` (or whichever CF block traces blackhole). They are slow.
4. **If users on a specific ISP report it persistently**, set up a non-CF backup hostname (e.g. `direct.teno-store.com` grey-cloud → origin IP) so users can switch domains as a last resort. Not recommended unless the issue is recurrent for that ISP.

**Note on going grey if you do choose to:** when re-enabling proxy later, immediately add a `ufw` rule allowing 80/443 only from Cloudflare's published ranges (the same list already in `Caddyfile` `trusted_proxies`), so the now-public origin IP can't be hit directly.

## Mitigations relevant to both causes

These reduce user impact but do not fix the underlying loss. Pick the simplest first.

1. **Edge-cache the signed-out landing pages** (operator-side; Next.js change). Currently every page is `force-dynamic` because of the `mp_session` cookie, so Cloudflare can't cache HTML and any origin-side blip hits visitors. Splitting into a public cached path (no cookie) + a dynamic path (cookie present) lets Cloudflare serve cached HTML when origin is briefly unreachable. Tracked in [`OPEN_QUESTIONS.md`](../../OPEN_QUESTIONS.md).
2. **Cloudflare → Caching → Configuration → Cache Rules**: add a rule that caches HTML for `/`, `/search`, `/product/*` for ~60 s when there's no `mp_session` cookie. Buys cache resilience without touching code. Operator does this in CF dashboard.
3. **Cloudflare → Argo Smart Routing** ($5/mo) routes around lossy paths between CF and origin. Probably defers the netcup conversation rather than ending it; only worth doing if netcup support is slow.

## Verification after a fix

```powershell
node scripts/probe-cf.mjs --count 200
```

Pass criterion: 0 slow (>3 s) requests across 200 samples.

## Append to CHANGELOG when done

```
## YYYY-MM-DD — fix: SYN packet loss to vps-eu (runbook 08)
- Root cause: <e.g. netcup hypervisor migration / network reconfig>
- Fix: <ticket #, what netcup did>
- Verified with `node scripts/probe-cf.mjs --count 200` — 0/200 slow.
```
