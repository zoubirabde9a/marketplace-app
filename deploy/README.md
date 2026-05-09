# `deploy/` — production deployment notes

This folder is the source of truth for **how this app gets deployed**, **which servers we own**, and **what we did to them**. If a teammate needed to recreate our production environment from scratch, everything they need should be either in this folder or referenced from it.

Nothing in this folder gets executed by the build. It's documentation + runbooks + non-secret config.

## Layout

```
deploy/
├── README.md                  ← you are here
├── servers.md                 ← list of every machine we own (no secrets)
├── dns.md                     ← domains we own, DNS records, Cloudflare settings
├── protocols.md               ← what protocols/tools we use and why
├── CHANGELOG.md               ← dated log of what we did when
├── .env.example               ← template for deploy/.env (passwords, etc.)
├── .env                       ← real secrets, gitignored, never committed
├── .gitignore                 ← belt-and-braces: don't commit .env
└── runbooks/
    ├── 01-provision-vps.md    ← buying & receiving a VPS
    ├── 02-ssh-bootstrap.md    ← getting key-based SSH working
    ├── 03-harden-server.md    ← firewall, disable root login, fail2ban (TODO)
    ├── 04-install-docker.md   ← Docker + Compose plugin (TODO)
    ├── 05-deploy-app.md       ← bring up the marketplace stack (TODO)
    ├── 06-seed-catalog.md     ← populate the prod catalog with Algerian-style listings
    ├── 07-deploy-changes.md   ← how to deploy a code change to vps-eu
    └── 99-disaster-recovery.md ← what to do if the box dies
```

## Conventions

- **Every server gets a short name.** We refer to it everywhere by that name (e.g. `vps-eu`), never by IP. The IP can change; the name shouldn't.
- **The short name is also the SSH alias.** `ssh vps-eu` Just Works. The mapping name → host lives in `~/.ssh/config` on each operator's machine; the canonical record lives in `servers.md`.
- **Secrets never enter git.** They live in `deploy/.env` (gitignored). When `deploy/.env.example` lists a key, the real value goes in `deploy/.env`.
- **Every change to a server gets a CHANGELOG.md line.** Date + server name + what we did. This is the only audit trail we have for ad-hoc work.
- **Runbooks are numbered.** They are meant to be executed in order on a fresh server. If a runbook has been completed for a given server, note it in `servers.md` against that server.

## Quick links

- **Production status snapshot** → [`STATUS.md`](./STATUS.md) (start here)
- Server list & current state → [`servers.md`](./servers.md)
- Domains, DNS records, Cloudflare settings → [`dns.md`](./dns.md)
- SEO state, what's indexed, what's left → [`seo.md`](./seo.md)
- What we use and why → [`protocols.md`](./protocols.md)
- Activity log → [`CHANGELOG.md`](./CHANGELOG.md)
- First-time SSH setup for a new operator → [`runbooks/02-ssh-bootstrap.md`](./runbooks/02-ssh-bootstrap.md)
