# Production Premium Plan — 2026-07-17

Owner directive (2026-07-17): make the whole product production-ready and premium-feeling, then write a launch article for a DevOps→GitHub migration forum. Work in cost-aware agent waves; persist state after every wave so any session can resume.

Source of truth for findings: `docs/reports/2026-07-17-code-ui-ux-audit-panel.md` (raw JSON in `.dev/audits/2026-07-17/`). Research/design outputs land in `.dev/prod-premium/2026-07-17/`.

## Decisions

- **PostgreSQL: REMOVE.** SQLite (better-sqlite3) is the only supported database. Docs must stop claiming Postgres works.
- **Semantic search:** evaluate `sqlite-vec` (successor of sqlite-vss) vs the current embedding approach — adopt only if it's a real win (R1 research decides).
- **Pricing rebalance:** nearly everything free with generous limits (owner has no site yet; wants broad adoption). Charge only enterprise-grade things (e.g. SSO, priority support, provided services/hosting). AI spend caps stay as cost guardrails. Honesty gates (pricing parity) must keep passing.
- **Merging:** PR per wave, squash-merge when CI is green (owner asked to "resolve tudo"); workflow-file changes still need the owner (token lacks `workflow` scope).

## Waves

### Wave 1 — Production hardening (branch `feat/prod-premium-wave1`) — IN PROGRESS
All audit FIX NOW items:
- [ ] S1 backend-guardrails: AI spend-cap coverage for /ai/index, /ai/batch-index, /ai/search, /ai/translate-search, /ai/suggest-name-description; usage-meter TOCTOU atomic increment; dashboard itemId validation; migration retry config rollback; GDPR registry CI assertion. Tests in `server/__tests__/`.
- [ ] S2 postgres-removal: remove postgres adapter + db.js branch (clear boot error if `postgres://` configured), fix `docs/operations.md` + `server/migrations/README.md`, delete orphaned `vercel.json`, README note on backend hosting.
- [ ] S3 frontend-resilience: CommandPalette prefetch `.catch` (+ audit other bare background imports), "Log in again" button in RepoStates AUTHENTICATION branch, WorkBoard contrast fix, useGitHub/useRepos action memoization, duplicate global-stats fetch, redundant mock-init effect, TeamDetails runs-fetch error surfacing. Tests in `tests/`.
- [ ] S4 team-invite: real notification on member add via `server/lib/email.js` (+ in-app fallback), docs update.
- [ ] Finalize: lint + targeted tests, push, PR, CI green, merge.

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
