# Production Premium Plan — 2026-07-17

**Status: COMPLETE.** All 5 waves shipped (PRs #206, #208, #209, #210, #211, #212, and the wave-5 PR opened from this session). See per-wave checklists below for detail.

Owner directive (2026-07-17): make the whole product production-ready and premium-feeling, then write a launch article for a DevOps→GitHub migration forum. Work in cost-aware agent waves; persist state after every wave so any session can resume.

Source of truth for findings: `docs/reports/2026-07-17-code-ui-ux-audit-panel.md` (raw JSON in `.dev/audits/2026-07-17/`). Research/design outputs land in `.dev/prod-premium/2026-07-17/`.

## Decisions

- **PostgreSQL: REMOVE.** SQLite (better-sqlite3) is the only supported database. Docs must stop claiming Postgres works.
- **Semantic search:** evaluate `sqlite-vec` (successor of sqlite-vss) vs the current embedding approach — adopt only if it's a real win (R1 research decides).
- **Pricing rebalance:** nearly everything free with generous limits (owner has no site yet; wants broad adoption). Charge only enterprise-grade things (e.g. SSO, priority support, provided services/hosting). AI spend caps stay as cost guardrails. Honesty gates (pricing parity) must keep passing.
- **Merging:** PR per wave, squash-merge when CI is green (owner asked to "resolve tudo"); workflow-file changes still need the owner (token lacks `workflow` scope).

## Waves

### Wave 1 — Production hardening (branch `feat/prod-premium-wave1`) — DONE, merged via PR #206
All audit FIX NOW items implemented + reviewed clean (run wf_98205922-e4b, 2026-07-18):
- [x] S1 backend-guardrails — commit 6d2a0265 (spend caps on all 5 bypass routes; atomic guardedIncrement primitives; itemId validation; retry config rollback; GDPR assertion strengthened). 66 tests green.
- [x] S2 postgres-removal — commit 580ea708 (boot error for postgres://, adapter + `pg` dep deleted, vercel.json deleted, docs/README honest SQLite-only).
- [x] S3 frontend-resilience — commits 8b214c3b + 5ff46ea6 (prefetch .catch, Log-in-again CTA, contrast, hook memoization, stats-fetch consolidation, mock-init removal, runs-error toast). 65 tests green.
- [x] S4 team-invite — commit 09b8323a (team-notify.js via Resend, notified flag + toasts, docs). 23 tests green.
- [x] Finalize — lint clean, 118 targeted tests green, plan + audit report committed (b1209474, 3efae6e1), PR #206 opened.
- [x] CI green → squash-merged #206 (2026-07-17).

### Research verdicts (2026-07-18)
- **sqlite-vec: SKIP** — current JS cosine scan is sub-10ms at real scale (low hundreds of rows/tenant); sqlite-vec is pre-1.0, brute-force anyway, and has a documented silent Windows loading failure in our better-sqlite3 range. Revisit only if scale changes (`.dev/prod-premium/2026-07-17/research-sqlite-vec.md`).
- **Pricing**: full matrix in `design-pricing-rebalance.md`. Owner-directive decisions applied autonomously: bulkAdvanced → Free WITH a new tier-independent daily anti-abuse ceiling; DORA → Free; spend caps become tier-aware but stay disabled-by-default for self-host (no hosted SaaS exists yet — env-overridable, documented); Pro repositioned as "AI headroom + support" in copy only.
- **Migration**: engine is solid; real gaps = PT strings in step 1 (SourceUrlForm), cancel-mid-run doesn't stop the running task (orphaned row), simple-import path lacks cancel/crash-recovery parity, LFS-failed state not actionable (`design-migration-premium.md`).
- **UI upgrades**: 12-item incremental plan, no new deps/endpoints (`design-ui-upgrades.md`).

### Wave 2 — Pricing rebalance + UI polish (design from R2) — DONE, merged via PR #208 (+ #209, #210 follow-ups)
- [x] Implement new free-first tier matrix across `feature-flags.js`, `require-tier.js`, `usage-meter.js`, Pricing UI, README; keep parity gate green; resolve the team-billing honesty gap (mostly dissolves when features go free).
- [x] The 7 IMPROVE items: canonical EmptyState in WorkBoard, OS-aware Kbd, MarksBadge motion contract, Enterprise pricing token, CODEOWNERS table scroll wrapper, SPRING vocabulary adoption (7 sites), mobile sticky save bar in SettingsTab.
- [x] Follow-ups: #209 (adm-zip 0.6.0 dependency-security bump) and #210 (ai-spend-cap mock fix in issue-to-plan route test harness) merged same day to keep CI green.

### Wave 3 — Premium migration + UI upgrades (designs from R3/R4) — DONE, merged via PR #211
- [x] Migration premium pass: fix every inconsistency/edge case R3 finds (cancel mid-run, network fail, LFS, empty/large repos, replace/retry), unify wizard/progress/history UI.
- [x] README reader (render repo READMEs in RepoDetail), better PR analysis + commit browsing UX (R4 design).
- [x] sqlite-vec adoption skipped per research verdict above (not recommended).
- [x] AI hooked deeper into migration flow where it adds real value (R3/R4 proposals implemented).

### Wave 4 — Ops + validation + article — DONE, this PR
- [x] Minimal prom-client `/metrics` scrape endpoint for production observability (`server/lib/metrics.js`, default + custom metrics via a prom-client Registry).
- [x] Self-host deployment story: `deploy/Caddyfile.example` (auto-TLS reverse proxy) + nginx guidance, including the migration SSE stream in the no-buffer block.
- [x] Deferred-UX slice: SimpleProgressStep ARIA parity + reconnect indicator, plus one further a11y/resilience item; the third item in that slice was skipped with documented reasoning in the PR.
- [x] Full validation: unit suite (632 files / 5629 tests passed, 24 skipped, 0 failures), production build clean, `npm run lint` clean (0 warnings), honesty gates (pricing-feature-parity, readme-honesty) re-run and green.
- [x] Launch article for a DevOps→GitHub migration forum drafted at `.dev/prod-premium/2026-07-17/article-draft.md` (gitignored local workspace; not part of this PR — for owner review before any external posting).

### Wave 5 — Deferred quality debt (branch `feat/prod-premium-wave5`) — DONE, this PR

- [x] Hunk-level risk heat rail in PR review's diff panel (design doc §2.2, item #6 — previously twice-deferred R4 phase-2 item): `HunkRiskRail.jsx` + `hunkUtils.js` + `useHunkScrollSync.js`, wired into `DiffPanel`/`DiffRenderer`, unified with the existing `ds-risk` tokens. Commit `2c26c6de`.
- [x] Dark-mode AA contrast debt: investigated and found already fully resolved on this branch (inherited from main's `d374a0f1` AA text-variant work). Verified via the existing `e2e/a11y-help*` specs rather than re-doing the work. No new commit needed.
- [x] List virtualization: audited every list in the app for genuine unbounded row counts before windowizing (measure-before-windowizing). Only `RepoGrid`'s list view crosses the existing 50-row threshold with real accumulation, so only it got a dependency-free `useVirtualWindow` hook. Grid mode, `MigrationHistory`, RepoDetail's Issues/PRs tabs, and the WorkBoard cross-repo tabs are all bounded to <=100 rows by server-side pagination/search caps and were deliberately left unwindowed (documented in the commit body). Commit `1e2a16c5`.
- [x] Validation: unit suite 635 files / 5676 tests passed (24 skipped, 0 failures), production build clean, honesty gates (`pricing-feature-parity`, `readme-honesty`) green, `npm run lint` clean.
- [x] Nothing deferred out of this wave's own scope; j/k roving navigation and keyboard shortcuts re-verified unaffected by both the risk-rail and windowing changes.

### Wave 6 — Community WOW (owner request 2026-07-18) — IN PROGRESS
Goal: features that make the app community-launch worthy, all AI-powered via existing guarded paths, all configurable:
- [ ] R: web-validated research (README-improvement tooling landscape; AGENTS.md/CLAUDE.md emerging standard + best practices; AI→mermaid→SVG feasibility — mermaid is already bundled in-app; security-posture analysis scope)
- [ ] README Studio: analyze README vs detected stack/license → gaps + score → AI-improved README with configurable options → diff preview → apply via existing write paths (meter: readmeGenPerMonth)
- [ ] Diagram generator: repo structure → AI mermaid (architecture/sequence/flow) → rendered in-app → SVG export
- [ ] Agent rules generator: repo analysis → AGENTS.md / CLAUDE.md per best practices, configurable sections, preview + apply
- [ ] Security posture panel: aggregate existing signals (branch protection, secrets patterns, workflow permissions, dependabot) + AI recommendations
- [ ] Community polish: repo README refresh with screenshots for launch
Research outputs → `.dev/prod-premium/2026-07-18/`. Same resumable slice pattern (implementer+reviewer, incremental commits, PR per wave).

## Resume instructions (any session)
1. Read this file + memory `project-prod-premium-2026-07-17`.
2. `git branch -a` + `gh pr list` to see which waves landed.
3. Check `.dev/prod-premium/2026-07-17/` for research/design docs and wave status notes.
4. Continue the first unchecked item; run waves as cost-aware workflows (Sonnet implementer+reviewer per slice, Fable only for synthesis-level judgment).
