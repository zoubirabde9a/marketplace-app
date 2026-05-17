# Audit: no swap, memory commit at 87% of strict limit

- **Detected:** 2026-05-17 19:42 local
- **Severity:** medium-high — risk of OOM-kill or `ENOMEM` on traffic spike
- **Source:** `free -h`, `/proc/meminfo`, `swapon --show` (vps-eu)

## Evidence

```
MemTotal:      8119480 kB  (~7.7 GiB)
MemAvailable:  2467108 kB  (~2.4 GiB)
SwapTotal:           0 kB
CommitLimit:   4059740 kB  (~3.9 GiB)
Committed_AS:  3526376 kB  (~3.4 GiB)   ← 86.9% of CommitLimit
vm.swappiness: 60          (irrelevant — no swap configured)
```

Currently used: 5.4 GiB / 7.7 GiB. Major resident processes: redis 1.2 GiB, dockerd 835 MiB, four node workers ~570–840 MiB each.

`CommitLimit` is ~4 GiB because `vm.overcommit_memory=2` is the default on some kernels with `overcommit_ratio=50`. With no swap, the kernel refuses allocations once `Committed_AS` would exceed `CommitLimit` — meaning a single ~500 MiB malloc spike (e.g. a large query result, a scraper batch, a node GC fragmentation event) can return `ENOMEM` even though there are 2.4 GiB physically free.

## Hypothesis

This box was provisioned without swap (netcup default) and inherited a strict overcommit configuration. So far it has been stable because steady-state commit sits just under the limit, but the margin is too thin: catalog growth, a larger Redis dataset, or a transient memory leak will push it over.

## Fix steps

1. Confirm the overcommit policy: `cat /proc/sys/vm/overcommit_memory /proc/sys/vm/overcommit_ratio`. If `overcommit_memory=2`, that is what enforces the strict 4 GiB ceiling.
2. Add a swap file (cheapest fix). On a 7.7 GiB box, 4 GiB is sensible:
   ```bash
   sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
   sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   sudo sysctl vm.swappiness=10   # only swap under real pressure
   ```
   This raises `CommitLimit` and gives the kernel headroom for transient spikes without the latency cost of constant swapping.
3. Independently, audit Redis: 1.2 GiB resident is a lot for what this app uses. Confirm `maxmemory` and `maxmemory-policy` are set, otherwise Redis will grow unbounded.
4. Add a basic alert: log/metric when `MemAvailable < 1 GiB` or `Committed_AS / CommitLimit > 0.9`.

## Similar issues to scan for

- Redis container has been up 5 days while api/web are 19 hours — Redis isn't being recreated on api redeploys (correct), but check `INFO memory` for fragmentation and key count growth.
- Postgres container up 9 days, no recent vacuum/analyze visible — with the scrape+prune churn (CLAUDE.md notes deletes match seeds to hold catalog at cap), `catalog.products` table bloat should be checked.
- This box has been up 9 days with no reboot — unrelated to memory but worth noting for the operator (kernel updates may be pending).
