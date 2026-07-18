# Production Premium Plan — 2026-07-17

Owner directive (2026-07-17): make the whole product production-ready and premium-feeling, then write a launch article for a DevOps→GitHub migration forum. Work in cost-aware agent waves; persist state after every wave so any session can resume.

Source of truth for findings: `docs/reports/2026-07-17-code-ui-ux-audit-panel.md` (raw JSON in `.dev/audits/2026-07-17/`). Research/design outputs land in `.dev/prod-premium/2026-07-17/`.

## Decisions

- **PostgreSQL: REMOVE.** SQLite (better-sqlite3) is the only supported database. Docs must stop claiming Postgres works.
- **Semantic search:** evaluate `sqlite-vec` (successor of sqlite-vss) vs the current embedding approach — adopt only if it's a real win (R1 research decides).
- **Pricing rebalance:** nearly everything free with generous limits (owner has no site yet; wants broad adoption). Charge only enterprise-grade things (e.g. SSO, priority support, provided services/hosting). AI spend caps stay as cost guardrails. Honesty gates (pricing parity) must keep passing.
- **Merging:** PR per wave, squash-merge when CI is green (owner asked to "resolve tudo"); workflow-file changes still need the owner (token lacks `workflow` scope).

## Waves

### Wave 1 — Production hardening (branch `feat/prod-premium-wave1`) — DONE, PR #206 awaiting CI/merge
All audit FIX NOW items implemented + reviewed clean (run wf_98205922-e4b, 2026-07-18):
- [x] S1 backend-guardrails — commit 6d2a0265 (spend caps on all 5 bypass routes; atomic guardedIncrement primitives; itemId validation; retry config rollback; GDPR assertion strengthened). 66 tests green.
- [x] S2 postgres-removal — commit 580ea708 (boot error for postgres://, adapter + `pg` dep deleted, vercel.json deleted, docs/README honest SQLite-only).
- [x] S3 frontend-resilience — commits 8b214c3b + 5ff46ea6 (prefetch .catch, Log-in-again CTA, contrast, hook memoization, stats-fetch consolidation, mock-init removal, runs-error toast). 65 tests green.
- [x] S4 team-invite — commit 09b8323a (team-notify.js via Resend, notified flag + toasts, docs). 23 tests green.
- [x] Finalize — lint clean, 118 targeted tests green, plan + audit report committed (b1209474, 3efae6e1), PR #206 opened.
- [ ] CI green → squash-merge #206.

### Research verdicts (2026-07-18)
- **sqlite-vec: SKIP** — current JS cosine scan is sub-10ms at real scale (low hundreds of rows/tenant); sqlite-vec is pre-1.0, brute-force anyway, and has a documented silent Windows loading failure in our better-sqlite3 range. Revisit only if scale changes (`.dev/prod-premium/2026-07-17/research-sqlite-vec.md`).
- **Pricing**: full matrix in `design-pricing-rebalance.md`. Owner-directive decisions applied autonomously: bulkAdvanced → Free WITH a new tier-independent daily anti-abuse ceiling; DORA → Free; spend caps become tier-aware but stay disabled-by-default for self-host (no hosted SaaS exists yet — env-overridable, documented); Pro repositioned as "AI headroom + support" in copy only.
- **Migration**: engine is solid; real gaps = PT strings in step 1 (SourceUrlForm), cancel-mid-run doesn't stop the running task (orphaned row), simple-import path lacks cancel/crash-recovery parity, LFS-failed state not actionable (`design-migration-premium.md`).
- **UI upgrades**: 12-item incremental plan, no new deps/endpoints (`design-ui-upgrades.md`).

### Wave 2 — Pricing rebalance + UI polish (design from R2)
- [ ] Implement new free-first tier matrix across `feature-flags.js`, `require-tier.js`, `usage-meter.js`, Pricing UI, README; keep parity gate green; resolve the team-billing honesty gap (mostly dissolves when features go free).
- [ ] The 7 IMPROVE items: canonical EmptyState in WorkBoard, OS-aware Kbd, MarksBadge motion contract, Enterprise pricing token, CODEOWNERS table scroll wrapper, SPRING vocabulary adoption (7 sites), mobile sticky save bar in SettingsTab.

### Wave 3 — Premium migration + UI upgrades (designs from R3/R4)
- [ ] Migration premium pass: fix every inconsistency/edge case R3 finds (cancel mid-run, network fail, LFS, empty/large repos, replace/retry), unify wizard/progress/history UI.
- [ ] README reader (render repo READMEs in RepoDetail), better PR analysis + commit browsing UX (R4 design).
- [ ] sqlite-vec adoption IF R1 recommends it.
- [ ] AI hooked deeper into migration flow where it adds real value (R3/R4 to propose; owner asked "ligar a IA para ficar melhor").

### Wave 4 — Ops + validation + article
- [ ] Minimal prom-client `/metrics` (admin-gated), Caddy/nginx TLS example, `docs/operations.md` refresh.
- [ ] Full validation: CI green across waves, manual smoke of key flows, edge-case sweep.
- [ ] Draft launch article for a DevOps→GitHub migration forum (honest, demo-driven) → `docs/` or `.dev/` for owner review.

## Resume instructions (any session)
1. Read this file + memory `project-prod-premium-2026-07-17`.
2. `git branch -a` + `gh pr list` to see which waves landed.
3. Check `.dev/prod-premium/2026-07-17/` for research/design docs and wave status notes.
4. Continue the first unchecked item; run waves as cost-aware workflows (Sonnet implementer+reviewer per slice, Fable only for synthesis-level judgment).
