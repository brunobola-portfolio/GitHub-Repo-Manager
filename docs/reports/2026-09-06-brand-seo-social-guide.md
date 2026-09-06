# Brand, SEO and social — what changed and what comes next

Date: 2026-09-06. Scope: the product (GitHub Repo Manager, this repository),
the marketing site (bolalabs.pt, repository `BolaLabs/MainSite`), the GitHub
repository page, and the launch on social channels. Five specialist reviews
ran read-only over both codebases and the live pages (SEO, brand, site UX,
social, docs); the full reports with file:line citations sit in
`.dev/panel-2026-09-06/` on the development machine. This guide is the
reviewed digest: what was applied today, what was verified live, and what is
recommended, in priority order, with the decisions only the owner can take.

## 1. Applied today

### Product — releases 4.24.4 and 4.24.5, both in production

| Area | Change | Where |
| --- | --- | --- |
| Search | Canonical, `og:url`, `og:site_name`, social card served from the deployment's own origin, `SoftwareApplication` JSON-LD (both plans), `robots.txt`, sitemap — all filled per deployment from `FRONTEND_URL`, so a self-hosted install advertises itself | `index.html`, `server/lib/spa-shell.js`, `vite.config.js` |
| Search | Title 52 characters, description 150, both describing what ships (Work Board with DORA, AI review, Azure DevOps migration) | `index.html`, `src/hooks/useAppRouter.js` |
| Landing | The dashboard, framed, in both themes, under the hero; headline "Manage, migrate and review every GitHub repository from one place"; "Continue with GitHub" | `src/components/Landing/HeroSection.jsx`, `public/landing/` |
| Landing | Feature grid on the one brand accent (amber and emerald were status colours used as decoration); "Premium Dashboard" is "One dashboard"; closing band carries the brand line "The repository that needs you, first." | `FeaturesSection.jsx`, `CTASection.jsx` |
| Landing | Footer: "A BolaLabs product · built by Bruno Marques", linking the product page; legal footer spells BolaLabs; ambient drifts read `LOOP.drift` / `LOOP.driftLong` from the motion vocabulary | `LandingPage.jsx`, `LegalFooter.jsx`, `ui/motion.js` |
| README | Nav gains "Open the app" and "Website"; the test badge says 7,700+ like the suite | `README.md` |
| Package | Description and homepage match the product page | `package.json` |
| Docs | API reference lists the two new routes and the real handler count | `docs/api/API.md`, `docs/index.md` |

### GitHub repository

Description rewritten to today's product; homepage set to the product page;
twenty topics (the limit), adding devops, code-review, dora-metrics, tfvc,
self-hosted, developer-tools, windows. The custom social preview was already
set.

### Site — releases 1.3.7 to 1.3.9, live

| Area | Change | Where |
| --- | --- | --- |
| Story | Product page tells the story first: hero with the product, four problem → outcome rows with real captures, "Three decisions behind it", the stack in one line, then the nine capabilities | `pages/RepoManager.tsx` |
| Search | Titles and descriptions per locale, search-sized (EN title 57 characters, description 149), keyword-led: "Repository Dashboard with AI Review" | `src/LanguageContext.tsx` |
| Search | JSON-LD `SoftwareApplication.url` follows the page locale (it named the Portuguese URL on every locale) | `src/jsonld.ts`, `components/JsonLd.tsx` |
| Brand | The product's social card carries the RepoManager mark, not the BolaLabs flask (the one conflation `docs/BRAND.md` forbids) | `scripts/gen-og.mjs`, `assets/brand/repomanager-mark.svg`, `public/og/repomanager.jpg` |
| Speed | AVIF and WebP variants wired for all ten RepoManager captures (they were built and unused; the hero JPEG is 80 KB, its AVIF 38 KB) | `src/productScreenshots.ts` |
| Copy | Tagline verb triple is manage · migrate · review everywhere; the closing band says "open the app" beside the button that opens it; test count 7,700+ in all four languages | `src/LanguageContext.tsx` |
| Facts | Version badge follows the latest release (4.24.5) | `src/site.ts` via `npm run versions -- --write` |

### Verified live

- `https://repomanager.bolalabs.pt/`: canonical and `og:url` on the public
  origin, card image 200 from the same origin, JSON-LD present, `robots.txt`
  and sitemap answering; anonymous visit loads once; sign-in reaches GitHub
  with the public `redirect_uri`.
- `https://bolalabs.pt/en/repomanager/`: new title, all fifteen captures
  loading, no console errors, roadmap and app links present.

## 2. Recommended next — by priority

Effort: S under an hour, M half a day, L one to two days. Every item below
is unshipped; nothing here is claimed anywhere yet.

### P0 — brand rules still broken in production

1. **Typefaces (M).** `docs/BRAND.md` specifies Archivo, IBM Plex Sans and
   JetBrains Mono, and the three files sit in `brand/fonts/`; the app ships
   Mona Sans (GitHub's own face) as display and a system stack for body. Swap
   in `src/design-system.css`, ship the woff2 from `public/fonts/`, re-run the
   axe gate. Site and app then read as one product.
2. **Social card set in the brand face (S).** `scripts/gen-brand-raster.mjs`
   names Archivo without loading it, so `brand/og-1200x630.png` is a fallback
   font. Embed the woff2 as a data URI, await `document.fonts.ready`,
   regenerate with `npm run gen:brand`.
3. **One card system (M).** Generate PNG (app) and JPEG (site) from the same
   generator in this repository; 1080×566 safe box, 28 px type floor, 72 px
   foot inset; add 1280×640 (GitHub social preview), 1200×1200 (square posts),
   1920×1080 (video cover); a checksum test on the site side.

### P1 — one name, one promise

4. **Decide the product name form (decision, then M).** Sanctioned:
   "GitHub Repo Manager" (full) and "RepoManager" (mark). "Repo Manager" (two
   words) appears in the app header, landing nav and 119 times on the site.
   Add `tests/build/brand-naming.test.js` once decided.
5. **Shared tokens (M).** Site lime `#7fc528` / accent text `#8fd23f` versus
   app `#55831b` / `#3f7d12`: clicking "Open the app" is a hue change. Publish
   `brand/tokens.json` from the generator; both repositories cite it.
6. **The proof triple (S).** Adopt the site's three decisions (grounded
   metered AI with your key · preview first, never auto-commit · runs where
   you decide) on the app landing's feature grid.
7. **Migration landing page (M, the biggest SEO lever).** One route
   `repomanager/azure-devops-migration` in four locales; the prerenderer,
   sitemap and hreflang follow. Strings and titles are in the SEO report
   (§2.3). Then `dora-metrics`, `ai-code-review`, `self-hosted`.
8. **Two `/insights` articles (M).** The blog pipeline (prerender, RSS,
   BlogPosting) is built and empty. First two: "Migrating TFVC to Git without
   losing history" and "DORA metrics from GitHub alone". Remove `noSitemap`
   from the route when the first goes live.
9. **awesome lists (S).** Submit to awesome-selfhosted, awesome-devops,
   awesome-github. Stars are the constraint now, not metadata.

### P2 — premium polish

10. **First five minutes guide (S).** Connect GitHub → add an AI key → track
    repositories → run a migration dry run; pure aggregation of existing
    docs, linked from README Quick Start and `docs/index.md`.
11. **README fold (M).** One 100-word intro instead of tagline + bold line +
    "Why" bullets; drop the Windows badge (redundant); move the AI-provider
    table and the OAuth-scope prose to the docs they duplicate. Every
    honesty-gated fact stays.
12. **Site uniformity (S).** AiTool's capability cards get the same tinted
    icon tile as RepoManager's; Arcva's origin eyebrow uses the shared mono
    treatment; "Live PR Inbox" stays untranslated like the other product
    names.
13. **Trust (decision, then M).** Testimonial policy: none yet, never
    fabricated — say so in `AGENTS.md`. A "free forever" sentence in the
    pricing FAQ. A 45–60 s silent product video (Dashboard → Work Board →
    Deep Review) and three GIFs (keyboard navigation, AI review publish,
    migration dry run).
14. **Real 404s (S).** Unknown app paths answer 200 with the shell; answer
    404 with the shell body for anything but `/`, `/brand/` and assets.
15. **Product mark on the site hero and a "press" page (S each).** The site
    never shows the product's mark; a `/press` page with fact sheet, media
    kit link, curated captures and a founder note is what launch-week
    commenters look for.
16. **Contributor path (S).** Tag three to five `good first issue` items;
    consider enabling Discussions and listing it in the issue chooser.

## 3. Social — the plan in one page

- **Channels:** GitHub (README, releases) and LinkedIn are primary; X and
  Bluesky mirror the same copy; Show HN, Product Hunt and r/devops,
  r/github, r/azuredevops are one-time launch events, each with its own
  framing (DORA, dashboard, migration), never the same text.
- **Cadence:** two posts a week (one substantive, one light), EN and PT,
  one long-form article every two to three weeks on Dev.to or `/insights`.
- **Week 1:** Show HN → Product Hunt (12:01 PT) → r/devops → r/azuredevops →
  LinkedIn recap, with the founder answering comments for the first hours.
  Suggested Show HN title: "Show HN: An open-source GitHub dashboard with
  DORA metrics, AI review, and Azure DevOps migration". Name the two honest
  limits up front: BYOK only, native installer is Windows-only.
- **Weeks 2–4:** Work Board and DORA; AI Deep Review and the BYOK stance;
  migration suite and roadmap transparency.
- **Don't:** post per changelog entry; imply managed AI; fake metrics;
  cross-post identical text to Reddit and HN; argue with critics; buy votes.
- **Profiles:** add the product link to the BolaLabs LinkedIn page and the
  personal headline and Featured section; link-in-bio to the product page,
  not the raw repository.
- **Assets, in order:** the 45–60 s video; three GIFs; four 1:1 cards from
  the unified card system; a narrated walkthrough later.
- **Measure:** the site's cookieless analytics (referrer and UTM breakdown,
  "Open the app" clicks) plus GitHub Traffic Insights and a weekly star
  count; retro at the end of week 4 before any second push.
- Post copy for every slot, with hook, body, CTA and the exact capture or
  recording, is in `.dev/panel-2026-09-06/social.md`.

## 4. Decisions only the owner can take

1. **Global default locale.** Root and `x-default` point at `/pt/`. For a
   developer tool, `/en/` is the money page. Switch both, or add
   Accept-Language negotiation. Business call: Portuguese consulting brand
   versus global product.
2. **Product name form** (P1 item 4).
3. **Typeface swap in the app** (P0 item 1): a visible change for every
   signed-in user.
4. **Testimonial policy and video budget** (P2 item 13).

## 5. Rules that came out of this pass

- After any production deploy, open the public origin in a real browser as
  an anonymous visitor and click Sign in. Mock-mode suites cannot see the
  session, proxy and rate-limit layers.
- A new route mounted in `server/index.js` changes the handler count the
  docs gate pins; update `docs/api/API.md` and `docs/index.md` with it.
- Artifacts (published pages) only for guides and reports someone will
  share or reread; always with a local copy like this file.
