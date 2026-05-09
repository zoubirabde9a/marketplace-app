# @marketplace/web

Read-only **observer UI** for human principals. The marketplace is agent-native (see `SPEC.md`); this package adds a web mirror so a human can click a link from their agent and see exactly which search filters and products the agent considered.

## What it shows

- **`/`** — landing page.
- **`/search?q=…&category=…&brand=…&priceMin=…&…`** — full search, every filter encoded in the URL so the agent can hand the user a deep link.
- **`/product/[id]`** — photo gallery (with lightbox), variants, prices, attributes, seller, ship-to list, counterfeit-risk badge.

All seller-supplied content is rendered with a small dot marker (`.untrusted`) and is never executed as instructions — see SPEC §8a.1.

## How the agent links here

The MCP `catalog.search` and `catalog.get_product` tools include a `webUrl` field whenever the env var `MARKETPLACE_WEB_BASE_URL` is set. The agent passes that URL back to the human as a clickable link.

## Running

```bash
# from repo root
pnpm install
pnpm --filter @marketplace/web dev
# → http://localhost:3200
```

Set `MARKETPLACE_API_URL` to the running REST API (default `http://localhost:3000`).
Set `MARKETPLACE_WEB_BASE_URL=http://localhost:3200` in the MCP server's environment so links the agent emits point here.

## Stack

- Next.js 15 (App Router, RSC, Suspense)
- React 19
- Tailwind CSS 3
- TypeScript 6.0.3 (workspace catalog)
