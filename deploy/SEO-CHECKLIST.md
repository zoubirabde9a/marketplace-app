# SEO & Visibility Checklist — teno-store.com

A step-by-step list of actions only you (the operator) can do to get the site found on Google, Bing, and across Algeria. Items are ordered by **biggest impact for least effort first**. Work top-down.

**Total estimated time: ~6 to 8 hours** spread across one or two sittings, plus ongoing waiting periods (directory approvals, indexing) that don't need your attention.

**If you only have 30 minutes today, do items 1, 2, and 5.** Those three put the site on the map for Google and unblock the search engine bots.

---

## Already done by the dev side (no action needed) — 2026-05-13

For context, here's what's already shipped on the site so you can answer questions if Google Search Console asks. You don't need to do anything for these; they're just informational.

- **Sitemap** at `https://teno-store.com/sitemap.xml` — auto-generated, lists every product, brand, seller, and category landing. ~14k+ URLs, refreshed every 30 min.
- **RSS feed** for the blog at `https://teno-store.com/blog/rss.xml`. AI search engines (ChatGPT/Perplexity/Bing Chat) follow this for content discovery.
- **Blog** with 4 long-form French posts (smartphone buyer guide, seller advice, used-car checklist, student laptop guide). Located at `/blog`.
- **Category landing pages** at `/c/<category>` for every category in the catalog (telephones, informatique, immobilier, voitures, etc.) — 29 hand-written French entries with FAQ sections that are eligible for Google's expandable FAQ rich results.
- **Structured data**: Product, Organization, WebSite (with SearchAction = sitelinks search box), BreadcrumbList, FAQPage, BlogPosting (with Article rich-result eligibility), CollectionPage, ProductGroup, Speakable (voice search) — all live and validate clean.
- **Open Graph cards**: dedicated 1200×630 PNGs for `/`, `/about`, `/search`, `/seller`, `/blog`, every `/blog/<slug>`, every `/c/<slug>`, and every `/store/<seller-id>`. Products use the seller's hero image.
- **Hreflang**: `fr-DZ` + `x-default` correctly emitted on every indexable route.
- **robots.txt** allows all major search bots + the AI crawler fleet (GPTBot, ClaudeBot, PerplexityBot, etc.) and disallows authenticated routes (`/seller/dashboard`, `/login`, `/api/`, private snapshot links).
- **IndexNow** integration: `https://teno-store.com/81b0a3ff408a96ef5c0381a78aae7f58.txt` host-key in place. New URLs are pushed to Bing/Yandex/Seznam/Naver on every deploy (the dev side runs `node packages/web/scripts/indexnow-ping.mjs` or the older `scripts/indexnow-submit.mjs` for the full sitemap).
- **`max-image-preview: large`** in the site-wide robots meta so Google can show full-width images in SERP cards (the default is small thumbs).

---

## 1. Google Search Console — verify the domain and submit the sitemap

**Time: 15 minutes (plus ~1 hour wait for DNS to propagate)**
**Why it matters:** Until Google knows the site exists, no one searching on Google will ever find it. This is the single most important step.

1. Go to https://search.google.com/search-console/welcome
2. Click **"Domain"** (left card, not "URL prefix") and enter `teno-store.com`.
3. Google will show a **TXT record** that starts with `google-site-verification=...`. Copy it.
4. Log into your **netcup customer portal** (https://www.customercontrolpanel.de/) → DNS for `teno-store.com` → add a new record:
   - Type: `TXT`
   - Host/Name: `@` (or leave blank for root)
   - Value: paste the `google-site-verification=...` string
5. Save. Wait 10-30 minutes, then click **Verify** in Search Console.
6. Once verified, in the left menu click **Sitemaps**, paste `https://teno-store.com/sitemap.xml`, click **Submit**.
7. Then click **URL Inspection** (top search bar), paste each of these one at a time and click **"Request indexing"**:
   - `https://teno-store.com/`
   - `https://teno-store.com/search`
   - `https://teno-store.com/blog` (if it exists — skip if not)
   - 2-3 popular product URLs from the catalog

---

## 2. Bing Webmaster Tools — import from Google

**Time: 10 minutes**
**Why it matters:** Bing powers DuckDuckGo, ChatGPT search, and Yahoo. Free traffic for almost no work since you can import the Google verification.

1. Go to https://www.bing.com/webmasters
2. Sign in with a Google account (the same one used for Search Console) and click **"Import from Google Search Console"**. This auto-verifies the site and pulls in your sitemap.
3. If import fails, manually add `teno-store.com`, choose **DNS verification**, and add the TXT record Bing gives you in netcup (same procedure as step 1).
4. Go to **Sitemaps** in the left menu and confirm `https://teno-store.com/sitemap.xml` is listed. Add it if not.
5. Go to **Settings → IndexNow** and **turn it on**. Copy the API key Bing generates — save it somewhere (you'll need it when our separate IndexNow integration ships).

---

## 3. Cloudflare — make sure search engine bots are not blocked

**Time: 5 minutes**
**Why it matters:** If Cloudflare's "Bot Fight Mode" is on, it can block Googlebot and Bingbot, which silently kills your indexing. Don't skip this.

1. Log into https://dash.cloudflare.com → select the `teno-store.com` zone.
2. Left sidebar → **Security → Bots**. Confirm **"Bot Fight Mode"** is **OFF**. (Free plan setting.)
3. If you want extra protection, leave Bot Fight Mode off and instead add a custom WAF rule that explicitly allows verified Google/Bing/DuckDuckGo bots. For now, off is fine.
4. While you're in the dashboard, go to **SSL/TLS → Overview** and confirm encryption mode is **"Full (strict)"** — not "Flexible". Flexible breaks canonical URLs.

---

## 4. Facebook page — the most important social channel in Algeria

**Time: 30 minutes**
**Why it matters:** Algeria has the highest Facebook penetration in North Africa. A linked Facebook page sends real traffic and gives you a second indexable home on the open web.

1. Go to https://www.facebook.com/pages/create
2. Page name: **Teno Store** · Category: **Shopping & Retail** · Bio (French): "Marketplace algérienne — achetez et vendez en toute confiance. teno-store.com"
3. Upload a logo (profile) and a banner image.
4. In **About**, put `https://teno-store.com` as the website. Add a contact email.
5. Post 3 launch posts: the homepage, 2 featured product categories. Link each back to the site.

---

## 5. Instagram, TikTok, X/Twitter, LinkedIn — claim the handles before someone else does

**Time: 45 minutes total (about 10 minutes per network)**
**Why it matters:** Claiming `@tenostore` on every network now (even if you don't post) prevents squatters and gives Google more verified mentions of your brand, which boosts trust.

For each, sign up, use the same logo, the same bio in French ("Marketplace algérienne — teno-store.com"), and put the website link in the profile:

- Instagram: https://www.instagram.com/accounts/emailsignup/
- TikTok: https://www.tiktok.com/signup (TikTok is huge with Algerian under-30s)
- X / Twitter: https://twitter.com/i/flow/signup
- LinkedIn Company Page: https://www.linkedin.com/company/setup/new/

You don't need to post regularly on all of them — just claim, brand, and link.

---

## 6. Google Business Profile — skip for now

**Time: 0 minutes**
**Why it matters:** Google Business Profile is for **businesses with a physical address** customers can visit. Teno Store is online-only — there's no shop to walk into. Creating a fake or "service area" profile risks being flagged and hurts more than it helps. Skip this until you have a physical office or warehouse you'd be happy for customers to visit.

---

## 7. Algerian business directory submissions

**Time: ~2 hours total (15 minutes per directory, spread across a week)**
**Why it matters:** Listings on respected `.dz` directories give Google strong "this is a real Algerian business" signals and bring in direct visitors. Acceptance is usually 3-14 days each.

Submit to these, in this order:

| Directory | URL | What they want | Wait time |
|---|---|---|---|
| **El Mouchir (Official CACI directory)** | https://elmouchir.caci.dz/ | Company name, registry number, address, sector. Most authoritative `.dz` listing. | 1-2 weeks |
| **Tidjara.dz** | https://tidjara.dz/directory-listing/ | Free form: name, category, description, logo, contact. | 2-5 days |
| **DZ Entreprise** | https://dzentreprise.net/annuaire-professionnel/ | Email signup then fill profile. | 1-3 days |
| **Annugate** | https://www.annugate.com/ | Standard business profile fields. | 3-7 days |
| **Pages Jaunes Algérie** | https://pagesjaunes-dz.com/ | Yellow-pages style. Look for "ajouter mon entreprise" link. | 1-2 weeks |
| **Archive DZ** | https://www.archive-dz.com/ | Free listing form. | 1 week |
| **PagesMaghreb** | https://www.pagesmaghreb.com/ | Regional Maghreb directory. | 1-2 weeks |
| **Kompass Algeria** | https://dz.kompass.com/ | Free basic listing, paid upgrades. Strong B2B signal. | 1 week |
| **AFRIKTA** | https://afrikta.com/listing-locations/algeria/ | Pan-African directory, free listing. | 3-7 days |

For each one: use the **same business name, same description, same logo, same phone, same URL**. Consistency is what Google measures (this is called "NAP consistency").

---

## 8. Schema.org markup — confirm it's live

**Time: 10 minutes**
**Why it matters:** Schema.org tells Google "this is a product page with this price, this image, this rating" so it can show rich results (stars, prices) directly in search. The dev team has built this in, but you should verify it's working in production.

1. Go to https://search.google.com/test/rich-results
2. Paste a product page URL (e.g. `https://teno-store.com/product/<any-id>`) and run.
3. You should see at least `Product` and `Offer` schema detected with no errors. If errors appear, screenshot them and send to the dev team.
4. Repeat for the homepage — should detect `Organization` and `WebSite`.

---

## 9. IndexNow — handled by the team, but here's how you'll ping URLs

**Time: 0 minutes now, 1 minute per use later**
**Why it matters:** IndexNow tells Bing (and Yandex) about new URLs instantly, without waiting for a crawl. The dev team is shipping the integration — when it lands, you'll get a script. Until then, you can manually submit URLs at https://www.bing.com/indexnow (after step 2's IndexNow toggle is on). No action needed today.

---

## 10. Press outreach to Algerian tech publications

**Time: 1 hour (writing the pitch) + 30 minutes (sending)**
**Why it matters:** A single article on a respected Algerian tech outlet drives more high-trust traffic and inbound links than 50 directory listings combined. Inbound links from news sites are the strongest SEO signal that exists.

Write **one short French-language pitch email** (5-6 sentences: who you are, what teno-store.com solves for Algerian buyers/sellers, why it's different, an interview offer, your contact). Send it to each:

| Outlet | Contact | Note |
|---|---|---|
| **TSA — Tout Sur l'Algérie** | Contact form: https://www.tsa-algerie.com/contactez-nous/ | Highest-traffic Algerian news site. Covers startups regularly. |
| **Algérie 360** | `redaction@a360.press` | Major general news, has a tech section. |
| **Maghreb Émergent** | Contact form at https://www.maghrebemergent.com/ | Economic and business news, Algerian-edited. |
| **Algeria Tech News** | https://algeriatech.news/ (contact link in footer) | Tech-focused, covers startups and e-commerce. |
| **Algeria 2.0** | https://algeria20.com/ (contact form) | Tech community blog, friendlier to small launches. |
| **Technology Innovators Magazine** | https://www.technology-innovators.com/ | Pan-African tech mag, includes Algeria coverage. |

Send one at a time, wait a couple of days between sends. Don't blast all six at once — if one bites and runs a story, you can mention it to the others ("just covered by TSA, would you like a different angle?").

---

## After you finish — what to check weekly

- **Search Console → Performance** tab: are impressions growing? Are clicks happening?
- **Search Console → Coverage**: any pages with errors? Fix or send to dev.
- **Bing Webmaster → Search Performance**: same idea.
- **Cloudflare Analytics → Traffic**: are bots from Google / Bing / DuckDuckGo showing up daily?

The first real signs of organic traffic typically appear **2 to 4 weeks** after Google Search Console verification. Don't panic if the first week is silent — that's normal.
