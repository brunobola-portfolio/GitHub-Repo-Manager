# Launch-Readiness Panel — 2026-07-19

7-specialist multi-agent audit of `main` @ `f13b20d9` (post-#227), covering production
ops, security/AI metering, code quality, docs, UI, UX, and premium/pricing — scoped to
"is this ready to run in production and to be publicly promoted?". Analysis only; no
code was changed.

## Verdict

**GO with conditions.** 5/7 dimensions GREEN, 2 YELLOW (security, docs). Nothing is
architecturally broken; the blockers are a handful of surgical fixes — one false
privacy claim in the README and three AI-metering gaps — that should land before
public promotion.

| Dimension | Verdict | Headline |
|---|---|---|
| Production & Ops | GREEN | Docker/CI/release all green; branch protection active. GHCR image private; compose drops `LICENSE_KEY`. |
| Security & AI metering | **YELLOW** | Core metering solid, 2026-07-17 HIGHs fixed — but 2 new HIGH bypass surfaces remain. |
| Code quality | GREEN | Lint 0 warnings, ~6005 tests, honesty gates live. Entry chunk 89KB (code-split follow-up pending). |
| Docs & honesty | **YELLOW** | Excellent overall — but README FAQ makes a **false privacy claim**; guides contradict free-first pricing. |
| UI | GREEN | Both themes inspected live in mock mode; polish items only (contrast, pricing card balance). |
| UX | GREEN | All 2026-07-17 dead ends verified fixed. Minor mobile/guard polish. |
| Premium & functionality | GREEN | Gating coherent across all 5 pricing surfaces; Stripe→license flow end-to-end. Usage-reporting defects. |

## Fix BEFORE promotion (blockers)

1. **README.md:508 — false privacy claim** (docs, HIGH). FAQ says AI receives
   "never your code content", but AI Deep Review sends the full PR diff
   (`server/lib/ai-features/pr-deep-review.js:117`) and the Commit Generator works
   from diffs. The Deep Review guide is already honest — rewrite the FAQ answer
   per-feature and consider adding the phrase to the readme-honesty gate. A false
   privacy claim is the single worst thing to launch with.
2. **POST /api/migration/analyze is completely unmetered** (security, HIGH).
   `server/routes/migration.js:745-756` → `server/migration-planner.js:281` calls the
   provider directly: no quota, no spend cap, no `recordAISpend`, no output cap, no
   `requireScope('ai')`, not in `AI_GENERATION_ROUTE_PATHS`. Prompt inflatable up to
   200 repos — denial-of-wallet on the server key. Route through `guardedGenerate`.
3. **dev-toolkit blocking branches bypass the spend cap** (security, HIGH). Streaming
   branches are guarded; the non-stream branches of `/ai/generate-commit` (:281),
   `/ai/generate-pr` (:405), `/ai/refine` (:519), `/ai/analyze-context` (:571) and
   non-stream `/ai/review-summary` (via `pr-review.js:97`) call
   `req.aiProvider.generate` raw. `?stream` is client-chosen, and for Enterprise
   (`aiQueriesPerMonth: Infinity`) the spend cap would be the ONLY guardrail. Convert
   to `guardedGenerate` (helpers already imported).
4. **Work Board + Community Health AI routes never touch the spend cap** (security,
   MEDIUM). `work-board-actions.js` `/ai-summary`, `/suggest-action`,
   `/draft-comment` and `actions-community.js` `/community-health/generate` charge
   quota but skip `checkAISpendCap`/`recordAISpend`. Rate limiters mitigate; still
   operator money outside the cap.

## Fix before promotion (strongly recommended, small)

5. **docker-compose doesn't forward `LICENSE_KEY`** (prod-ops, MEDIUM) — a paying
   self-host customer silently degrades to Free (same class as the #227 public.pem
   fix). 1 line. Also missing: `DB_BACKUP_DIR`/`DB_BACKUP_KEEP`/`ALLOWED_AZURE_HOSTS`.
6. **GHCR image is private and undocumented** (prod-ops, MEDIUM) — 28 versions
   published, nobody can pull. Make the package public + add `docker pull` line to
   README/operations.md. (Owner action, 2 clicks.)
7. **Usage dashboard shows 0 on non-UTC hosts** (premium, MEDIUM) —
   `server/routes/usage.js:12-13` builds the period key in LOCAL time while all
   writes use UTC (`usage-meter.js:18-24`). On a UTC+1 host (Portugal, DST) Settings →
   Usage reads 0/1000 forever. Enforcement unaffected. 2-line fix: reuse
   `getCurrentPeriod()`.
8. **Docs contradict free-first pricing** (docs, MEDIUM) —
   `docs/features/ai-deep-review.md:22-36`, `docs/api/API.md:4770-4773`,
   `docs/index.md:119-122` still call Prompt Studio / slash commands / PR Chat
   "Pro-only"; there is no `requireTier('pro')` anywhere in `server/routes/` anymore.
   README matrix is correct; guides under-promise.
9. **Monthly $19 sub emits a 12-month irrevocable license key** (premium, MEDIUM) —
   `stripe-webhooks.js:156` hardcodes `months: 12` for any checkout; cancellation only
   downgrades SaaS tier, the emailed JWT stays valid with no revocation. Align key
   duration to `billingPeriod` (metadata already carries it) or document as deliberate
   AGPL goodwill.

## Polish (can ship after promotion)

- **10 of ~15 Free quotas invisible in Usage dashboard** (premium) — deep review, PR
  chat/commands, prompt tests, diagrams, agent rules, security posture, images,
  migration full, sync apply are enforced + advertised but users only discover them
  at the 429. Extend `/api/v1/usage` + `UsageDashboard`.
- **Contrast**: `WhatNeedsYouGrid.jsx:92` delta badge uses `text-emerald-500/rose-500`
  on small text (~2.3:1 in light, below AA; state-gated so axe never sees it); also
  `DevToolkit/shared/DiffSummary.jsx:29,44`, `ReviewTab/QuickSummary.jsx:24`. Swap to
  600/400 variants.
- **Pricing page balance**: Pro/Enterprise cards have ~450px of empty space (grid
  stretches to the Free card's 30 rows). `items-start` or collapse Free list. Public
  launch surface.
- **Motion vocabulary drift**: ~19 files hardcode `[0.16,1,0.3,1]` (= `EASE.emphasized`)
  or off-vocab springs; overshoot ease in `states/UpgradeRequired.jsx:98` /
  `ServiceUnavailable.jsx:77` violates the no-bounce contract. Mechanical find/replace.
- **z-[45]** in `AIAssistant.jsx:451` escapes the z-index guard regex (only catches
  30|40|50|60|70|80|90|3+ digits). Tokenize + widen regex.
- **Mobile**: 4 AI modals hardcode split diff view (unreadable at 375px) —
  `ReadmeStudioModal.jsx:456`, `ReadmeEnhanceDiffPanel.jsx:113`,
  `DiagramGenerator.jsx:547`, `AgentRulesModal.jsx:316`; PRReview's `DiffRenderer`
  already has the unified toggle to reuse.
- **Anti-PT guard gaps**: `no-portuguese-ui.test.js` ROOTS misses `src/contexts`,
  `src/actions`, `src/config`, `src/__mocks__` (currently clean, unguarded). Also one
  Mac-only `⌘K` glyph in `WorkBoard/KeyboardHelpModal.jsx:8`.
- **Onboarding doesn't showcase launch features** — README Studio / AI Diagrams /
  Security Posture / Agent Rules have zero first-use discovery. A 4th onboarding step
  or "What's new" chip is cheap, high promotion ROI.
- **Entry bundle 89KB gz** (budget re-baselined to 92KB in #227; code-split of the
  eager App shell — Header/Sidebar/RepoList/OrgSidebar in `App.jsx:3-43` — still
  pending; then drop `EAGER_INDEX_GZ_BUDGET` to ~75KB).
- **CHANGELOG missing #227** — `[Unreleased]` stops at #226; README points to
  CHANGELOG as source of truth.
- **Ops niceties**: Docker image never boot-tested in CI (smoke test before push);
  backups land on the same volume as the live DB; `deploy.yml` duplicates the full
  suite on every main push while `DEPLOY_ENABLED` is off; CodeQL never enabled
  (owner, 2 clicks); TOCTOU check-then-increment on quotas (self-overrun only;
  atomic pattern exists in `chargeMigrationQuotaTxn`); `community-health/commit-fix`
  accepts client-echoed `filePath` (limited blast radius — own repo, preview-first).

## Verified healthy (evidence, not assumption)

- CI/Docker/Release green; honesty + axe + bundle gates actually executing
  (`RUN_BUILD_TESTS=1` in ci.yml:87); branch protection with required
  lint/test/build/e2e contexts **active** (#227 follow-up done by owner).
- All 2026-07-17 audit HIGHs verified fixed in current code: AI spend-cap bypasses
  (indexing/translate-search/suggest-name), session dead end, stale-deploy toast,
  silent team invite.
- Honesty stack: pricing-feature-parity (602 lines, cell-for-cell vs README +
  FeatureComparison) + readme-honesty green, 67 tests, never weakened; "6,000+ tests"
  claim true (~6011); docs:linkcheck 0 broken across 207 files; all 22 README images
  exist; zero Portuguese in docs/src; ARTICLE.md placeholder-free; v4.6.0 release
  published with assets.
- Premium end-to-end: Stripe checkout → idempotent webhook → subscription + EdDSA
  license key by email; expiry auto-downgrade; honest 503 fallback banner when Stripe
  unconfigured; all headline features (README Studio, Diagrams, Agent Rules, Security
  Posture, Image Gen, metered Migration, PR Review, Live Inbox) implemented, metered,
  preview-first via `commitOrOpenPR`.
- Mocks can't leak to prod (inline DEV guards + build-honesty bundle check); no fake
  code/stubs; only 2 conditional test skips, both executed in CI.

## Suggested landing order

1. PR "launch honesty + metering": README FAQ fix + `migration/analyze` guard +
   dev-toolkit blocking branches → `guardedGenerate` + work-board/community-health
   spend cap + regression tests. (Blockers 1-4.)
2. PR "distribution": compose `LICENSE_KEY`/backup vars + README `docker pull` line;
   owner flips GHCR package public + enables CodeQL.
3. PR "premium truth": usage.js UTC fix + 10 missing quota rows + license `months`
   by billingPeriod + docs Pro-only corrections + CHANGELOG #227.
4. Post-launch polish wave: contrast, pricing card balance, motion/z-index cleanup,
   mobile diff mode, onboarding "What's new", shell code-split.

Panel run: 7 agents, 293 tool uses, ~643k tokens, 7m06s. Findings above were
verified against code (file:line) by the reporting specialist; prior-audit claims
were re-checked rather than trusted.
