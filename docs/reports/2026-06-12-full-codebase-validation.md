# Full Codebase Validation — All Dimensions

> **RESOLUTION (2026-06-13).** All 13 major findings + the 5 working-tree
> findings below were fixed in a follow-up pass for the v4.4.0 release.
> Summary of fixes:
> - **#1 boot crash** → `app.get('/{*splat}')` named splat (Express 5 / path-to-regexp v8); registration proven non-throwing.
> - **#2 rate-limiter bucket** → `ipKeyGenerator(req.ip)` at both call sites (per-IP again).
> - **#3 CSRF vs API keys** → `requireCsrfToken` skips `Bearer grm_live_` (header auth is CSRF-immune); **write-scope gate** centralised in `apiKeyAuth` so read-only keys can't mutate any route.
> - **#4 duplicate detection** → route unwraps `githubApi()`'s `{ data }`; the masking test mocks were corrected to the real shape.
> - **#5 SSE freeze** → monotonic `seq` in `useSSE` + seq-cursor in `ProgressStep` (>100-event regression test added).
> - **#6 README typography** → `@tailwindcss/typography` installed + `@plugin` wired; `prose` now emits (153 rules) across all 8 surfaces.
> - **#7 Approve button** → wired to `useReviewAction.approve`.
> - **#8 OAuth callback** → fails closed (no session saved) when `/user` fetch fails or returns no id.
> - **#11 MIT headers** → 21 files relicensed to AGPL-3.0-only.
> - **#12 team-card a11y / #13 setState-in-render**: see release notes (addressed where in scope).
> - **Working-tree findings**: `forceStrategy` enum aligned to camelCase; TFVC routes now honour `savedCredentialId` via the shared resolver; `AllowlistFixPanel` non-admin `.env` snippet no longer prints a destructive replacement; pat-resolver + KDF-v1 fixture + import-service core now have tests.
> - **Out of scope (noted, not blocking the release):** `dados.txt` (untracked, gitignored — left as user data, recommend moving to `.dev/`); the `concurrently → shell-quote` dev-only npm-audit criticals; the broader minor-findings backlog.

**Date:** 2026-06-12 (evening session)
**Method:** Hard verification (lint, unit, e2e, build, bundle budget) + 8 specialist audit agents (frontend-react, backend-core, security, ui-design-system, ux-a11y, testing, docs, uncommitted-diff review), each major finding adversarially verified by an independent refuter agent. Scope: the whole codebase, explicitly excluding the 37 findings already fixed earlier today (see `2026-06-12-expert-panel-codebase-audit.md`).
**Result:** 13 major findings confirmed (1 critical, 11 high, 1 downgraded to medium) · 0 refuted outright · 48 minor findings (unverified individually but evidence-backed).

## Hard verification

| Check | Result |
| --- | --- |
| `eslint . --max-warnings 0` | ✅ clean |
| `vitest run` | ✅ 4530 passed / 0 failed (24 skipped, 518 files) |
| `vite build` (+ `lint:css` prebuild) | ✅ succeeds |
| `playwright test` (full e2e) | ⚠️ 83 passed / 3 failed / 14 skipped — **all 3 failures pass when re-run in isolation** (CPU-contention flakes from running e2e + vitest + build + agents simultaneously, not regressions): `ai-deep-review`, `assistant-paste-url`, `branches-free-plan` |
| `check:bundle-size` | ❌ main bundle 86.4 KB gzip vs 60 KB budget (pre-existing — HEAD measures 86.3 KB; other 6 chunks within budget) |

Test-suite noise observed (cosmetic): one `act(...)` warning in `tests/components/RepoContextMenu.test.jsx`, happy-dom AbortError spam during teardown.

## Executive summary

The foundations are genuinely strong — the React layer is carefully memoized with disciplined cancellation patterns, SQL is fully parameterized, webhooks verify signatures, the premium Select rule has zero violations, z-index is fully tokenized, and the English-only rule holds everywhere in UI strings. But the audit found one **boot-stopping production bug** (the Express 5 SPA fallback crashes the server before it listens — production with a built `dist/` cannot start at all), a **production login DoS** (rate-limiter bug collapses all clients into one shared bucket), and a cluster of "shipped but dead" features: API-key write scopes blocked by CSRF, duplicate detection silently broken by a wrong response shape (masked by wrong mocks), the Work Board Approve button wired to an empty function, README rendering relying on a Tailwind plugin that was never installed, and the migration progress UI freezing permanently after 100 SSE events. Test coverage is dense overall but missing exactly on the money paths (Stripe billing, OAuth callback, import-service credential embedding). Today's uncommitted fix waves verified clean except one functional bug (forceStrategy enum case mismatch) and a few targeted test gaps.

## Major confirmed findings (adversarially verified)

1. **Express 5: `app.get('*')` throws at startup — production server cannot boot** — CRITICAL · backend · `server/index.js:290`
   Express 5.2.1 / path-to-regexp v8 rejects a bare `*` at route registration (`TypeError: Missing parameter name`). The block only runs when `NODE_ENV=production` AND `dist/` exists — so dev, tests, and CI never hit it, but the canonical Docker deployment (build → `NODE_ENV=production node server/index.js`) crashes before `listen()`. Verified against the installed dependency. Fix: `app.get('/{*splat}', ...)` or a path-checking `app.use` fallback; add a production-boot smoke test.

2. **Rate limiter: `ipKeyGenerator(req)` instead of `ipKeyGenerator(req.ip)` — all clients share one `[object Object]` bucket** — HIGH · backend/security · `server/middleware/tenant-rate-limit.js:61,115`
   Verified by executing express-rate-limit 8.5.1: the helper returns the req object unchanged, stringifying to a constant key. Consequences: the login limiter (20 req/15 min in production) becomes a **global** bucket — 20 attempts from anyone lock every user out of login; per-IP brute-force protection does not exist; anonymous `/api` traffic shares one free-tier budget. Fix is two characters per call site + a two-IP regression test.

3. **CSRF middleware blocks every API-key mutation — documented `write`/`admin` scopes are unusable** — HIGH · backend · `server/middleware/csrf.js:114` + `server/index.js:231`
   Bearer `grm_live_` clients carry no session, so every POST/PUT/PATCH/DELETE 403s with `csrf_invalid` before `apiKeyAuth` runs. A documented, paid capability (programmatic writes) is entirely non-functional. Related: `requireScope` is defined and unit-tested but applied to **zero** routes, so fixing CSRF alone would grant read-scoped keys full write access — fix both together.

4. **`/import/check-duplicates` reads the wrong `githubApi` return shape — duplicate detection silently broken, masked by wrong mocks** — HIGH · backend · `server/routes/import/url.js:155-189`
   `githubApi()` returns `{ data, headers }` but the route reads fields off the wrapper: personal-account imports always return empty duplicates (check disabled); org imports flag **every** existing repo — including empty ones — as a blocking duplicate, breaking the documented push-into-empty-repo flow. The test suite passes because it mocks the raw object instead of the wrapper.

5. **Migration progress UI permanently freezes after 100 SSE events** — HIGH · react · `src/components/MigrationWizard/steps/ProgressStep.jsx:183` + `src/hooks/useSSE.js:74`
   useSSE caps events at a sliding 100-item window while ProgressStep tracks consumption by array length — once length pins at 100, every new event is skipped forever. A single TFVC conversion emits ~120 progress events, so real migrations stall mid-flight showing a live indicator; `plan-complete`/auto-advance/`MIGRATION_COMPLETE` never fire. Fix: sequence-number cursor instead of length cursor + a >100-events regression test.

6. **README rendering depends on Tailwind `prose` classes but `@tailwindcss/typography` was never installed** — HIGH · ui · `src/components/ui/RepoMarkdown.jsx:55`
   `prose prose-sm dark:prose-invert` are silent no-ops (plugin absent from package.json/node_modules/CSS, verified across full git history), and the planned `.ds-readme` stylesheet (`docs/plans/2026-05-21-readme-premium-pack-rollout.md`) was never created. With Tailwind v4 preflight resets, READMEs on the repo-detail Overview render as flat unstyled text — no headings, bullets, or visible links — on a primary product surface. Same dead pattern in 6 other components (AI chat, PR/issue panels).

7. **Work Board "Approve" is a dead no-op button** — HIGH · ux · `src/components/WorkBoard/tabs/MyReviewsTab.jsx:120`
   `onApprove={() => {}}` — zero feedback, PR never approved, while a fully working `useReviewAction.approve` (optimistic removal, toast, working server endpoint) sits unused in the same component. Snooze and request-changes on the same row work.

8. **GitHub OAuth `/callback` untested — and saves a half-authenticated session on `/user` fetch failure** — HIGH · testing/security · `server/routes/auth.js:93-138`
   No test exercises the real handler (state CSRF check, token exchange, session-fixation regenerate). Verified reachable edge: if the GitHub `/user` fetch fails, the flow still regenerates and saves a session with `accessToken` but `userId=undefined`, then redirects as a successful login — and `requireAuth` checks only `accessToken`.

9. **Stripe billing routes have zero tests** — HIGH · testing · `server/routes/billing.js`
   The money path (customer create/upsert, price selection, checkout session metadata `{userId, tier}` that the webhook depends on to issue licenses, portal lookup) is untested; the webhook side is well-tested, so the contract is asserted on only one half.

10. **`import-service.js` core is only ever mocked, never tested** — HIGH · testing · `server/import-service.js:99,129`
    `embedCredentials` (PATs into clone URLs, Azure userinfo special-casing) and `safeUrl` (the log-redaction regex keeping PATs out of logs) have no unit tests anywhere — a regression silently leaks credentials or breaks every migration clone. These are pure functions; tests are cheap.

11. **21 source files carry MIT license headers in an AGPL-3.0-only repo** — HIGH · docs/legal · `src/main.jsx:6` et al.
    "Licensed under the MIT License" in 21 tracked files (main.jsx, core hooks/utils, mocks) while LICENSE is AGPL v3 and the project sells commercial exceptions — an explicit per-file MIT grant creates real dual-licensing ambiguity that undermines the open-core model. Replace with SPDX `AGPL-3.0-only` tags + a CI grep guard.

12. **Team cards cannot be opened with the keyboard on the Teams page** — MEDIUM (downgraded from high) · ux/a11y · `src/components/Teams/TeamHub.jsx:265`
    Click-only `motion.div` with no role/tabIndex/keydown; the owner menu lacks Escape/focus management. Downgraded because the Dashboard renders teams as real buttons reaching the same TeamDetails — a per-page WCAG 2.1.1 failure, not a total blockage.

13. **AIAssistant: setState-in-render via modal open inside a state updater** — MEDIUM · react · `src/components/AIAssistant.jsx:94-101` *(found during e2e triage, verified by React warning in live run)*
    `handlePasteConfirm` calls `openModalWithData(...)` inside the `setPasteDialog` updater — updaters must be pure (they run during render), producing `Cannot update ModalProvider while rendering AIAssistant`. Read `pasteDialog` from closure, call `openModalWithData` outside the updater.

## Working-tree (today's fixes) review — `wip-diff`

Today's waves verified **clean overall**: userinfo-smuggling gate, DNS-rebinding rework, pat-resolver wiring (resolved before status transition/quota charge), v1→v2 KDF migration (v1 blobs still decrypt — parameters verified identical), useHostAllowlist consolidation, and the AllowlistFixPanel move to `ui/` (zero stale imports). Found before commit:

| Sev | File | Finding |
| --- | --- | --- |
| med | `server/lib/validators.js:150` | `forceStrategy` enum is kebab-case (`import-api`, `git-tfs`) but `pickStrategies` keys are camelCase — old values now 400, new values silently run the full cascade instead of the forced strategy. The admin escape hatch fix #6 just enabled is broken both ways. |
| low | `server/routes/import/azure/tfvc.js:49` | Schemas accept `savedCredentialId` on all 3 TFVC routes but handlers ignore it (legacy `resolvePat`) — silent env/session PAT substitution, the exact confusing-401 mode fix #5 eliminated in migration.js. |
| low | `src/components/ui/AllowlistFixPanel.jsx:32` | Non-admin .env snippet is now built from hidden (empty) patterns — an admin applying it verbatim on a non-default deployment drops every other env-configured host. |
| low | `server/__tests__/credential-encryption.test.js` | No fixture pinning v1-blob decryption — the migration's core guarantee is untested. |
| low | `server/lib/pat-resolver.js` | Zero tests on the resolver + the 401-before-quota-charge invariant. |

## Minor findings by dimension (48 total, key items)

### Security (no major; posture verified strong — auth gates, parameterized SQL, webhook signatures, sanitized markdown, SSRF guards, arg-array spawns all check out)
| Sev | File | Finding |
| --- | --- | --- |
| med | `server/routes/license.js:59` | `GET /api/v1/license` unauthenticated — leaks license-holder **email (PII)**, org, seats, active-seat count to anonymous callers. |
| low | `server/import-service.js:77` | `validateSourceUrl` echoes raw git stderr (can embed the PAT-bearing URL — git does not redact userinfo) back to the client; `safeUrl()` exists but is not applied. |
| low | `server/lib/logger.js:13` | Pino has no `redact` config — secret protection is entirely opt-in at call sites. |
| low | `server/routes/license.js:124` | License bootstrap self-grants global admin to the first authenticated user when no license/LICENSE_KEY is set — risky for the SaaS direction. |
| low | `server/index.js:133` | CORS reflects any origin with credentials whenever `NODE_ENV !== 'production'` (staging/preview exposure). |

### Backend
| Sev | File | Finding |
| --- | --- | --- |
| med | `server/middleware/api-key-auth.js:102` | `requireScope` defined + tested but used by zero routes — scopes are decorative. |
| med | `server/routes/webhooks.js:36` | Actions webhook writes `user_id=0` and its meta upsert **clobbers real users' workflow aggregates** (UNIQUE on github_workflow_id). |
| med | `server/import-service.js:471` | Multi-GB synchronous `rmSync` on the request-serving event loop (also wiki-service, tfvc cleanup) — stalls every request/SSE stream for seconds-to-minutes. |
| low | `server/routes/teams.js:239` | No uniqueness on repo_assignments — duplicate assignments inflate counts and fan-out work. |

### Frontend / React
| Sev | File | Finding |
| --- | --- | --- |
| med | `src/hooks/useRepos.js:175+` | `performAction`/`archiveRepos`/`deleteRepos` etc. unmemoized — fully defeats the documented `sidebarProps` useMemo + Sidebar/SlimSidebar React.memo; the whole sidebar re-renders on every toast/selection change. |
| low | `src/hooks/useSSE.js:102` | Hook never (re)connects when `url` changes after mount; ProgressStep shows "Reconnecting..." forever after retries are exhausted. |
| low | `src/hooks/usePRData.js:31` | Shared cache never populated (dead warm-open path) + latent key-poisoning race in the write path. |

### UI / design system (Select rule: zero violations · z-index fully tokenized · dark mode near-complete)
| Sev | File | Finding |
| --- | --- | --- |
| med | `src/index.css:161` vs `design-system.css:285` | Two conflicting `.ds-scrollbar` definitions — the unlayered design-system.css copy silently kills the "Smart Glass" hover behavior; opt-in premium containers look *different* from default ones. |
| med | `WorkItemsStep.jsx:232` et al. | Five bespoke toggle switches bypass `ui/form/Switch` (drifting track colors, missing focus rings; PricingPage knob animates layout `left` instead of transform). |
| med | `Settings/AzureCredentialsSection.jsx:608` + AzureHostsAllowlistSection | Today's new Azure forms re-implement Field/Input with raw inputs that have **no focus styling**, visibly drifting from the shared premium primitives in the same modal. |
| low | `RepoDetail/ActionsTab.jsx:102` | Dead `ds-hover-scale` class (removed from CSS by the premium contract, one call site survived). |
| low | `states/ServiceUnavailable.jsx:82` et al. | Hero icon size/stroke drift across the three sibling full-page state screens. |

### UX / a11y (English-only rule: clean — no Portuguese in UI strings)
| Sev | File | Finding |
| --- | --- | --- |
| med | `ProgressStep.jsx:174,268,279` | getPlan/pause/cancel failures swallowed with `.catch(() => {})` — "0/0 tasks" forever, unresponsive buttons, during the highest-stakes operation. |
| med | `StepRenderer.jsx:132` | Failed task retry gives zero feedback (same silent-catch pattern). |
| med | `WorkBoardPage.jsx:186` | Command-palette "Save current filters as preset" doesn't save — it opens a `window.alert` (the last remaining alert in the UI). |
| med | `Pricing/PricingPage.jsx:329` | Billing toggle exposes no state to AT (no role=switch/aria-checked); prices swap silently. |
| low | `Pricing/PricingCard.jsx:172` | Checkout CTA double-fireable while the Stripe session is being created. |
| low | `Teams/TeamHub.jsx:53` | Empty-name team submit is a silent no-op; no in-flight guard (double-create possible). |
| low | `ui/Select.jsx:147` | Searchable mode drops focus to `<body>` after select/Escape; `aria-activedescendant` on the wrong element while searching. |
| low | `SummaryStep.jsx:440` | Infinite "Loading migration report..." spinner when planId is missing (ProgressStep guards the same case). |
| low | `MyReviewsTab.jsx:167` | AI draft-comment failure entirely silent in the Request Changes modal. |

### Testing (no misplaced test files · no .only/.todo in unit suites)
| Sev | File | Finding |
| --- | --- | --- |
| med | `server/__tests__/azure-host-validator.test.js:27` | **Still mutates and `DELETE`s from the real on-disk dev DB** (known audit #32, unfixed) — running unit tests locally wipes configured allowlist hosts. |
| med | `server/lib/pat-resolver.js` / `validators.js:152` / `useSourceStepForm.js:339` | Three of today's wave-2 fixes shipped without regression tests (pat-resolver branches, TFVC schemas, prefetch-storm). |
| med | `e2e/migration-wizard.spec.js` | Flagship wizard's only e2e test asserts the dialog opens — no step-walking journey despite full mock-mode support. |
| low | e2e | No browser coverage for billing/checkout, license activation, teams, or the new credentials/allowlist settings; 3 tests hard-skipped with untracked "fix-forward planned" notes. |
| low | `AddRepoInput.test.jsx:40` et al. | Real-clock sleeps racing debounce windows — the exact pattern tests/setup.js documents as the historical 37% flake source. |

### Documentation
| Sev | File | Finding |
| --- | --- | --- |
| med | `docs/api/API.md` | ~15 live Azure endpoints undocumented — the **entire** host-allowlist + credentials-vault surface, projects/create, 5 enrichment endpoints, TFVC in-place. index.md's "every endpoint documented" claim is now false (counts: index ~280, API.md ~300, actual 304). |
| med | `.env.example:95` | `ALLOWED_AZURE_HOSTS` — which the UI literally instructs admins to set — appears in zero docs; on-prem TFS support has no operator documentation at all. |
| med | `AGENTS.md:76` | Prescribes the glassmorphism aesthetic the v4.3.0 theme spec explicitly deleted; stack line says Gemini-only; conflicts with CLAUDE.md on temp-file location; references gitignored rule files. |
| low | `CLAUDE.md:18` + overview.md:385 + ARTICLE.md:229 | "Vite 7" → actual Vite 8. |
| low | `docs/index.md` | One dead link (validation-mobile-snapshot.md), v4.2.0 still "upcoming", map omits WORK-BOARD-API.md, work-board-tracking.md, and 10 of 12 reports. |
| low | `README.md:583` / `ROADMAP.md:30` / `README.md:30` | PBKDF2 note describes only the legacy path; roadmap says v4.0.0 "unreleased" and on-prem Azure "Q3 2026" (already implemented); hero links "What's new in v4.0.0" at v4.3.0. |
| low | `dados.txt` (root) | **Loose file in repo root containing a real Enterprise license key JWT** (gitignored, but one .gitignore edit from being committed). Move to `.dev/` or delete — the key is re-mintable. Also: stray root `plans/`, empty `Implementation/`, per-tool rule folders. |

## Suggested order of attack

1. **Before anything else commits/deploys:** #1 production boot crash + #2 rate-limiter bucket (both are tiny diffs with outsized impact) + the wip-diff `forceStrategy` enum fix (it's in the uncommitted work).
2. **Dead features users can hit today:** #7 Approve button, #5 SSE freeze, #6 README typography, #4 duplicate detection (+ fix its mocks).
3. **Contract/security pair:** #3 CSRF-vs-API-keys together with `requireScope` enforcement; license endpoint PII gate.
4. **Test the money paths:** #8 OAuth callback (incl. the half-authenticated-session edge), #9 billing, #10 import-service, plus today's untested fixes (pat-resolver, KDF v1 fixture, TFVC schemas) and the dev-DB-wiping suite (#32).
5. **Legal hygiene:** #11 MIT headers sweep + CI guard; move `dados.txt` out of the root.
6. **Premium polish sweep:** ds-scrollbar unification, Switch adoption, Azure-form primitives, the UX silent-failure cluster (ProgressStep/retry/palette/pricing toggle).
7. **Docs catch-up:** API.md Azure section, ALLOWED_AZURE_HOSTS + on-prem guide, AGENTS.md rewrite, index.md map fixes.
