# Audit: `/_next/image` saturates one Node core, ~90 % of all traffic

- **Detected:** 2026-05-17 19:47 local (server time 17:47 UTC)
- **Severity:** medium-high — already caused a load spike to 3.80 and pushed available RAM down to 1.6 GiB
- **Source:** caddy access log + `ps`/`top` on vps-eu

## Evidence

In a 5-minute window:

```
total requests:        1013
/_next/image:           908   (89.6%)
all other paths:        105
status 0 (aborted):      27
load average (start):  0.30, 0.36, 0.49
load average (peak):   3.80, 1.49, 0.88
one node process:      149 % CPU, 374 MB RSS
MemAvailable:          2.4 GiB → 1.6 GiB during the window
```

Distinct image URLs being optimized point at Ouedkniss CDN origins:

```
/_next/image?url=https%3A%2F%2Fcdn7.ouedkniss.com%2F200%2Fmedias%2F...   (top hit, 26 reqs)
/_next/image?url=https%3A%2F%2Fcdn9.ouedkniss.com%2F200%2F...
/_next/image?url=https%3A%2F%2Fcdn8.ouedkniss.com%2F400%2F...
```

The catalog stores Ouedkniss CDN URLs verbatim (see CLAUDE.md: "Image bytes are not stored locally — `catalog.media.url` holds the original Ouedkniss CDN URL"), so the Next.js `<Image>` component routes each one through `/_next/image`, which downloads from the remote CDN, transcodes with sharp, and re-emits. That cost is paid by our single Node web process.

## Hypothesis

Two compounding causes:

1. **Origin does all the work.** Cloudflare's default cache rules don't cache responses with query strings unless explicitly configured. Every distinct `?url=…&w=…&q=…` is a separate cache key, and with ~55 k products × multiple sizes the long tail is huge — origin is hit constantly.
2. **Sharp is single-threaded per request and the web container has one Node main process.** A burst of unique images means concurrent sharp invocations queue on the event loop and pin the CPU.

## Fix steps

### Cheap, no code change
- In Cloudflare → Caching → Cache Rules: add a rule for `URI Path equals /_next/image` → "Eligible for cache", "Cache Level: Cache Everything", `Edge TTL` ≥ 7 days. Optionally set `Browser TTL` to 1 day. This collapses the long tail to one origin hit per (url, width, quality) combo.
- Operator action — not doable from this session per CLAUDE.md.

### Medium effort
- Configure `next.config.js` `images.remotePatterns` + a longer `minimumCacheTTL` so that even local-disk cache survives container restarts. Currently each new container starts cold.
- Mount a persistent volume at `/app/.next/cache/images` so the optimizer's local cache survives `docker compose up -d web` redeploys (web was just redeployed at 19:47 — its image cache is empty as of now, which guarantees the next traffic burst lands hot on sharp again).

### Bigger
- Stop proxying remote images. Either (a) rewrite `catalog.media.url` to point at a Cloudflare Worker / R2 / locally-cached object, or (b) emit `<img>` directly to `cdn*.ouedkniss.com` without going through `/_next/image` — accept that you lose responsive sizes but you give up the CPU bottleneck.

## Update 2026-05-17 20:19 — first confirmed 504

A Facebook crawler (`meta-externalagent/1.1`) just received a **504 Gateway Timeout** after 7.01 s on `/_next/image?url=…cdn9.ouedkniss.com/…&w=48&q=75`. This is the predicted user-visible failure mode: the image optimizer queue grows long enough that Caddy gives up before Next.js responds. Caddy log line:

```
status=504 duration=7.01s ua=meta-externalagent/1.1
uri=/_next/image?url=https%3A%2F%2Fcdn9.ouedkniss.com%2F200%2Fmedias%2Fannouncements%2Fimages%2F59rrXv%2F…&w=48&q=75
```

Priority on the Cloudflare Cache Rule fix is higher than originally stated — we are now timing out on real crawler traffic.

## Update 2026-05-17 22:24 — second recurrence, this time degrading SSH

Load spiked to 2.21 (vs ~0.5 baseline) and external latency went 10× normal — `https://api.teno-store.com/livez` returned 200 in 1.26 s (normally 60 ms), home in 1.44 s. Two consecutive SSH attempts to the box at 22:18 and 22:23 timed out before the diagnostic third attempt got through; CPU contention with sshd is the likely cause.

5-minute Caddy sample during the spike:

```
total requests: 894
/_next/image:   888  (99.3 %)
top IPs:        172.18.0.1 (873)      ← SSR render-time fetches
                57.141.20.18 / .44 / .68  ← Meta crawler
                5.255.231.199          ← Yandex crawler
5xx:            0
slow >3s:       1   (/product/<uuid> at 3.32 s)
```

Same root cause as the 19:47 and 20:19 episodes. The Cloudflare Cache Rule fix is still not in place; pattern will keep recurring on every crawler sweep.

**22:43 — escalation to total request failure.** A `curl https://teno-store.com/` from off-host timed out at the 15 s mark (status 000, no body). An SSH attempt in the same window also timed out. Three retries 30 s later all succeeded in 400–500 ms. So the saturation windows are now brief but severe enough that **at least one user request just got dropped entirely**, not merely served slowly. The `/_next/image` call rate during the surrounding 5 min was 881 — same sustained baseline, with a transient spike inside it.

**2026-05-18 17:00 — new failure surface: docker DNS resolution.** Two 502s on `/_next/image` requests from `meta-externalagent/1.1`. Caddy log:

```
status=502 duration=3.003s
err: "dial tcp: lookup web: i/o timeout"
```

This is mechanistically different from the previous 504s (sharp queue exhaustion). Caddy's reverse-proxy resolver could not get a docker-DNS answer for the `web` container name within its 3 s dial timeout. Likely cause: the docker daemon is under enough load (from spinning up scrape-loop containers + sharp work + image fetches) that internal DNS resolution is briefly starved. Same overall root cause domain — too much origin work for a single-host setup — but it widens the failure surface: now even healthy `web` instances are intermittently unreachable from caddy. Fix lever is unchanged: the Cloudflare Cache Rule on `/_next/image` collapses the load that produces this contention.

## Similar issues to scan for

- The single Node process pinned at 149 % CPU is the only process serving SSR. While it is busy on image optimization, category/product page renders also slow down — the same client (`136.117.185.78`) saw `3.8 s` responses for `/c/*` and `/product/*`. So image optimization contention is also degrading page TTFB for real users. See related audit `2026-05-17-1947-aggressive-crawler-136-117-185-78.md`.
- The Next.js web container does not appear to have a memory limit set in `docker-compose.prod.yml` (it isn't in `docker stats` until it allocates). Combined with no swap (see `2026-05-17-1942-no-swap-commit-near-limit.md`), a sharp memory spike from a large image could OOM-kill it.
- Web container was just redeployed at 19:47 (Up 28 s), `marketplace-api-migrate` Exited 0 in the same window. Standard deploy, not an incident, but worth recording: deploys discard any in-memory or local-disk image cache.
