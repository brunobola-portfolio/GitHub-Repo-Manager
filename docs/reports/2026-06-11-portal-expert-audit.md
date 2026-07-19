# Expert Audit Report — GitHub Repo Manager (v4.3.0)

> **Date:** 2026-06-11
> **Method:** 8 independent specialist subagents + adversarial verification of every high/critical finding.
> **Scope:** Whole portal (frontend `src/` ~368 components / ~61K LOC JSX + Express backend `server/`).
> **Trigger:** "Improve the tooltips and the whole portal, audit it with subagents, give an expert report."

## 1. Executive Summary

The portal is a **mature, generally well-built application** with several genuinely strong foundations: a parameterized-everywhere SQL layer with AES-256-GCM credential encryption and timing-safe CSRF, a coherent design-token system, correct lazy-loading/bundle hygiene, a thoughtful focus-trap-based modal/drawer a11y baseline, and consistent use of the shared `Select` primitive (no native `<select>` leaks). The defects that survived verification are concentrated at the **edges and in shared wiring** rather than in core happy paths.

The single most pervasive UX defect is the user-flagged custom **Tooltip**, which is not portaled and is hard-pinned to `-top-7` with no flip detection — confirmed independently by four specialists — so labels on the entire top-row Header cluster (theme toggle, sync, notifications) clip off the viewport, and tap-revealed tooltips can stick on touch. The highest-leverage structural issues are an **unmemoized app-wide `TrackedReposContext`** that fans re-renders across the repo grid, a **non-functional optimistic-rollback** that can clobber concurrent mutations, a **DNS-rebinding SSRF gap** on the BYOK AI-endpoint (`local` provider) path, and a **dead-end onboarding CTA** on the Work Board first-run flow. Design-system **token adoption is effectively zero** for the semantic color/surface families the system was built to provide, so a "single tweak-point" exists only on paper. None of the confirmed findings are data-loss at rest, but several break first-run activation, primary-task correctness, or accessibility for keyboard/SR users.

### Finding counts by severity (post-verification)

| Severity | Count | Notes |
|---|---:|---|
| Critical | 0 | — |
| High | 8 | Adjusted (post-verification) severity |
| Medium | 14 | Mostly unverified (below threshold) but file:line-grounded |
| Low | 8 | Polish / latent traps |
| **Refuted / dropped** | **0** | No finding was refuted |
| Downgraded on verification | 4 | `perf` TrackedDot → medium; `security` SSRF → medium; `state` usePRData → low; `i18n` greeting/eyebrow → medium |

---

## 2. Top Priorities (P0/P1)

Cross-cutting, highest-impact issues, deduplicated across specialists.

### P0-1 — Tooltip clips at viewport top & sticks on touch (the user's starting point)
**What/where:** [Tooltip.jsx:83-95](../../src/components/ui/Tooltip.jsx#L83-L95) renders the label inline (no `createPortal`) as `<span className="absolute -top-7 left-1/2 -translate-x-1/2 … pointer-events-none z-[var(--ds-z-popover)]">` with zero collision/flip logic, plus a touch path ([Tooltip.jsx:79](../../src/components/ui/Tooltip.jsx#L79)) whose only dismissals are `onMouseLeave`/`onBlur` — neither fires reliably on tap. Consumed by the Header theme toggle ([Header.jsx:412](../../src/components/Header.jsx#L412)) and every `HeaderIconButton` ([Header.jsx:436](../../src/components/Header.jsx#L436)), all inside the `sticky top-0` header ([Header.jsx:81](../../src/components/Header.jsx#L81), inner bar `h-14 sm:h-16`).
**Why it matters:** Four independent specialists (a11y, ux, design, perf) and their verifiers confirmed this. A 34px button centered in a 56-64px sticky bar leaves ~11-15px of headroom, so `-top-7` (28px) pushes the tooltip's top edge to roughly **-17px above the viewport** — clipped for the most-used controls in the app. On touch, a tap that fires `onClick` (e.g. theme toggle) never blurs, so the tooltip can **persist as a stuck label**.
**Fix (M):** Render the label through `createPortal(document.body)` (as `ContextMenu` already does) and compute placement from the trigger's `getBoundingClientRect` with a top→bottom flip near the viewport edge — or adopt `@radix-ui/react-tooltip` (the `@radix-ui` family is already a dependency) with `collisionPadding`. Add an auto-hide on touch. Shared primitive → the fix lands everywhere at once. Keep the existing 300ms delay and `aria-describedby`/`aria-label` wiring.

### P1-2 — App-wide `TrackedReposContext` is unmemoized → re-renders fan out across the repo grid
**What/where:** [TrackedReposContext.jsx:114-129](../../src/contexts/TrackedReposContext.jsx#L114-L129) builds the provider `value` as a fresh object literal every render (no `useMemo`; not even imported), and `mutateRepo = useCallback(…, [repos])` ([:54-71](../../src/contexts/TrackedReposContext.jsx#L54-L71)) re-creates `pin/unpin/mute/unmute/track/untrack` on every list mutation. Provider wraps the whole app ([App.jsx:582](../../src/App.jsx#L582)); consumers (`TrackedDot`, `WorkBoardRowMenu`, `TrackedChip`, `CommandPalette`) subscribe via a selector-less `useContext`.
**Why it matters:** Any pin/mute/track/untrack — or any provider state change — yields a new context value and re-renders every consumer, including every visible `RepoCard`'s `TrackedDot` ([RepoCard.jsx:171](../../src/components/RepoList/RepoCard.jsx#L171)). `RepoCard`'s `memo` does **not** shield this. Confirmed.
**Fix (S):** Wrap `value` in `useMemo`; decouple `mutateRepo` from `repos` via the functional `setRepos(prev => …)` form already used for optimistic patches.

### P1-3 — Optimistic rollback clobbers concurrent/interleaved tracked-repo mutations
**What/where:** [TrackedReposContext.jsx:54-71](../../src/contexts/TrackedReposContext.jsx#L54-L71). Apply and success paths use functional `setRepos(prev => …)`, but the failure path captures `const previous = repos` from the render closure and restores it wholesale: `catch (e) { setRepos(previous); throw e }`.
**Why it matters:** Fire mute-A then pin-B; if B rejects, `setRepos(previous)` reverts to the array captured when B started — **discarding A's successful change** and any interleaved server `new_state`. Data-integrity/trust defect on the core Work Board surface; recovery is manual refresh only. Confirmed.
**Fix (M):** Targeted functional rollback — restore only the affected repo's prior row inside a functional updater, or re-fetch the single repo on failure.

### P1-4 — SSRF: BYOK `local` AI-endpoint skips the DNS-resolution check
**What/where:** [url-validator.js:199-220](../../server/lib/url-validator.js#L199-L220) (`assertSafeAIEndpoint`) ends its public branch at `assertSafeExternalUrl(raw, { allowHttp: false })` — **string-level only**, by its own doc — and neither the save path ([user-ai-config.js:102-112](../../server/routes/user-ai-config.js#L102-L112)) nor the provider-build path ([ai-provider.js:719-722](../../server/lib/ai-provider.js#L719-L722)) ever calls `resolveAndValidateHost`. The import path correctly chains both ([import/url.js:24-30](../../server/routes/import/url.js#L24-L30)).
**Why it matters (downgraded high→medium on verification):** Real and exploitable for **DNS-rebinding to `169.254.169.254` / loopback / RFC1918**, but **scoped narrower** than originally filed: only the `local` provider actually fetches the user-supplied `endpointUrl`; `openai`/`openrouter` constructors read a hardcoded `baseURL` and ignore it. The genuine vector is the `local` provider when `ALLOW_LOCAL_AI_ENDPOINTS` is not set.
**Fix (M):** `await resolveAndValidateHost(url)` in the public/local branches at both save and provider-build time. Ideally pin the resolved IP to close the resolve-then-fetch TOCTOU window.

### P1-5 — Work Board onboarding "Setup guide" CTA is a dead-end
**What/where:** [WorkBoardPage.jsx:100-108](../../src/components/WorkBoard/WorkBoardPage.jsx#L100-L108) links to `/docs/guides/github-webhook-setup`, which exists only as Markdown source — not in `public/`, no `/docs` route on the server (catch-all at [server/index.js:289-294](../../server/index.js#L289-L294) returns the SPA `index.html`) and no client `/docs` route.
**Why it matters:** Connecting a webhook gates the entire Work Board, and this is the **single actionable CTA on the first-run gate**. Users land on the app shell, never the guide. Confirmed.
**Fix (S):** Reuse the canonical constant already present — `DOCS_URL` at [WebhookConnectPanel.jsx:7](../../src/components/Settings/WorkBoard/WebhookConnectPanel.jsx#L7) — or render the guide in an in-app modal.

### P1-6 — Header dropdowns (user menu, notifications, system-health) have no focus management
**What/where:** [Header.jsx](../../src/components/Header.jsx) — `UserDropdown` (`:487-565`), `NotificationsDropdown` (`:597-654`), `SystemHealthIndicator` panel (`:724-814`, panel `role="dialog"` at `:768`). All are plain `<div>`s whose only dismissal is an outside-click `mousedown` handler. Grep confirms **zero** `useFocusTrap`/`Escape`/`onKeyDown`/`focus()`.
**Why it matters:** Keyboard users cannot close these with Escape (the app-wide convention `useFocusTrap` provides in 9 other components), focus never enters the panel, and on close focus is lost to `<body>`. WCAG 2.1.1, 2.4.3. Confirmed.
**Fix (M):** Route through Radix `DropdownMenu`/`Popover`, or add Escape-to-close + on-open focus + on-close focus-return; drop `role="dialog"` from the non-modal health popover.

### P1-7 — Semantic & status design tokens have ZERO adoption
**What/where:** [design-system.css:229-256](../../src/design-system.css#L229-L256) defines `ds-text-heading/primary/secondary/muted`, `ds-surface-card`, `ds-border-subtle`; `:92-97` defines `--ds-danger/success/attention`. Grep across all `.jsx` returns **0** component callsites. Status colors are spelled three incompatible ways in one file ([Header.jsx:389](../../src/components/Header.jsx#L389) `text-rose-600`, `:576` `text-red-600`, `:593` `text-red-500`).
**Why it matters:** The single tweak-point the design system was built to provide does not exist in practice; a theme/contrast change is a **769-callsite (across 212 files)** manual sweep. Semantic-token finding **confirmed**; status-token finding **partial** (original "1361 utilities" headline overstated; actual **769**).
**Fix (L):** Delete the dead token classes, or codemod raw combos onto the tokens — and enforce with a lint rule. Start with shared primitives.

---

## 3. Findings by Specialist

### 3.1 Accessibility (WCAG 2.2) — `a11y`
*Strong baseline (focus traps, reduced-motion parity, labelled icon buttons), with four real defects on the Tooltip, Header overlays, toast announcement, and muted-text contrast.*

| Title | Severity | Location | Fix | Effort |
|---|---|---|---|---|
| Tooltip clipped at viewport top & stuck on touch (no portal/flip/auto-hide) | high (confirmed) | `ui/Tooltip.jsx:83-95,77-82` | Portal + flip + touch auto-hide / Radix Tooltip | M |
| Header dropdowns: no focus trap, no Escape, no focus return | high (confirmed) | `Header.jsx:487-565,597-654,724-814` | Radix Popover/DropdownMenu, or add Escape+focus mgmt | M |
| Toasts not reliably announced (live region created with its content) | medium (unverified) | `ui/Toast.jsx:91-101,56-61` | Single persistent `aria-live` on always-mounted container | M |
| Muted-text tokens fail WCAG AA (light 2.56:1, dark 3.75:1) | medium (unverified) | `design-system.css:52,64,244,250` | Darken light muted ≥slate-500; lighten dark muted to slate-400 | M |

### 3.2 UX & User Flows — `ux`
*Broadly mature state coverage; impactful gaps at the edges — a dead-end onboarding CTA, the global Tooltip clip, a stranded migration-report error, a placeholder `window.alert`, and fake setup progress.*

| Title | Severity | Location | Fix | Effort |
|---|---|---|---|---|
| Work Board "Setup guide" CTA is a dead-end (404s in SPA) | high (confirmed) | `WorkBoard/WorkBoardPage.jsx:100-108` | Reuse `WebhookConnectPanel.jsx:7` `DOCS_URL` or in-app modal | S |
| Tooltip clips at viewport top (fixed `-top-7`, no portal/flip) | high (confirmed) | `ui/Tooltip.jsx:83-94`; `Header.jsx:412,436` | Portal + collision/flip / Radix Tooltip | M |
| Migration report error state is a stranded dead-end (no retry/exit) | medium (unverified) | `MigrationWizard/steps/SummaryStep.jsx:468-479` | Add Retry + surface View History / New / Close | S |
| Command-palette "Save preset" fires a raw `window.alert` | medium (unverified) | `WorkBoard/WorkBoardPage.jsx:181-188` | Wire to PresetDropdown, or remove; `toast.info` stopgap | M |
| First-run setup fakes ~4.8s progress against a sync backend | low (unverified) | `Setup/SystemSetup.jsx:13-47` | Drive UI from real request lifecycle; drop `wait()` ladder | S |
| PR review fatal-error state offers only "Go back", no retry | low (unverified) | `PRReview/PRReviewView.jsx:305-320` | Add "Try again" calling `refetch()` | S |

### 3.3 Design-System Consistency — `design`
*Well-authored token set, but adoption is the core problem: whole token families have zero callsites, the card surface shade is split, the Tooltip isn't portaled, and `index.css` carries global selectors that violate the project rule.*

| Title | Severity | Location | Fix | Effort |
|---|---|---|---|---|
| Semantic color/surface tokens defined but ZERO adoption | high (confirmed) | `design-system.css:229-256`; 0 `.jsx` callsites | Delete dead classes or codemod; enforce with lint | L |
| Status tokens unused; 769 raw status-color utilities / 212 files | high (partial — count overstated as 1361) | `design-system.css:92-97`; `Header.jsx:389,576,593` | Add `ds-text-danger/-success/-attention`; standardize red vs rose | L |
| Card surface shade split (slate-800 vs slate-900) | medium (unverified) | `ui/Card.jsx:23`; `ui/Select.jsx:319`; `Header.jsx:489` | Pick canonical dark card shade; align Card/Select | M |
| Tooltip not portaled, hard-pinned `-top-7`, clips at top | medium (unverified) | `ui/Tooltip.jsx:83-94` | Portal + flip / Radix Tooltip | M |
| Global element/universal CSS selectors violate "no global selectors" rule | medium (unverified) | `index.css:69-156` (esp. `*::-webkit-scrollbar`) | Scope scrollbar to opt-in `.ds-scrollbar`; remove `*` rules | M |
| Ad-hoc `text-[10/11/13]px` persist despite size tokens | low (unverified) | `Header.jsx:104,282,289`; 15 occ / 10 files | Replace with `ds-text-micro/meta/body-sm`; lint-ban | S |
| Header reimplements raw `<kbd>` instead of shared `Kbd` (⌘ vs Ctrl) | low (unverified) | `Header.jsx:121` vs `ui/Kbd.jsx:16-23` | Use `<Kbd modifier="mod">K</Kbd>` | S |

### 3.4 Performance & Rendering — `perf`
*Good bundle hygiene (lazy-loading, paginated RepoList); the real debt is shared context wiring fanning re-renders across the grid.*

| Title | Severity | Location | Fix | Effort |
|---|---|---|---|---|
| `TrackedReposContext` value/callbacks not memoized → app-wide re-renders | high (confirmed) | `contexts/TrackedReposContext.jsx:114-129,54-71` | `useMemo` value; stabilize callbacks | S |
| `TrackedDot` does O(n) linear scan per card, not memoized | medium (downgraded high→medium) | `WorkBoard/TrackedDot.jsx:9-13` | O(1) `Map` lookup from context; `memo` the dot | S |
| `WorkBoardPage` rebuilds filter-option arrays every render | medium (unverified) | `WorkBoard/WorkBoardPage.jsx:205-220` | `useMemo` `allItems` + the three `availableX` arrays | S |
| `RepoCard.memo` comparator ignores handler props (stale-closure risk) | medium (unverified) | `RepoList/RepoCard.jsx:240-252` | Stabilize handlers; include them or drop custom comparator | M |
| Custom Tooltip rendered ~6× per card; no portal/collision | medium (unverified) | `ui/Tooltip.jsx:83-95`; `RepoCard.jsx:34-55` | Single portal-rendered floating layer with flip | M |
| `RepoCard` recomputes quick-actions list every render | low (unverified) | `RepoList/RepoCard.jsx:21-26` | Precompute static shortlist at module scope | S |

### 3.5 Security — `security`
*Genuinely well-hardened: parameterized SQL, AES-256-GCM creds, HMAC API keys, timing-safe CSRF, OAuth state + session regeneration, sanitized markdown. The material gap is an incomplete SSRF defense on one BYOK path.*

| Title | Severity | Location | Fix | Effort |
|---|---|---|---|---|
| SSRF: BYOK `local` AI endpoint validated string-only, no DNS check | medium (downgraded high→medium; scope narrower) | `lib/url-validator.js:199-220`; `routes/user-ai-config.js:102-112` | `resolveAndValidateHost` at save + build time; pin IP | M |
| SSRF string guard misses non-dotted IP encodings (decimal/octal/hex) | medium (unverified) | `lib/url-validator.js:76,145-180` | Normalize/reject bare-integer & `0x`/`0`-prefixed hosts | S |
| `resolveAndValidateHost` TOCTOU + single-A-record + no IPv6 range check | medium (unverified) | `lib/url-validator.js:225-251` | `dns.lookup {all:true}`, validate all, pin IP, IPv6 ranges | M |
| Dev CORS reflects any Origin with credentials | low (unverified) | `server/index.js:133-136` | Restrict dev origin to explicit allowlist | S |

### 3.6 Code Quality & Architecture — `codequality`
*Well-architected for its size (uniform ErrorBoundary+Suspense, clean AI/command-palette decomposition, parameterized SQL). Weaknesses: god-components, duplicated fetch+CSRF boilerplate bypassing the resilient wrapper, eslint-disable backlog.*

| Title | Severity | Location | Fix | Effort |
|---|---|---|---|---|
| 25 sites hand-roll fetch+CSRF, bypassing `fetchWithRetry`/`apiCall` | high (confirmed) | 18 files; `Teams/TeamDetails.jsx`; wrapper `utils/api.js:324-348` | Add `mutate()` helper; migrate sites | L |
| `TeamDetails.jsx` 861-line god-file (4 self-fetching components) | high (partial — 2nd largest; App.jsx is 913) | `Teams/TeamDetails.jsx` | Split into per-tab components + data hooks | L |
| `App.jsx` AppContent 913-line shell, ~20 useState, 15-18 prop-drilled | medium (unverified) | `App.jsx:70-901` | Extract repo-detail/PR nav cluster to context | L |
| `SettingsTab.jsx` mixes 3 feature areas, 647 lines, 13+ useState | medium (unverified) | `RepoDetail/SettingsTab.jsx` | Split General/Topics/Webhooks sections | M |
| Custom Tooltip fixed `-top-7`, no portal/flip | medium (unverified) | `ui/Tooltip.jsx:83-94` | Portal + vertical flip / Radix Tooltip | M |
| Duplicated language-color maps & inline owner/repo split parsing | low (unverified) | `Teams/TeamDetails.jsx:374-383`; `Dashboard/LanguageChart.jsx:10` | Shared `languageColors` util + `parseFullName()` | S |
| 167 eslint-disable suppressions (79 set-state-in-effect) "deferred" | low (unverified) | App-wide | Refactor fetch-in-effect into `useAsyncData`; delete suppressions | L |

### 3.7 State & Data Flow — `state`
*Generally thoughtful (alive refs, fetch-id guards, AbortControllers in several hooks), but several core flows lack request-sequencing guards, and the optimistic rollback is the standout defect.*

| Title | Severity | Location | Fix | Effort |
|---|---|---|---|---|
| TrackedRepos optimistic rollback clobbers concurrent mutations | high (confirmed) | `contexts/TrackedReposContext.jsx:54-71` | Targeted functional rollback / single-repo re-fetch | M |
| `usePRData` no cancellation guard — stale PR can overwrite current | low (downgraded high→low) | `hooks/usePRData.js:20-44` | Latent only (consumer fetch-disabled); still add `fetchId` guard | S |
| `useSSE` never reconnects when `url` prop changes after mount | medium (unverified) | `hooks/useSSE.js:24-102` | Add `url` to lifecycle effect deps | S |
| `useOrgs` fires `fetchStats` twice on load, no sequence guard | medium (unverified) | `hooks/useOrgs.js:116-172` | Single stats effect keyed `[user, selectedOrg]` + fetch-id | M |
| WorkBoard polling hooks lack in-flight guards | medium (unverified) | `hooks/useWorkBoardBadgeCounts.js:49-74`; `hooks/useWorkBoardAI.js:13-48` | Add incrementing `fetchIdRef` | S |
| TrackedRepos `bulkUpdate/discover/updatePrefs` reject without handling | medium (unverified) | `contexts/TrackedReposContext.jsx:80-112` | Surface structured result/error + `error` state | M |
| `usePRData`/`useRepoMetadata` caches never revalidate | low (unverified) | `hooks/usePRData.js:38-44`; `hooks/useRepoMetadata.js:33-45` | Adopt SWR: serve cached + background revalidate | M |
| `useOptimisticMutation` Undo can revert via stale snapshot | low (unverified) | `hooks/useOptimisticMutation.js:30-35`; `hooks/useInbox.jsx:90-115` | Make revert additive/targeted | M |

### 3.8 Internationalization & Content — `i18n`
*No i18n framework at all; every string is hardcoded English except one harmful ad-hoc Portuguese/English switch on the Dashboard hero, plus English-only string-concat pluralization.*

| Title | Severity | Location | Fix | Effort |
|---|---|---|---|---|
| Dashboard hero ships mixed PT/EN copy based on `navigator.language` | medium (confirmed; downgraded high→medium) | `utils/greeting.js:15-43`; `Dashboard/TodayPanel.jsx:64,115` | Make hero English-only until real i18n, or gate behind pref | S |
| Dashboard eyebrow line is literally half-PT, half-EN | medium (confirmed; downgraded high→medium) | `Dashboard/TodayPanel.jsx:30-36`; `hooks/useRelativeTime.js:17-23` | `Intl.RelativeTimeFormat` or keep eyebrow fully EN | M |
| Pluralization via English-only string concat (45 sites / 32 files) | medium (unverified) | `utils/format.js:200`; `hooks/useRepos.js:232`; `LicenseBadge.jsx:72` | Introduce `plural()` helper; `Intl.PluralRules` later | M |
| Hardcoded `en-US` date formatting contradicts app's own locale logic | medium (unverified) | `Settings/AzureCredentialsSection.jsx:493`; `Settings/AzureHostsAllowlistSection.jsx:367` | Use shared locale-respecting `formatDate` | S |
| No i18n layer; every user-facing string hardcoded inline | medium (unverified) | App-wide (no catalogs, no `react-intl`/`i18next`) | Decide if i18n is a goal; if yes adopt a lib + extract | L |
| `LicenseBadge` shows ungrammatical "Expires in 1 days" | low (unverified) | `LicenseBadge.jsx:71-75` | Apply `day${n===1?'':'s'}` in both branches | S |

---

## 4. Recommended Remediation Roadmap

### Now (quick wins — high impact, mostly confirmed)
1. **Fix the Tooltip primitive** (P0-1) — portal + flip + touch auto-hide. One change fixes the user's flagged issue across the Header, repo cards, and everywhere. *(M, schedule first.)*
2. **Memoize `TrackedReposContext`** (P1-2) — `useMemo` value + stabilize callbacks. **S**, removes app-wide re-render fan-out.
3. **Repoint the Work Board "Setup guide" CTA** (P1-5) — reuse `DOCS_URL`. **S**, unblocks first-run activation.
4. **Fix the LicenseBadge "1 days" grammar bug**. **S**, visible to every paying user.
5. **Make the Dashboard hero English-only** (or gate behind a setting) — removes the half-translated eyebrow. **S**.

### Next (correctness, security, a11y — confirmed/partial, M effort)
6. **Targeted optimistic rollback** in `TrackedReposContext.jsx:54-71` (P1-3). **M**.
7. **Add `resolveAndValidateHost` to the `local` AI-endpoint path** (P1-4) at save + build time; normalize non-dotted IP encodings; harden `resolveAndValidateHost`. **M**.
8. **Add focus management to the three Header overlays** (P1-6). **M**.
9. **Introduce a `mutate()` helper** routing through `fetchWithRetry`; migrate the 25 raw-fetch sites (start with `TeamDetails.jsx`). **L, but start now.**
10. **Persistent toast `aria-live` region** + **bump muted-text contrast to AA**. **M** each.

### Later (structural & strategic — L effort)
11. **Design-system token adoption** (P1-7) — codemod or delete dead classes; enforce with lint.
12. **Decompose god-components** — `TeamDetails.jsx`, `App.jsx` AppContent, `SettingsTab.jsx`.
13. **Retire the eslint-disable backlog** via a shared `useAsyncData` hook.
14. **Decide the i18n strategy** — commit to a framework, or formally remain single-locale and remove the partial PT layer. Add a `plural()` seam regardless.
15. **Remaining state-sequencing guards** — `useSSE` reconnect, `useOrgs` double-fire, WorkBoard polling, SWR revalidation. Batchable.
16. **Scope the global scrollbar CSS** in `index.css` to opt-in `.ds-scrollbar`.

---

## 5. Methodology & Confidence

- **Coverage:** 8 independent specialists — Accessibility (WCAG 2.2), UX & User Flows, Design-System Consistency, Performance & Rendering, Security, Code Quality & Architecture, State & Data Flow, Internationalization & Content.
- **Adversarial verification:** Every **high/critical** finding was independently re-checked by a verifier who read the cited files and re-ran the cited greps, emitting *confirmed* / *partial* / *refuted*. **No finding was refuted.** Medium/low findings were below the verification threshold (marked **unverified**); still file:line-grounded but not independently re-read.
- **Adjustments applied:**
  - **Confirmed:** Tooltip (all four lenses), Header focus management, Work Board dead-end CTA, semantic-token zero-adoption, unmemoized `TrackedReposContext`, optimistic-rollback clobber, raw-fetch/CSRF bypass, mixed PT/EN hero & eyebrow.
  - **Partial (caveat noted, kept):** Status-token finding — real, but "1361" overstated (actual **769**/212 files). `TeamDetails` god-file — real, but **2nd**-largest JSX file (`App.jsx` at 913 is larger).
  - **Downgraded on verification:** SSRF high→**medium** (scoped to `local` provider only). `TrackedDot` O(n) scan high→**medium** (bounded `M`, fires only on tracked mutations). `usePRData` race high→**low** (sole consumer fetch-disabled; live path already guarded). The two i18n hero findings high→**medium** (`pt-*` only on an English-first product).
- **What's notably healthy (no findings):** parameterized SQL, credential encryption, CSRF, OAuth state, webhook HMAC, sanitized markdown, bundle lazy-loading, modal/drawer focus traps, consistent shared-`Select` usage — actively probed and held up.
