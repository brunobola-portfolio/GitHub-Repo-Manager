# Repo Advisor — follow-ups handoff (resume here)

**Date:** 2026-06-22
**Status:** Handoff — initiative shipped; a deferred tail remains
**Read first:** `docs/specs/2026-06-21-repo-advisor-initiative.md` (master spec) + project memory `project_repo_advisor_initiative.md`

## What's already on `main` (done, CI-green — 13 PRs this session)

- **Hotfix:** Git LFS migration (`--above=100MiB`) — the original incident.
- **Phase 1:** renamed to **Repo Advisor**; `AI_PROVIDER` honored server-wide (provider-neutral).
- **Phase 2:** error knowledge base (`server/lib/ai-features/error-kb.js`) + grounded "Known issue" prompt block; failed-migration context chip.
- **Phase 3:** suggested prompts + `aria-live`; source-citation rendering; **code-block copy**; per-call **output-token cap** (`ai-output-budget.js`); generalized **spend cap** (`ai-spend-cap.js` + `ai_spend` table); **PII-safe audit** (`ai-audit.js`); chat golden eval (`server/evals/.../repo-advisor-chat.*`).
- **AI-config audit remediation:** documented all AI env vars (`.env.example` + `docs/ai-providers.md`); `guardedGenerate(req,opts,{feature})` wrapper in `server/routes/ai/shared.js` applied to 7 non-streaming routes; output-cap on all 6 `generateStream` sites; `AI_PROVIDER` validated in `config.js`.

## Remaining work (the deferred tail) — do these as separate PRs, in order

1. **Spend-record + audit on streaming completion.** Streams have the output cap but not spend tracking/audit. After each `generateStream` finishes (usage is available post-stream), call `recordAISpend(userId, costUSD)` + `auditLog(... buildAIAuditMeta(...))`. Sites: `server/routes/ai/dev-toolkit.js` (5), `server/routes/ai/pr-chat.js` (1). Also add a spend-cap **check** before each stream.
2. **Quota on the Pro-tier routes.** `deep-review.js`, `pr-chat.js`, `pr-commands.js` have `requireTier('pro')` but **no** `checkUsageLimit`/`checkAIFeatureLimit` + no spend/audit. Add them (even Pro should be metered).
3. **`readme/enhance` guards.** It generates inside `server/lib/ai-features/readme-enhance.js` via `aiService.provider` (not a route-level `generate` call), so `guardedGenerate` doesn't reach it. Either thread the guards into the helper or refactor the route to call `guardedGenerate`.
4. **Quota gaps (audit #5):** `GET /ai/search` (no quota), the `POST /ai/batch-index` per-repo embed loop (one quota check for N embeds), prompt-studio mutation/test endpoints.
5. **BYOK minors (audit #6):** key-rotation UX (re-encrypt on `CREDENTIAL_ENCRYPTION_KEY` change), validate `featureOverrides` model values, optional DNS-rebinding recheck in `createProviderForUser`.
6. **Owner-only (need elevated scope/keys):**
   - **CI eval-gate:** add `- run: npm run test:evals` to the `test` job in `.github/workflows/ci.yml` (one line, after `npx vitest run`). The agent's OAuth token lacks `workflow` scope — you (or a PAT with `workflow`) must push it.
   - **Real-model evals** (`--real` mode in `server/evals/run.js`) + LLM-as-judge scorer — need a provider key + budget; run locally/scheduled, not in PR CI.
   - **Streaming UX** for Repo Advisor replies (SSE end-to-end) — bigger cross-stack effort; designed in the master spec.

## Reusable building blocks (consume, don't reinvent)
- `guardedGenerate(req, opts, { feature })` — `server/routes/ai/shared.js` (spend-cap check→429, output cap, spend record, audit). **Every new non-streaming AI route should use this.**
- `resolveMaxOutputTokens()` — `server/lib/ai-output-budget.js`.
- `checkAISpendCap()` / `recordAISpend()` — `server/lib/ai-spend-cap.js` (table `ai_spend`, env `AI_SPEND_CAP_CENTS`).
- `buildAIAuditMeta()` — `server/lib/ai-audit.js` (PII-safe).
- `findErrorKbEntry()` — `server/lib/ai-features/error-kb.js`.

## Gotchas / working rules (learned this session)
- **Concurrent agent:** another agent works in worktree `s:/grm-migration-honesty` (branch `feat/migration-review-honesty`). To avoid the git ref race, **do every slice in an isolated `git worktree`** (EnterWorktree). On Windows, junction `node_modules` to the main checkout instead of reinstalling: `New-Item -ItemType Junction -Path node_modules -Target "S:\Git Hub Repo Manager\node_modules"`.
- **Backend route tests need env:** `config.js` calls `process.exit(1)` without `SESSION_SECRET`. Run backend tests with `$env:SESSION_SECRET='…(≥16 chars)'; $env:NODE_ENV='test'`. CI sets this in the `test` job.
- **Don't run full e2e locally as the gate** — push and let CI run Playwright (mock mode). Locally, free ports 5173/3001 first so Playwright starts its own mock servers.
- **Workflow:** one slice → its own worktree → TDD → PR → wait for CI green → squash-merge → delete branch → ExitWorktree → sync `main`.
- **Note:** `main` carries the concurrent migration-planner backend (swept into Slice-1 squash `598021f`); the migration-review frontend lives on `feat/migration-review-honesty` and reconciles when that branch merges.

## Bootstrap prompt for the next session
> Continue the Repo Advisor follow-ups. Read `docs/specs/2026-06-22-repo-advisor-followups-handoff.md` and the project memory, then tackle the "Remaining work" list in order (start with #1, streaming spend+audit). Use isolated git worktrees per slice (concurrent agent active), reuse `guardedGenerate`, TDD, one PR per slice, CI→merge.
