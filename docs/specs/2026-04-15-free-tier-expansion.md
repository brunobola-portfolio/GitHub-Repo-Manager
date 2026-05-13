# Free Tier Expansion — Spec

**Date:** 2026-04-15
**Owner:** Bruno Silva Marques
**Status:** Implemented

## Problem

The Free tier's feature matrix had three issues:

1. **AI capabilities were not discoverable.** The AI Assistant, Semantic Search, Migration Risk Analysis, and PR Review were all Pro-only. Free-tier users never experienced the product's strongest differentiators, which hurt conversion.
2. **Advertised per-feature caps (3 READMEs/month, 20 commits/month, 5 insights/month) were cosmetic.** All AI endpoints incremented a single `ai_queries` counter, so a free user could exhaust their whole budget on one feature, or — inversely — use one feature far above its advertised cap.
3. **Marketing promised features that code didn't enforce or implement.** `Migration Risk Analysis` had no backend route. Advanced bulk operations (transfer, mirror, cross-org) had no tier gate. Dry-run migration was a DB column but never changed execution behavior.

## Goals

- Make the AI product surface-area visible on Free — especially the conversational Assistant, which is the clearest "why pay" hook when a user hits a quota.
- Back every advertised cap with a real per-feature counter.
- Close the gaps where pricing-page claims diverged from runtime enforcement.

## Non-goals

- Changing the Pro price point.
- Building a net-new feature (Migration Risk reuses the existing Gemini wiring).
- Restructuring Enterprise.

## New tier matrix

| Feature                              | Free            | Pro          | Enterprise |
|--------------------------------------|-----------------|--------------|------------|
| Repositories managed                 | 50              | Unlimited    | Unlimited  |
| API keys                             | 2               | 10           | 50         |
| Basic bulk on own repos              | ✓               | ✓            | ✓          |
| Advanced bulk (transfer, mirror, cross-org) | ✗        | ✓            | ✓          |
| Sync Repository (mirror sync)        | ✗               | ✓            | ✓          |
| AI Assistant (conversational)        | ✓ **NEW**       | ✓            | ✓          |
| AI queries / month (total)           | **200** (was 100) | **5,000** (was 2,000) | Unlimited |
| Semantic Search                      | **50/month NEW**| Unlimited    | Unlimited  |
| Migration Risk Analysis (AI)         | **5/month NEW** | Unlimited    | Unlimited  |
| Repo Insights / Quality Report       | **10/month** (was 5) | Unlimited | Unlimited |
| README Generator (AI)                | **5/month** (was 3) | Unlimited | Unlimited |
| Commit Generator (AI)                | **50/month** (was 20) | Unlimited | Unlimited |
| PR Review Experience                 | ✓ read-only **NEW** | ✓ full + write-back | ✓ full + write-back |
| Dry-Run migration                    | ✓               | ✓            | ✓          |
| Export Metadata (JSON)               | ✓               | ✓            | ✓          |
| Azure DevOps Cloud migration         | ✗               | ✓            | ✓          |
| Community Health Dashboard           | ✓               | ✓            | ✓          |
| Teams                                | ✗               | 15 members   | Unlimited  |
| Audit Logs                           | ✗               | ✗            | ✓          |
| SSO                                  | ✗               | ✗            | ✓          |

> **Amended 2026-05-13** — `semanticSearchPerMonth` raised 50 → 75 and `repoInsightsPerMonth` raised 10 → 15 on Free. See `docs/specs/2026-05-12-ai-quota-premium-indicators.md` for rationale. No other matrix values changed.

## Implementation changes

### Per-feature quotas (new metric types)

`server/lib/usage-meter.js` now recognises five new metric types:

- `ai_readme` → `readmeGenPerMonth`
- `ai_commit` → `commitGenPerMonth`
- `ai_insights` → `repoInsightsPerMonth`
- `ai_migration_risk` → `migrationRiskPerMonth`
- `ai_semantic_search` → `semanticSearchPerMonth`

Two helpers were added:

- `checkAIFeatureLimit(userId, featureMetric)` — verifies the per-feature cap AND the global `ai_queries` cap, returning the first one that would be exceeded (so error messages point at the specific quota hit).
- `incrementAIUsage(userId, featureMetric)` — bumps the feature-specific counter AND the global `ai_queries` counter in one call.

Every AI route in `server/routes/ai.js` was updated to use these helpers with its own metric (README → `ai_readme`, commit → `ai_commit`, insights/index/batch-index/quality-report → `ai_insights`, semantic search → `ai_semantic_search`, migration risk → `ai_migration_risk`). The conversational chat, refine, PR review summary, and analyze-context endpoints keep using the generic `ai_queries` metric — they're the "background" AI calls that don't have their own advertised cap.

### Semantic Search exposed on Free

Removed `requireTier('pro')` from `GET /ai/search` in `server/routes/ai.js`. The endpoint is still rate-limited, now via the `ai_semantic_search` per-feature counter (50/month on Free).

### Migration Risk Analysis — new endpoint

`POST /ai/migration-risk` in `server/routes/ai.js`. Given a repo and source/target platforms, it:

1. Pulls signals soft-failingly: branch count, LFS usage (`.gitattributes` filter=lfs), CI workflow count, languages, size, open issues, visibility, archived status, wiki/pages flags.
2. Prompts Gemini with the signals for a structured risk report (`overallRisk`, `score 0-100`, `summary`, `blockers[]`, `warnings[]`, `recommendations[]`, `estimatedDurationMinutes`).
3. Falls back gracefully if the AI response can't be parsed — the raw text is surfaced as a warning rather than erroring out.

### Advanced bulk gating

Added `requireTier('pro')` to `POST /transfer`, `POST /transfer/check-conflicts`, and `POST /mirror` in `server/routes/bulk.js`. Basic bulk (`/visibility`, `/archive`, `/delete`) remains available to Free — those are own-repo operations, not cross-org moves.

### Dry-run migration honored

`server/migration-engine.js::_executeTask` now checks `migration_plans.is_dry_run` at the start of each task. If set, it emits four simulated progress steps (validation, target check, transfer, finalize) and returns success metadata tagged `{ dryRun: true }` without touching remote services. Real target-name validation still runs first, so dry-run surfaces bad configs as real failures.

### Usage endpoint expansion

`GET /api/v1/usage` now returns an `aiFeatures` block with per-feature `{ current, limit }` pairs for readme, commit, insights, migrationRisk, and semanticSearch — consumed by the Settings UsageDashboard.

### Frontend

- `PricingPage.jsx` — rewrote Free-tier card to lead with AI capabilities; Pro now shows `5,000` queries.
- `FeatureComparison.jsx` — new rows reflect per-feature caps; PR Review is read-only on Free, full on Pro+.
- `Landing/PricingPreview.jsx` — Free preview now highlights AI Assistant + Semantic Search + Migration Risk as the hook.
- `Settings/UsageDashboard.jsx` — renders per-feature progress bars when the tier has caps. Pro/Enterprise users only see the global AI Queries bar (per-feature limits collapse to Unlimited, bars skipped).

## Migration & compatibility

- **Existing Free users** get more capability, not less — no opt-in needed.
- **DB schema** unchanged: the `usage_metrics` table already has `metric_type TEXT`, so the new metric strings slot straight in.
- **Counters reset on calendar month boundaries** (existing behavior via `getCurrentPeriod()`).
- **API key clients** calling `/ai/search` previously got 403 on Free, now get 200 with a `ai_semantic_search` counter decrement. No breaking change — new behavior is strictly more permissive.

## Test plan

- Unit tests for `checkAIFeatureLimit` / `incrementAIUsage` covering (a) per-feature cap hit, (b) global cap hit first, (c) both counters increment in tandem.
- Unit test for `/ai/migration-risk` happy path + malformed AI response fallback.
- Unit test for dry-run migration: plan marked `is_dry_run=1` skips real service calls and emits `{ dryRun: true }`.
- Smoke: build passes, existing tests green, manual check that pricing page matches the matrix above.

## Risks

- **AI cost**: raising Free queries from 100 → 200 and adding Semantic Search/Migration Risk to Free doubles worst-case per-user Gemini spend. Monitored via audit log's `ai.*` actions; if abuse shows, tighten `aiQueriesPerMonth` rather than re-gate features.
- **Scope creep**: the PR Review "read-only on Free vs write-back on Pro" split is advertised in pricing but not yet enforced in code — a follow-up is needed to gate the write-back path when Pro is flagged `false`. Tracked as a TODO in `src/components/PRReview/` for the next iteration.

## Post-review hardening (2026-04-15 follow-up)

Code review surfaced issues addressed before merge:

- **Free tier dry-run migration access**: the `/migration` router was previously gated Pro-only at `server/routes/v1/index.js`, denying Free users any access — including the dry-run pricing claims. Gate moved per-route: Free can create plans (forced to `isDryRun=true`) and execute/resume/retry them; real (non-dry-run) execution requires Pro via a new `requireProOrDryRunPlan` middleware in `server/routes/migration.js`.
- **Migration-risk input hardening**: added `isValidGitHubFullName` in `server/middleware/auth.js` (regex allowlist: `owner/repo`, no traversal, no query injection). Applied in `/ai/migration-risk`; also restricts `source`/`target` platform strings to a fixed allowlist.
- **Migration-risk response hardening**: response fields are explicitly coerced (risk enum validated against `['low','medium','high','critical','unknown']`, score clamped 0–100, arrays filtered to strings, durations to finite positive numbers). Parse failures now return `overallRisk: 'unknown'` + `parseError: true` instead of fabricating a `medium` verdict.
- **Dry-run now probes target availability**: for `repo`/`repo-tfvc` tasks, dry-run hits `GET /repos/{owner}/{repo}` on the target — 404 is the happy path, 200 means "target exists" and fails the simulation. For `work-items`/`wiki`/`repo-tfvc`, missing Azure PAT credentials fail dry-run up-front.
- **Shared 429 body** via `quotaExceededResponse` in `server/lib/usage-meter.js`. All per-feature AI endpoints now return a uniform `{ error, message, metric, limit, current, remaining, upgradeUrl }` shape.
- **Transactional counter increment**: `incrementAIUsage` wraps both writes (feature + global `ai_queries`) in `db.transaction` so they never drift on a partial write.
- **Tests added**: `server/__tests__/usage-meter-ai-features.test.js` (7 tests for the new helpers), `server/__tests__/ai-migration-risk.test.js` (7 tests for the endpoint + validation + parse fallback), and a `_executeTask — dry-run branch` describe block in `server/__tests__/migration-engine.test.js` (3 tests for the simulation + target probe + Azure-PAT guard).
