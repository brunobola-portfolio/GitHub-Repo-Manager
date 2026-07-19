# Codebase Audit — Performance, Deduplication, Simplification, Premium & Security

**Date:** 2026-06-26 · **Branch:** `main` · **Version:** 4.4.0
**Method:** Read-only multi-agent panel. The codebase was sliced into 30 coherent areas; one reviewer per slice audited all five dimensions, every High/Critical and Security finding was then adversarially re-verified against the real code (false positives dropped), and the results were consolidated here. **No source files were modified.**

> ✅ **Coverage: 30/30 slices — the whole codebase** (`server/**` and `src/**`). Excluded by design: `tests/`, `e2e/`, `node_modules/`, build output. **348 verified findings.**

---

## Executive summary

This is a **mature, well-architected codebase in fundamentally good shape.** The recent history shows deliberate de-monolithing (azure router split, migration task-runners, a real schema-migration framework) and the right primitives already exist — a resilient `githubApi()` wrapper (circuit breaker + ETag cache + backoff), a strict `assertSafeExternalUrl()` SSRF guard, a central CSRF-aware fetch layer (`apiCall`/`fetchWithRetry`), a `SafeMarkdown` component, a shared premium `Select`, typed-throw AI clients, and a quota/spend-cap layer. There are **zero critical issues and no SQL injection** — parameterized queries are used consistently.

The dominant problem is not bad code; it is **good primitives that aren't used everywhere — and the weakest copy silently defines the real behavior.** The clearest case spans the whole frontend: **20+ components and hooks hand-roll raw `fetch()` with a manual, one-shot CSRF token** instead of `apiCall`/`fetchWithRetry`. The shared layer auto-injects and *rotates* the CSRF token, retries `403 csrf_invalid`, queues mutations while offline, and fires the session-expiry bus — none of which the bespoke copies get. One of them (`dashboardInbox`) forgets the token entirely and **returns 403 in production**; others silently fail on a rotated token. The same "divergent duplicate" shape recurs in security primitives (three secret-redactors that disagree, a second SSRF guard that allows `git://`), in markdown rendering (raw `ReactMarkdown` on AI output and GitHub comment bodies while `SafeMarkdown` exists), and — notably — in **UI primitives you just unified: several pickers re-implement native `<select>`/custom dropdowns instead of the shared premium `Select`,** a regression against the June migration.

The second theme is **scale**: several dashboard/work-board queries full-scan multi-tenant `issue_events`/`pr_events` tables that lack the needed indexes, and embedding search runs an O(N) cosine loop on the event-loop thread — fine today, a cliff as data grows. The third is a cluster of **premium/UX correctness bugs** in shared surfaces: a `Button` that defaults to `submit`, a "Simulate" toggle that performs a *real* transfer, an AI-description button and an "Adjust cap" CTA that silently no-op.

Most fixes are **low-risk consolidation and safe wins** — exactly the "improvements without breaking anything" you asked for. **21 High, 125 Medium, 202 Low** (348 total, 0 Critical). Two findings touch strategic bets: the **`dev.azure.com` hardcoding** breaks the on-prem/TFS migration you invested in, and the **Postgres singleton-transaction bug** is a data-integrity hazard on the SaaS path you're transitioning to.

**Overall health: GOOD.**

---

## Scorecard

| Dimension | Critical | High | Medium | Low | Total |
|---|:--:|:--:|:--:|:--:|:--:|
| 🔒 Security | 0 | 7 | 14 | 30 | 51 |
| ⚡ Performance | 0 | 7 | 35 | 41 | 83 |
| ✨ Premium / Professional | 0 | 4 | 26 | 56 | 86 |
| ♻️ Deduplication | 0 | 2 | 38 | 24 | 64 |
| 🪶 Simplification | 0 | 1 | 12 | 51 | 64 |
| **Total** | **0** | **21** | **125** | **202** | **348** |

---

## Cross-cutting themes

Fixing the *pattern* is higher-leverage than fixing one instance, and most of these are pure consolidation onto helpers that already exist.

### 1. Bespoke `fetch()` + manual CSRF fragments resilience and security (the biggest theme)
**20+ frontend sites** hand-roll `fetch()` with a one-shot `getCsrfToken()` instead of `apiCall`/`fetchWithRetry` (`src/utils/api.js`), losing CSRF *rotation*-retry, the offline mutation queue, 401 session-expiry handling, and backoff. Confirmed in: the MigrationWizard data hooks (`useAzureProjectData`, `useBranchCache`, `useRepoNameConflicts`, `useSourceStepForm`, `useWizardNavigation` — the last **sends a PAT/password** through this weaker path), `SourceStep/PatPasteGuide.jsx`, `TargetConfigStep` duplicate-check, **all DevToolkit tabs** (`PRTab`/`CommitTab`/`ReviewTab`/`QuickActions`), `PRReview/hooks/useReviewAI.js`, `Settings/ApiKeysSection.jsx`, `Teams/TeamDetails.jsx`, `useReviewAction`, `CreateRepoModal` (CSRF boilerplate copied ~18×). **`src/api/dashboardInbox.js:62-107` omits the token entirely → archive/restore/snooze 403 in production.** Backend mirror: raw `fetch()` bypassing `githubApi()` in `server/actions-service.js`, `work-item-service.js`, `import-service.js`. **Fix:** route everything through the shared wrappers. Pure dedup that also closes a prod bug and a class of CSRF/credential edge-cases.

### 2. Shared premium `Select` / form primitives bypassed (regression vs the June unification)
After the June migration to a single premium `Select`, several surfaces have drifted back to native `<select>`/`<input>` or bespoke listboxes — re-introducing the a11y/behavior gaps the migration removed: `MigrationWizard/.../SavedCredentialsPicker.jsx`, `ServerPicker.jsx` (raw `<input>`), `AIPrompts/PromptPicker.jsx`, `Settings/AIConfig/ModelCombobox.jsx`, `DevToolkit/shared/{BranchSelector,RepoSelector}.jsx` (three near-identical custom dropdowns), `Settings/AzureCredentialsSection.jsx` (native inputs + a shadow `Field`). **Fix:** migrate these to the shared `Select`/form primitives. Premium + accessibility; low risk.

### 3. Unsanitized markdown despite a `SafeMarkdown` component
Untrusted text is rendered with bare `ReactMarkdown`/`rehypeRaw` even though a sanitizing `SafeMarkdown` exists: `AI/ChatPrimitives.jsx` (assistant output, no sanitization), `PRReview/DiffPanel/InlineComment.jsx` (GitHub comment bodies), `RepoSelectStep/RepoDetailPanel.jsx` (README via `rehypeRaw` before sanitize). XSS surface that hinges entirely on schema correctness. The server-side `sanitizeSvg` also misses `<use>`/`<style>`/CSS vectors. **Fix:** route untrusted markdown through `SafeMarkdown`; harden the SVG allowlist.

### 4. Parallelizable work is awaited serially (safe perf wins)
`server/routes/search.js:86-103` (`type=all`) runs three GitHub searches serially **despite its docstring claiming parallel "to keep response under ~400ms."** Same shape in `server/routes/bulk.js:315-329` (community-health compare: up to **50 sequential** round-trips per request, while sibling `/transfer/check-conflicts` already uses `Promise.all`), `server/community-health-service.js:9-23` (three independent phases serial, ignoring its own cache), and `src/components/MigrationHistory.jsx` (one fetch **per plan row**). Fix = `Promise.all`/bounded fan-out. Risk: low.

### 5. Unindexed full-table scans across multi-tenant event tables (scale risk)
`server/lib/event-aggregations.js:156` (`assignee_logins LIKE '%"login"%'`, no index on `action`), `:374` (unscoped `GROUP BY` over all `issue_events`, run daily per active user by the KPI job), `server/lib/dashboard-aggregator.js:91` (fetch 50 cross-tenant rows, filter by author in JS). `server/lib/ai-features/semantic-search.js` loads **every** embedding row and computes cosine in a synchronous JS loop on the event loop. Fix = add the missing indexes, push filters into SQL, snapshot "latest state" tables; consider sqlite-vec/pgvector. Risk: none–low.

### 6. Duplicated, divergent security primitives (the weakest copy wins)
Three secret-redactors that disagree (`redact-secrets.js` misses GitHub/Azure PAT families; `ai-error-format.js` only known prefixes → custom keys leak to clients). Multiple SSRF guards: `import/url.js` and `import/azure/git.js` byte-identical; `url-validator.js:145-180` `isInternalUrl()` a weaker third variant allowing `git://`/encoded loopback. Outbox integrity: `gh-outbox.js` idempotency key omits `userId` (global `UNIQUE`) → cross-user response / dropped mutation; worker lacks a row-claim guard → overlapping ticks **double-execute** GitHub mutations.

### 7. Input-validation inconsistency at the GitHub-path boundary
Most repo routes validate `owner`/`repo`/`full_name` before splicing into a GitHub URL — but `server/routes/v1/repos-{security,export,sync}.js` register no param validators and `server/routes/ai/indexing.js` `/ai/index` (length-only) and `/ai/batch-index` (no schema) splice `full_name` straight into `githubApi()` paths. Reuse the validators already used next door. Risk: low.

### 8. On-prem / VSTS host dropped on key migration paths (product regression)
`server/work-item-service.js:431-482` hardcodes `https://dev.azure.com/...` (receives `host`, never reads it) and `server/wiki-service.js:64-70` hardcodes it in generated links → **work-item migration 404s for every non-cloud source.** Directly undercuts the on-prem investment. Fix = thread `host` through the host-aware azure-service helpers. Risk: low.

### 9. Premium / professional correctness in shared surfaces
`ui/Button.jsx:42-62` never defaults `type` → `submit` inside every form modal. `TransferModal.jsx` "Simulate" never passes `dryRun` → **clicking Simulate performs a real transfer.** `CreateRepoModal.jsx:83-99` AI description reads non-existent fields → silently no-ops. `Settings/WorkBoard/ai/WorkBoardCapReachedBanner.jsx:76-78` "Adjust cap" focuses a non-existent element → dead CTA. Plus `WorkBoardPage` falling back to `window.alert()`, `Setup/SystemSetup` showing fabricated progress, and double-fetch effects in `Settings/AuditLogSection`/`LicensePlanSection`.

### 10. SaaS-path concurrency hazard & auth edges
`server/lib/adapters/postgres-adapter.js` stashes the per-transaction pg client on the **process-wide singleton** → concurrent requests cross-contaminate (bind to `AsyncLocalStorage`; risk medium — verify carefully). `auth.js:196-226` mock-login reachable outside dev via `ALLOW_MOCK_AUTH`. `license.js:59-84` unauthenticated `GET /api/v1/license` leaks holder email/org/active-users. `ai-provider.js:826-833` BYOK `endpointUrl` SSRF-validated but never applied.

---

## Top priorities

Ordered for impact × safety. Most are **low breaking-risk** — the "safe wins" you asked for. Full detail per finding is in the [Appendix](#appendix--all-findings).

| # | Issue | Where | Dim | Sev | Fix risk |
|:--:|---|---|:--:|:--:|:--:|
| 1 | "Simulate" dry-run performs a **real** transfer | `src/components/TransferModal.jsx` | Premium | High | low |
| 2 | Dashboard inbox archive/restore/snooze **broken in prod** (missing CSRF → 403) | `src/api/dashboardInbox.js` | Security | High | low |
| 3 | Postgres transaction client on singleton → **cross-request contamination** (SaaS) | `server/lib/adapters/postgres-adapter.js` | Security | High | med |
| 4 | Outbox idempotency key not user-scoped → cross-user response / dropped mutation | `server/lib/gh-outbox.js` | Security | High | low |
| 5 | Work-item migration hardcodes `dev.azure.com` → **on-prem TFS broken** | `server/work-item-service.js` | Simplif. | High | low |
| 6 | v1 repos routes splice unvalidated `owner/repo` into GitHub/push URLs | `server/routes/v1/repos-*.js` | Security | High | low |
| 7 | `/ai/batch-index` has **no** body validation; `full_name` → GitHub path | `server/routes/ai/indexing.js` | Security | High | low |
| 8 | `isInternalUrl()` weak/divergent SSRF guard (allows `git://`, encoded loopback) | `server/lib/url-validator.js` | Security | High | med |
| 9 | `/ai/interpret` no per-call rate limit → monthly AI budget burned in seconds | `server/routes/work-board-ai.js` | Security | High | low |
| 10 | `search.js` `type=all` runs 3 calls **serially** (contradicts its own docstring) | `server/routes/search.js` | Perf | High | low |
| 11 | Missing indexes → full multi-tenant scans on `issue_events`/`pr_events` | `server/lib/event-aggregations.js` · `db.js` | Perf | High | none |
| 12 | community-health compare: up to **50 serial** GitHub round-trips per request | `server/routes/bulk.js` | Perf | High | low |
| 13 | **Bespoke fetch + manual CSRF across 20+ sites** (theme 1) — consolidate onto `apiCall` | `MigrationWizard/*`, `DevToolkit/*`, `Settings/ApiKeysSection`, … | Dedup | High | low–med |
| 14 | Shared `Button` defaults to `type="submit"` → accidental form submits | `src/components/ui/Button.jsx` | Premium | High | low |
| 15 | AI "magic description" reads wrong fields → silently no-ops | `src/components/CreateRepoModal.jsx` | Premium | High | low |
| 16 | "Adjust cap" CTA is a dead no-op (focuses non-existent element) | `Settings/WorkBoard/ai/WorkBoardCapReachedBanner.jsx` | Premium | High | low |
| 17 | Native/custom dropdowns bypass the shared premium `Select` (theme 2, a11y regression) | `MigrationWizard`, `AIPrompts`, `Settings`, `DevToolkit` | Premium | Med | low |
| 18 | Untrusted markdown rendered without `SafeMarkdown` (theme 3, XSS surface) | `AI/ChatPrimitives.jsx` · `PRReview/.../InlineComment.jsx` | Security | Med | low |

**Also notable:** outbox worker double-executes mutations (no row-claim) · mock-login reachable outside dev via `ALLOW_MOCK_AUTH` · unauthenticated `/api/v1/license` leaks PII · `semantic-search` O(N) cosine on the event loop · `github-api` ETag cache keyed on a 32-bit token hash (cross-tenant leak risk) · raw PAT sent in `AzureTargetForm` body · Import button stays enabled on a known name conflict · `Pricing` feature catalog defined 3× · `App.jsx` hardcodes endpoint URLs despite `config.js` constants.

---

## How to apply

These are **advisory** — no code was changed. Suggested sequencing of safe wins first:

1. **Quick safe wins (risk: none–low, high value):** `Button` default `type`, `dashboardInbox` CSRF, `search.js` parallelize, add the missing event-table indexes, v1 route validators, `/ai/interpret` rate limit, `dev.azure.com` host threading, the two dead-CTA bugs (`CreateRepoModal`, `WorkBoardCapReachedBanner`), `TransferModal` dry-run.
2. **Consolidation sweeps (one PR each, mechanical):** migrate bespoke fetch sites onto `apiCall`/`fetchWithRetry` (theme 1); migrate dropdowns onto the shared `Select` (theme 2); route untrusted markdown through `SafeMarkdown` (theme 3); unify the three secret-redactors and the SSRF guards (theme 6).
3. **Carefully (risk: medium, verify with tests):** Postgres `AsyncLocalStorage` transaction binding; outbox row-claim + idempotency user-scoping; `semantic-search` ranking.

Want me to turn any of these into an implementation plan (`docs/plans/`) or start applying tier-1 safe wins? Say the word and I'll scope it.

---

## Appendix — all findings

All 348 verified findings, grouped by dimension then severity. Each lists location, fix breaking-risk, the problem, and the proposed fix. Security/High findings were adversarially re-verified (verdict shown).

---

### 🔒 Security (51)

#### High · 7

**SH-1. Transaction client stored on the singleton adapter — concurrent Postgres requests cross-contaminate**
`server/lib/adapters/postgres-adapter.js:100, 121, 133, 142, 179-199`  —  risk: **med** · confidence: high · verify: confirmed
- *Problem:* transaction() stashes the per-transaction pg client on the shared adapter instance (this._txClient), and get/all/run all route through `this._txClient \|\| this._pool`. The adapter is a process-wide singleton (db-adapter.js builds one PostgresAdapter for the whole server). Under the SaaS Postgres path, any DB call made by request B while request A is inside a `db.transaction(...)` will be executed on A's transaction client instead of the pool — landing B's reads/writes inside A's transaction, seeing A's uncommitted rows, and being rolled back if A rolls back. With async interleaving this is the normal case, not an edge case. It silently breaks isolation/atomicity and can corrupt data or leak another tenant's uncommitted state. (better-sqlite3 is synchronous so the SQLite path is unaffected; this only bites the pg adapter, which is production-selectable via DATABASE_URL.)
- *Fix:* Do not store the tx client on the shared instance. Use AsyncLocalStorage to bind the active client to the async context of the transaction callback, and have get/all/run read the client from that context (falling back to the pool when none is set). Each concurrent transaction then sees only its own client. Add a concurrency test that runs two overlapping transactions and asserts no cross-talk.

**SH-2. Global UNIQUE idempotency_key (no user scope) lets one user receive another user's outbox response and silently drop their own mutation**
`server/lib/gh-outbox.js:57-62, 88-114; schema in server/lib/db-migrations.js:318`  —  risk: **low** · confidence: high · verify: confirmed
- *Problem:* makeIdempotencyKey() derives the key from (method, url, sha256(body)) only — it does NOT include userId. The gh_outbox.idempotency_key column is globally UNIQUE (db-migrations.js v20: `idempotency_key TEXT NOT NULL UNIQUE`). In enqueueAndExecute(), the INSERT uses `ON CONFLICT(idempotency_key) DO NOTHING`, and the fallback SELECT `... WHERE idempotency_key = ?` is NOT scoped by user_id. Consequence: if user B issues a mutation with the same method+url+body as a prior user A (realistic for collaborators on a shared repo — e.g. identical issue-comment body, or the same `/repos/o/r/pulls/N/merge` call), B's request collides with A's row, the INSERT is a no-op, and B falls into the 'fetch existing row' branch. If A's row already 'succeeded', B is returned A's cached response_body and B's mutation is NEVER executed against GitHub. This is a cross-tenant information leak (B sees A's response payload) plus a correctness/data-integrity bug (B's intended write is dropped).
- *Fix:* Scope idempotency by user: either include userId in the derived key (e.g. `${userId}:${method}:${url}:${bodyHash}`) AND/OR change the SELECT-on-conflict to `WHERE idempotency_key = ? AND user_id = ?`. Cleanest is to incorporate userId into the key at makeIdempotencyKey/executeViaOutbox so two users can never share a row; the UNIQUE constraint then remains correct. Add a regression test for two userIds with identical method+url+body.

**SH-3. isInternalUrl() is a weaker, divergent SSRF guard that misses several private ranges and allows git://**
`server/lib/url-validator.js:145-180`  —  risk: **med** · confidence: high · verify: confirmed
- *Problem:* isInternalUrl() is a second, parallel SSRF implementation used by import-service.js / wiki-service.js (per the file header). It is materially weaker than assertSafeExternalUrl() in the same file: (1) it allows the `git:` scheme (cleartext, unauthenticated) as a non-internal URL; (2) it only blocks the exact literals `127.0.0.1`/`::1`/`localhost` — it does NOT block `127.0.0.5`, `2130706433` (decimal-encoded loopback), `0x7f.0.0.1`, or `0.0.0.0/8` except the all-zero case; (3) it never strips IPv6 brackets nor blocks fe80::/10 link-local or fc00::/7 unique-local, so `https://[fe80::1]` and `https://[fd00::1]` pass; (4) it does not block `.local` / cloud-metadata via hostname. An attacker controlling an import/wiki URL can reach internal services the strict guard would block. Because two guards disagree, callers using the weak one are exposed.
- *Fix:* Make isInternalUrl() delegate to the strict path: implement it as `try { assertSafeExternalUrl(urlString, { allowHttp: false }); return false } catch { return true }` (extending assertSafeExternalUrl to also accept `git:` only if a caller truly needs it, behind an explicit opt-in). For defence-in-depth against DNS rebinding, ensure those call sites also run resolveAndValidateHost(). At minimum, add the missing octet/decimal/IPv6 checks and drop `git:` from the allowed schemes.

**SH-4. POST /ai/batch-index has NO body validation; unvalidated repo.full_name flows into GitHub API path**
`server/routes/ai/indexing.js:212-289`  —  risk: **low** · confidence: high · verify: confirmed
- *Problem:* Unlike every other repo-fetching AI route, /ai/batch-index reads `const { repos } = req.body` with no Zod schema (no validateBody middleware). Each element's `repo.full_name` is then interpolated raw into authenticated GitHub calls: `githubApi(`/repos/${repo.full_name}/readme`)` and `/contents` (lines 280, 287), with NO `isValidGitHubFullName` check and NO `encodeURI`. A crafted full_name (e.g. containing `../`, `..%2f`, `?`, `#`, or extra path segments) lets a caller reshape the request path against api.github.com while carrying the victim's OAuth token — an SSRF-within-the-GitHub-host / unexpected-endpoint-access primitive (e.g. redirecting `/repos/x/readme` toward `/repos/owner/repo/collaborators` style segments, or appending query params). `repo.id`, `repo.name`, and the embedding inputs are also unvalidated, so junk types reach the DB INSERT and analyzeRepo. The non-stream /ai/index route shares the weaker validation (see separate finding) but at least runs a schema.
- *Fix:* Add `validateBody(...)` with a schema mirroring aiIndexSchema's repo object but as an array (e.g. `z.object({ repos: z.array(aiBatchRepoSchema).min(1).max(10) })`), where each repo's full_name uses the `repoFullNameRegex` already defined in validators.js. Then `encodeURI(repo.full_name)` before splicing into githubApi paths, matching readme/enhance and quality-report.

**SH-5. v1 repos routes splice unvalidated :owner/:repo into GitHub API URLs and a git push URL (path/query injection)**
`server/routes/v1/repos-security.js, server/routes/v1/repos-export.js, server/routes/v1/repos-sync.js:repos-security.js:44-50; repos-export.js:9-18; repos-sync.js:18,40,62`  —  risk: **low** · confidence: high · verify: confirmed
- *Problem:* Unlike the server/routes/repos/*.js sub-routers (which all call applyOwnerRepoParamValidators to enforce GITHUB_NAME_RE on :owner/:repo), the three v1 routers mounted in v1/index.js (router.use(reposExportRouter/reposSyncRouter/reposSecurityRouter)) register NO router.param validators. Their owner/repo come straight from req.params into githubApi(path) which builds the URL as `https://api.github.com${path}` with no encoding (github-api.js:241). A value like repo='x?per_page=100&visibility=all' or owner='x/../../user' rewrites the path/query sent to GitHub. repos-sync.js is worst: owner/repo also flow into the git push target URL `https://x-access-token:${token}@github.com/${owner}/${repo}.git` (line 62) and into an audit log. The same params are validated everywhere else in the codebase, so this is an inconsistency that defeats the existing control.
- *Fix:* Call applyOwnerRepoParamValidators(router) (from ../repos/_shared.js) at the top of each of repos-security.js, repos-export.js, and repos-sync.js — exactly as the repos/*.js sub-routers do. This rejects owner>39 chars / repo>100 chars and anything not matching GITHUB_NAME_RE before the handler runs.

**SH-6. /interpret invokes an LLM provider per request with no per-call rate limit**
`server/routes/work-board-ai.js:85-149`  —  risk: **low** · confidence: high · verify: confirmed
- *Problem:* POST /ai/interpret calls `provider.generate(...)` (an external, billable LLM call) on every request, gated only by requireWorkBoardAI. That gate enforces a *monthly* cost cap only when `ai_monthly_cap_cents > 0` (middleware lines 32-46); when the cap is 0/unset there is no ceiling at all, and even with a cap a user can burn the entire monthly budget in seconds with a tight request loop. There is no per-minute/hour limiter. Contrast work-board-actions.js /draft-comment (lines 95-103, 388) which wisely applies `draftCommentLimiter` (10/hour) around its provider call. This is a denial-of-wallet / abuse vector on the most expensive endpoint in the slice.
- *Fix:* Add an express-rate-limit limiter keyed on `req.session.userId` (mirroring draftCommentLimiter) to /interpret (and ideally /apply), with a sane window such as 20-30/hour. Optionally also reject when `ai_monthly_cap_cents === 0` to require an explicit cap before enabling LLM calls.

**SH-7. Dashboard inbox mutations skip CSRF token -> 403 in production**
`src/api/dashboardInbox.js:62-107`  —  risk: **low** · confidence: high · verify: confirmed
- *Problem:* archiveInboxItem / restoreInboxItem / snoozeInboxItem POST to same-origin /api/v1/dashboard/inbox/* via the local jsonFetch() helper, which calls raw fetch() with NO X-CSRF-Token header. The server enforces requireCsrfToken on ALL /api/* mutations (server/index.js:243, server/middleware/csrf.js:114) and /api/v1/dashboard is NOT in the bypass list, so every archive/restore/snooze write returns 403 { code: 'csrf_invalid' }. The optimistic UI in useInbox removes the row immediately, so the user sees the item vanish then (on refresh) reappear, with no visible error. This is a real functional break for a shipped feature, not just a hardening gap.
- *Fix:* Route these mutations through fetchWithRetry/apiCall (which auto-inject and auto-rotate the CSRF token) instead of the bespoke jsonFetch, OR inject `'X-CSRF-Token': await getCsrfToken()` into the headers of the POST calls. fetchWithRetry is the established pattern and also gives 401/429/csrf-rotation handling for free.


#### Medium · 14

**SM-1. redactSecrets only matches known key prefixes — custom/local API keys and bearer tokens in upstream error bodies can leak to the client**
`server/lib/ai-error-format.js:126-132`  —  risk: **low** · confidence: medium · verify: confirmed
- *Problem:* formatAIErrorForUser returns rawMessage and upstreamRaw (up to 500 chars) to the API client after passing them through redactSecrets(). redactSecrets (server/lib/redact-secrets.js:11-23) only redacts sk-*, key_*, AIza* prefixes and basic-auth-in-URL. For BYOK/local/OpenRouter or Azure-style deployments the key may not carry an sk- prefix (e.g. an Azure 'api-key' GUID, a bearer JWT, or a self-chosen local token). If a misconfigured upstream echoes the Authorization header or key into its JSON error.message/metadata.raw (some gateways do), that secret is surfaced verbatim in the /test response and in logger.warn. Low-frequency but a plausible token-leak path on the security-critical slice.
- *Fix:* Strengthen redactSecrets: also redact `Bearer\s+[A-Za-z0-9._-]{12,}`, `api-key`/`x-api-key` header-value patterns, and long high-entropy hex/base64 tokens; and never echo upstreamRaw unless it has been redacted. Consider gating upstreamRaw behind a config flag for non-self-host deployments.

**SM-2. BYOK custom endpoint (endpointUrl) is SSRF-validated but never applied to OpenAI/OpenRouter providers — validation/use mismatch**
`server/lib/ai-provider.js:826-833, 858-863`  —  risk: **low** · confidence: high · verify: adjusted
- *Problem:* createProviderForUser SSRF-validates userConfig.completionCredentials.endpointUrl (lines 808-817) and then builds the provider with `entry.create({ ...creds, ...model })`. The stored credential object uses the key `endpointUrl` (see server/routes/user-ai-config.js:128). But OpenAIProvider/OpenRouterProvider constructors read `baseURL`, NOT `endpointUrl` (server/lib/providers/openai.js:127). So for openai/openrouter the user's configured endpoint is silently DROPPED and the provider always hits the hardcoded default (https://api.openai.com/v1 or openrouter.ai). Only LocalProvider reads `endpointUrl`. Consequences: (1) the validate-vs-use surfaces are different fields, so the SSRF guard protects a value that isn't used by these providers while the field that IS used (baseURL) is whatever the default is; (2) functionally, Azure OpenAI / LiteLLM / corporate-gateway / self-hosted OpenAI-compatible endpoints are impossible to configure — the user's key is sent to api.openai.com regardless. The existing test (server/__tests__/ai-provider-user.test.js:394-410) only asserts `instanceof MockOpenAIProvider`, never that baseURL was applied, so it does not catch this.
- *Fix:* In createProviderForUser, normalise creds before create(): map endpointUrl→baseURL for OpenAI/OpenRouter (or have OpenAIProvider accept an `endpointUrl` alias). E.g. build `const { endpointUrl, ...rest } = creds; entry.create({ ...rest, ...(endpointUrl ? { baseURL: endpointUrl } : {}), ...model })`. Keep LocalProvider's endpointUrl handling. Add a test asserting the provider's _baseURL equals the configured endpoint.
- *Verifier (severity adjusted):* Mechanism fully confirmed. Stored credential uses key `endpointUrl` (server/routes/user-ai-config.js:128,141). createProviderForUser SSRF-validates `endpointUrl` (ai-provider.js:808-816) then builds providers via `entry.create({ ...creds, ...(model?{model}:{}) })` (lines 829-832, 858-863) with no endpointUrl->baseURL normalization, and PROVIDER_REGISTRY.create passes opts straight to the constructor (lines 693-700). OpenAIProvider only destructures `baseURL` (providers/openai.js:123-128) and OpenRouterProvider likewise (providers/openrouter.js:22-28); neither reads `endpointUrl`, so it is silently dropped and baseURL defaults to the hardcoded public host. Only LocalProvider reads endpointUrl (providers/local.js:21-27). The cited test (ai-provider-user.test.js:394-410) only asserts instanceof + the resolve-call arg, never _baseURL, so it would not catch this. Adjusting high->medium: the dropped endpoint means there is no actual SSRF reachability for openai/openrouter (the validated value is never fetched), so the 'security' label overstates direct exploitability. The real harm is a high-impact correctness/config bug (Azure OpenAI/LiteLLM/corporate-gateway configs impossible; user's key silently sent to api.openai.com contrary to explicit config) with a modest security dimension. Medium fits better than high.

**SM-3. Entropy-based redaction regex can catastrophically backtrack on long child-process output (ReDoS)**
`server/lib/env/sanitize.js:13`  —  risk: **low** · confidence: medium · verify: confirmed
- *Problem:* The final pattern `/(?=[A-Za-z0-9_+/=-]*[A-Za-z])(?=[A-Za-z0-9_+/=-]*\d)[A-Za-z0-9_+/=-]{32,}/g` uses two unanchored lookaheads each scanning an unbounded `[A-Za-z0-9_+/=-]*` run, applied to attacker-influenceable installer/child-process stdout that can be large. On long alphanumeric runs this is super-linear and can stall the event loop (the same output is also sliced to 4000 chars only AFTER sanitisation, so the regex runs on the full untruncated buffer). sanitizeOutput runs on every spawned line via onLine, so a hostile package name/version banner could degrade the server.
- *Fix:* Truncate/bound the input before regex (cap to e.g. 16 KB), and/or rewrite the entropy check to a linear scan: split on whitespace and test each token's length+char-class with simple character counting instead of nested lookaheads. Apply the 4000-char cap before sanitisation, not after.

**SM-4. Outbox worker has no row-claiming/in-flight guard — overlapping ticks double-execute non-idempotent GitHub mutations**
`server/lib/gh-outbox.js:178-274, 287-298`  —  risk: **low** · confidence: medium · verify: confirmed
- *Problem:* runOutboxOnce() SELECTs up to 50 status='pending' rows and processes them without marking them in-flight (no `status='processing'` claim, no row lock). startGhOutboxWorker() uses setInterval(...) which fires every 60s regardless of whether the previous async tick has finished; a slow tick (50 rows x network round-trips behind backoff) easily exceeds 60s, so the next interval re-selects the SAME pending rows and re-issues the raw HTTP call. The idempotency_key only dedupes at INSERT time — it does NOT make the GitHub call itself idempotent, so a re-driven `POST .../comments` posts a duplicate comment. Any horizontally-scaled deployment (>1 process) hits this unconditionally since the queue is a shared SQLite table.
- *Fix:* Atomically claim rows before processing: `UPDATE gh_outbox SET status='processing' WHERE id IN (SELECT id ... LIMIT 50)` (or set a `claimed_at` and filter it out in the SELECT), and only operate on the claimed ids. Also guard the interval against re-entrancy (a boolean `running` flag, or chain the next tick in `.finally()` instead of setInterval). Document that multi-process safety still needs the DB-level claim.

**SM-5. ETag/response cache keyed on a 32-bit truncated token hash risks cross-tenant private-data leakage**
`server/lib/github-api.js:242-243, 359-360`  —  risk: **none** · confidence: high · verify: confirmed
- *Problem:* The in-memory etagCache key is `${userHash}:${url}` where userHash = sha256(token).slice(0, 8) — only 8 hex chars (32 bits) of entropy. The cache stores the full response `data` (which can be private repo contents). In a multi-tenant SaaS, two distinct tokens that share the same 8-hex-char prefix and request the same URL will collide on the cache key, so one user could be served another user's cached private response. 32 bits is far too short to serve as a tenant-isolation boundary, and truncation also weakens the 304-revalidation correctness (a colliding entry could send a wrong If-None-Match ETag).
- *Fix:* Use the full sha256 hex (or at least 16+ bytes) for the cache-key user component — there is no size benefit to truncating a key string. Alternatively key the cache by the authenticated userId (passed in) rather than a hash of the token. This is a one-line change (drop `.slice(0, 8)`), backward-compatible since the cache is in-memory.

**SM-6. Secret redactor misses GitHub/Azure PAT families it is meant to scrub before logs/responses**
`server/lib/redact-secrets.js:13-22`  —  risk: **low** · confidence: high · verify: confirmed
- *Problem:* redactSecrets() (used before logging or returning strings to the client) covers `sk-`, `key_`, `AIza`, and basic-auth URLs, but does NOT cover the token families that are most prevalent in THIS product: GitHub PATs (`ghp_`, `gho_`, `ghs_`, `ghr_`, classic and `github_pat_...`) and Azure DevOps PATs (52-char base32). The sibling utilities secret-redactor.js (SECRET_REGEX) and env/sanitize.js DO cover `gh[pousr]_` / `github_pat_`. So a GitHub token flowing through redactSecrets() (e.g. an error string containing a remote URL with `x-access-token:ghp_...@github.com` after the userinfo regex has already been applied, or a bare token in a message) is logged/returned in cleartext. The project rule explicitly says never log PAT/tokens.
- *Fix:* Add the GitHub/Azure token patterns to redactSecrets (reuse the same regex as env/sanitize.js: `/\b(?:gh[pousr]\|github_pat)_[A-Za-z0-9_]{20,}\b/gi` plus a high-entropy 32+ base64-ish fallback). Better: collapse redact-secrets.js, secret-redactor.js, and env/sanitize.js into one shared redactor so all three stay in sync.

**SM-7. POST /ai/index: repo.full_name validated only by length, spliced into GitHub path without regex or encodeURI**
`server/routes/ai/indexing.js:29-47`  —  risk: **low** · confidence: high · verify: confirmed
- *Problem:* aiIndexSchema (validators.js line 370) types `repo.full_name` as `z.string().min(1).max(200)` with NO `repoFullNameRegex` and NO `isValidGitHubFullName` guard. It is then interpolated directly into `githubApi(`/repos/${repo.full_name}/readme`)` and `/contents` (lines 45-47) with no encodeURI. This is the same class of path-injection as batch-index, just narrower (single repo). Sibling routes readme/enhance (core.js:497), quality-report (dev-toolkit.js:46), migration-risk (migration.js:225) and issue-to-plan all reject non-`owner/repo` shapes before touching the GitHub URL; this one does not.
- *Fix:* Tighten aiIndexSchema.repo.full_name to `.regex(repoFullNameRegex)` (already exported in validators.js), or add an `isValidGitHubFullName(repo.full_name)` 400 check at the top of the handler, plus `encodeURI(repo.full_name)` before the githubApi calls.

**SM-8. Mock-login route is reachable in any non-development env via ALLOW_MOCK_AUTH and grants a full session**
`server/routes/auth.js:196-226`  —  risk: **low** · confidence: medium · verify: confirmed
- *Problem:* POST /api/v1/auth/mock issues a fully-authenticated session (userId 999999, accessToken='mock_token') whenever NODE_ENV==='development' OR process.env.ALLOW_MOCK_AUTH==='true'. The allow-list framing is good, but ALLOW_MOCK_AUTH is an environment escape hatch that, if ever set on a preview/staging/prod box (or leaked into a shared .env), hands anyone an authenticated session with zero credentials — a complete auth bypass. There is no additional secret/token required to invoke it. The blast radius is total account access for the mock user (and admin if 999999 is ever granted is_admin).
- *Fix:* Keep the route mounted only when NODE_ENV==='development'. If a non-dev opt-in is truly needed, require a high-entropy shared secret in the request body compared timing-safely against an env var (e.g. MOCK_AUTH_SECRET), and never enable it on a build artifact that ships to production. At minimum, log a loud startup warning when ALLOW_MOCK_AUTH is set so misconfiguration is visible.

**SM-9. OAuth callback reports success even when the token exchange returns no access_token**
`server/routes/azure/oauth.js:102-121,133-139`  —  risk: **low** · confidence: high · verify: confirmed
- *Problem:* After POSTing the code, the handler only branches on tokenData.access_token being present. If Azure AD returns a JSON error body (e.g. invalid_grant, expired code, consent revoked) there is no access_token but no exception is thrown, so azureTokenError is never set and the page still renders 'Authentication complete'. The polling endpoint /azure/oauth/token then returns { ready:false, error:false } forever, leaving the wizard spinning with no failure signal. Errors in the AAD response body are also silently swallowed (never logged).
- *Fix:* Add an else branch: when !tokenData.access_token, set req.session.azureTokenError = true, log the AAD error code/description (NOT the raw token), and render the 'Authentication failed' page instead of the success page.

**SM-10. Unauthenticated GET /api/v1/license leaks license holder email, org, and active-user count**
`server/routes/license.js:59-84`  —  risk: **low** · confidence: high · verify: confirmed
- *Problem:* GET /api/v1/license has NO requireAuth. When a license is active it returns info.email (the license holder's email address), info.org, info.seats, and seatsUsed — where seatsUsed is computed by an unbounded scan COUNT over users with last_login in the last 30 days. Any anonymous internet caller can therefore harvest the operator/company email, org name, seat entitlement, and a live active-user count. The inline comment claims 'public: server-level info, no user data', but email and the live user-count are exactly the kind of PII/operational intel that should not be anonymous-readable on a SaaS deployment. This is information disclosure useful for phishing the license owner and for sizing/recon of the tenant.
- *Fix:* Gate the route with requireAuth (and ideally requireAdmin for the email/seat fields), or strip info.email / seatsUsed from the unauthenticated response and only return the coarse { active, tier } needed by a setup wizard. If a public variant is required for the wizard, return only { active, tier } and move org/email/seats/seatsUsed behind auth.

**SM-11. URL/GitHub import sends raw token/password via bespoke fetch that bypasses CSRF-retry and offline queue**
`src/components/MigrationWizard/hooks/useWizardNavigation.js:42-103`  —  risk: **low** · confidence: high · verify: confirmed
- *Problem:* handleStartImport assembles credentials { type:'token', token: source.authToken } or { type:'basic', username, password } and POSTs them with a one-shot getCsrfToken() (L74: `try { headers['X-CSRF-Token'] = await getCsrfToken() } catch {}`) directly via fetch. Because it does not go through fetchWithRetry, it gets no csrf_invalid auto-retry, no offline mutation queue, and no session-expiry handling — and on a stale-token 403 the user's import silently fails with a generic toast. Sending real source credentials makes the missing retry/queue protections more consequential than a read-only call. Note this is the one mutation in the slice that carries secrets in the body.
- *Fix:* Use the shared apiCall (or a migrationApi.startImport wrapper) so the request inherits CSRF rotation-retry, offline queue, and 401 handling. Verify the credential is only ever sent over the existing same-origin POST (it is) and never logged.

**SM-12. Raw PAT sent in request body, bypassing the shared azureCredPayload credential rule**
`src/components/MigrationWizard/steps/TargetConfigStep/AzureTargetForm.jsx:128, 188-195`  —  risk: **low** · confidence: high · verify: adjusted
- *Problem:* ExistingProjectForm (line 128) and NewProjectForm (lines 188-195) hand-build the request body with `pat: source.pat` unconditionally. The codebase has a dedicated util `src/utils/azureRequestPayload.js#azureCredPayload(source)` whose whole purpose is to centralise 'prefer savedCredentialId, fall back to pat, and for serverPat/oauth send NOTHING (backend resolves from session/env)'. By sending `source.pat` directly these two forms (1) transmit the raw PAT over the wire even in serverPat/oauth modes where the server already has the credential, and (2) silently ignore `source.savedCredentialId`, so a user who picked a saved credential instead sends a possibly-empty/stale PAT and the call may use the wrong identity. The sibling hook useAzureProjectData.js (lines 49, 92) correctly spreads `...azureCredPayload(source)` for the exact same endpoints, proving this form is the deviation. Unnecessary PAT transmission widens the secret's exposure surface (logs, proxies, error capture).
- *Fix:* Import `azureCredPayload` from utils/azureRequestPayload and replace the inline `host/org/pat` fields in both fetch bodies with `org: source.org, ...azureCredPayload(source)` (and drop the explicit `host`/`pat`, which azureCredPayload already supplies). This matches useAzureProjectData and stops leaking the PAT in modes where the backend resolves it server-side.
- *Verifier (severity adjusted):* REAL. AzureTargetForm.jsx line 128 (ExistingProjectForm) builds the body as {host: source.host, org: source.org, pat: source.pat} and lines 188-195 (NewProjectForm) include pat: source.pat unconditionally, bypassing the shared azureCredPayload(source) util in src/utils/azureRequestPayload.js. That util is the established pattern, used at useAzureProjectData.js:49/94, useBranchCache.js:43, WorkItemsStep.jsx:60, WikiStep.jsx:43, useEnrichedRepos.js:42/73/116, RepoDetailPanel.jsx:55 — these two forms are the clear deviation. The genuine defect confirmed by server/lib/pat-resolver.js + server/routes/azure/_shared.js + proxy.js: the backend resolver order is savedCredentialId(vault) > pasted pat > session OAuth > env AZURE_PAT, so these forms (a) never send source.savedCredentialId, meaning a user who picked a saved token (where 'the PAT never leaves the server', per SavedCredentialsPicker.jsx) sends pat:undefined and the server falls through to session/env and uses the WRONG identity (or 400s) — a real functional/identity bug. Severity adjusted from high to medium: the 'widens PAT exposure surface in serverPat/oauth modes' framing is largely theoretical — in those modes source.pat is empty so nothing extra is actually transmitted, and in personalPat-pasted mode the PAT is legitimately sent (resolver's 'pasted' branch requires it). The actionable harm is the dropped savedCredentialId (a correctness defect, not a secret leak), which is medium, not a high-severity security exposure.

**SM-13. GitHub comment bodies rendered with bare ReactMarkdown instead of SafeMarkdown**
`src/components/PRReview/DiffPanel/InlineComment.jsx:2, 42, 169`  —  risk: **low** · confidence: medium · verify: confirmed
- *Problem:* InlineComment renders attacker-controllable GitHub review-comment bodies and replies via raw ReactMarkdown with no rehypeSanitize, no remarkGfm, and no link hardening. The project ships a dedicated SafeMarkdown component (components/AIPrompts/SafeMarkdown.jsx) explicitly 'for untrusted / user-supplied content' that adds rehype-sanitize and rel=noopener target=_blank on links — used elsewhere in this very slice (WalkthroughTab, PublishReviewModal, PRCommandsTab). react-markdown v10's defaults do block raw HTML and javascript: URLs, so this is not a live script-injection hole, but it is a defense-in-depth/consistency gap: the one component handling third-party content uses the unsanitised path, and the inline comment '// safe against XSS' is an under-justified manual assertion that future maintainers may rely on when adding rehype-raw or autolinking.
- *Fix:* Render comment.body and reply.body with <SafeMarkdown> instead of bare <ReactMarkdown>. This also gives GitHub comments GFM tables/strikethrough and the safe external-link behaviour the rest of the surface already has.

**SM-14. SVG sanitizer misses <use> external refs, <style>, and CSS-based vectors**
`src/utils/sanitizeSvg.js:16-19, 37-39`  —  risk: **low** · confidence: medium · verify: confirmed
- *Problem:* DANGEROUS_ELEMENTS does not include `use` or `style`. A `<use href="https://evil/x.svg#a">` can pull in an external SVG fragment, and `<style>` inside SVG allows CSS that can reference `url(...)` / `@import` and (in some engines) trigger requests or obscure click-jacking overlays. The href check (line 37) only guards `href`/`xlink:href` against javascript:/data:/vbscript:/file: but does not block external http(s) `<use>` references at all. This is defence-in-depth behind Mermaid+DOMPurify so real-world risk is bounded, but the file's stated purpose is to be the belt-and-suspenders layer for AI-generated SVG, and these are exactly the holes that layer is supposed to close.
- *Fix:* Add `use`, `style`, and `image` to DANGEROUS_ELEMENTS (Mermaid diagrams don't need them), or for `<use>`/`<image>` strip any href whose value is not a same-document fragment (must start with '#'). Strip `<style>` elements outright. Keep the existing on*/protocol checks.


#### Low · 30

**SL-1. credentialEncryptionKey / apiKeySecret accept any length (incl. weak/empty)**
`server/config.js:54-59`  —  risk: **low** · confidence: medium · verify: adjusted
- *Problem:* sessionSecret is validated to min 32 chars, but credentialEncryptionKey (the AES-256-GCM key used to encrypt user BYOK keys and Azure PATs) and apiKeySecret are typed as plain optional strings with no length/entropy validation. credentialEncryptionKey 'falls back to SESSION_SECRET if unset' per the comment, but if an operator sets a short CREDENTIAL_ENCRYPTION_KEY explicitly there is no startup guard, weakening encryption of the most sensitive at-rest secrets. index.js enforces API_KEY_SECRET presence in prod but not its strength.
- *Fix:* Add a min-length (>=32) refinement on credentialEncryptionKey and apiKeySecret in the zod schema (or in verifySecretsAtStartup), so a weak explicit key fails fast at boot the same way a weak SESSION_SECRET does.
- *Verifier (severity adjusted):* The headline claim is factually wrong: credentialEncryptionKey is NOT unguarded. server/lib/startup-secrets-check.js lists CREDENTIAL_ENCRYPTION_KEY in `required` (line 27) and, in production, errors out when it is missing OR shorter than 32 chars (lines 30-36); verifySecretsAtStartup is invoked from index.js line 54. So an operator who sets a short CREDENTIAL_ENCRYPTION_KEY in prod already fails fast — contradicting the finding's central premise about 'the most sensitive at-rest secrets'. A narrower residual is real: apiKeySecret has NO length validation anywhere (only presence checks in config.js/index.js/api-key-auth.js), and the zod schema itself (config.js lines 56,59) lacks a min() refinement, so non-production paths and apiKeySecret strength are unguarded. That residual is a genuine but minor hardening gap, so severity remains low; adjusted because the primary asserted issue (credentialEncryptionKey) is refuted by existing startup validation.

**SL-2. filePath for GitHub Contents PUT is request-derived and not constrained to repo-relative**
`server/lib/ai-features/community-health-fix.js:254, 278`  —  risk: **low** · confidence: medium · verify: confirmed
- *Problem:* `commitOrOpenPR` builds the write URL from `filePath` via `encodeURIComponent(filePath).replace(/%2F/g,'/')`, the same pattern as the read path. The FILE_GENERATORS registry uses fixed paths, but `commitOrOpenPR` is exported and takes arbitrary `filePath`, so a future caller passing a user-controlled path with `..`/leading `/` would write to an unintended location (subject to GitHub normalization). Defense should be local, not reliant on the API.
- *Fix:* Validate `filePath` against an allow-list / repo-relative regex (no `..`, no leading slash) inside `commitOrOpenPR`, or restrict it to the known FILE_GENERATORS paths.

**SL-3. appendMessage stores message content unbounded (no length cap in the store)**
`server/lib/ai-pr-chat-store.js:80`  —  risk: **low** · confidence: medium · verify: confirmed
- *Problem:* `appendMessage` writes `String(content ?? '')` with no length limit. The per-message cap `MAX_USER_MESSAGE_LEN` (4000) lives only in pr-chat.js render/compact helpers, not in the persistence layer, so any caller (or a future route) that forgets to clamp can persist arbitrarily large blobs — a denial-of-storage / cost vector and inconsistent with the careful caps elsewhere in this slice.
- *Fix:* Clamp content (and tool_input/output JSON) to a hard maximum inside `appendMessage` as defense-in-depth, independent of caller-side trimming.

**SL-4. renderPrompt performs raw string substitution of untrusted README/repo metadata into the system prompt (prompt-injection surface)**
`server/lib/ai-prompt-registry.js:402-413`  —  risk: **low** · confidence: medium · verify: adjusted
- *Problem:* renderPrompt does literal split/join substitution of {readme}, {description}, {topics}, etc. into the prompt template. For suggest_name_description the {readme} value is attacker-influenced repo content (a repo README can contain 'Ignore previous instructions...'). The registry descriptions claim variables are 'sanitized', but this function does no sanitization or partitioning — it relies entirely on the calling route to wrap content in the anti-injection `parts` array. Nothing in this module enforces that, so a future caller using getResolvedPrompt() for a single-prompt provider path would inline untrusted content directly into the system prompt.
- *Fix:* Document explicitly that renderPrompt output must be sent via the multi-part `parts` channel for any variable carrying untrusted content, and/or add a length cap / delimiter-escaping step for known-untrusted variables (readme). At minimum add a code comment + test asserting the suggest_name_description route uses parts partitioning.
- *Verifier (severity adjusted):* The core vulnerability is real but the problem description's stated mitigation is factually wrong. Confirmed: renderPrompt (ai-prompt-registry.js:402-413) does literal split/join substitution with no sanitization, and {readme} is attacker-influenced repo content. HOWEVER the claim that the suggest_name_description route 'relies entirely on the calling route to wrap content in the anti-injection parts array' is FALSE: the actual route (server/routes/ai/suggest-name-description.js:68-78,186-195) uses NO parts channel at all — it builds a single string via getResolvedPrompt and calls provider.generate({ prompt }). Its only protection is sanitizeForPrompt (lib/ai-features/sanitize.js:12-16), which merely strips null bytes and truncates — it does NOT neutralize injection instructions like 'Ignore previous instructions'. So the proposed fix ('add a test asserting the route uses parts partitioning') is premised on a parts mechanism that does not exist. The underlying prompt-injection surface is genuine (and arguably understated since there is no parts isolation), so the issue is not refuted; but the mechanism description is materially inaccurate, hence adjusted. Severity low is appropriate: low-impact feature (name/description suggestion), output is JSON-parsed and clamped.

**SL-5. Dead-letter queue persists raw HTML email bodies that can contain license keys / PATs in plaintext at rest**
`server/lib/email.js:153-174, 234-256`  —  risk: **med** · confidence: medium · verify: confirmed
- *Problem:* When the initial send exhausts retries, insertDeadLetter writes the full body_html/body_text into email_dead_letter. License-delivery emails (license-issuer.js) embed the signed license key, and retention warnings reference account data; these bodies sit unencrypted in the DB until the worker eventually delivers (or never, after give-up at 10 attempts, where rows are intentionally left in place forever). The codebase is otherwise careful never to log keys (sendConsole deliberately omits the body), so persisting them in cleartext in a long-lived table is an inconsistent exposure surface, especially for the multi-tenant SaaS DB.
- *Fix:* Either (a) don't store the rendered body — store a context reference (license_id / template + params) and re-render on retry, or (b) encrypt body_html/body_text at rest with the same credential-encryption key used for user_ai_config, and add a retention sweep that purges given-up rows after N days. Re-rendering (a) also shrinks the row and removes the leak entirely.

**SL-6. Outbox hardcodes response_status = 200, masking the real GitHub status to callers and stored audit**
`server/lib/gh-outbox.js:124-135, 225-234`  —  risk: **low** · confidence: medium · verify: confirmed
- *Problem:* Both the synchronous success path and the worker success path write `response_status = 200` and return `status: 200` regardless of the actual upstream status. GitHub mutations frequently return 201 (created) or 204 (no content, e.g. some DELETEs/merges). The stored response_status (used for replayed-response fidelity in enqueueAndExecute's succeeded branch, and for any audit/inspection) is therefore wrong, and a 204 with empty body becomes a stored `null`/`{}` returned as 200. Not directly exploitable, but it degrades auditability of mutation outcomes in a security-sensitive write path.
- *Fix:* Capture the real status from githubApi's response (expose it on the returned object or read result.headers/status) and persist that instead of the literal 200; default to 200 only when unknown.

**SL-7. Stderr sanitizer masks 32+ char tokens but can let shorter credential fragments and query-string secrets through**
`server/lib/git-tfs-runner.js:151-152`  —  risk: **low** · confidence: low · verify: confirmed
- *Problem:* sanitizeStderr masks the literal PAT, userinfo in URLs, Bearer/Basic headers, and 32+ char base64-ish runs. Azure DevOps PATs are long so the literal-replace path covers the common case, but secrets that arrive only in a redirected/derived form (e.g. a shorter session token, an `?sig=`/`?code=` query parameter, or a base64 fragment broken across line wraps under 32 chars) would survive into the DB error_message / SSE stream. The 32-char heuristic is also locale-fragile (the regex's literal combining-mark range in slugify nearby suggests encoding sensitivity).
- *Fix:* In addition to the existing rules, strip URL query strings entirely (`\?[^\s]*` → `?***`) from stderr before storage, lower the token-run threshold or add an explicit `access_token=…`/`sig=…`/`code=…` key=value masker, and unit-test the sanitizer against a sample git-tfs auth-failure stderr. Low severity because the primary PAT is already literal-masked.

**SL-8. BullMQ Redis connection configured by raw REDIS_URL with no TLS/auth assertion**
`server/lib/queue.js:55-63, 76-81`  —  risk: **low** · confidence: low · verify: confirmed
- *Problem:* getQueue/createWorker pass `connection: { url: redisUrl }` straight from process.env with no validation that the URL uses TLS (rediss://) or includes auth in production. Jobs flowing through these queues carry migration/AI work that can reference tokens or PATs in job data; an unauthenticated or plaintext Redis is a data-exposure and job-injection vector. There is also no error handler on the Queue/connection, so connection failures surface only via thrown adds.
- *Fix:* In production, assert redisUrl starts with `rediss://` (or that TLS is otherwise configured) and contains credentials at startup (mirror startup-secrets-check). Optionally attach an 'error' listener to the Queue/Worker connection for observability. Low breaking risk — guarded to production.

**SL-9. customFiles paths are not path-normalized before being placed into GitHub contents URL**
`server/lib/repo-context-builder.js:38-49, 209-217`  —  risk: **low** · confidence: medium · verify: confirmed
- *Problem:* `customFiles` from the request body are validated only as `z.string().min(1).max(255)` (route) and then interpolated into `/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g,'/')}`. `encodeURIComponent` does NOT encode `.` or `/` (the latter is re-decoded), so values like `../../foo` survive into the URL path. GitHub's contents API normalizes within the repo so cross-repo escape is not currently possible, but relying on the upstream API to neutralize `..` is fragile and the intent ('a file in this repo') isn't enforced locally.
- *Fix:* Reject or normalize paths containing `..` segments, leading `/`, or backslashes before fetching (e.g. validate against a `^[\w./-]+$` allow-list and strip `..`). Enforce in the route schema and/or in buildContext.

**SL-10. Outbox token lookup scans all live sessions and returns the first matching user's GitHub access token**
`server/lib/session-token-lookup.js:41-60`  —  risk: **med** · confidence: medium · verify: adjusted
- *Problem:* tokenLookup() pulls up to 200 session blobs (`SELECT data FROM sessions ... LIMIT 200`) and JSON.parses each to find one whose userId matches, returning that user's accessToken to the background outbox worker. While the worker presumably only acts on that user's own outbox rows, this widens the blast radius of any logic bug: a wrong userId argument silently yields another user's live OAuth token. It also reads/decodes up to 200 full session payloads per call (every outbox tick), an unbounded-ish O(N) scan that grows with concurrent users. There is no index-assisted lookup because userId lives inside the opaque JSON blob.
- *Fix:* Persist a lightweight `session_tokens(user_id, access_token, expires)` projection (written on login/refresh, deleted on logout) and look up by `user_id = ?` directly — O(1), no full-table scan, no cross-user blob iteration. Failing that, at minimum assert the parsed userId strictly equals the requested userId (already done) AND cap/parameterise the scan, and add a comment that the caller MUST pass a trusted userId. The projection table is the right fix.
- *Verifier (severity adjusted):* Code matches: session-token-lookup.js:44-54 runs SELECT data FROM sessions WHERE expires > ? ORDER BY expires DESC LIMIT 200, JSON.parses each blob, and returns the first row where parsed.userId === userId && parsed.accessToken. The strict equality check (parsed?.userId === userId, line 50) IS present, so no cross-user token is returned absent a caller bug — the finding itself concedes the worker 'presumably only acts on that user's own outbox rows.' This is a hardening/perf concern (bounded O(N<=200) scan per outbox tick, opaque-blob lookup), not an active vulnerability. The scan is already capped and parameterised. The projection-table fix is reasonable but the current severity overstates it; downgrading to low.

**SL-11. User-controlled login interpolated into GitHub search qualifiers without sanitization**
`server/lib/work-board-github.js:78`  —  risk: **none** · confidence: medium · verify: confirmed
- *Problem:* login is interpolated directly into GitHub search queries (`review-requested:${login}`, `author:${login}`, `assignee:${login}`) in fetchMyPendingReviews/fetchMyOpenPRs/fetchStalePRs/fetchMyOpenIssues. The whole q is URL-encoded by callSearch, so this is not request smuggling, but if login ever carries a space or a GitHub search operator (e.g. ' is:public' or 'a OR b'), the qualifier breaks or the query is reshaped, returning unintended results. discovery.js avoids the issue by using literal @me. The login normally comes from the session so risk is bounded, but there is no validation that it is a single bare GitHub handle.
- *Fix:* Validate login against the GitHub handle charset (^[A-Za-z0-9-]{1,39}$) before building any search query, rejecting or stripping otherwise. Cheap defense-in-depth that also guards against future callers passing attacker-influenced logins.

**SL-12. API key auth runs an unauthenticated DB write (last_used_at) without rate limiting on the key-prefix path**
`server/middleware/api-key-auth.js:57-90`  —  risk: **low** · confidence: medium · verify: confirmed
- *Problem:* apiKeyAuth hashes the bearer and does a single indexed lookup (good — constant-ish), but on a VALID key it then performs a synchronous UPDATE (last_used_at/ip/ua) on every request (line 107-109). better-sqlite3 is synchronous and blocks the event loop; a high-RPS valid key turns every request into a blocking write. Also, the failed-auth path logs `prefix: key.slice(0,16)` (the literal `grm_live_` + first 7 chars of the secret) on every invalid attempt — a partial secret in logs, and an unbounded log-write amplification under brute force. The global limiter (200/15min, pre-session) helps but bearer requests may bypass per-user limiters since userId isn't set yet.
- *Fix:* Throttle the last_used_at write (e.g. only update if last_used_at is older than ~60s) to avoid a blocking write per request. Stop logging the key prefix on failure (or hash it) so no secret material reaches logs. Confirm a per-IP limiter covers the bearer path before apiKeyAuth.

**SL-13. verifyWebhookSignature silently accepts ALL unsigned webhooks when NODE_ENV !== 'production'**
`server/middleware/auth.js:59-86`  —  risk: **low** · confidence: high · verify: confirmed
- *Problem:* When WEBHOOK_SECRET is unset, the function returns `true` for any signature in any non-production environment (`NODE_ENV !== 'production'`). 'staging', 'preview', 'qa', or an unset NODE_ENV all count as non-production and thus accept forged webhooks unconditionally. Combined with the CSRF bypass for `/api/webhooks/*`, a non-prod deploy reachable from the internet accepts arbitrary webhook payloads. The startup check enforces WEBHOOK_SECRET only in production, so a staging box with a public URL is wide open.
- *Fix:* Gate the unsigned-accept path on an explicit `NODE_ENV === 'development'` (or `=== 'test'`) check rather than `!== 'production'`, and/or require an explicit `ALLOW_UNSIGNED_WEBHOOKS=true` opt-in. Anything unrecognised should fail closed (return false).

**SL-14. Webhook signature verification fails OPEN in any non-production NODE_ENV**
`server/middleware/auth.js:59-68`  —  risk: **low** · confidence: medium · verify: confirmed
- *Problem:* verifyWebhookSignature returns true (accept unsigned) whenever WEBHOOK_SECRET is unset AND NODE_ENV !== 'production'. This guards every webhook handler in the slice (webhooks.js, github-events-webhook.js). The same NODE_ENV ambiguity flagged for /auth/mock applies here: an internet-exposed 'staging'/'preview' deploy with NODE_ENV !== 'production' and an unset WEBHOOK_SECRET will accept forged, unsigned GitHub webhook payloads, letting an attacker write arbitrary rows into pr_events/issue_events/workflow tables and the DLQ. The startup-secrets-check only enforces the secret in production.
- *Fix:* Make the dev fail-open opt-in and explicit (e.g. only when an ALLOW_UNSIGNED_WEBHOOKS=true flag is set) rather than implicitly for every non-production NODE_ENV, OR require WEBHOOK_SECRET whenever the host is internet-reachable. Log a warning each time an unsigned webhook is accepted so the posture is observable.

**SL-15. CSRF token is never rotated on privilege change and lives for the whole session**
`server/middleware/csrf.js:114-142`  —  risk: **low** · confidence: medium · verify: confirmed
- *Problem:* ensureCsrfToken() generates the token once and reuses it for the entire session lifetime; it is never regenerated on login or on session-fixation-relevant transitions. express-session's default does not regenerate the session id on auth either (need to confirm in routes/auth.js). A token that survives a pre-auth → post-auth transition weakens the session-fixation posture of the double-submit defence. Lower severity because SameSite=Lax already blocks most cross-site delivery.
- *Fix:* Regenerate the CSRF token (and ideally call req.session.regenerate) on successful login in the OAuth callback, and on logout. Add a helper `rotateCsrfToken(req)` next to ensureCsrfToken and call it from the auth callback.

**SL-16. GET /config/ai-status is unauthenticated and resolves a per-user provider from an unauthenticated session**
`server/routes/ai/core.js:78`  —  risk: **med** · confidence: medium · verify: confirmed
- *Problem:* This route has no requireAuth (the only GET without it in the slice). It reads `req.session?.userId ?? null` and calls `req.getAIProvider(kind)`, which on a logged-in session probes that user's BYOK key health. While it returns no secret material (only provider id + health enum), exposing whether a provider is configured/healthy and the provider vendor id without auth is broader than necessary, and the probe path does real per-user DB/provider work that an unauthenticated client can trigger repeatedly (with `?probe=1` forcing a synchronous probe). No rate limit applies.
- *Fix:* Either gate the per-user/probe branch behind requireAuth (keep an unauthenticated 'is the server configured at all' boolean if the public UI truly needs it), or at minimum ignore `?probe=1` and per-user resolution when `req.session?.userId` is absent so anonymous callers can't force probes.

**SL-17. Semantic-search audit logs the raw user query string instead of just its length**
`server/routes/ai/indexing.js:171`  —  risk: **none** · confidence: high · verify: confirmed
- *Problem:* auditLog records `{ query: q, resultCount }` — the full natural-language search text the user typed. Every other AI route in the slice deliberately logs only lengths/counts (e.g. core.js translate-search logs `{ qLength: q.length }` at line 371, and the chat/suggest routes log `messageLength`/counts only and explicitly comment 'never prompt/reply content'). Persisting raw query text in the audit table is an inconsistent PII/content-leak vector versus the slice's own stated policy.
- *Fix:* Log `{ qLength: q.length, resultCount: enriched.length }` to match the PII-safe convention used elsewhere in the slice.

**SL-18. Inbox archive accepts arbitrary itemId with no shape validation**
`server/routes/dashboard.js:34-42`  —  risk: **low** · confidence: medium · verify: confirmed
- *Problem:* POST /inbox/:itemId/archive (and /restore, /snooze) decodeURIComponent the path param and write it straight into dashboard_inbox_state with no validation of format or length. The write is user-scoped (user_id = session) so it is not an IDOR, but an unbounded arbitrary string is persisted per call, letting a user accumulate unbounded junk rows (each unique itemId is a new PK) — a minor storage-abuse vector and a data-quality smell. There is also no upper bound on itemId length.
- *Fix:* Validate itemId against the known inbox item-id format (e.g. a max length and an allowlist regex matching the IDs composeInbox actually emits) and 400 on mismatch, in all three handlers. Even a simple `if (itemId.length > 256) return 400` bounds the abuse.

**SL-19. Bootstrap license-install lets ANY authenticated user self-promote to admin**
`server/routes/license.js:124-152`  —  risk: **med** · confidence: medium · verify: confirmed
- *Problem:* POST /license/install bootstrap path (no stored license, no env LICENSE_KEY) allows any authenticated user to install a valid license and is then auto-promoted to is_admin=1 (lines 165-170). On a multi-tenant SaaS deployment where many users share one server but no admin has been designated yet, the FIRST user to call this with any validly-signed license key becomes a global operator admin (gaining access to all /admin/* DLQ data, other users' webhook payloads, etc.). The chicken-and-egg rationale is sound for single-operator self-host, but on shared SaaS this is a privilege-escalation foot-gun. It is rate-limited (5/min) but not otherwise constrained to a trusted actor.
- *Fix:* Gate bootstrap promotion behind an explicit deployment flag (e.g. ALLOW_LICENSE_BOOTSTRAP_ADMIN, default false on managed SaaS) so the self-host convenience can't silently grant operator admin on a multi-tenant host. Alternatively require the bootstrapping user to match an operator allow-list (env OPERATOR_USER_IDS).

**SL-20. Repo contents path is validated for traversal but interpolated unencoded into the GitHub API URL**
`server/routes/repos/crud.js:297-315,318-338,341-361`  —  risk: **low** · confidence: medium · verify: confirmed
- *Problem:* validatePath() blocks '..', leading '/', and null bytes, but the path is then spliced raw into the URL: `/repos/${owner}/${repo}/contents/${path}` (line 306) with only the ref query-param encoded. A path containing '?' or '#' (e.g. path='README.md?ref=secret-branch') is not blocked by validatePath and would inject/override query parameters on the GitHub request, since githubApi does no encoding. Segment-level encoding is the standard fix and is missing here (commits compare at crud.js:469-476 already encodes its segments, showing the intended pattern).
- *Fix:* Encode each path segment before interpolation, e.g. path.split('/').map(encodeURIComponent).join('/'), or at minimum extend validatePath to reject '?' and '#'. The ref param is already encoded; apply the same rigor to path.

**SL-21. checkout.session.completed trusts session.metadata.userId without verifying it owns the Stripe customer**
`server/routes/stripe-webhooks.js:107-168`  —  risk: **med** · confidence: medium · verify: confirmed
- *Problem:* On checkout.session.completed the handler does parseInt(session.metadata?.userId) and writes/overwrites the user_subscriptions row (tier, stripe_customer_id, stripe_subscription_id) for that userId, and issues a signed license to that user. metadata is set at checkout-creation time (billing.js does set it server-side from the session, which is good), but the webhook does not cross-check that session.customer actually maps back to the same userId stored on the customer's metadata. reconcileTierFromPrice hardens the TIER against tampering but not the userId binding. If a checkout session can ever be created with attacker-controlled metadata.userId (e.g. a future direct payment-link / non-billing.js path, or a compromised price-link), an attacker could attach a paid subscription + license to a victim's account or hijack a customer mapping. The signature check prevents external forgery, but not metadata-binding abuse from any code path that creates sessions.
- *Fix:* Cross-verify the userId against the Stripe customer's own metadata.userId (stripeCustomer.metadata.userId, which billing.js already sets) before writing the subscription/issuing the license; if they disagree, log and reject. This makes the customer object (server-controlled at creation) the source of truth for the user binding, mirroring the existing tier-reconciliation pattern.

**SL-22. PUT /:id/members/:userId reads role from raw req.body with no schema validation**
`server/routes/teams.js:186-188`  —  risk: **low** · confidence: high · verify: adjusted
- *Problem:* Unlike every other mutating team route which uses `validateBody(...)`, the update-member-role handler pulls `const { role } = req.body` directly and only checks `['admin','member'].includes(role)`. There is no validateBody, so the rest of the body is unvalidated and the route diverges from the file's consistent validation pattern. While the allowlist check prevents arbitrary role values, relying on an inline ad-hoc check rather than the shared zod middleware is inconsistent and easy to regress (e.g. a future maintainer adding more updatable fields would have no schema guardrail).
- *Fix:* Introduce a small zod schema `teamMemberRoleSchema = z.object({ role: z.enum(['admin','member']) })` in validators.js and apply `validateBody(teamMemberRoleSchema)` to this route, then read `req.validatedBody.role`. This matches the rest of the router and removes the bespoke check.
- *Verifier (severity adjusted):* Verified teams.js:186-188 reads `const { role } = req.body` with only inline `['admin','member'].includes(role)`, while sibling mutating routes (lines 31,62,134,239) all use validateBody + req.validatedBody — the inconsistency is real. However the inline allowlist fully constrains the only consumed field (role), the route is user-scoped and permission-checked (owner/admin only, owner-role protected), SQL is parameterized, and no other body field is read. There is no exploitable security impact — this is a code-consistency/maintainability smell, not a medium-severity security issue. Downgrading to low.

**SL-23. Unescaped org/project interpolated into generated markdown links**
`server/wiki-service.js:64-70`  —  risk: **low** · confidence: medium · verify: confirmed
- *Problem:* convertContent builds `[ADO Work Item #$1](https://dev.azure.com/${org}/${project}/_workitems/edit/$1)` by interpolating the raw org/project strings into a markdown link URL with no URL-encoding. A crafted org/project value (containing ')', spaces, or markdown-breaking characters) could corrupt the generated link or inject trailing markdown into the converted wiki content that is then committed to the target repo. Also hardcodes dev.azure.com, so on-prem work-item links are wrong.
- *Fix:* encodeURIComponent the org/project path segments (and ideally derive the base URL from the source host), so the generated link is well-formed and cannot break out of the markdown link syntax.

**SL-24. AI/assistant chat output rendered with raw ReactMarkdown (no sanitization) while a SafeMarkdown component exists**
`src/components/AI/ChatPrimitives.jsx:53, 73`  —  risk: **low** · confidence: high · verify: adjusted
- *Problem:* MessageBubble (line 53) and StreamingBubble (line 73) render assistant/tool message bodies with bare `<ReactMarkdown>{body}</ReactMarkdown>` and no rehype-sanitize. react-markdown does not strip dangerous content by itself: raw HTML can be enabled via plugins, and (depending on react-markdown major version / urlTransform config) javascript: and data: URLs in `[text](...)` links may pass through. This body is LLM-generated and, for tool-role chips, includes server-fetched tool output — exactly the untrusted surface the project already built `SafeMarkdown.jsx` (remark-gfm + rehypeSanitize, safe-rel anchors) to guard. Rendering it unsanitized is a markdown-injection / XSS vector and also bypasses the project's own hardened renderer.
- *Fix:* Replace the two `<ReactMarkdown>` usages with the existing `SafeMarkdown` component (src/components/AIPrompts/SafeMarkdown.jsx), or at minimum pass `rehypePlugins={[rehypeSanitize]}` and a safe `urlTransform`. This also dedups the markdown-rendering config (gfm + sanitize + safe anchors) into one place.
- *Verifier (severity adjusted):* Code is accurately cited: src/components/AI/ChatPrimitives.jsx renders untrusted assistant body (line 53, MessageBubble) and streaming text (line 73, StreamingBubble) with bare `<ReactMarkdown>{...}` and no rehypeSanitize, while a hardened SafeMarkdown (remark-gfm + rehypeSanitize + safe-rel anchors) does exist at src/components/AIPrompts/SafeMarkdown.jsx. So the inconsistency/defense-in-depth gap is real. BUT the 'high'/live-XSS framing is overstated for this codebase: react-markdown is pinned to 10.1.0 (node_modules/react-markdown/lib/index.js). At v10 (a) raw HTML is converted to an inert text node by default (line 360-365) and rehype-raw is NOT imported in ChatPrimitives.jsx (it is used only in RepoDetailPanel.jsx and RepoMarkdown.jsx, always paired with rehypeSanitize), so '<script>'/'onerror' HTML cannot execute; (b) defaultUrlTransform runs by default (line 320, 421-444) with safeProtocol=/^(https?\|ircs?\|mailto\|xmpp)$/i (line 124), which strips javascript:/data: URLs in `[text](...)` links to ''. Therefore the two concrete XSS vectors the finding cites (raw HTML 'enabled via plugins' and javascript:/data: links 'passing through') are not actually reachable here. This is a valid hardening/consistency recommendation (use SafeMarkdown to be resilient to a future rehype-raw addition or style-attr injection), which is low severity, not high.

**SL-25. README rendered with rehypeRaw before sanitize — XSS surface hinges entirely on schema correctness**
`src/components/MigrationWizard/steps/RepoSelectStep/RepoDetailPanel.jsx:217-252`  —  risk: **low** · confidence: medium · verify: adjusted
- *Problem:* ReadmePreview pipes untrusted repo README content through rehypeRaw (which parses embedded raw HTML) and then rehypeSanitize. The ordering is correct (raw then sanitize) and a custom README_SCHEMA is used, but README_SCHEMA widens defaultSchema by allowing extra attributes (align, width, height on div/p/img). Any future widening of this allowlist, or a sanitizer bypass, becomes stored-XSS from attacker-controlled repo content. The urlTransform also returns '#' for non-absolute hrefs but does not strip javascript:/data: explicitly (it relies on isAbsolute matching `[a-z]+://` — javascript: has no // so falls through to '#', which is safe, but this is implicit).
- *Fix:* Keep rehypeSanitize strictly after rehypeRaw (already done) and add a defensive test asserting that <script>, on* handlers, and javascript:/data: URLs are stripped from a malicious README fixture. Consider explicitly disallowing data: and javascript: protocols in urlTransform rather than relying on the isAbsolute regex shape. Document why each extra attribute in README_SCHEMA is safe.
- *Verifier (severity adjusted):* Verified at RepoDetailPanel.jsx:217-252 plus README_SCHEMA at 18-27. rehypePlugins ordering is [rehypeRaw, [rehypeSanitize, README_SCHEMA]] (line 234) — raw THEN sanitize, the correct/safe order, as the auditor itself states. The widened attributes (align on div/p; width/height/align on img) are inert layout attributes, not script vectors. urlTransform (218-222) + isAbsolute (213-214, /^[a-z]+:///i) means javascript: and data: (neither contains '://') fall through to '#' for hrefs and to '' (dropped img, line 243) for srcs — both protocols are already neutralized today. The finding accurately describes the code but it documents a SAFE state and only recommends defense-in-depth (add a malicious-README test, explicitly blocklist javascript:/data:, document attribute safety). There is no current XSS, bypass, or mis-ordering, so security/medium overstates it; this is low-severity hardening/documentation.

**SL-26. Raw fetch builds the labels URL from owner/repo without encodeURIComponent**
`src/components/RepoDetail/IssueSidebar.jsx:45`  —  risk: **low** · confidence: medium · verify: confirmed
- *Problem:* LabelEditor bypasses the api layer with a direct `fetch(`/api/v1/repos/${owner}/${repo}/labels`)` where owner/repo come from `repoFullName.split('/')` (IssueDetailPanel.jsx:319-320). The values are interpolated unencoded. While GitHub owner/repo names are normally restricted, this is the only place in the slice that hand-builds an API URL instead of going through the shared api client, so it skips whatever encoding/normalization the client does and is an inconsistent, lower-trust path. Not exploitable for SQLi (it hits an HTTP route), but a slash/`..`-bearing repo value would be path-confused.
- *Fix:* Route this through the shared api/useRepoDetail client (add a fetchLabels method) or at minimum `encodeURIComponent(owner)`/`encodeURIComponent(repo)` and keep `credentials: 'include'`. Removes the bespoke fetch and the unencoded interpolation.

**SL-27. Untrusted README is sanitized correctly, but external links open with target=_blank — verify rel and confirm code blocks aren't injected raw**
`src/components/ui/RepoMarkdown.jsx:56-83`  —  risk: **low** · confidence: medium · verify: confirmed
- *Problem:* This is the one untrusted-HTML surface in the slice (renders arbitrary GitHub README markdown). The good news: rehypeRaw runs BEFORE rehypeSanitize (line 58) which is the correct secure ordering, the schema is explicit-allow with clobberPrefix namespacing (lines 12-27), and links get rel="noopener noreferrer" (line 67). Two residual notes: (1) the schema relaxes img width/height/align and div/p align from untrusted input — benign but worth a conscious sign-off; (2) the default rehype-sanitize schema permits href protocols; confirm `javascript:`/`data:` hrefs are stripped (defaultSchema does restrict protocols, but the urlTransform on line 59 only rewrites relative src/href and passes absolute through unchanged, so the protocol safety relies entirely on the sanitizer's protocol allowlist).
- *Fix:* Add an explicit `protocols: { href: ['http','https','mailto'], src: ['http','https'] }` to SCHEMA so link/image protocol safety is asserted in-repo rather than inherited implicitly from defaultSchema, and add a test asserting a `javascript:` href in a README is dropped. No behavior change for legitimate content.

**SL-28. Org/username path and query segments interpolated into URLs without encoding**
`src/hooks/useOrgs.js:83, 124-126, 188`  —  risk: **low** · confidence: medium · verify: confirmed
- *Problem:* `fetchOrgRepos` builds `/orgs/${orgLogin}/repos`, `fetchStats` builds `/stats?org=${org}`, and `fetchActivity` builds `/activity?username=${username}` with raw template interpolation. While GitHub org logins and usernames are charset-constrained, this is inconsistent with the rest of the codebase (useRepoDetail / useHostAllowlist correctly `encodeURIComponent`), and any value not strictly validated could break the URL or smuggle extra query params (e.g. an org value containing `&admin=1`).
- *Fix:* Wrap interpolated user-derived segments in `encodeURIComponent(...)` for consistency: `?org=${encodeURIComponent(org)}`, `?username=${encodeURIComponent(username)}`, `/orgs/${encodeURIComponent(orgLogin)}/repos`.

**SL-29. Collaborator username interpolated into path without encoding**
`src/hooks/useRepoDetail.js:148`  —  risk: **none** · confidence: medium · verify: confirmed
- *Problem:* `addCollaborator: (username, permission) => apiFetch(\`${base}/collaborators/${username}\`, ...)` interpolates `username` raw, unlike sibling endpoints in the same file that correctly `encodeURIComponent` branch/label names (lines 63, 67, 131). `releaseId`/`hookId`/issue `number` are typically numeric, but `username` is a free-text identifier and should be encoded to avoid malformed paths or path traversal segments.
- *Fix:* Use `encodeURIComponent(username)` in the collaborators path (and consider the same for releaseId/hookId for defense-in-depth).

**SL-30. buildAzCliCommand interpolates host/org into a shell command shown for copy-paste**
`src/utils/azureProvider.js:160-165`  —  risk: **low** · confidence: medium · verify: confirmed
- *Problem:* buildAzCliCommand returns `az devops login --organization "https://${host}/${org}"` built by string interpolation from parsed URL fields. host/org originate from parseAzureUrl on user-pasted input and are not shell-escaped; a host/org containing a double-quote would break out of the quoting in the displayed command the user copies into their terminal. This is a copy-paste command (not exec'd by the app), so it's not RCE in the app itself, but it's a command-injection-shaped footgun handed to the user, and inconsistent with buildPatSettingsUrl which encodeURIComponent-escapes its segments.
- *Fix:* Reject or sanitize host/org that contain characters outside the Azure DevOps allowed set (already URL-validated upstream) before interpolation, or escape embedded quotes. Mirroring the encodeURIComponent treatment used in buildPatSettingsUrl for the URL portion is the minimal fix.


---

### ⚡ Performance (83)

#### High · 7

**PH-1. Full-table embedding scan + in-memory cosine on every search (O(N) per query)**
`server/lib/ai-features/semantic-search.js:128-157, 79-116`  —  risk: **low** · confidence: high · verify: confirmed
- *Problem:* `semanticSearch` and `findSimilarById` load EVERY embedding row for the user into memory (`SELECT ... FROM repo_embeddings WHERE user_id = ?` then `.all()`), JSON.parse each blob, and compute cosine similarity in a JS loop on the request thread. For a user with thousands of indexed repos this parses thousands of large float arrays and runs a tight numeric loop synchronously on the event loop for each search — blocking other requests. The code comment even admits 'For large datasets, this is inefficient.' There is no index usable for similarity and no pre-filter (e.g. by topic/language) to bound the candidate set.
- *Fix:* Short term: add a cheap pre-filter (limit candidate rows by language/topic or a LIMIT with recency) and/or cap the number of rows scanned per query; cache parsed target vectors. Medium term: move ranking to a vector store / sqlite-vec / pgvector ANN index so the DB does the top-K instead of pulling all rows into Node. At minimum, batch the cosine work or yield to the event loop for large N.

**PH-2. stale_drafts fallback scans all tenants' pr_events then filters in JS**
`server/lib/dashboard-aggregator.js:91`  —  risk: **low** · confidence: high · verify: confirmed
- *Problem:* The stale_drafts webhook fallback calls listStalePRs({ staleAfterDays: 7 }) with no repoIds and no author filter, then does .filter(r => r.authorLogin === login) in JS. listStalePRs scans pr_events globally (action='opened' has no index — see db.js, only idx_pr_events_repo_pr / repo_created / author_action exist) with a correlated 'latest action' subquery per opened PR, returning up to 50 cross-tenant rows just to keep the handful authored by the current login. On every inbox load without a token this is the most expensive query in the path and grows with total PR volume across ALL users, not the current user's slice.
- *Fix:* Push the author filter into the SQL: add an authorLogin option to listStalePRs that adds `AND pe_open.author_login = ?` (covered by idx_pr_events_author_action) and pass it from the fallback, instead of fetching 50 rows and discarding most in JS. Bumping the SQL LIMIT is no longer needed once the author is bound.

**PH-3. listMyOpenIssues full-scans issue_events (no index on action or assignee_logins)**
`server/lib/event-aggregations.js:156`  —  risk: **none** · confidence: high · verify: confirmed
- *Problem:* The query filters issue_events by action='opened' and assignee_logins LIKE '%"login"%'. There is no index on issue_events.action nor on assignee_logins (db.js only defines idx_issue_events_repo_issue and idx_issue_events_author). The leading-wildcard LIKE is non-sargable, so SQLite full-scans the entire cross-tenant issue_events table on every dashboard 'mentions' fallback load, plus three correlated subqueries per surviving row. This is the mentions hot path.
- *Fix:* Add `CREATE INDEX idx_issue_events_action_created ON issue_events(action, created_at)` so the action='opened' predicate is index-driven, and consider a generated/normalized assignee join table (or storing assignee rows) to replace the leading-wildcard LIKE. At minimum the action index turns the full scan into a range scan over opened events only.

**PH-4. listTechDebtIssues unscoped path does a full GROUP BY over all issue_events**
`server/lib/event-aggregations.js:374`  —  risk: **low** · confidence: high · verify: confirmed
- *Problem:* When repoIds is omitted (innerWhere = ''), the subquery `SELECT MAX(id) FROM issue_events GROUP BY repo_id, issue_number` scans and aggregates the entire issue_events table across all tenants, then runs a NOT EXISTS 'closed' subquery and a MIN(created_at) correlated subquery per surviving row. The KPI snapshot job (work-board-kpi-snapshots.js:29) calls this unscoped with limit:1000 once per active user per day, and techDebtHotspots calls it with limit:1000. The code comment at lines 350-352 acknowledges this is an O(all-events) scan. As event volume grows this dominates the snapshot job and any unscoped tech-debt read.
- *Fix:* Maintain a per-(repo_id, issue_number) latest-snapshot table updated on webhook ingest (the comment already names this as the real fix), or at minimum index issue_events(action) so the closed/opened predicates are index-driven. For the snapshot job specifically, scope by the user's tracked repo_ids instead of running fully unscoped.

**PH-5. community-health/compare does a serial N+1 GitHub fetch loop (up to 50 round-trips)**
`server/routes/bulk.js:315-329`  —  risk: **low** · confidence: high · verify: confirmed
- *Problem:* The handler accepts up to 50 repos (line 308) and then iterates with a `for...of` loop doing `await githubApi(/repos/{owner}/{repo})` one at a time (line 319). With 50 repos this is 50 sequential GitHub API round-trips inside one request — easily multiple seconds of wall-clock latency and a long-held event-loop-bound request. The sibling endpoint /transfer/check-conflicts (line 83) already uses Promise.all for exactly this pattern, so the serial version here is an inconsistency as well as a perf bug.
- *Fix:* Replace the serial for-loop with a bounded-concurrency fan-out (e.g. Promise.all over the parsed repos, or batches of 5 like orgs.js lines 60-80). Map each repo to a promise that fetches the repo + reads the cache row, then assemble `comparison`. Preserve the `if (!parsed) continue` skip semantics by filtering out unparseable names first.

**PH-6. type=all runs the three GitHub search calls serially, not in parallel**
`server/routes/search.js:86-103`  —  risk: **low** · confidence: high · verify: confirmed
- *Problem:* The file docstring (lines 11-15) explicitly claims that for type=all the three sub-queries run "in parallel (3 calls per user keystroke after debounce) rather than serially, which keeps the response under ~400 ms". The implementation does the opposite: each branch creates a promise `p` and immediately `await`s it (`prs = await p.catch(...)`, then `issues = await p.catch(...)`, then `repos = await p.catch(...)`). Because each await blocks before the next promise is even created, the three GitHub Search round-trips execute sequentially. On the Command Palette hot path this roughly triples latency (~3x a single search RTT) for every keystroke after debounce.
- *Fix:* Kick off all three promises first, then await them together. e.g. build `const tasks = []` pushing `searchIssues(q,'is:pr',...)`, `searchIssues(q,'is:issue',...)`, `searchRepos(q,...)` (each `.catch(()=>[])` for type=all), then `const [prs, issues, repos] = await Promise.all(tasks)`. Keep the single-type branches awaiting only their one promise.

**PH-7. N+1 fetch: one /migration/marks/plan request per plan row**
`src/components/MigrationHistory.jsx:19-38, 233-281`  —  risk: **low** · confidence: high · verify: confirmed
- *Problem:* The Plans list maps every plan to <PlanMarksCell planId={plan.id} />, and each PlanMarksCell calls useMarksForPlan(planId) (src/hooks/useMigrationMarks.js:38-62), which fires its own fetch('/api/migration/marks/plan/${planId}'). loadPlans() requests up to the full plan list, so opening the Migration History modal can fan out into dozens of parallel network requests (one per plan) just to render small badges — a classic frontend N+1 that scales linearly with plan count.
- *Fix:* Fetch marks for all visible plans in one batched request (e.g. a /api/migration/marks?planIds=... endpoint, or include a marks summary in listPlans()), then pass each plan's marks down as a prop. Failing a backend change, lazily fetch marks only for the expanded plan instead of every row on mount.


#### Medium · 35

**PM-1. N+1 aggregate recompute: updateWorkflowMeta called per run**
`server/actions-service.js:360-363`  —  risk: **low** · confidence: high
- *Problem:* After fetching up to 100 runs, the sync loop calls `this.updateWorkflowMeta(run.repository.id, run.workflow_id, userId)` once per run. updateWorkflowMeta runs a full aggregate SELECT over workflow_runs plus an UPSERT each call. Many of the 100 runs share the same workflow_id, so the same aggregate is recomputed dozens of times redundantly within a single sync — O(runs) heavy queries where O(distinct workflows) is sufficient.
- *Fix:* Collect the distinct (repoId, workflowId) pairs while storing runs, then call updateWorkflowMeta once per distinct workflow after the store loop (e.g. iterate a Set of keys).

**PM-2. Health analysis fires ~13 sequential GitHub calls with no cache gate**
`server/community-health-service.js:9-23`  —  risk: **low** · confidence: high
- *Problem:* analyzeRepository awaits fetchRepoData, then checkCommunityFiles (7 parallel content calls), then getActivityMetrics (3 calls) strictly in sequence. The three phases have no data dependency on each other, and there is a community_health_cache table (with analyzed_at) yet analyzeRepository never checks it before doing the full ~13-call fan-out. Every dashboard hit re-pays the full GitHub round-trip cost.
- *Fix:* Run the three independent phases with Promise.all, and short-circuit to the cached row when community_health_cache.analyzed_at is within a freshness window (e.g. 6-24h) before issuing any GitHub calls.

**PM-3. Placeholder converter mis-handles SQL string literals (doubled-quote escaping), corrupting ?→$N mapping**
`server/lib/adapters/postgres-adapter.js:21-41`  —  risk: **low** · confidence: high
- *Problem:* convertPlaceholders toggles `inString` on every `'` unless the previous char is a backslash (`sql[i-1] !== '\\'`). SQLite and standard SQL do NOT escape quotes with backslash — they double the quote (`'it''s'`). For a legitimately doubled-quote literal the toggle logic leaves `inString` in the wrong state for the remainder of the statement, so any `?` after that literal is either skipped (left as `?`, which pg rejects) or numbered wrong. It also doesn't skip dollar-quoted strings or `--`/`/* */` comments containing `?`. Because the whole codebase writes SQLite-flavored SQL with `?` placeholders, any such query silently breaks only on the Postgres backend. Not an injection (params are still bound separately), but a latent correctness/availability bug for the SaaS path.
- *Fix:* Replace the hand-rolled scanner with a tokenizer that understands SQL-standard doubled single quotes, double-quoted identifiers, and line/block comments; or restrict the placeholder rewrite to occur only outside recognized literal/identifier/comment spans. Add unit tests covering `WHERE name = 'O''Brien' AND id = ?` and a `?`-containing comment.

**PM-4. invalidateByRepo() uses a leading-wildcard LIKE that can't use the index and over-invalidates sibling repos across all users**
`server/lib/gh-cache.js:174-184`  —  risk: **med** · confidence: high
- *Problem:* invalidateByRepo builds `DELETE ... WHERE resource_key LIKE '%' \|\| repoFullName \|\| '%'`. The leading `%` defeats the idx_gh_cache_resource_type index on resource_key, forcing a scan of every row of the matching resource_type for every push/comment webhook. Worse, substring matching over-matches: a push to `acme/site` invalidates cache for `acme/site2`, `acme/site-internal`, etc., and (because there is no user_id filter) wipes those rows for EVERY user. Repo names also legally contain `_`, a LIKE wildcard, widening false matches further. On a busy server this is both a hot-path scan and unnecessary cache thrash.
- *Fix:* Store/match on an exact, anchored key. Either (a) add a dedicated indexed `repo_full_name` column populated at write time and DELETE on equality, or (b) anchor the key form so callers always prefix `resource_key` with `repoFullName#`/`repoFullName?` and match `LIKE repoFullName \|\| '#%'` / `repoFullName \|\| '?%'` (prefix, index-usable) plus escape `_`/`%` in the literal. Keep the resource_type filter present in all call sites.

**PM-5. KPI snapshot runs 4 unbounded cross-tenant aggregations per active user daily**
`server/lib/work-board-kpi-snapshots.js:26`  —  risk: **low** · confidence: high
- *Problem:* writeSnapshot calls listMyPendingReviews, listStalePRs, listMyOpenIssues and listTechDebtIssues each with limit:1000 for every active user (work-board-sweeper.js:56 iterates all users with a cache row in the last 7 days). listStalePRs and listTechDebtIssues here are unscoped (no repoIds), so each is a full cross-tenant scan, multiplied by the number of active users, all on the synchronous better-sqlite3 connection — this can block the event loop for the duration of the snapshot tick as the dataset grows.
- *Fix:* Scope the snapshot aggregations to the user's tracked repo_ids (getTrackedRepos already knows them), and/or only count via COUNT(*) queries rather than materializing up to 1000 rows of each kind just to read .length. The snapshot only needs counts, not the row payloads.

**PM-6. filterOutSnoozed re-queries snoozes from DB on every call**
`server/lib/work-board-snooze.js:65`  —  risk: **low** · confidence: medium
- *Problem:* filterOutSnoozed calls listSnoozes({ userId }) (a DB round-trip) every invocation. The dashboard/work-board read path filters PRs and issues separately, so this runs at least twice per request, and any caller looping over sections re-hits the DB each time. The snooze set is small and stable within a request.
- *Fix:* Accept an optional pre-fetched snooze set, or load the active snoozes once per request in the route and pass them into both the PR and issue filter calls. Alternatively memoize per (userId, request) at the caller. Low effort, removes redundant queries from the hot read path.

**PM-7. createTenantLimiters creates a NEW ioredis client every time it is called**
`server/middleware/tenant-rate-limit.js:36-51`  —  risk: **low** · confidence: high
- *Problem:* Each invocation of createTenantLimiters() (called once per limiter type: api/ai/auth, and potentially per-mount) does `new Redis(redisUrl)` and a fresh RedisStore. Every distinct limiter opens its own Redis connection instead of sharing one client. With several limiter types across mounts this multiplies long-lived connections, and there is no error handler on the created client (an unhandled 'error' event on an ioredis client can crash the process). The import of ioredis/rate-limit-redis is also re-done each call.
- *Fix:* Create the Redis client and the dynamic imports once at module scope (or memoise by redisUrl), attach a `.on('error', ...)` handler, and pass the shared client into every RedisStore. Reuse one client across all limiter types.

**PM-8. Task scheduling loop polls with a fixed 500ms setTimeout**
`server/migration-engine.js:399-406`  —  risk: **med** · confidence: medium
- *Problem:* The executePlan main loop, after dispatching all startable tasks, waits via `await new Promise(resolve => setTimeout(resolve, 500))` before re-checking whether a slot freed up. This adds up to 500ms of dead latency between a task finishing and the next one starting, and busy-loops the scheduler every 500ms even when nothing changes. For plans with many short tasks this serializes throughput unnecessarily.
- *Fix:* Race the in-flight promises instead of polling: keep the dispatched promises in a map and `await Promise.race([...inFlightPromises])` so the loop wakes exactly when a slot frees. Keep a short timeout only as a safety fallback for cancel/pause checks.

**PM-9. Batch-index processes repos strictly serially (await inside for-loop) — N sequential GitHub+LLM round-trips**
`server/routes/ai/indexing.js:274-306`  —  risk: **low** · confidence: high
- *Problem:* The loop awaits readme fetch, contents fetch, analyzeRepo (LLM), and embedText (LLM) one repo at a time for up to 10 repos. Each iteration is multiple network/LLM round-trips, so a 10-repo batch is ~40 serial awaits and can take tens of seconds, holding the request open the whole time with no streaming/progress. The DB writes are already correctly batched into one transaction, but the slow part is the serial I/O above it.
- *Fix:* Process repos with a bounded-concurrency map (e.g. p-limit at 3-4) over the fetch+analyze+embed stage, then run the existing single batch transaction. Concurrency must stay bounded to respect GitHub rate limits and provider QPS. Alternatively move batch indexing to a BullMQ job and return 202, since the infra is already present.

**PM-10. check-duplicates fans out up to 100 concurrent GitHub API calls with no concurrency cap**
`server/routes/import/url.js:172-196`  —  risk: **low** · confidence: high
- *Problem:* POST /import/check-duplicates does `await Promise.all(repos.map(...))` over the validated repos array, which the schema allows up to 100 entries. That fires up to 100 simultaneous GET /repos/:owner/:repo requests against GitHub on a single user action — a burst that can trip GitHub secondary-rate-limit protection (which then penalizes ALL of this user's subsequent calls) and spikes outbound connections. Every other batch path in this slice deliberately bounds concurrency (azure batch CONCURRENCY=2, FOLDER_SIZE_CONCURRENCY=5, team activity BATCH_SIZE=3); this one is unbounded.
- *Fix:* Process the repos array in bounded chunks (e.g. 5-8 at a time) the way azure/proxy.js tfvc/items does, or route through a small p-limit-style pool. Behavior (the returned duplicates/duplicateDetails maps) is unchanged.

**PM-11. Personal-account repo counts are wrong for users with >100 owned repos**
`server/routes/orgs.js:36-51`  —  risk: **low** · confidence: medium
- *Problem:* GET / fetches `/user/repos?affiliation=owner&per_page=100` exactly once (no pagination) and then derives publicRepos/privateRepos by filtering that single page (lines 41-42). For any user owning more than 100 repos the personal-account card shows truncated counts (max 100 split across public/private), silently understating reality. The org branch by contrast reads authoritative counts from `/orgs/{login}` (orgDetails.public_repos / total_private_repos), so the inconsistency is visible side-by-side in the same response.
- *Fix:* Read the authoritative counts from the already-fetched `/user` payload instead of counting a single page: GitHub's `/user` returns `public_repos`, `total_private_repos` (and owned counts) for the authenticated user. Use `user.public_repos` and `user.total_private_repos` for the personalAccount object and drop the extra `/user/repos` call entirely (also removing a round-trip).

**PM-12. Team actions/stats has no response cache and re-runs N per-repo stat queries on every call**
`server/routes/v1/index.js:44,202-244`  —  risk: **low** · confidence: medium
- *Problem:* GET /teams/:id/activity caches via activityCache (60s TTL), but POST /teams/:id/actions/stats has no caching and re-computes actionsService.getMultiRepoStats for every assigned repo plus a JS .find() per stat (line 227: repos.find(...) inside .map() → O(repos^2)) on every request. Dashboards typically poll this. The activity route right next to it already demonstrates the cache pattern.
- *Fix:* Build a Map(repo_id → repo_full_name) once instead of repos.find() inside the map (removes the quadratic lookup), and reuse the existing createCache helper to memoize the computed payload per (teamId,userId,days) for a short TTL, mirroring the activity route.

**PM-13. GET /ping fires runDiscovery fire-and-forget with no in-flight de-duplication**
`server/routes/work-board-tracking.js:166-183`  —  risk: **low** · confidence: medium
- *Problem:* On every /ping where discovery is stale (>24h) and a token exists, the route launches `runDiscovery(...)` fire-and-forget (lines 175-180). Because the staleness check reads `prefs.last_discovery_at` and runDiscovery presumably updates it only on completion, two near-simultaneous pings (e.g. multiple tabs, or a fast reload) both observe `isStale === true` and both spawn a full cross-repo discovery against the GitHub API for the same user. There is no per-user in-flight lock, so concurrent pings multiply GitHub load and can race on the same writes.
- *Fix:* Guard runDiscovery with a per-user in-flight Set/Map (add userId before launching, delete in a .finally), skipping the launch when the user already has a discovery running. Alternatively mark last_discovery_at (or a discovery_started_at) at launch time so a second concurrent ping sees it as fresh.

**PM-14. Redundant second network request for README that the AI endpoint already returns**
`src/components/AI/ReadmeEnhanceDiffPanel.jsx:38-64`  —  risk: **low** · confidence: high
- *Problem:* The effect fires a bespoke raw `fetch('/api/repos/<full_name>/readme')` in parallel with `aiApi.enhanceReadme(repo)`. But the enhance endpoint already returns `currentReadme` in its response body (confirmed in server/routes/ai/core.js and server/lib/ai-features/readme-enhance.js), and line 53 explicitly prefers `result.currentReadme` over the parallel fetch result (`result.currentReadme \|\| readme \|\| ''`). So in the configured/success path the extra GitHub-proxied README fetch is wasted work that is immediately discarded. The raw fetch also bypasses the shared apiCall/fetchWithRetry + error-normalization layer that reposApi/aiApi use everywhere else, and reposApi already has a file-content helper (getFileContent) so the hand-rolled base64/fetch path is duplicated infra.
- *Fix:* Drop the parallel `readmeFetch` and rely on `result.currentReadme` from enhanceReadme; only fall back to a fetch (via reposApi) when the server omits it. If a separate fetch is genuinely needed, route it through the shared reposApi helper rather than a raw fetch.

**PM-15. Command-group builders recompute new arrays every render, defeating child memoization**
`src/components/CommandPalette.jsx:266-308`  —  risk: **low** · confidence: medium
- *Problem:* On every render of CommandPalette, `buildTrackedRepoCommands`, `buildAICommands`, `buildRepoDetailCommands`, `buildPRReviewCommands`, `buildTeamsCommands`, `buildReposCommands`, `buildRepoActionsCommands`, plus the `buildPR/Branch/IssueActionCommands` calls all run and allocate brand-new array/object identities. The component re-renders on every keystroke (`input` state) and on each parent re-render. Each new array is passed into `<CommandGroup commands={...}>`, so any memoization on those children is defeated and they re-render on every keystroke even though their inputs (tracked repos, active view) haven't changed. `entitiesCtx` (288-299) is likewise re-created with new closures each render.
- *Fix:* Wrap each builder result in `useMemo` keyed on its real inputs (e.g. `useMemo(() => buildTrackedRepoCommands(trackedHook.repos), [trackedHook.repos])`), and memoize `entitiesCtx` with `useMemo`. This keeps array identities stable across keystrokes so the contextual groups don't re-render while the user is just typing a search.

**PM-16. Activity chart collapses 30d/90d ranges onto 7 weekday labels (correctness + misleading UX)**
`src/components/Dashboard/ActivityChart.jsx:26-57`  —  risk: **low** · confidence: high
- *Problem:* chartData buckets every event by ISO day into dailyData (correct), but the final map() relabels each bucket with dayNames[new Date(date).getDay()] — i.e. just the weekday name (Mon/Tue/...). For timeRange '30d' or '90d' this yields many points sharing the same x-axis label (4-13 'Mon's, etc.), so recharts renders overlapping/ambiguous ticks and the line reads as noise. The 7d case happens to look fine only because each weekday is unique. The expensive per-day bucket build is also wasted since the label granularity is thrown away.
- *Fix:* Label points with a real date key (e.g. date.toLocaleDateString(locale,{day:'2-digit',month:'short'}) for 30/90d, weekday only for 7d) and/or aggregate into weekly buckets for 30d/90d so each x-tick is distinct. Keep the dailyData fill but emit a unique, sorted label per point.

**PM-17. OrganizationCard does an O(repos) scan per org card; N orgs × all repos every render set**
`src/components/Dashboard/OrganizationCard.jsx:12-33`  —  risk: **low** · confidence: medium
- *Problem:* Each OrganizationCard filters the FULL repos array (repos.filter(r => r.owner?.login === org.login)) then runs 6 more passes (reduce x3, filter x2, some x1) inside useMemo. With M orgs rendered in the Organizations grid, that is M full traversals of the global repos list (O(M·R)). The parent DashboardPremium already holds `repos` and could group once. The custom memo comparator also compares prevProps.repos.length === nextProps.repos.length, so an in-place repo refresh that keeps the same length (e.g. star counts changed) will skip re-render and show stale org totals.
- *Fix:* Group repos by owner.login once in DashboardPremium (useMemo -> Map<login, repo[]>) and pass each org its own slice, so each card iterates only its own repos. Separately, broaden the memo comparator or drop it in favor of passing a stable per-org array reference so length-preserving data updates still refresh.

**PM-18. PR files refetched on every Q&A question (repeated large payload)**
`src/components/DevToolkit/ReviewTab/ReviewTab.jsx:72, 110`  —  risk: **low** · confidence: high
- *Problem:* `fetchSummary` already fetches `/pulls/:n/files` (line 72) to build the review summary, but `handleQA` (line 110) refetches the exact same full file list on every single question the user asks, then rebuilds patches client-side. PR file payloads include full patches and can be large; asking 5 questions means 5 redundant full-diff downloads plus 5 JSON parses. The file set does not change between questions for a fixed PR.
- *Fix:* Fetch the files once per selected PR (e.g. store the file manifest/patches in a ref or state keyed by pr.number, or memoize), and reuse it in both `fetchSummary` and `handleQA`. Invalidate when `selectedPR.number` changes.

**PM-19. stepCtx object rebuilt every render and StepRenderer is unmemoized**
`src/components/MigrationWizard/MigrationWizard.jsx:148-178, 325`  —  risk: **med** · confidence: medium
- *Problem:* stepCtx is a fresh 28-field object literal assembled on every MigrationWizard render and passed straight into <StepRenderer ctx={stepCtx}/>, which is not wrapped in React.memo. The comment at L146-147 explicitly states this is intentional, but it means any state change in the wizard shell (e.g. validation spinner, import-job tick, a single keystroke that bubbles via onChange) re-renders the entire current step subtree, including the lazy-loaded heavy steps. React 19's compiler can memoize component bodies but cannot stabilize a fresh object literal passed as a prop, so memoizing StepRenderer alone wouldn't help while ctx changes identity each render.
- *Fix:* Pass the wizard hooks/handlers as discrete stable props (most are already memoized via useCallback or come from the hook) instead of a monolithic per-render object, OR wrap the ctx in useMemo keyed on the values the current step actually reads. Then the per-step components only re-render when their real inputs change rather than on every shell tick.

**PM-20. RepoConfigStep onUpdateRepo does an O(n) findIndex by name on every update**
`src/components/MigrationWizard/StepRenderer.jsx:97-103`  —  risk: **low** · confidence: medium
- *Problem:* The repoConfig case wraps onUpdateRepo so each update from a selected-repo row runs repos.findIndex(r => r.name === selectedRepos[selectedIndex]?.name) to map the filtered index back to the original array. This closure is also re-created on every render (it's inline in the switch). For large Azure projects (hundreds of repos), every keystroke in a target-name field triggers a linear scan plus a new function identity, which combined with the unmemoized ctx above compounds re-render cost. Matching by name is also fragile if two source repos share a name.
- *Fix:* Pass a stable identity (repo.id, falling back to name) and resolve the original index via a Map<id, index> memoized from repos, or have updateRepo accept a repo id directly. Hoist the handler out of the switch so it isn't reallocated each render.

**PM-21. Detail-panel enrichment effect depends on whole `source` object, refetching on unrelated state changes**
`src/components/MigrationWizard/steps/RepoSelectStep/RepoDetailPanel.jsx:45-89`  —  risk: **low** · confidence: high · verify: adjusted
- *Problem:* The useEffect that fires 3 POST requests (full-stats, readme, commit-activity) lists `source` in its dependency array. `source` is the entire wizard source slice; any mutation to it (e.g. the user toggling credentialMode, editing the PAT field, validating, switching org) produces a new object identity and re-triggers all three network round-trips for the currently-open repo, even though only org/project/cred fields matter. With the panel open this is an easy N+1 of heavy calls (README + commit history for 12 months).
- *Fix:* Depend on the primitive fields actually used: source.org, source.project, and a stable credential key (e.g. JSON of azureCredPayload(source) or source.savedCredentialId/source.pat/source.host) plus repo.id, instead of the whole `source` reference. Optionally hoist getCsrfToken outside the per-repo effect since the token is request-agnostic.
- *Verifier (severity adjusted):* Verified at RepoDetailPanel.jsx:45-89. The enrichment effect firing 3 POSTs (full-stats, readme, commit-activity with months:12) has dependency array [repo, source, empty] (line 89) while only using source.org, source.project, and azureCredPayload(source) (host/credentialMode/savedCredentialId/pat). Depending on the whole `source` object means any new identity re-triggers all three heavy round-trips, so the over-broad dependency is real and the suggested primitive-key fix is correct. However the panel lives on RepoSelectStep while PAT/credentialMode editing happens on the prior SourceStep where the panel isn't mounted, so the 'refetch on every keystroke' blast radius is narrower in practice than described; org-switch/validated-flag flips can still over-fire but less frequently. Real but over-rated — medium is appropriate.

**PM-22. RepoRow is unmemoized and receives fresh inline closures, defeating virtualization gains**
`src/components/MigrationWizard/steps/RepoSelectStep/RepoRow.jsx:22-110`  —  risk: **low** · confidence: medium
- *Problem:* RepoRow is a plain function component (no React.memo) rendered once per repo, including inside the virtualized list. RepoList passes the same onToggle/onOpenDetail handlers, but RiskBadge gets `onRiskClick ? () => onRiskClick(repo.id) : undefined` created inline, and the Set-based selectedIds/activeId props mean every list re-render re-renders every visible row. For large repo lists this is the hot path; with React Compiler in play memoization may be partially handled, but the inline onRiskClick closure and lack of an explicit memo boundary still cause avoidable row re-renders on each selection toggle.
- *Fix:* Wrap RepoRow in React.memo with a comparator on (repo, isSelected, isActive, density), and stabilize the per-row risk-click handler (pass onRiskClick(repo.id) wiring down via a stable callback or omit the inline arrow). Confirm parent handlers are useCallback-stable.

**PM-23. Project list re-fetches on every PAT keystroke**
`src/components/MigrationWizard/steps/TargetConfigStep/AzureTargetForm.jsx:117-141`  —  risk: **low** · confidence: high
- *Problem:* ExistingProjectForm's loader effect depends on `[source.host, source.org, source.pat]`. `source.pat` changes on every character the user types into the PAT field (the wizard keeps PAT in `source`), so each keystroke fires a fresh `POST /api/azure/projects` round-trip to enumerate projects — an N-per-keystroke network amplification for data that only depends on host+org+credential. The shared useAzureProjectData hook guards this by depending on stable credential identifiers and not re-deriving on every transient field, but this copy keys directly off the raw PAT string.
- *Fix:* Remove the local effect entirely in favour of useAzureProjectData (which already debounces re-fetch via credentialMode/savedCredentialId deps), or at minimum drop `source.pat` from the dependency array and trigger the fetch on an explicit 'load projects' action / on blur rather than per-keystroke.

**PM-24. PR reviews fetched on every open but never consumed**
`src/components/PRReview/hooks/useReviewData.js:42-47`  —  risk: **low** · confidence: high
- *Problem:* fetchAll includes api.fetchPullReviews(pullNumber) in the Promise.all and stores it as data.reviews, but `reviews` is never destructured or used anywhere — PRReviewView's LOAD_DATA payload only forwards pr/headSha/files/comments, and a repo-wide grep shows no other consumer of data.reviews. Every time a user opens the PR review surface, an extra GitHub-proxied request (and its rate-limit cost) is spent for data that is discarded.
- *Fix:* Remove api.fetchPullReviews from the Promise.all and the `reviews` key from setData. If reviews are needed later (e.g. to show prior review verdicts), wire them into state and the UI at that point rather than fetching speculatively.

**PM-25. Collaborators not refetched when switching to a different repo (stale-data guard never re-runs)**
`src/components/RepoDetail/CollaboratorsSection.jsx:59-65`  —  risk: **med** · confidence: medium
- *Problem:* The mount-fetch effect lists `[owner, repo]` as deps but its body is guarded by `if (!loaded && !loading)`. Once the first repo's collaborators load, `loaded` is permanently true, so navigating to a different repo's Settings tab (when RepoDetail/SettingsTab stays mounted and only the owner/repo props change) will NOT refetch — the list shows the previous repo's collaborators. The remove/add handlers then operate against the wrong repo context shown to the user.
- *Fix:* Reset state on identity change rather than guarding on `loaded`: either key CollaboratorsSection by `${owner}/${repo}` from the parent, or in the effect call `setLoaded(false); setCollaborators([]); load()` whenever owner/repo changes (drop the `!loaded` guard, keep an in-flight guard via an abort/ignore flag).

**PM-26. Selected-repo lists rebuilt with full repos.filter on every render of the orchestrator**
`src/components/RepoList/index.jsx:186-200`  —  risk: **low** · confidence: high
- *Problem:* repos.filter((r) => selectedIds.has(r.id)) is computed inline in three places (SelectionSheet repos, SelectionBar repos, RepoContextMenu selectedRepos) on every RepoList render — including every keystroke in the search box and every selection toggle. With large repo lists this is 1-3 full O(R) scans per render even when nothing relevant changed. These are not memoized.
- *Fix:* Compute `const selectedRepos = useMemo(() => repos.filter(r => selectedIds.has(r.id)), [repos, selectedIds])` once and reuse it for SelectionBar, SelectionSheet, and the context menu's selectedRepos branch.

**PM-27. Non-admins still fire /api/env/tooling on mount because the loader has no isAdmin guard**
`src/components/Settings/EnvironmentToolingSection.jsx:20-23, 38-40`  —  risk: **low** · confidence: high
- *Problem:* useTabData runs its loader unconditionally on mount (verified in src/hooks/useTabData.js:55-72). EnvironmentToolingSection passes `() => apiCall('/api/env/tooling')` with deps [] and an empty isAdmin guard only at render (line 38). So every non-admin who opens this tab fires a guaranteed-to-403 network request before the component short-circuits to the 'Admin only' EmptyState — wasted round-trip and a server-side 403 log per non-admin view. ProbeStatsSection right next door does this correctly: `() => (isAdmin ? apiCall(...) : Promise.resolve(null))` with deps [isAdmin].
- *Fix:* Mirror ProbeStatsSection: change the loader to `() => (isAdmin ? apiCall('/api/env/tooling') : Promise.resolve(null))` and deps to [isAdmin]. This skips the fetch entirely for non-admins.

**PM-28. useWorkBoardAI is a non-shared hook called twice → duplicate status/suggestions/activity fetches on every Work Board open**
`src/components/Settings/WorkBoard/WorkBoardSummary.jsx:17 (and ai/WorkBoardAISection.jsx:11)`  —  risk: **low** · confidence: high · verify: adjusted
- *Problem:* Unlike useTrackedRepos (a context, single shared fetch), useWorkBoardAI (src/hooks/useWorkBoardAI.js) holds its own state and runs its own useEffect(reload) on mount. It is instantiated independently in two components that both render simultaneously inside WorkBoardSettingsSection: WorkBoardSummary (right rail) and WorkBoardAISection (step 05). Each instance fires GET /ai/status, then GET /ai/suggestions + GET /ai/activity in parallel. That doubles every AI request on each Settings visit, and the two instances can also disagree on `enabled`/`reason`. An existing audit (docs/reports/2026-06-11-portal-expert-audit.md:149) already flagged this hook as lacking in-flight guards.
- *Fix:* Promote useWorkBoardAI to a context provider (like TrackedReposContext) so all consumers share one fetch + one state tree, OR have WorkBoardSummary derive AI-enabled state from the already-shared prefs (prefs.ai_assistant_enabled) instead of spinning up a second hook instance. At minimum add an in-flight ref guard so concurrent mounts don't double-request.
- *Verifier (severity adjusted):* REAL. useWorkBoardAI (src/hooks/useWorkBoardAI.js) is a plain non-shared hook: own useState + useEffect(reload) on mount (line 48). reload() fires fetchStatus() then fetchSuggestions()+fetchActivity() in parallel (lines 21,30). It is instantiated independently in WorkBoardAISection.jsx:11 and WorkBoardSummary.jsx:17, and WorkBoardSettingsSection.jsx renders BOTH simultaneously with no gating (WorkBoardAISection at line 208 in the main column, WorkBoardSummary at line 217 in the right-rail aside). So every Settings visit double-fires the AI requests and the two enabled/reason states can diverge (two sources of truth). No in-flight guard exists. The audit cross-ref is accurate: docs/reports/2026-06-11-portal-expert-audit.md lists hooks/useWorkBoardAI.js:13-48 as lacking in-flight guards, rated 'medium' there. Adjusting high->medium: the requests are idempotent GETs on a low-traffic settings page, so the perf cost is modest; the genuine state-divergence is real but bounded. The original audit itself rated this medium.

**PM-29. Every visible Tooltip attaches capturing scroll/resize/pointer listeners; reposition runs unthrottled**
`src/components/ui/Tooltip.jsx:150-171`  —  risk: **low** · confidence: medium
- *Problem:* While a tooltip is visible it registers a capturing `scroll` listener on window (`addEventListener('scroll', reposition, true)`) plus resize and document pointerdown. The capturing scroll listener fires for ANY scroll in any nested scroll container in the app, and each fire calls computePosition() which does two getBoundingClientRect() reads (forced layout) and a setState. Tooltips are attached to most icon buttons (toolbars, rows, headers), so a single hovered tooltip while scrolling a long list triggers a rAF-less layout+setState storm on the hot scroll path.
- *Fix:* Throttle reposition via requestAnimationFrame (coalesce bursts to one measure per frame), and/or only listen to scroll on the trigger's scroll-parent rather than capturing all scrolls. Since only one tooltip is typically visible at a time the absolute cost is bounded, but the unthrottled rAF-less reflow on scroll is the part worth fixing.

**PM-30. Data hooks instantiated twice (page + active tab), each running its own 60s poll**
`src/components/WorkBoard/tabs/MyReviewsTab.jsx:199-203, 247-270`  —  risk: **med** · confidence: high
- *Problem:* WorkBoardPage calls useMyPendingReviews/useStalePRs/useMyOpenIssues/useTechDebt to feed the KpiRow, and each tab (MyReviewsTab, StalePRsTab, MyIssuesTab, TechDebtTab) calls the SAME hook again for its own list. Each useWorkBoardFetch instance starts an independent setInterval(60_000) and its own visibilitychange listener (useWorkBoard.js:101-134). The SWR cache dedupes the payload, but two timers per dataset fire two fetches per minute for the visible tab's data and add redundant re-render churn. The page already has the data and could pass it down as props.
- *Fix:* Pass the already-loaded { data, loading, error, refresh } from WorkBoardPage into the active tab as props (the page holds all four), or have the page be the single owner and let tabs read filtered slices via the FilterProvider/context. Avoids the duplicate polling timers and double fetch-on-focus.

**PM-31. Per-row useTrackedRepos().repos.find — O(n) lookup repeated for every list row**
`src/components/WorkBoard/TrackedChip.jsx:10-12`  —  risk: **low** · confidence: medium
- *Problem:* TrackedChip, TrackedDot (TrackedDot.jsx:10-11), and WorkBoardRowMenu (WorkBoardRowMenu.jsx:29) each call useTrackedRepos() and then repos.find(r => r.repo_full_name === ...) on every render. When rendered once per Work Board row (and WorkBoardRowMenu is rendered for every row in every tab), this is an O(rows × repos) linear scan plus a full subscription to the tracked-repos store, so every row re-renders whenever ANY tracked repo changes (pin/mute of one repo re-renders all rows).
- *Fix:* Expose a memoized Map (repo_full_name -> repo) from useTrackedRepos (or a useTrackedRepo(repoFullName) selector hook) so each row does an O(1) lookup and only re-renders when its own repo entry changes.

**PM-32. Filter-option aggregation + earliest-timestamp recomputed every render (no memo)**
`src/components/WorkBoard/WorkBoardPage.jsx:199-221, 282-307`  —  risk: **low** · confidence: high
- *Problem:* On every WorkBoardPage render, allItems is rebuilt by spreading reviews/stale/issues/debt arrays, then three separate Array.from(new Set(...)).sort() passes run over the combined list (availableRepos/availableAuthors/availableLabels), plus a min-of-timestamps IIFE. The page re-renders on every URL-param change (tab switch, any filter chip toggle), on each 60s background refresh of any of the four hooks, and on refreshing-state flips. These O(n) scans + sorts run on the full cross-tab dataset each time even though the underlying data did not change. The derived arrays are then passed as new identities to FilterProvider and WorkBoardFilterBar, defeating the useMemo inside FilterProvider.
- *Fix:* Wrap allItems, availableRepos/Authors/Labels, and earliest in useMemo keyed on [reviews.data, stale.data, issues.data, debt.data] (and the lastFetchedAt values for earliest). This stabilizes identities so FilterProvider's memo and the filter bar stop re-running on unrelated renders.

**PM-33. Single ModalProvider re-renders every modal consumer on any open/close**
`src/contexts/ModalContext.jsx:53-121`  —  risk: **med** · confidence: medium
- *Problem:* All ~17 modals share one internalStates object and one context value. Opening or closing ANY modal replaces internalStates, rebuilds modalStates via toBooleanStates over all keys, and produces a new context value object — so every component subscribing to useModal (context menus, every RepoCard quick-action, selection bar, command palette, settings) re-renders even though only one boolean changed. getModalData is also recreated on every internalStates change (depends on internalStates) which busts memoization in consumers that depend on it.
- *Fix:* Split into a stable actions context (openModal/closeModal/openModalWithData — never change) and a per-modal state selector, or expose a useModalState(name) hook that subscribes only to that key. At minimum, memoize the actions separately from modalStates so action-only consumers don't re-render on open/close.

**PM-34. Per-render recomputation + forced 'all loading' setMap flashes shimmer over cached data**
`src/hooks/useAIFeaturesHealth.js:19-43`  —  risk: **low** · confidence: medium
- *Problem:* validFeatures (a .filter) and the initial map (with a peekAIStatusForFeature call per feature) are recomputed on EVERY render, though useState(initial) only consumes initial on mount — so the work after mount is thrown away. Worse, the effect unconditionally setMap(...)s every feature to { loading: true } up-front on every run (line 37-43), then resolves. Because getAIStatusForFeature is cached (60s TTL, resolves synchronously-ish), components that already have fresh per-feature status still flash a loading shimmer and incur an extra render on each mount/feature-change. The effect dep is a join() string, so any re-render that changes feature identity re-triggers the whole loading cycle.
- *Fix:* Memoize validFeatures with useMemo([features.join('\|')]); skip the up-front 'mark all loading' setMap when peekAIStatusForFeature already returns fresh data for every requested feature (only shimmer features that are actually unknown). This removes the guaranteed double-render + shimmer flash on the Settings AI screen.

**PM-35. useLicense and useAIUsage both fetch /api/v1/usage and both refetch on every window focus**
`src/hooks/useLicense.js:40, 62-72`  —  risk: **low** · confidence: medium
- *Problem:* useLicense fetches `${API_BASE_URL}/api/v1/usage` (line 40) and refetches on every `focus` event (line 65,67). useAIUsage.js fetches the same `/api/v1/usage` endpoint and also refetches on focus (it has a 30s module cache, useLicense has none). When both hooks are mounted (common: header shows tier badge + AI quota), every tab focus fires two uncached requests to the same endpoint, and useLicense has no dedup/cache at all. This is duplicated fetching of identical data.
- *Fix:* Share a single cached usage fetcher (the module-level cache + subscribe pattern already in useAIUsage.js / useRepoMetadata.js) and have useLicense derive `{ tier, status }` from it, instead of issuing its own uncached request on every focus.


#### Low · 41

**PL-1. previewWorkItems issues 2 sequential round-trips per work-item type**
`server/azure-service.js:472-501`  —  risk: **low** · confidence: medium
- *Problem:* previewWorkItems loops over each requested type and, per type, does a WIQL POST followed by a workitems detail GET strictly sequentially. With several types selected this is 2*N serialized Azure round-trips on a user-facing preview path, each subject to the 30s timeout. listRepoActivity/checkLfsMarkers already demonstrate the p-limit concurrency pattern used elsewhere in this file.
- *Fix:* Run the per-type probes concurrently with p-limit (as listRepoActivity does), or issue one combined WIQL with an IN (...types) clause then a single batched detail fetch, mirroring getWorkItemCounts.

**PL-2. cosineSimilarity has no length-mismatch / zero-norm guard**
`server/lib/ai-features/semantic-search.js:30-40`  —  risk: **low** · confidence: high
- *Problem:* `cosineSimilarity` iterates `for i < vecA.length` and reads `vecB[i]` without checking the vectors are the same length, and divides by `Math.sqrt(normA) * Math.sqrt(normB)` with no zero guard. A dimension change between embedding-model versions (older rows of different length), or an all-zero/empty stored vector, yields silent NaN scores that then sort unpredictably (NaN comparisons) rather than being skipped. parseEmbedding validates JSON shape but not vector length.
- *Fix:* Return null/-Infinity (and skip) when `vecA.length !== vecB.length` or when either norm is 0; filter out NaN scores before sorting. Optionally store/validate the expected embedding dimension.

**PL-3. getKeyHealth background-probe inflight guard has a race that can fire concurrent billed probes**
`server/lib/ai-health-probe.js:186-199`  —  risk: **low** · confidence: medium
- *Problem:* The 'is a probe already running?' check reads `entry?.inflight` where `entry` was captured at the top of the function before any await. Two near-simultaneous reads both see entry.inflight as falsy (or both see a stale entry), both enter the block, and both kick off `runProbe` — each of which bills a real completion against the user's provider. The comment for the 5-minute TTL explicitly aims to avoid 'billing extra completions for every page-load', but this guard does not actually serialise concurrent first-hits.
- *Fix:* Re-read the cache entry immediately before scheduling (`const cur = cache.get(key); if (cur?.inflight) return ...`) and set the inflight marker synchronously before the first await, so a second concurrent caller observes it. Alternatively store and reuse the inflight Promise.

**PL-4. Destructive bulk operations execute strictly serially with no concurrency bound**
`server/lib/bulk-helpers.js:75-85`  —  risk: **low** · confidence: medium
- *Problem:* performBulk awaits each repo's execute() one at a time in a for-loop. For a bulk transfer/delete/visibility change across many repos, each execute() is a GitHub API round-trip, so a 100-repo bulk action serializes 100 sequential network calls — the request can run for minutes and there is no per-item progress streamed back (the whole thing resolves at once). Given these are the premium bulkAdvanced operations, the latency reads as unpolished.
- *Fix:* Run executes with a bounded concurrency (e.g. p-limit of 4-6) to cut wall-clock time while staying under GitHub abuse limits, preserving the per-repo results array. If ordering matters for audit, keep the audit log of `repos` as-is (already a snapshot) and just parallelize the execute calls. Optionally stream progress via SSE for large batches.

**PL-5. Derived-key cache evicts the entire map on overflow instead of bounded LRU**
`server/lib/credential-encryption.js:86`  —  risk: **none** · confidence: high
- *Problem:* When keyCache reaches KEY_CACHE_MAX (256) the code does `keyCache.clear()` — a full flush. Under a workload with >256 distinct salts (each credential has a unique salt), this thrashes: every overflow drops ALL cached keys, so the expensive PBKDF2 (210k iterations, ~100ms) re-runs for entries that were just evicted. For a busy migration server decrypting many distinct saved PATs this reintroduces the cost the cache was meant to remove.
- *Fix:* Use a simple bounded LRU (delete the oldest entry on insert when size >= max) instead of clear(). Map preserves insertion order, so `keyCache.delete(keyCache.keys().next().value)` evicts the oldest in O(1).

**PL-6. Oversized-blob scan builds a full sha→path Map and concatenates every object id into one cat-file batch input**
`server/lib/oversized-blobs.js:44-66`  —  risk: **low** · confidence: medium
- *Problem:* findOversizedBlobs reads the entire `git rev-list --objects --all` output, builds a Map of every object (commits/trees/tags included, since the filter only drops lines without a space) and a parallel `shas` array, then joins all shas into a single string fed to cat-file. For a large monorepo this is hundreds of thousands of entries held in memory and a multi-MB stdin blob, even though only blobs over 100 MiB matter and the result is capped at 50. The Map also stores paths for non-blob objects that are never sized.
- *Fix:* Pipe rev-list output line-by-line into cat-file --batch-check via a stream rather than materializing both the Map and the joined string; only retain the path for a sha lazily (look it up after the size check passes the threshold). Bounds memory to O(oversized) instead of O(all objects). Lower priority since it only runs during a migration, not on a request hot path.

**PL-7. Sequential awaited GitHub fetches for manifest/entrypoint/custom-file candidates**
`server/lib/repo-context-builder.js:63-79, 209-217`  —  risk: **low** · confidence: medium
- *Problem:* `fetchManifest` loops MANIFEST_CANDIDATES awaiting each fetch one-by-one (early-return on first hit), `fetchEntrypoints` awaits each of ~13 entrypoint candidates serially, and the custom-files loop fetches each file serially. On a cold context build this serializes up to ~20 GitHub round-trips, adding noticeable latency to an interactive 'suggest name/description' request. The README/manifest/entrypoint/dir top-level signals are also fetched sequentially relative to each other.
- *Fix:* Parallelize independent fetches with `Promise.all` (entrypoints and custom files especially, since all are independent and the result is filtered afterward), and run the independent top-level signal fetches concurrently. Keep the manifest first-hit semantics if ordering matters, or fetch all and pick the first present.

**PL-8. Semantic-search result enrichment uses array.find inside map (O(n*m)) instead of a lookup map**
`server/routes/ai/indexing.js:165-168`  —  risk: **none** · confidence: high
- *Problem:* `results.map(r => metas.find(m => m.repo_id === r.repo_id))` is O(results * metas). With the 10/100 caps here it's tiny, but it's the kind of nested-scan pattern worth normalizing since the same shape recurs. Negligible today; flagged only as a cheap cleanup.
- *Fix:* Build `const metaById = new Map(metas.map(m => [m.repo_id, m]))` once, then `metaById.get(r.repo_id)` in the map.

**PL-9. Audit list runs a second full COUNT(*) query on every page request**
`server/routes/audit.js:22-43`  —  risk: **low** · confidence: medium
- *Problem:* Each GET /audit builds and executes a separate COUNT(*) over audit_log_v2 filtered by user_id (+ optional action/resource_type/from/to) in addition to the page query. For a high-volume enterprise tenant this is an O(n) scan on every pagination request just to render a total, doubling the DB work per page and growing linearly as the audit log grows. The two queries also duplicate the entire WHERE-clause assembly (lines 25-28 vs 38-41).
- *Fix:* Either (a) drop the exact total in favour of a hasNextPage probe (fetch limit+1 rows), or (b) cache the count per filter-set for a short TTL, or (c) at minimum extract the shared WHERE-builder into one helper so the two queries can't drift. Ensure a composite index on (user_id, created_at) and on the filtered columns exists to keep the count bounded.

**PL-10. Repo-list mirror annotation loads ALL of the user's mirror jobs on every page**
`server/routes/repos/crud.js:95-103`  —  risk: **low** · confidence: medium
- *Problem:* GET /repos builds mirrorMap by selecting every is_mirror=1 migration_jobs row for the user (no WHERE on the repos actually being returned) on each paginated request, then checks membership for the <=100 repos on the page. For a heavy mirror user this scans/loads the full mirror set repeatedly when only the page's full_names matter.
- *Fix:* Constrain the query to the page: collect the page's full_names and query WHERE is_mirror=1 AND user_id=? AND (target_owner\|\|'/'\|\|target_repo) IN (...), or just add an index-friendly filter. Minor, but it makes the cost proportional to the page size rather than the user's total mirror count.

**PL-11. POST /ai-config decrypts the full config up to twice per save (redundant PBKDF2 work)**
`server/routes/user-ai-config.js:124, 137`  —  risk: **none** · confidence: high
- *Problem:* On a save that touches both completion and embedding credentials, getDecryptedConfig(req.session.userId) is called once at line 124 and again at line 137. Each call runs decryptCredentials, which derives a PBKDF2-SHA512 key (~tens of ms; cached by salt+secret but the cache is per-blob). Two full row reads + two decrypt passes on a single mutation is wasteful, and the second read re-decrypts the same row.
- *Fix:* Call getDecryptedConfig once before building both credential objects and reuse the result for both completion and embedding merge branches.

**PL-12. export_meta_selected downloads repos strictly sequentially (await in for-loop)**
`src/actions/repoActions.js:449-460`  —  risk: **low** · confidence: medium
- *Problem:* The batch metadata export awaits each ctx.api.exportMetadata one repo at a time. For a large selection this serializes N network round-trips plus N synthetic <a>.click() downloads, making bulk export feel slow with no progress feedback (only a final count toast). It is the only batch action that does real per-item network work inline rather than delegating to a modal/queue.
- *Fix:* Bound-concurrency the loop (e.g. a small pool of 3-4 in flight) so throughput improves while staying polite to the API, and surface incremental progress (e.g. toast.info or a progress modal) instead of a single terminal toast. Keep the stop-on-error semantics if desired.

**PL-13. Per-feature AI-status cache never coalesces a forced refetch (inflight overwrite)**
`src/api/aiStatus.js:62-74`  —  risk: **low** · confidence: medium
- *Problem:* getAIStatusForFeature stores the new inflight promise via featureCache.set(feature, { ...entry, inflight: promise }) (line 72) but the promise's own .then (line 68-71) overwrites the WHOLE entry with { cached, cachedAt, inflight: null }. If force:true is passed twice in quick succession, the second call sees entry.inflight from the first set and returns it (good) — but a force call started AFTER a non-forced inflight resolves will not dedupe against an in-progress non-forced fetch because there is no force-vs-nonforce distinction; both share one slot and a forced refetch can clobber a settling non-forced one. The headline getAIStatus path (lines 41-53) handles inflight correctly; the per-feature path is a looser copy.
- *Fix:* Mirror the headline path exactly: check entry.inflight first and return it regardless of force, and only start a new fetch when there is no inflight. Or unify both caches into one keyed Map so there is a single, tested code path.

**PL-14. handleLogin / handleLogout / handleOrgSelect not memoized, unlike sibling handlers**
`src/App.jsx:514, 520, 529`  —  risk: **low** · confidence: medium
- *Problem:* Almost every other handler in AppContent is wrapped in useCallback (handleOpenRepo, handleAction, handleReauthorize, handleOpenOrgManager, etc.), but handleLogin (514), handleLogout (520) and handleOrgSelect (529) are recreated on every render. They are passed down to Header (onLogin/onLogout), OrgSidebar/MobileOrgDrawer/DashboardPremium (onSelectOrg via handleOrgSelect) and CommandPalette (onSignOut). handleOrgSelect in particular fans out to many children and to the dashboard's onOrgClick closure, so its unstable identity propagates fresh prop references on each parent render. Inconsistent with the deliberate memoization strategy documented elsewhere in the file (e.g. the sidebarProps memo comment on line 545).
- *Fix:* Wrap the three handlers in useCallback with their real dependencies (handleOrgSelect deps: [setSelectedOrg, setOrg, fetchOrgRepos, refresh]; handleLogin/handleLogout have none beyond stable setters). This restores referential stability so memoized descendants (and future React.memo additions) don't re-render needlessly.

**PL-15. scrollIntoView fires on every streaming delta and on open even when minimized**
`src/components/AIAssistant.jsx:248-250`  —  risk: **low** · confidence: medium
- *Problem:* The effect [messages, isOpen] calls messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) on every messages change. During streaming, setMessages updates the bubble text on each delta (lines 337-339), so this triggers a smooth-scroll animation on every token chunk — janky and wasteful. It also runs when the panel is minimized/closed (ref may be null, but the effect and dependency churn still run).
- *Fix:* Throttle/rAF the scroll, or only scroll when a new message is appended (track count) rather than on every text mutation; gate on isOpen && !isMinimized so it doesn't run for hidden panels.

**PL-16. Index-based keys on an editable, reorderable path-rules list**
`src/components/AIPrompts/PromptEditor.jsx:205-227`  —  risk: **low** · confidence: high
- *Problem:* Path rules are rendered with `key={i}` while being individually edited (glob + extraPrompt inputs) and removable mid-list (removeRule splices by index). React index keys on a mutable list cause input state/DOM to bind to the wrong row after a removal, so removing rule 2 can visually shift rule 3's typed text up and momentarily desync controlled values. The same pattern appears for testResult.lineComments (line 267) — lower risk there since it's read-only.
- *Fix:* Give each rule a stable id when added (e.g. `{ id: crypto.randomUUID(), glob:'', extraPrompt:'' }`) and key on `rule.id`. Keep index keys only for the truly static, read-only comment list.

**PL-17. Recommendations and tasks lists keyed by array index**
`src/components/CommunityHealthDashboard.jsx:276-277, 328-329`  —  risk: **low** · confidence: medium
- *Problem:* RecommendationItem is rendered with key={idx} (twice — desktop and mobile). Index keys are unstable across re-fetches/reordering and defeat React's reconciliation, which matters here because each item mounts spring-animated children; a refresh that reorders recommendations can mis-associate animation state and cause needless remounts.
- *Fix:* Key by a stable field from the recommendation (e.g. `${rec.category}-${rec.action}` or a server-provided id) instead of the loop index.

**PL-18. new Date().setHours(...) inside useMemo defeats memoization stability and is re-read each recompute**
`src/components/Dashboard/OrganizationCard.jsx:20`  —  risk: **low** · confidence: medium
- *Problem:* Inside the useMemo, `const now = new Date().setHours(0,0,0,0)` reads wall-clock time. The surrounding comment even acknowledges this is impure. While the useMemo deps are [repos, org.login], any recompute re-reads `now`, so hasRecentActivity can flip between renders that recompute for unrelated reasons, and the value is non-deterministic for tests. It also allocates a Date per card per recompute.
- *Fix:* Compute a single day-start timestamp once at the DashboardPremium level (or via a shared util) and pass it down as a prop, or hoist it to a module-level value refreshed on mount. Keep the useMemo pure over its inputs.

**PL-19. content useMemo depends on the whole toolkit object, recomputing every keystroke**
`src/components/DevToolkit/DevToolkitPanel.jsx:117-143`  —  risk: **low** · confidence: medium
- *Problem:* The `content` useMemo lists `[toolkit, onStartReview, onClose]` as deps. `toolkit` is the full object returned by useDevToolkit and changes identity on essentially every state update inside the hook (branch typing, streaming text, etc.), so this memo recomputes constantly and re-creates the active tab element subtree each time — defeating the purpose of memoizing. The tab components themselves are not memoized, so they re-render along with it.
- *Fix:* Depend on the specific fields that actually gate the render (`toolkit.selectedRepo`, `toolkit.isPinned`, `toolkit.activeTab`) and pass `toolkit` straight through to the tab; or drop the memo entirely since it provides no benefit while `toolkit` identity churns. Consider React.memo on the tab components if their props are stabilized.

**PL-20. toggleBranchExpand depends on branchCache/expandedBranches so its identity churns on every branch load**
`src/components/MigrationWizard/hooks/useBranchCache.js:22-53`  —  risk: **low** · confidence: medium
- *Problem:* useCallback lists [expandedBranches, branchCache, source] as deps, so the handler is recreated whenever any repo is expanded or any branch list arrives. Every RepoConfigStep row receiving this callback as a prop then re-renders on each expand. Reading expandedBranches[key] and branchCache[key] from inside the callback is the reason for the deps, but the functional-setState pattern already used (setExpandedBranches(prev => ...)) makes those reads avoidable.
- *Fix:* Read isExpanded and cache-presence inside functional updaters (or via refs mirroring the maps) so the callback can drop expandedBranches/branchCache from its dep array and keep a stable identity, eliminating the per-load re-render cascade across rows.

**PL-21. Project-metadata prefetch fires up to 100 sequential-per-worker POSTs to /api/azure/repos**
`src/components/MigrationWizard/hooks/useSourceStepForm.js:348-412`  —  risk: **low** · confidence: medium
- *Problem:* fetchMeta prefetches repo counts for up to PREFETCH_CAP=100 projects using 3 concurrent workers, each issuing an /api/azure/repos POST per project (and fetching a fresh CSRF token per call via getCsrfToken().catch at L385, inside the loop). The cap mitigates the worst case, but 100 round-trips against an on-prem TFS purely to populate dropdown badges is a heavy N+1; the badge data is also only visible for the handful of projects the user scrolls past.
- *Fix:* Fetch repo counts lazily on dropdown-item visibility (intersection observer) or only for the picked project + a small window, rather than eagerly prefetching 100. Hoist the CSRF token outside the worker loop (one token, reused) — getCsrfToken already caches, but the per-iteration call is unnecessary noise. Ideally expose a batched /api/azure/project-repo-counts endpoint.

**PL-22. Bootstrap effect can double-fire analyze() in a re-analyze race**
`src/components/MigrationWizard/steps/AIReviewStep.jsx:95-100`  —  risk: **med** · confidence: medium
- *Problem:* The mount effect calls `analyze()` whenever `!aiPlan?.analyzed && !analyzing`. `analyze` is wrapped in useCallback over `[wizard, onUpdate]`; because `wizard` is a fresh object on most parent renders, `analyze`'s identity changes frequently, re-running the effect. The `analyzing` guard mitigates the common case, but between `setAnalyzing(false)` in `finally` and `onUpdate({analyzed:true})` propagating back as a new `aiPlan` prop, there is a window where `analyzed` is still false and `analyzing` is false, allowing a redundant second analyze() (an extra AI/network call). The eslint-disable comment acknowledges the smell.
- *Fix:* Track a `hasBootstrappedRef` (or gate on a stable `aiPlan.analyzed` only, and set `analyzed:true` synchronously before clearing analyzing), so the one-shot bootstrap can fire at most once per mount regardless of `analyze` identity churn.

**PL-23. cleanOldEntries does a full synchronous localStorage scan + JSON.parse on every mount**
`src/components/PRReview/hooks/useReviewState.js:25-49, 168-171`  —  risk: **low** · confidence: medium
- *Problem:* On every PRReviewView mount, cleanOldEntries iterates the entire localStorage keyspace and JSON.parse()s every 'pr-review-*' entry to find expired ones. On users with many persisted PRs this is unbounded synchronous main-thread work during mount, competing with the initial paint of the review surface. The TTL is 30 days, so this housekeeping does not need to run on every single open.
- *Fix:* Defer the sweep (e.g. requestIdleCallback / setTimeout(0)) and/or throttle it to run at most once per session via a sessionStorage flag, the same pattern ReviewStatusBar already uses for hint counting.

**PL-24. Redundant per-file heuristicRisk passes across PRReviewView and FileTree**
`src/components/PRReview/PRReviewView.jsx:164-193`  —  risk: **low** · confidence: medium
- *Problem:* PRReviewView computes heuristicScores by calling heuristicRisk on every file (187-193) and also sorts via sortFilesByRisk which itself calls heuristicRisk per file again (sortedFiles, 164-176). FileTree then accepts heuristicScores but, when sorting is risk-based, the same heuristic values are effectively recomputed in multiple memos. For large PRs this is several O(n) heuristic passes per render of the active file. heuristicRisk is cheap individually, but the work is repeated rather than computed once and shared.
- *Fix:* Compute a single { filename: heuristicScore } map once (memoized on state.files) and feed it to both sortFilesByRisk (as the fallback score source) and FileTree, so each file is scored once per files change.

**PL-25. rowRefs ref arrays are never trimmed when lists shrink**
`src/components/RepoDetail/CommitsTab.jsx:115; IssuesTab.jsx:47,198; PullRequestsTab.jsx:53,278`  —  risk: **low** · confidence: medium
- *Problem:* Several list components push DOM nodes into `rowRefs.current[idx]` keyed by render index but never reset the array between data loads. When a filter switches from a long list (e.g. 50 commits / 'all' issues) to a short one, stale node references for the removed tail indices remain in `rowRefs.current`. The scroll-into-view effect reads `rowRefs.current[focusedIndex]`, so a focusedIndex landing on a stale slot could scroll to a detached/old node. Minor, but it's repeated in 3+ components.
- *Fix:* Reset the ref array each render before populating it (e.g. `rowRefs.current = []` at the top of the map, or use a Map keyed by item id). A shared `useRowRefs(items)` helper would also dedupe this pattern across CommitsTab/IssuesTab/PullRequestsTab.

**PL-26. Reviews list keyed by array index**
`src/components/RepoDetail/PRDetailPanel.jsx:445`  —  risk: **none** · confidence: high
- *Problem:* `reviews.map((review, i) => <Card key={i} ...>)` uses the array index as the React key. Reviews have stable ids (`review.id`) and submitted timestamps; index keys cause incorrect element reuse / avatar+state flicker if the reviews array is reordered or partially updated after a new review is submitted (the Reviews tab refetches via onSubmitted).
- *Fix:* Key by a stable identifier: `key={review.id ?? `${review.user?.login}-${review.submitted_at}`}`.

**PL-27. Effect resets context menu on every filteredRepos identity change**
`src/components/RepoList/index.jsx:89-92`  —  risk: **low** · confidence: medium
- *Problem:* useEffect(() => setRepoMenu(null), [filteredRepos]) runs whenever the filteredRepos array reference changes. useRepoFiltering likely returns a fresh array each render (filter/sort), so this effect fires far more often than 'the filtered set actually changed', closing the context menu spuriously and triggering an extra render+state set. The eslint-disable for set-state-in-effect hides the smell.
- *Fix:* Key the effect on a stable signal of the filtered set (e.g. filteredRepos.length plus the active filter/search values) or memoize filteredRepos by content in the hook, so the menu only closes when the visible set truly changes.

**PL-28. Global click+capture-scroll listeners always mounted just to close the selection menu**
`src/components/RepoList/RepoFilterBar.jsx:86-94`  —  risk: **low** · confidence: high
- *Problem:* A window 'click' listener and a capture-phase window 'scroll' listener are registered for the component's whole lifetime, even when showSelectionMenu is false. The capture-phase scroll listener fires on every scroll of any scrollable ancestor and calls setShowSelectionMenu(false) unconditionally — a state set on every scroll event while the bar is mounted (the sticky toolbar is always mounted on the repos view).
- *Fix:* Only attach the listeners while showSelectionMenu is true (add showSelectionMenu to the effect deps and early-return when closed), and guard the handler to no-op if the menu is already closed to avoid redundant state sets.

**PL-29. Per-render recompute of legacyCount and idxById Map inside the open dropdown**
`src/components/Settings/AIConfig/ModelDropdown.jsx:37, 40`  —  risk: **none** · confidence: medium
- *Problem:* On each render of the open dropdown, legacyCount = options.filter(o => o.legacy).length scans the full catalogue, and idxById = new Map(itemsInOrder.map(...)) rebuilds a Map. For curated providers this is trivial, but for the OpenRouter live catalogue (hundreds of models, fetched in useProviderModels.js) these run on every keystroke-driven re-render and every hover (hover updates parent highlight → re-render). Combined with useFilteredmodels already memoized, these two are the unmemoized hot-path leftovers.
- *Fix:* Wrap legacyCount and idxById in useMemo keyed on options / itemsInOrder. Minor, but it's the one place where the large OpenRouter payload meets per-keystroke work.

**PL-30. isDirty recomputes two JSON.stringify of the full form on every render/keystroke**
`src/components/Settings/AIConfigSection.jsx:128-148, 169`  —  risk: **none** · confidence: medium
- *Problem:* isDirty (line 128) serializes a 9-key object for both form and saved with JSON.stringify on every render — including every keystroke in any provider field — and handleSave does another JSON.stringify(form.featureOverrides) twice (line 169). featureOverrides can be a non-trivial object. This is unmemoized work on the hot typing path; it's cheap per call but runs on each render and grows with override count.
- *Fix:* Wrap isDirty in useMemo keyed on the specific form/saved fields, or compare field-by-field (most fields are primitives) and only stringify featureOverrides once. Minor, but removes redundant serialization from the keystroke path.

**PL-31. langColors map literal recreated for every repo on every keystroke**
`src/components/Teams/TeamDetails.jsx:372-385`  —  risk: **none** · confidence: high
- *Problem:* Inside the assign-repository list, the `langColors` object literal is allocated inside the `.map()` callback, so it is rebuilt for each repo AND on every render (the list re-renders on each `selectedRepoToAssign` search keystroke). It is a constant lookup table and never changes.
- *Fix:* Hoist `langColors` to module scope (it has no dependencies). Trivial allocation win and clearer code.

**PL-32. Workflow dispatch refresh uses a blind 2s setTimeout instead of polling actual state**
`src/components/Teams/TeamDetails.jsx:729-744`  —  risk: **low** · confidence: medium
- *Problem:* After triggering a workflow, handleRunWorkflow does `setTimeout(() => fetchWorkflows(repoFullName), 2000)`. GitHub Actions runs frequently take longer than 2s to register, so the refreshed 'Recent Runs' list often misses the just-triggered run, leaving the user thinking nothing happened (no optimistic 'queued' row either). It also fires a full workflows+runs refetch even if the user navigated away.
- *Fix:* Optimistically insert a pending run row, then poll runs a few times with backoff (or until the new run appears) instead of a single fixed delay; guard against the component/selection having changed.

**PL-33. actionableIndices recomputed every render and feeds an effect dep array**
`src/components/ui/ContextMenu.jsx:46-48`  —  risk: **low** · confidence: high
- *Problem:* `actionableIndices` is rebuilt with a map+filter over all items on every render (line 46-48, not memoized) and is then listed in the keydown effect's dependency array (line 214). Because it's a fresh array each render, the keydown effect tears down and re-adds its capturing window listener on every render of the menu (including on every hover/focus state change, which are frequent). For a menu this is small, but it is needless work and a fresh global listener churn on each keystroke/hover.
- *Fix:* Wrap actionableIndices in useMemo([items]) so its identity is stable across hover/focus re-renders, which also stabilizes the keydown effect and stops the per-render listener re-attach.

**PL-34. Toast auto-dismiss timer resets whenever duration identity changes; onDismiss handled via ref but duration not**
`src/components/ui/Toast.jsx:33-49`  —  risk: **low** · confidence: low
- *Problem:* The auto-dismiss effect depends on [duration, id] (line 49). onDismiss is correctly stabilized via a ref to avoid timer resets, but if a parent passes a fresh `duration` (e.g. recomputed inline) the setTimeout is cleared and restarted, so a toast could outlive its intended window or never dismiss if duration churns. Minor, but the ref pattern was applied to onDismiss and not to the equally-volatile duration.
- *Fix:* Capture the initial duration once (it's not meant to change mid-life) — e.g. read it from a ref set on mount, or document that duration must be stable. Low impact; include only if touching this file.

**PL-35. Visibility re-derived from localStorage on every render; subscribed snapshot unused**
`src/hooks/useAIPromoVisibility.js:20-37`  —  risk: **low** · confidence: medium
- *Problem:* The hook subscribes via useSyncExternalStore(subscribe, getSnapshot) but the snapshot return value is explicitly discarded; the actual visibility decision (lines 28-37) re-reads three localStorage keys and parseInt on every render. localStorage reads are synchronous and run on each render of whatever component shows the promo strip. It works, but the external-store value that already encodes the same three keys is wasted, and the decision isn't memoized.
- *Fix:* Compute visibility from the subscribed snapshot string (or memoize the localStorage-derived boolean keyed on the snapshot) so the decision recomputes only when the storage keys actually change, not on every render.

**PL-36. Global keydown listener re-binds on every focus change and every items-array identity change**
`src/hooks/useFocusedRow.js:23-47`  —  risk: **low** · confidence: high
- *Problem:* `handleKey` depends on `[items, focusedIndex]`, so the window `keydown` listener (effect at 44-47) is removed and re-added on every j/k press (focusedIndex changes) and whenever the parent passes a new `items` array reference. For a list view re-rendering frequently this is needless add/removeEventListener churn on a hot path.
- *Fix:* Move `items` and `focusedIndex` into refs (like onOpenRef already is) so `handleKey` can have `[]` deps and the listener attaches once. Read the current values from refs inside the handler.

**PL-37. Multiple auto-fetch effects each wrapped in Promise.resolve().then for no benefit and fire overlapping stats loads**
`src/hooks/useOrgs.js:157-172, 203-207`  —  risk: **med** · confidence: medium
- *Problem:* Three effects (selectedOrg/user→fetchStats, user→fetchOrgs+fetchStats, user→fetchActivity) each defer via `Promise.resolve().then(...)`, which only adds a microtask hop without preventing the cascade. On initial login both the user-effect (line 165) and the selectedOrg-effect (line 157, selectedOrg starts null) call `fetchStats()` with the same empty org, firing two identical /stats requests back-to-back.
- *Fix:* Drop the redundant `Promise.resolve().then` wrappers and dedupe the initial stats load (e.g. let only the selectedOrg effect own stats, or guard the user effect to not also call fetchStats when selectedOrg is already null/about-to-fire).

**PL-38. Global keydown listener re-subscribes on every activeIndex/rows change**
`src/hooks/useRowNavigation.js:20-40`  —  risk: **low** · confidence: high
- *Problem:* The keydown effect lists rows, activeIndex, move, onOpen, onKey as deps, so the window 'keydown' listener is removed and re-added on every arrow-key press (activeIndex changes) and on every rows reference change. For a frequently-navigated list this is needless add/removeEventListener churn on a global target, and inline onOpen/onKey from callers (often unmemoized) make it worse.
- *Fix:* Keep the latest rows/activeIndex/onOpen/onKey in refs (the 'latest ref' pattern already used elsewhere in this codebase, e.g. useKeyboardShortcuts/useContextShortcut) and register the keydown listener once with an empty dep array, reading current values from refs inside the handler.

**PL-39. Intl.NumberFormat instances reconstructed on every call**
`src/utils/format.js:28-51, 62-84`  —  risk: **none** · confidence: medium
- *Problem:* formatNumber and formatCompact build a new Intl.NumberFormat on every invocation. These are called per-row in list/stat surfaces (the file header says 368-component UI) and Intl formatter construction is comparatively expensive vs. .format(). On large repo/stat lists this is repeated work that should be memoized.
- *Fix:* Cache formatters keyed by a stringified options signature (locale + min/max digits + notation) in a module-level Map, returning a memoized formatter. The default-options path (the overwhelmingly common case) then hits a single cached instance.

**PL-40. defaultRepoDescription compiles a RegExp from project name on every call**
`src/utils/migrationDescription.js:40`  —  risk: **low** · confidence: medium
- *Problem:* In the TFVC branch, `new RegExp(`^${escapeForRegex(project)}/?`)` builds and compiles a fresh regex from the project string on each invocation. The function is called by the wizard as an instant AI-off fallback; while not a tight loop, constructing a RegExp where a plain string prefix-strip would do is needless work and a subtle source of ReDoS-shaped surprises if escapeForRegex ever misses a metachar.
- *Fix:* Replace the regex with a literal prefix check: `folder = tfvcPath.replace(/^\$\//,''); if (folder.startsWith(project + '/')) folder = folder.slice(project.length + 1); else if (folder === project) folder = ''`. Avoids per-call RegExp construction entirely.

**PL-41. Recursive SVG sanitizer can blow the JS stack on deep/large model output**
`src/utils/sanitizeSvg.js:23-43`  —  risk: **low** · confidence: medium
- *Problem:* sanitizeNode recurses synchronously per child node with no depth bound. AI/Mermaid output is attacker-influenceable (a model can be coaxed to emit a deeply nested SVG); a pathologically deep tree throws RangeError: Maximum call stack size exceeded, and a very wide tree does O(n) Array.from snapshots per level. Because parseAndSanitizeSvg returns null on failure the caller renders an error placeholder, so this degrades rather than XSS-es, but a single bad diagram can throw an uncaught error in the render path.
- *Fix:* Convert sanitizeNode to an explicit stack/queue iteration (push child element nodes onto a worklist) instead of recursion, and optionally cap node count. Behavior is identical for normal inputs.


---

### ✨ Premium / Professional (86)

#### High · 4

**PH-1. AI 'magic description' button reads wrong response fields and never fills the textarea**
`src/components/CreateRepoModal.jsx:83-99`  —  risk: **low** · confidence: high · verify: confirmed
- *Problem:* handleMagicDescription calls askAI(...) then checks res.error === 'AI_NOT_CONFIGURED' and res?.message. But askAI (src/hooks/useAI.js:43-58) resolves to { reply, actions } and throws typed errors (e.g. AINotConfiguredError) rather than returning an { error, message } object. So on success res.message is undefined and the description is never populated; the not-configured branch is dead code (that case throws and is swallowed by the catch into aiError). The headline AI feature of this modal silently does nothing.
- *Fix:* Use the documented shape: set description from res?.reply (trimmed, de-quoted), and handle the not-configured case via the thrown typed error in catch (e.g. branch on err.code/err.name) instead of res.error.

**PH-2. 'Adjust cap' CTA is a dead no-op — focuses a non-existent #ai-cap-input element**
`src/components/Settings/WorkBoard/ai/WorkBoardCapReachedBanner.jsx:76-78`  —  risk: **low** · confidence: high · verify: confirmed
- *Problem:* The banner's primary recovery action calls document.getElementById('ai-cap-input')?.focus(). No element with id 'ai-cap-input' exists anywhere in the codebase (grep finds the string only in this file). The actual cap control lives in AIAssistantToggle.jsx, which renders the shared <Select> as a <button role="combobox"> with an auto-generated useId — it has no 'ai-cap-input' id. Because of the ?. optional chaining the click silently does nothing: e.preventDefault() runs, the page does not scroll, nothing focuses. The headline call-to-action in a 'you are blocked' banner is broken.
- *Fix:* Give the cap Select a stable, queryable anchor (e.g. wrap it in a div id='ai-cap-input' or pass an id the Select forwards to its trigger button), and scrollIntoView + focus it. Also gate the banner on AI being enabled — the cap control only renders when the toggle is on, so 'Adjust cap' must first ensure the section/toggle is visible.

**PH-3. Dry-run / "Simulate" toggle is purely cosmetic — clicking Simulate performs a real transfer**
`src/components/TransferModal.jsx:32, 92-127, 386-394`  —  risk: **low** · confidence: high · verify: confirmed
- *Problem:* The `dryRun` state only changes the footer summary text (line 143) and the submit button label to "Simulate" (line 171). It is never passed to `onTransfer`/`onMirror`. `handleSubmit` calls `onTransfer?.(repos.map(r => r.full_name), targetOrg, strategies)` with no dry-run flag, and the callers in ModalSurfaces.jsx (`onTransfer={async (repoNames, targetOrg, strategies) => ...}`) never receive it. A user who ticks "Simulate transfer (dry-run)" and clicks the button labelled "Simulate" actually moves the repositories irreversibly. This is a dangerous false-affordance on a destructive, non-undoable action.
- *Fix:* Either (a) thread `dryRun` through: `onTransfer?.(names, targetOrg, strategies, { dryRun })` and have the server/handler short-circuit to a simulation, or (b) if dry-run is not yet implemented end-to-end, remove the toggle entirely until the backend supports it. Do not ship a destructive button that lies about what it does.

**PH-4. Button defaults to type="submit" inside forms (no default type)**
`src/components/ui/Button.jsx:42-62`  —  risk: **low** · confidence: high · verify: confirmed
- *Problem:* Button spreads {...props} onto a native <button> but never defaults `type`. The HTML default for a button without an explicit type is "submit". This shared primitive is used inside <form>-bearing modals (CreateRepoModal, PRTab/CreatePRConfirm, MigrationWizard URL step, etc.) where almost none of the call sites pass type. Any such Button — a Cancel, a secondary action, an AIRunButton (which forwards to Button), even a ghost icon button — will submit the enclosing form and/or trigger an implicit Enter-key submit. This is a classic production footgun that produces accidental submits, double POSTs, and lost form state.
- *Fix:* Default the prop: `function Button({ className, variant='primary', size='md', type='button', children, ...props })` and pass `type={type}` to the <button>. Call sites that genuinely need a submit button already pass type="submit" explicitly, so they keep working; everything else becomes safe by default.


#### Medium · 26

**PM-1. Anthropic (and OpenAI) generateStream ignores parts/systemPrompt/schema — silent feature loss vs generate()**
`server/lib/providers/anthropic.js:342-356`  —  risk: **low** · confidence: medium
- *Problem:* AnthropicProvider.generateStream only accepts { prompt, generationConfig, signal, modelOverride } and builds messages from `prompt \|\| ''`. It silently ignores `parts` (the anti-injection multi-part partitioning that generate() carefully preserves) and `systemPrompt`. OpenAIProvider.generateStream (398-410) has the same gap. Any streaming caller that passes parts/systemPrompt gets neither — the system instruction and the injection-resistant partitioning are dropped without warning. This is both a correctness/UX gap and weakens the documented anti-injection guarantee for streaming paths.
- *Fix:* Accept and honour parts and systemPrompt in both generateStream methods, mirroring generate(): map parts→content blocks and set body.system (Anthropic) / push a system message (OpenAI). If streaming intentionally won't support schema, document that explicitly.

**PM-2. Non-streaming dev-toolkit branches call provider.generate() directly, bypassing the spend-cap + audit guards**
`server/routes/ai/dev-toolkit.js:280-283, 404-407, 518-521, 570`  —  risk: **med** · confidence: high
- *Problem:* shared.js documents guardedGenerate as 'Use this instead of providerGenerateWithRetry / provider.generate for every blocking AI call' so routes 'can't accidentally omit' the OWASP-LLM10 spend-cap check, output-token ceiling, retry, and PII-safe audit. But the non-stream branches of generate-commit (280), generate-pr (404), refine (518), and analyze-context (570) call `req.aiProvider.generate(...)` raw — no spend-cap check, no maxOutputTokens ceiling, no retry, and analyze-context/refine emit only a bare auditLog without buildAIAuditMeta cost data. The streaming branches correctly call denyIfSpendCapReached; the non-streaming twins silently skip it. This is an inconsistent guard surface that defeats the stated design intent and leaves a denial-of-wallet gap on the non-stream path.
- *Fix:* Route the non-streaming branches through guardedGenerate (passing systemPrompt via opts) so they inherit the spend cap, output ceiling, retry, and cost audit uniformly. analyze-context additionally lacks a spend-cap check entirely on a path that does an LLM call after only the count quota.

**PM-3. Inconsistent mock-mode gating across the api slice (DEV-guarded vs not)**
`src/api/aiStatus.js:1-26`  —  risk: **low** · confidence: high
- *Problem:* Mock short-circuits are gated three different ways in this slice: aiStatus.js/teams.js/ai.js gate on MOCK_MODE (VITE_MOCK_MODE === 'true') with NO import.meta.env.DEV guard, while dashboardInbox.js (line 5), attentionFeed.js (line 20) and TrackedReposContext.jsx (line 45) additionally require import.meta.env.DEV. So a production build with VITE_MOCK_MODE=true would serve fabricated teams/AI-status while simultaneously hitting the real network for inbox/attention-feed — an incoherent, hard-to-debug state. The teams.js docstring (line 7) compounds the confusion by describing the gate as `VITE_MOCK_MODE !== 'false'`, which does not match the `=== 'true'` constant it imports.
- *Fix:* Standardize on a single exported helper (e.g. MOCK_MODE already in config, or a MOCKS_ENABLED = import.meta.env.DEV && VITE_MOCK_MODE === 'true') and use it everywhere so production builds can never half-mock. Fix the stale `!== 'false'` comment in teams.js.

**PM-4. Bespoke custom listbox dropdown instead of the shared premium Select component**
`src/components/AIPrompts/PromptPicker.jsx:13-121`  —  risk: **med** · confidence: high
- *Problem:* PromptPicker hand-rolls an entire listbox: open state, click-outside, Escape, arrow/Home/End roving focus, aria-haspopup/controls, z-index, etc. (~110 lines). The project rule is to ALWAYS use the shared premium Select (the codebase already migrated every native/custom select to it — see PromptEditor.jsx and CommunityHealthFixModal.jsx which both use `../ui/Select`). This is a parallel implementation that drifts from the design system: different styling, a raw `▾` glyph trigger, manual a11y that the shared Select already provides, and per-item `tabIndex={0}` which double-tabs through every option.
- *Fix:* Replace the custom dropdown with the shared `Select` from ui/Select, mapping presets to `{ value: String(p.id), label: p.name, ... }`. If the badges (built-in/default/severity floor) need richer option rendering, extend Select's option renderer rather than maintaining a second dropdown.

**PM-5. Refresh wipes the dashboard back to a full skeleton instead of refreshing in place**
`src/components/CommunityHealthDashboard.jsx:132-151, 168-171`  —  risk: **low** · confidence: high
- *Problem:* handleRefresh sets refreshing=true and calls fetchHealth(..., true), but fetchHealth unconditionally calls setLoading(true) at the top. Because showContent = !loading && health, the entire populated dashboard is replaced by the SkeletonState on every manual Refresh, discarding the already-rendered score/metrics. A premium refresh should keep current content visible (the Modal already exposes isBusy and there is a separate refreshing flag and a spinning RefreshCw for exactly this) and swap in new data when it arrives.
- *Fix:* Don't toggle the full-screen `loading` on a refresh: pass the refresh flag through and set `setLoading(true)` only on the initial (non-refresh) load, relying on `refreshing` + the spinning icon for re-fetches so existing content stays mounted.

**PM-6. Hardcoded Portuguese string 'A sincronizar…' in an otherwise English UI**
`src/components/Dashboard/HeroSyncChip.jsx:20`  —  risk: **none** · confidence: high
- *Problem:* The sync chip shows label = syncing ? 'A sincronizar…' : ... — a Portuguese literal in a component whose surrounding labels ('Sync', aria 'Sync now') and the whole dashboard are English. This reads as an untranslated leftover and is inconsistent for a product being prepared for SaaS. The aria-label path stays English, so screen-reader and visual text also diverge.
- *Fix:* Replace with 'Syncing…' (or route through the project's i18n/locale helper used elsewhere, e.g. getDashboardLocale/greeting utils) so visible label and aria-label match and the copy is consistent.

**PM-7. Q&A answers render with no markdown formatting and a non-scrolling streaming view**
`src/components/DevToolkit/ReviewTab/ReviewTab.jsx:159-184`  —  risk: **low** · confidence: medium
- *Problem:* AI review answers are AI-generated prose that almost always contains markdown (lists, code spans, headings), but they render as raw text in a flex chat bubble (`{msg.content}` at line 167). Inline code, lists and code fences appear as literal asterisks/backticks — a polish gap for an AI review tool. Additionally the streaming bubble (line 171) lives inside a `max-h-48 overflow-y-auto` container that does not auto-scroll to the bottom as tokens arrive, so long answers scroll the newest text out of view.
- *Fix:* Render answer content through the app's existing sanitized markdown renderer (the same one used elsewhere for AI output) rather than raw text, and auto-scroll the qaResponses container to bottom on new streamingText (ref + scrollTop = scrollHeight in an effect).

**PM-8. Custom dropdowns lack keyboard navigation and listbox a11y semantics**
`src/components/DevToolkit/shared/BranchSelector.jsx:32-88 (also RepoSelector.jsx:28-78, RepoBadge.jsx:29-96)`  —  risk: **low** · confidence: high
- *Problem:* These bespoke dropdowns render a plain `<button>` trigger and a `<div>` of option `<button>`s with no `role="combobox"`/`role="listbox"`/`role="option"`, no `aria-expanded`, no `aria-activedescendant`, and no arrow-key/Home/End/Escape handling. A keyboard or screen-reader user cannot arrow through branches/repos; they must Tab through every option button. The shared premium Select handles all of this. This is a real a11y regression versus the rest of the design system (the slice's CommandPalette, by contrast, gets full keyboard nav for free via cmdk).
- *Fix:* Adopt the shared Select/combobox (see the dedup finding) which already implements listbox roles and keyboard nav; or, if kept bespoke, add roving-tabindex arrow navigation, Escape-to-close, and the listbox/option ARIA roles.

**PM-9. OAuth popup opens to a hardcoded path before startOAuth, with no popup-block + already-open guard consistency**
`src/components/MigrationWizard/steps/SourceStep/CredentialsForm.jsx:222-228`  —  risk: **med** · confidence: medium
- *Problem:* OAuthSection opens window.open('/api/azure/oauth/start') directly in the idle button, while ConnectionStatusPanel/parent also reference OAuth start; the URL is hardcoded inline rather than centralized, and the popup is opened before startOAuth() so if the user double-clicks they can spawn multiple auth popups. The success/pending/error states are good, but there is no handling for the popup being closed by the user without completing (the 'pending' spinner waits indefinitely until the hook times out).
- *Fix:* Centralize the OAuth start URL in a constant/util, guard against re-opening while status==='pending', and add a 'window closed without finishing' affordance (poll popup.closed or surface a cancel/retry) so the pending state isn't a dead-end spinner.

**PM-10. Bespoke dropdown reimplements the shared premium Select (a11y + behavior gaps)**
`src/components/MigrationWizard/steps/SourceStep/SavedCredentialsPicker.jsx:92-159`  —  risk: **med** · confidence: medium
- *Problem:* The saved-credential picker is a hand-built button+absolute <ul> dropdown. It has no listbox/option ARIA roles, no arrow-key navigation, no type-ahead, no outside-click-to-close, and no focus management — capabilities the shared ui/Select already provides and which SmartSelectMenu had to re-implement by hand too. Project rules require always using the shared premium Select; this is a parallel implementation with weaker keyboard/screen-reader support.
- *Fix:* Reuse ui/Select with custom option rendering (label + prefix + exact-match badge + 'paste different PAT' extraOption/footer slot), mirroring how OrgField composes Select sections/extraOption. If a true custom surface is unavoidable, at minimum add role=listbox/option, aria-activedescendant, arrow-key handling, and an outside-click handler.

**PM-11. On-prem host edit uses a raw native <input>, not the shared form Input/Field**
`src/components/MigrationWizard/steps/SourceStep/ServerPicker.jsx:57-68`  —  risk: **low** · confidence: medium
- *Problem:* The on-prem hostname editor uses a hand-styled native <input> with bespoke focus-ring/border classes rather than the shared ui/form Input component used elsewhere in this very slice (SourceUrlForm, OrgField, PatPasteGuide). This duplicates focus/disabled/error styling, drifts from the design system, and lacks the associated <label>/Field a11y wiring. PatPasteGuide.jsx:225-232 (the save-label input) has the same issue.
- *Fix:* Replace the native <input> with the shared <Input> (and wrap in <Field> where a label applies) so styling, focus-ring, and a11y come from the design system. Keep the onKeyDown Enter/Escape handlers via Input's passthrough props.

**PM-12. Import button stays enabled on a known name conflict**
`src/components/MigrationWizard/steps/TargetConfigStep.jsx:171-181`  —  risk: **low** · confidence: high
- *Problem:* The 'Import Repository' button is disabled purely on `!source.targetName?.trim()` (line 174). When the live duplicate check has already resolved `nameStatus === 'conflict'` (and the Field shows the red 'A repository with this name already exists.' error), the button is still fully enabled and clickable. The user is shown a conflict yet allowed to fire the import, which will then fail server-side — a rough, non-premium flow that wastes a round-trip and produces a confusing late error.
- *Fix:* Disable the button (and skip onStartImport) when `nameStatus === 'conflict'` (or while `nameStatus === 'checking'`), e.g. `disabled={!source.targetName?.trim() \|\| nameStatus === 'conflict'}`. Keep the inline error so the reason is visible.

**PM-13. Duplicate/orphaned label for the Owner Select harms a11y and DS consistency**
`src/components/MigrationWizard/steps/TargetConfigStep.jsx:95-108`  —  risk: **low** · confidence: medium
- *Problem:* The Owner field renders a manual `<label htmlFor="target-config-owner">Owner</label>` (line 96-98) AND passes `label="Owner"` to the shared `<Select>` (line 100). The Select almost certainly renders its own internal label/aria-labelledby, so the page now has two 'Owner' labels, and the manual `htmlFor="target-config-owner"` targets an id the Select trigger may not expose — leaving the explicit label associated with nothing. Screen-reader users hear a doubled/duplicated label and the design-system Select's own labelling is undermined. Other fields in this very file (Repository name, Description) correctly delegate labelling to the `Field` wrapper, so this owner block is inconsistent.
- *Fix:* Drop the manual `<label>` and wrap the Select in the shared `Field` (as the other fields do), or rely solely on the Select's `label` prop. Ensure exactly one accessible label is associated with the control.

**PM-14. Submitted review comments don't appear until manual reload (no optimistic UI / refetch)**
`src/components/PRReview/PRReviewView.jsx:217-232`  —  risk: **low** · confidence: high
- *Problem:* After submitReview() succeeds, doSubmit only dispatches CLEAR_PENDING_COMMENTS. The freshly-posted line comments are never merged into state.comments (the ADD_SUBMITTED_COMMENT reducer case exists in useReviewState.js:135 but is never dispatched) and refetch() is not called. The pending badges vanish but the comments the user just posted to GitHub do not show in the synced thread list, so the surface looks like the comments were lost until the user reloads the page. This is a notable polish/trust gap on the core action of the screen.
- *Fix:* On successful submit, either optimistically dispatch the returned review comments into state.comments (wiring up the existing ADD_SUBMITTED_COMMENT case) or call refetch() to pull the canonical synced threads. A short success toast confirming the posted review would further close the loop.

**PM-15. Webhook creation has no client-side URL validation or feedback**
`src/components/RepoDetail/SettingsTab.jsx:178, 206-220, 380-388`  —  risk: **low** · confidence: medium
- *Problem:* The webhook 'Payload URL' field only gates the Create button on `!hookForm.url` (truthy). There is no validation that it is an absolute https URL, and no inline error feedback — any non-empty string is submitted to api.createWebhook. Compare with the Topics editor right below, which validates against TOPIC_PATTERN and surfaces a clear toast. This reads as inconsistent/amateurish for a security-sensitive field (webhook endpoints), and pushes all rejection to a generic server-error toast.
- *Fix:* Validate the URL on the client before submit (e.g. `new URL(hookForm.url)` and require `https:` protocol), disable Create until valid, and show inline 'Enter a valid https URL' feedback. Server-side validation must remain authoritative, but the client should give immediate, specific feedback like the Topics field does.

**PM-16. Security alerts silently truncated at 20 with no indicator; missing severity-color fallback**
`src/components/security/SecurityScanModal.jsx:42-49, 9-14`  —  risk: **none** · confidence: high
- *Problem:* SourceSection renders `source.alerts.slice(0, 20)` with no 'showing 20 of N' affordance or link out — on a repo with 50 Dependabot alerts the operator silently sees only 20 and may believe the repo is cleaner than it is, which is dangerous for a security surface. Separately, SeverityBadge indexes `colors[level]` with no fallback, so any unexpected level string yields an unstyled (class `undefined`) badge.
- *Fix:* Show the open count vs. displayed count (the summary `${alerts.length} open` is present but the body still hides the remainder) and add a 'View all on GitHub' link or pagination. Add a default entry to the `colors` map.

**PM-17. Override-section open state is initialized once and never reacts to async form hydration**
`src/components/Settings/AIConfig/EmbeddingSection.jsx:20-22`  —  risk: **low** · confidence: medium
- *Problem:* useState(!!form.embeddingProvider) captures the value only on first render. If the AI config form is hydrated from a network fetch after the component mounts (a common pattern — form starts empty, then fills from GET /ai-config), a user who already has a stored embedding override will see the section collapsed with the 'Override embedding provider' checkbox unchecked, hiding their saved configuration until they manually toggle it. There is no effect to reconcile showOverride when form.embeddingProvider transitions from falsy to truthy.
- *Fix:* Derive open-state instead of mirroring it: const showOverride = explicitToggle \|\| !!form.embeddingProvider, where explicitToggle is the only piece kept in state; or add a useEffect that sets showOverride true when form.embeddingProvider becomes truthy. Confirm against the parent AIConfigSection's loading guard.

**PM-18. Keyboard navigation desyncs from rendered list once a tier chip or legacy toggle is applied in the dropdown**
`src/components/Settings/AIConfig/ModelCombobox.jsx:39-41, 65-72, 79-83`  —  risk: **med** · confidence: high
- *Problem:* ModelCombobox owns keyboard highlight and derives itemsInOrder via useFilteredModels(options, { query: value, tier: null, showLegacy: false }) — hardcoding tier:null/showLegacy:false. But ModelDropdown maintains its OWN activeTier and showLegacy state. After a user clicks a tier chip (e.g. 'Reasoning') or expands legacy models, the dropdown renders a different/reordered/smaller set, while ArrowDown/Up + Enter still index into the parent's unfiltered order. The highlighted row and the row that Enter selects can therefore be a different model than the one visually highlighted. The component's own JSDoc (lines 13-18) admits it only matches the 'initial render'.
- *Fix:* Lift the dropdown's activeTier/showLegacy into ModelCombobox (or have ModelDropdown report its current itemsInOrder up via a ref/callback) so the parent's keyboard nav indexes the exact set being rendered. Single source of truth for the ordered list.

**PM-19. Filter change resets page via a second setState effect, causing a double fetch (page=N then page=1)**
`src/components/Settings/AuditLogSection.jsx:97-99, 68-95`  —  risk: **low** · confidence: high
- *Problem:* fetchLogs depends on [page, limit, action, dateFrom, dateTo] and runs whenever any change (effect at line 95). A separate effect (line 98) resets page to 1 when filters change. When the user is on page 3 and changes a filter, fetchLogs first fires with the new filter + page=3, then the reset sets page=1 which fires fetchLogs again — two requests, and the first one can return out-of-range/empty results that briefly flash before the second resolves. There's also no request-cancellation, so a slow first response can land after the second (stale render).
- *Fix:* Collapse filter+page into a single state transition: have the filter onChange handlers set page=1 directly (e.g. setAction(v) -> also setPage(1)) so only one fetch fires, and/or add AbortController cancellation (or adopt useTabData) so the superseded request can't overwrite fresh results.

**PM-20. Native <input>/<label> form fields and a shadow Field component instead of the shared premium form primitives**
`src/components/Settings/AzureCredentialsSection.jsx:356-579, 426-471`  —  risk: **low** · confidence: high
- *Problem:* AddCredentialForm and AddHostForm use raw <input className='w-full px-3 py-2 ... border ...'> and define a local `Field` (line 608) that shadows the shared ../ui/form Field/Input used everywhere else in this slice (ApiKeysSection, AIInstructionsSection, AuditLogSection all import { Field, Input } from '../ui/form'). This is a parallel hand-styled form implementation: it misses the design-system focus ring/error/disabled states the shared Input provides, and duplicates border/padding literals across ~8 inputs. (Note: native <input type=checkbox> is fine; the issue is the bespoke text inputs + local Field, not a native <select>.)
- *Fix:* Import the shared Field/Input from ../ui/form and delete the local Field. Where a password reveal toggle is needed, extend the shared Input (trailingIcon) rather than re-styling a raw input, so focus/error/disabled tokens stay consistent.

**PM-21. LicensePlanSection embeds UsageDashboard, which independently re-fetches usage — uncoordinated double network fan-out and no shared loading state**
`src/components/Settings/LicensePlanSection.jsx:459, 274-301`  —  risk: **low** · confidence: medium
- *Problem:* LicensePlanSection fetches /api/v1/license and /api/v1/billing/subscription, then unconditionally renders <UsageDashboard/> (line 459) which fires its own /api/v1/usage fetch on mount with a separate loading spinner. On a Free/unlicensed view the page shows the plan skeleton resolve, then a second independent spinner pops in below — staggered, janky loading. The two components share no cache and can't show a unified skeleton. UsageDashboard is also rendered even while the parent is still in its own `loading` skeleton branch.
- *Fix:* Lift the usage fetch to a shared hook/SWR-style cache (or fetch usage in the parent and pass as a prop), and gate <UsageDashboard/> behind the parent's resolved state so the two loads present as one coordinated skeleton rather than two staggered spinners.

**PM-22. Setup shows fabricated step progress unrelated to real backend state**
`src/components/Setup/SystemSetup.jsx:15-47`  —  risk: **med** · confidence: medium
- *Problem:* startSetup fires one POST /api/system/setup, then advances steps 2->3->4 purely on `await wait(1000)` timers ('Simulate progress matching backend simulation'). The 'Creating SQLite Database', 'Running Migrations', and 'Verifying Security' rows turn green on a fixed timer regardless of whether those backend phases actually succeeded — only the initial POST's `res.ok` is checked. If migrations fail server-side after the 200, the UI still shows all-green and 'Launch Workspace'. This is a trust/honesty gap on a critical bootstrap screen.
- *Fix:* Drive step status from real backend signals (stream progress, or poll a status endpoint), or at minimum collapse the fake multi-step theater into a single honest 'Initializing…' state so a post-POST failure can't be masked by timers.

**PM-23. Field silently drops label association and aria wiring when given multiple/non-element children**
`src/components/ui/form/Field.jsx:42-53`  —  risk: **low** · confidence: medium
- *Problem:* Field uses Children.only(children) inside isValidElement and cloneElement to inject id + aria-describedby (lines 42-53). If a caller passes more than one child, Children.only throws at render (crashing the form); if the single child is not a valid element (a string, a fragment, or a component that doesn't forward id/aria-describedby to its DOM node), the clone path is skipped and the <label htmlFor={controlId}> points at an element that never receives that id — so clicking the label does nothing and screen readers lose the control association, with no warning. Given Field is the canonical form wrapper, this is a quiet a11y/robustness gap.
- *Fix:* Guard explicitly: if Children.count(children) !== 1 or the child isn't a valid element, render children as-is but warn in DEV that label/aria wiring was skipped; document that the child must forward `id`/`aria-describedby` to its underlying control. Optionally fall back to wrapping the label around the control when no id can be threaded.

**PM-24. Custom Select listens on mousedown only — no touch/pointer outside-close, and search has no debounce on large lists**
`src/components/ui/Select.jsx:97-126`  —  risk: **low** · confidence: medium
- *Problem:* The outside-click-to-close handler only registers `mousedown` (line 106). On touch devices a tap outside the open dropdown does not always emit a synthetic mousedown before other handling, so the dropdown can stay open on mobile (the rest of the codebase, e.g. AIQuotaMeter, also uses mousedown, but ContextMenu/Tooltip moved to pointerdown for exactly this reason). Separately, the searchable filter runs a full toLowerCase().includes scan over every option on each keystroke with no virtualization/debounce; for the large option lists this Select is built to support (it ships skeletons + sections + search precisely for big sets) that is O(n) per keystroke on the main thread.
- *Fix:* Switch the outside handler to `pointerdown` to match the menu/tooltip primitives and reliably close on touch. For large lists, debounce searchQuery (or memoize the lowercased option labels once) so per-keystroke work is bounded.

**PM-25. Filter bar renders every repo/author/label as a chip with no overflow cap**
`src/components/WorkBoard/filters/WorkBoardFilterBar.jsx:37-70`  —  risk: **low** · confidence: medium
- *Problem:* WorkBoardFilterBar maps availableRepos, availableAuthors, and availableLabels directly to FilterChip with no limit. availableLabels in particular is flatMap of all labels across every PR/issue/debt item and can easily be dozens of values; for a user tracking many repos this produces a wall of chips that wraps over many rows and pushes content down, with no 'show more'/search affordance. Contrast ManageReposButton which correctly caps at TOP_N=10 with search.
- *Fix:* Cap each dimension (e.g. first N by frequency/recency) with a '+X more' expander, or move high-cardinality dimensions (labels, authors) into a searchable shared Select/Combobox like ManageReposButton already does for repos.

**PM-26. Command-palette 'Save preset' action falls back to window.alert()**
`src/components/WorkBoard/WorkBoardPage.jsx:182-189`  —  risk: **low** · confidence: high
- *Problem:* The WORKBOARD_SAVE_PRESET handler calls window.alert('Use the Presets dropdown...'). A native alert is a jarring, unstyled, blocking modal that breaks the premium feel and is inconsistent with the app's toast/Modal system used everywhere else. The inline comment even acknowledges it as a 'lightweight first pass'.
- *Fix:* Replace window.alert with a toast.info (useToast) or actually open the PresetDropdown via a shared event/ref. At minimum use the design-system toast so the message is non-blocking and styled.


#### Low · 56

**PL-1. Workflow name discarded (stored as empty string) in workflows_meta**
`server/actions-service.js:300-326`  —  risk: **low** · confidence: high
- *Problem:* updateWorkflowMeta inserts workflows_meta with `name` hardcoded to '' (line 305) and never sets it on conflict either. The workflow's human-readable name is available on the run rows (workflow_name) and on the GitHub API response, but the meta table — which the UI reads for workflow listings — ends up with blank names. Reads amateurish: the dashboard shows empty/unknown workflow names.
- *Fix:* Pass the workflow name through (e.g. SELECT MAX(workflow_name) in the aggregate, or accept a name arg from syncWorkflowRuns) and write it into both the INSERT and the ON CONFLICT update.

**PL-2. Hard-coded placeholder defaults (example.com emails, Date.now() branch names) leak into generated artifacts**
`server/lib/ai-features/community-health-fix.js:247, 76, 144`  —  risk: **med** · confidence: medium
- *Problem:* `generateCodeOfConduct` defaults contact to `admin@example.com`, `generateSecurityMd` to `security@example.com`, and the PR-fallback branch is `chore/community-health-fixes-${Date.now()}`. If callers don't pass an email, the committed CODE_OF_CONDUCT/SECURITY files ship with a non-functional `example.com` address — an unprofessional artifact in the user's public repo. `Date.now()` branch names are also non-deterministic/un-idempotent (re-running creates a new branch each time, and rapid double-clicks can collide within the same ms).
- *Fix:* Require/validate a real contact email (or derive from the authenticated user/org) and fail clearly rather than silently committing example.com; make the branch name deterministic per file/run (e.g. include the file slug and a content hash) so retries are idempotent.

**PL-3. Azure credential host validation accepts ports but the SSRF allowlist relies on a separate validator — mismatch risk + IPv6 not allowed**
`server/lib/azure-credentials-manager.js:27 / 103`  —  risk: **low** · confidence: medium
- *Problem:* create() validates host against HOST_RE (line 27) which requires at least one dot and allows a port, but the actual SSRF/allowlist gate is azure-host-validator.isAllowedHost (different regex, also accepts bracketed IPv6). A host accepted here (e.g. a public hostname with a port) may later be rejected by the allowlist at use-time, or vice-versa, producing a credential the user can save but never use — a confusing dead-end with no feedback at save time. The two regexes are near-identical copies (PATTERN_RE in azure-host-validator vs HOST_RE here) that can drift.
- *Fix:* Validate the host on save through the same isAllowedHost/hasSafeHostShape used at request time (or at least share the one regex constant), and surface 'host not on allowlist' as a save-time validation error so the user gets immediate feedback instead of a later failure.

**PL-4. Digest aggregators swallow every error with empty catch blocks, masking missing-index or schema regressions**
`server/lib/notifications-digest.js:60-129`  —  risk: **none** · confidence: high
- *Problem:* All four aggregate* helpers wrap their query in `try { ... } catch { return [] }`. A genuinely broken query (renamed column, dropped table, missing index causing a timeout) silently yields an empty category, so the user sees 'nothing new' and operators get no signal. This is the same anti-pattern across reviews/issues/failed-migrations/stale-pinned, so a single schema drift can blank the whole bell with zero log output.
- *Fix:* Log the caught error at warn level (with the category name) before returning the empty array, so a regression is visible in logs/Sentry while the UI still degrades gracefully. Keep the empty-array fallback for resilience.

**PL-5. Longest-prefix pricing match silently over/under-prices unlisted variants with no signal that an estimate was used**
`server/lib/provider-pricing.js:70-81`  —  risk: **low** · confidence: medium
- *Problem:* lookupByPrefix matches by startsWith, so e.g. 'gemini-2.5-flash-lite' (cheaper) is priced at 'gemini-2.5-flash' rates, and any unlisted model falls back to FALLBACK_PRICING. computeCostUSD/estimateCallCostCents return a number with no indication it was a guess, so cost-cap accounting and any UI surfacing costUSD present an estimate as if it were exact. For a billing-adjacent feature this reads as imprecise.
- *Fix:* Return a small flag/metadata from getPricingForModel (e.g. { input, output, estimated:true } when falling back or prefix-matching) and let callers mark the displayed/persisted cost as approximate. At minimum add the most common cheaper variants (gemini-2.5-flash-lite, gpt-4o-mini already present) to the table.

**PL-6. AI fact sheet embeds untrusted PR/issue titles into the prompt with no delimiting (prompt-injection surface)**
`server/lib/work-board-summary.js:82`  —  risk: **low** · confidence: medium
- *Problem:* buildFactSheet interpolates raw repo names, PR/issue titles and author logins straight into the prompt lines (e.g. `${r.repoFullName}#${r.prNumber} "${r.title}"`). Titles are attacker-controllable (anyone who can open a PR/issue in a tracked repo). A crafted title like '" ignore previous instructions and ...' can steer the summary model. attention-narrative.js has the same exposure via JSON.stringify(signal) but is somewhat safer because it is JSON-quoted. This is a quality/trust gap for a premium AI feature rather than an RCE-class bug.
- *Fix:* Wrap user-derived content in an explicit, clearly-fenced data block (e.g. a single JSON payload the system prompt declares as untrusted data, never instructions) and add a system-prompt line stating that repository content is data to summarize, not commands to follow. Keeps the model on-task when titles are adversarial.

**PL-7. Checkout rejects unconfigured price with a 400 that leaks tier-config gaps and lacks an actionable code**
`server/routes/billing.js:23-65`  —  risk: **low** · confidence: medium
- *Problem:* If the requested tier's Stripe price isn't configured, the endpoint returns 400 { error: `Price not configured for ${tier} tier` }. This surfaces an operator/server misconfiguration as a client-facing 4xx with no machine-readable code, so the frontend can't distinguish 'you sent a bad tier' from 'billing isn't fully set up on this deployment'. Compared to the rest of the codebase (which uses { error, code } envelopes via errorResponse), this is inconsistent and reads as a server-config 500-class condition mislabeled as a client error.
- *Fix:* Return 503 with a stable code (e.g. { error: 'Billing not fully configured for this tier', code: 'price_not_configured' }) so the UI can show a 'billing temporarily unavailable' state rather than a validation error, and adopt the shared errorResponse helper for consistency.

**PL-8. PR write-back endpoints document themselves as 'Pro+ tier-gated' but have no requireTier**
`server/routes/repos/pulls.js:113,276,326,361`  —  risk: **none** · confidence: high
- *Problem:* The file header (lines 18-20) and inline comments on merge (113), create-comment (276-277), replies (326) and submit-review (361-362) all assert these are 'tier-gated as Pro+' / 'available on ALL tiers'. The actual handlers only use requireAuth — no requireTier anywhere in pulls.js (confirmed: requireTier is imported only in v1/repos-security.js and repos-sync.js). The comments contradict each other AND the code. Either the gating was dropped or the comments are stale; in both cases the comments are now actively misleading for anyone reasoning about billing/entitlements.
- *Fix:* Decide the intended policy. If write-back is genuinely free on all tiers (which the header also claims), delete the contradictory 'Pro+ tier-gated' comments. If it should be gated, add requireTier('pro') to merge/comments/replies/reviews. Do not leave the comments asserting a control that isn't there.

**PL-9. Per-request webhook_connected probe queries the DB on every my-reviews call**
`server/routes/work-board.js:168-172`  —  risk: **low** · confidence: medium
- *Problem:* Every GET /my-reviews runs `SELECT 1 FROM webhook_events LIMIT 1` (line 170) wrapped in a try/catch purely to set a boolean `webhookConnected` flag in meta. This is a fixed extra query on a hot dashboard path whose result changes very rarely (it only flips from false→true once webhooks start arriving). It also uses an empty `catch {}` that silently swallows all errors, masking real DB problems. Notably none of the other tabs (my-issues, stale-prs, tech-debt) expose this flag, so it is also an inconsistency.
- *Fix:* Cache the webhook-connected boolean in-process with a short TTL (e.g. memoize for 60s) instead of querying per request, or compute it once at the meta-assembly layer shared by all tabs. Log (debug-level) inside the catch rather than swallowing silently.

**PL-10. limit query param interpolated without coercion/clamping**
`src/api/attentionFeed.js:32`  —  risk: **none** · confidence: medium
- *Problem:* fetchAttentionFeed builds `?limit=${limit}` by direct interpolation. limit defaults to 5 but is caller-supplied and never coerced to an integer or clamped to a sane max. A caller passing a non-numeric or huge value forwards it verbatim to the server; if the endpoint trusts it, this is an unbounded-payload / weak-input-validation smell on a dashboard fan-out surface. Same shape in workBoardTracking.searchRepos (q is encoded but unbounded) and dashboardInbox sections join.
- *Fix:* Coerce and clamp client-side: `const n = Math.min(50, Math.max(1, Number(limit) \|\| 5))` before building the URL. Cheap defense-in-depth even though the server should also validate.

**PL-11. exportMetadata filename parsing breaks on RFC 5987/quoted-with-escapes headers**
`src/api/repos.js:59-65`  —  risk: **none** · confidence: medium
- *Problem:* The download path parses Content-Disposition with /filename="(.+?)"/ (line 64). This non-greedy match fails for filenames containing an escaped quote and ignores the `filename*=UTF-8''...` (RFC 5987) form entirely, silently falling back to `${repo}-export.json`. Minor, but it is the kind of rough edge that produces wrong filenames for non-ASCII repo names on a paid export feature.
- *Fix:* Prefer the `filename*=` token (decodeURIComponent of the RFC 5987 value) when present, fall back to the quoted form, and strip surrounding quotes. A small shared parseContentDisposition util would also serve any other blob downloads.

**PL-12. Entire app shell is one ~470-line AppContent component with no error boundary around the main view tree**
`src/App.jsx:75, 935-945`  —  risk: **low** · confidence: medium
- *Problem:* AppContent holds ~30 useState/useRef/useMemo hooks and renders the whole authenticated shell. The per-view ViewShell blocks (dashboard, teams, work-board, prompt-studio, admin-dlq, pricing, roadmap on lines 670-845) are NOT individually wrapped in ErrorBoundary — only 'repos' (725) and 'repo-detail'/'System Setup' get a ViewErrorFallback. A render-time throw in DashboardPremium, TeamHub, WorkBoardPage, PromptStudioPage or AdminDLQPage therefore unmounts the entire shell to the top-level ErrorBoundary (blank app) instead of degrading to a per-view fallback like the repos view does. Inconsistent resilience across routes for a 'premium' SaaS shell.
- *Fix:* Wrap each ViewShell render branch (or ViewShell itself) in an ErrorBoundary with a ViewErrorFallback({ viewName }) the way the repos and System Setup branches already do, so a single view crash contains itself.

**PL-13. GitHub compare hint is non-clickable text and builds a malformed multi-segment URL**
`src/components/AI/CompareDiffModal.jsx:191-194`  —  risk: **low** · confidence: high
- *Problem:* The footer renders a github.com compare URL inside a `<code>` as plain text (not a link), so the user has to hand-copy it. Worse, the URL is assembled with `targetDisplay.replace('/', ':')` — String.replace with a string arg replaces only the FIRST '/', so an owner/name target produces `owner:name` correctly but any value containing extra slashes breaks, and the `sourceLabel` segment is interpolated raw without encoding. It reads as a polished affordance but doesn't actually function as one.
- *Fix:* Make it a real anchor (target=_blank, rel=noopener noreferrer) with a properly constructed/encoded href, or remove the pseudo-link. Use a correct compare URL form (`github.com/<owner>/<repo>/compare/main...<targetOwner>:<targetRepo>:main`) built from the parsed parts rather than string.replace.

**PL-14. File search is silently capped at 100 results with no empty-state or 'more results' affordance**
`src/components/AI/FileTreePicker.jsx:41-46, 76-90`  —  risk: **low** · confidence: medium
- *Problem:* filtered slices results to the first 100 with no indication when matches were truncated, and there is no empty-state when a query matches nothing (the `<ul>` just renders empty). On a large repo a user searching for a file that ranks past the first 100 alphabetical matches gets a confusing blank/partial list with no feedback. The `data?.truncated` notice only covers the server-side 500-file cap, not the client-side 100 slice.
- *Fix:* Show an explicit empty-state row ('No files match "<query>"') and, when `filtered` is capped, a 'showing first 100 of N matches — refine your search' hint. Consider raising or virtualizing the list since it's already overflow-scroll.

**PL-15. Clipboard copy has no error handling or fallback; can silently fail and still show 'Copied'**
`src/components/AI/ReadmeEnhanceDiffPanel.jsx:72-77`  —  risk: **low** · confidence: high
- *Problem:* handleCopy calls `navigator.clipboard.writeText(enhanced)` without awaiting or catching, then unconditionally sets `copied=true`. `navigator.clipboard` is undefined on insecure origins and the promise rejects when the document isn't focused or permission is denied — in those cases the UI shows the 'Copied' confirmation even though nothing was copied, which is misleading for a premium surface. The enhanced README can be large, so a silent failure is a real UX trap.
- *Fix:* Await the write inside try/catch (or use a shared copy-to-clipboard util with a document.execCommand fallback); only flip `copied` on success and surface a toast on failure.

**PL-16. Filter tabs are hand-rolled buttons with raw lowercase labels and ad-hoc active styling, inconsistent with the design system**
`src/components/AIPrompts/PromptLibrary.jsx:32-42`  —  risk: **low** · confidence: medium
- *Problem:* The all/builtin/custom/org filter renders `{f}` directly (so the UI literally shows lowercase 'builtin', 'org'), with a bespoke `bg-blue-600 text-white` active state that uses a raw blue rather than the `--ds-accent-brand` token used elsewhere in this slice. It's a small but visible polish gap on a Pro-facing management surface, and reimplements a segmented-control/tabs pattern the design system likely already provides.
- *Fix:* Use a shared segmented-control/Tabs primitive (or at minimum a label map for human-readable names and the ds accent token for the active state) so the Prompt Studio matches the rest of the app's premium tabs.

**PL-17. Banner truncates and hides the only actionable explanation on small screens**
`src/components/BYOKUpgradeBanner.jsx:72-78`  —  risk: **none** · confidence: medium
- *Problem:* The message wrapper uses `truncate` on the <p>, and the explanatory half ("Configure it in Settings -> AI Configuration. If a shared server key is configured...") is `hidden sm:inline`. On mobile the user sees only "AI features now use your own provider key (BYOK)." with no hint of what to do or that things still work — and `truncate` will clip even that on narrow viewports. For a one-time onboarding nudge this is the worst place to drop the call-to-action context.
- *Fix:* Drop `truncate` (allow the line to wrap to 2 lines) and replace `hidden sm:inline` with a responsive wrap rather than full removal, or move the secondary copy into a tooltip/expandable so mobile users still get the guidance. The "Configure now" CTA is present, but the reassurance that features keep working should not be desktop-only.

**PL-18. handleFix maps a file label to a fixer, but the 'Fix with AI' button can show for unmappable files**
`src/components/CommunityHealthDashboard.jsx:159-166`  —  risk: **low** · confidence: low
- *Problem:* FileCheckItem only shows the Fix button when FILE_TYPE_BY_LABEL[file] is truthy (line 374), yet handleFix re-checks and falls back to toast.info(`No AI generator wired for ${fileLabel} yet`). The label set GitHub returns (e.g. 'Issue templates', 'Pull request template') doesn't always match the keys in FILE_TYPE_BY_LABEL, so some missing community files render no actionable Fix button at all while others do — inconsistent affordance with no explanation to the user.
- *Fix:* Normalize GitHub's community-profile labels to the registry keys in one place (extend FILE_TYPE_BY_LABEL or add an alias map) so coverage is consistent, and when a file genuinely has no generator, show a subtle disabled/'coming soon' state rather than silently omitting the action.

**PL-19. AI narrative fan-out has no per-row error/timeout feedback; failures silently render nothing**
`src/components/Dashboard/AttentionFeed.jsx:145-175`  —  risk: **low** · confidence: medium
- *Problem:* In the sequential narrative loop, any non-quota error sets next[it.id] = { text: null, loading: false } with no distinction between 'AI returned no narrative' and 'request failed'. Combined with the row render (AttentionFeed AttentionRow: only shows narrative when narrative.text is truthy), a transient failure just shows no AI line with no indication anything was attempted. For a premium AI feature this reads as flaky. There is also no timeout, so a hung request leaves that row's shimmer until the component unmounts (cancelled only on unmount/dep change).
- *Fix:* Distinguish error from empty (e.g. settle { text: null, error: true }) and optionally show a subtle 'AI summary unavailable' affordance or retry, matching the InboxRow pattern which already prints 'No AI summary available'. Consider an AbortSignal-based timeout per request.

**PL-20. Migration widget swallows fetch errors into the same 'No migrations yet' empty state**
`src/components/Dashboard/MigrationActivity.jsx:69-77`  —  risk: **low** · confidence: medium
- *Problem:* On fetch failure the catch is a silent no-op and finally sets loading=false, so a network/server error renders the identical 'No migrations yet' EmptyState as a genuinely empty account. The user can't tell 'you have no migrations' from 'we failed to load your migrations', and there's no retry affordance. The comment claims errors surface via toast+Sentry, but .then(r => r.json()) without checking r.ok means a 4xx/5xx HTML/error body is parsed as JSON and may resolve to a truthy non-stat object or throw — behavior is inconsistent.
- *Fix:* Track an error state; check r.ok before r.json(); render a distinct error tile with a retry button when the load fails, separate from the legitimate empty state.

**PL-21. fetchRepoStyle swallows non-ok responses and sets a confusing error only on throw**
`src/components/DevToolkit/CommitTab/CommitTab.jsx:60-73`  —  risk: **low** · confidence: medium
- *Problem:* `fetchRepoStyle` returns null on `!res.ok` without surfacing anything, but sets `localError('Failed to fetch repo commit style')` only in the network `catch`. So a 403/500 from the style endpoint silently produces no style and no feedback, while a thrown network error shows an error toast even though generation may still proceed with the default format. The two failure modes are handled inconsistently, and the user gets no signal that 'Repo Convention' formatting silently fell back.
- *Fix:* Route through the shared apiCall (which classifies errors uniformly) and decide one behavior: either surface a non-blocking 'couldn't load repo style, using default' notice for both !ok and thrown cases, or treat both as a silent fallback. Don't split the two.

**PL-22. clipboard.writeText calls have no error handling or fallback**
`src/components/DevToolkit/PRTab/PRTab.jsx:149 (also StreamingOutput.jsx:11, MultiCommitSplit.jsx:12/19, OutputSection.jsx:9, SectionCard.jsx:14)`  —  risk: **low** · confidence: high
- *Problem:* Every copy affordance calls `navigator.clipboard.writeText(...)` without awaiting or catching. `writeText` returns a promise that rejects in insecure (non-HTTPS) contexts, when the document isn't focused, or when permission is denied. On rejection the UI still flips to the 'Copied!' state (the setTimeout-based success indicator fires unconditionally), so the user is told the copy succeeded when it didn't — and an unhandled promise rejection is logged. PRTab.handleCopyAll, StreamingOutput, MultiCommitSplit, OutputSection and SectionCard all share this.
- *Fix:* Wrap in a shared `copyToClipboard(text)` helper that awaits writeText, returns success/failure, and only sets the 'Copied!' state on success (with a toast on failure). Reuse across all copy buttons in the slice.

**PL-23. Create-PR success falls back to a non-existent /pulls page URL**
`src/components/DevToolkit/PRTab/PRTab.jsx:194, 311`  —  risk: **low** · confidence: medium
- *Problem:* On create, if `data.pull_request?.html_url` is missing the code falls back to `https://github.com/${owner}/${repo}/pulls` (line 194). `/pulls` (plural) is the list page, but the success affordance labels it 'View PR on GitHub ->' (line 311), so the user is sent to the repo's PR list rather than their new PR — a confusing dead-end when the API response shape is unexpected. The same fallback is stored into `generatedPR.url`, which ReviewTab later keys off.
- *Fix:* Only render the 'View PR' link when a real html_url is present; otherwise show a neutral 'PR created' confirmation without a misleading link. Avoid fabricating a /pulls URL.

**PL-24. Footer hardcodes 'Vite 7' while Hero reads version from env and project is Vite 8**
`src/components/Landing/LandingPage.jsx:45`  —  risk: **none** · confidence: high
- *Problem:* LandingFooter prints a hardcoded stack string 'React 19 + Vite 7 + Tailwind CSS v4'. The project is on Vite 8 (per the brief) and HeroSection already sources the app version dynamically from `import.meta.env.VITE_APP_VERSION`. The footer literal is stale and will keep drifting on every major bump.
- *Fix:* Either drop the version numbers from the footer tagline or source them from a single constant/env so they can't go stale.

**PL-25. Hourly setInterval runs for every tab regardless of whether a license can expire**
`src/components/LicenseBadge.jsx:46-49`  —  risk: **low** · confidence: medium
- *Problem:* A `setInterval(... , 3600000)` to refresh `now` is installed unconditionally on mount (line 46-49), even when there is no license, no `expiresAt`, or the tier is Free/Demo — i.e. when `daysUntilExpiry` is always null and the recompute changes nothing. It is harmless per-tab but is needless background work in a component that mounts on every authenticated page load, and it keeps a timer alive forever on long-lived tabs for no benefit in the common (non-expiring) case.
- *Fix:* Gate the interval on having an expiry that matters: only install it when `info?.expiresAt` is set (and optionally only when within, say, 60 days of expiry). When there's nothing time-sensitive to recompute, skip the timer entirely.

**PL-26. Re-run / Resume / Export actions swallow all errors silently**
`src/components/MigrationHistory.jsx:136-167`  —  risk: **low** · confidence: medium
- *Problem:* handleRerunPlan, handleResumePlan, and handleExportReport all end in `catch { /* ignore */ }`. A user clicking Re-run or Resume on a failed plan gets zero feedback if the request fails (no toast, no inline error), and Export silently produces nothing on failure. For destructive/expensive actions in a production tool this reads as unresponsive and erodes trust.
- *Fix:* Surface failures via the existing toast system (the component already imports nothing for toasts — wire useToast) so re-run/resume/export errors show an actionable message; optionally show a success toast on completion.

**PL-27. MigrationHistory uses Portuguese copy and dark-only colors, breaking the design system**
`src/components/MigrationHistory/MarksDetailModal.jsx:20, 40, 67, 70; MarksBadge.jsx 5-23, 36`  —  risk: **none** · confidence: high · verify: adjusted
- *Problem:* Two issues in one slice. (1) i18n: user-facing strings are in Portuguese in an otherwise all-English product — MarksBadge 'Sem tags' (line 36), MarksDetailModal '— nada escrito' (line 20). (2) These components hardcode dark-mode-only palettes with NO `dark:` variants or light equivalents: `text-emerald-300/amber-300/rose-300/slate-300` (MarksBadge VARIANTS), `bg-slate-900/90`, `text-slate-100`, `text-slate-200`. Unlike every other component in the slice (which pairs e.g. `text-slate-900 dark:text-slate-100`), these assume a dark background unconditionally, so in light mode the modal body and badge text are low-contrast/unreadable.
- *Fix:* Translate the two Portuguese strings to English ('No tags', 'nothing written'). Add light-mode color pairs to MarksBadge VARIANTS and the modal surfaces (e.g. `bg-emerald-500/15 text-emerald-700 dark:text-emerald-300`), matching the slate-pairing convention used everywhere else.
- *Verifier (severity adjusted):* Both sub-claims are REAL and verified in live, rendered code (MigrationHistory.jsx imports/renders both at lines 15-16, 26-35). (1) i18n: Portuguese strings confirmed - MarksBadge.jsx line 34 'Sem tags' (finding said line 36; minor line drift) and MarksDetailModal.jsx line 20 '— nada escrito'. The modal string is reachable for any empty scope; the badge 'Sem tags' path is gated by 'if (!marks.length) return null' in the cell but the exported component still contains it. (2) Dark-only palette confirmed: Grep found ZERO 'dark:' usages in the entire MigrationHistory directory, while the rest of the codebase pairs light+dark heavily (44+ 'text-slate-900 dark:text-slate-100', 131+ 'dark:text-slate'). Light mode is genuinely toggleable (useTheme.jsx adds/removes '.dark' on documentElement), so MarksBadge variants like 'text-emerald-300' on a light page are low-contrast - a legitimate readability concern. One overstatement: the modal hardcodes its OWN dark surface (bg-slate-900/90), so its body text is not 'unreadable' - it's a dark island in light mode (a DS inconsistency, not a contrast failure). Net: real but mis-rated. These are purely cosmetic copy + theme-pairing issues with no functional, security, data, or crash impact, so 'high' is too strong; correct severity is low.

**PL-28. Mixed-language UI strings (Portuguese 'Progresso' / 'A validar credenciais') in an otherwise English wizard**
`src/components/MigrationWizard/Steppers.jsx:163, 312`  —  risk: **none** · confidence: high
- *Problem:* The sidebar progress header hardcodes 'Progresso' (L231) and the JSDoc/example for currentStepStatusDetail references 'A validar credenciais…' while every other label in this slice (STEP_LABELS, STEP_HINTS, STEP_META, ConnectionStatusPanel copy) is English. For a product transforming into a paid SaaS this inconsistent localization reads as unpolished and there is no i18n layer to justify the single Portuguese string.
- *Fix:* Replace 'Progresso' with 'Progress' (or route all wizard copy through a single i18n/strings module if localization is a real requirement). Align the status-detail strings produced by useWizardStepStatus with the same language.

**PL-29. User-supplied regex compiled and run on every keystroke with no debounce / ReDoS guard**
`src/components/MigrationWizard/steps/RepoSelectStep/PatternSelectModal.jsx:10-19`  —  risk: **low** · confidence: medium
- *Problem:* PatternSelectModal compiles `new RegExp(pattern, 'i')` and runs it against every repo name inside a useMemo that recomputes on each keystroke. A catastrophic-backtracking pattern (e.g. (a+)+$) typed against many repos can freeze the UI thread. The 100-char cap helps but does not bound backtracking. There is no debounce, so every character triggers a full repos.filter pass.
- *Fix:* Debounce the pattern input (e.g. 150-200ms) before compiling, and/or run matching with a small time budget or a known-safe regex engine guard. At minimum cap the repo set scanned per keystroke or memoize compiled regex separately from the filter pass.

**PL-30. parseAzureUrl re-run on every render for the badge instead of reusing the hook's parsed preview**
`src/components/MigrationWizard/steps/SourceStep/SourceUrlForm.jsx:21-22`  —  risk: **low** · confidence: medium
- *Problem:* SourceUrlForm calls parseAzureUrl(smartPasteValue) inline on every render (for parsedBadge/showParseError), while useSourceStepForm already parses the same value to produce urlPreview. This re-parses the URL on each keystroke/re-render and creates two parsing code paths for the same input, risking divergence between the inline error and the hook's preview. Not memoized.
- *Fix:* Surface the parse error from the hook alongside urlPreview (the hook already parses) and pass it down as a prop, removing the inline parseAzureUrl call. If kept inline, wrap in useMemo keyed on smartPasteValue.

**PL-31. Visibility toggle buttons missing aria-pressed / radiogroup semantics**
`src/components/MigrationWizard/steps/TargetConfigStep.jsx:133-156`  —  risk: **none** · confidence: high
- *Problem:* The Private/Public visibility selector is a pair of plain `<button>`s whose selected state is conveyed only by Tailwind color classes (lines 134-156). There is no `aria-pressed` (toggle) or `role="radio"`/`role="radiogroup"` semantics, so assistive tech cannot announce which option is active — the selection is a purely visual affordance. This is a recurring accessibility pattern gap; the AzureTargetForm ModeCards (same file tree) have the same issue.
- *Fix:* Add `aria-pressed={source.makePrivate}` / `aria-pressed={!source.makePrivate}` to the two buttons (or model them as a `role="radiogroup"` with `role="radio"` + `aria-checked`). Apply the same to AzureTargetForm's ModeCard buttons.

**PL-32. Raw checkmark glyph instead of design-system icon for success state**
`src/components/MigrationWizard/steps/TargetConfigStep/AzureTargetForm.jsx:246-248`  —  risk: **none** · confidence: medium
- *Problem:* The new-project success message renders a literal `✓` text character (line 247) rather than a lucide `CheckCircle2` icon used everywhere else in this slice (e.g. TargetConfigStep line 82, AIReviewStep line 353). Inline unicode glyphs render inconsistently across fonts/platforms and break the otherwise consistent iconography, reading as unpolished.
- *Fix:* Replace the `✓ ` prefix with an inline `<CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />` next to the text, matching the rest of the wizard's success affordances.

**PL-33. same-project / existing-project / new-project modes have no validation gate or name-conflict feedback**
`src/components/MigrationWizard/steps/TargetConfigStep/AzureTargetForm.jsx:93-110`  —  risk: **low** · confidence: medium
- *Problem:* Unlike the GitHub form (which debounce-checks the target name against existing repos and surfaces conflict status), the Azure SameProjectForm/ExistingProjectForm just collect a free-text `azureTargetRepoName` with zero conflict detection against the destination project's existing repos — even though useAzureProjectData already exposes `azureProjectRepoNames` for exactly this local, debounce-free check. A user can type a name that already exists in the target Azure project and get no feedback until the migration fails. Inconsistent rigor between the two destination families.
- *Fix:* Feed the destination project's existing repo-name Set (via useAzureProjectData) into these forms and show the same clear/conflict trailing indicator the GitHub form uses, reusing useRepoNameConflicts' local-Set branch.

**PL-34. Backend validation error surfaced verbatim into the status panel detail line**
`src/components/MigrationWizard/ui/ConnectionStatusPanel.jsx:70-77`  —  risk: **low** · confidence: low
- *Problem:* The 'validate' step renders `detail: validationError` directly (L73) when validateStep === 'error'. validationError originates from backend responses in useSourceStepForm.runValidation (validateData.error / e.message). While this is error text not a secret, echoing raw server/exception messages into the premium status surface can leak internal detail (stack-ish messages, host paths) and reads inconsistently next to the curated copy of the other steps. No sanitization/truncation is applied.
- *Fix:* Map known error shapes to curated user-facing copy (as humanizeAIReason does for AI), and cap/truncate any passthrough message. Keep the raw detail behind a 'show details' affordance rather than rendering it inline by default.

**PL-35. React key uses f.type which is not guaranteed unique within a repo's flag list**
`src/components/MigrationWizard/ui/repo/RepoRiskReport.jsx:13-17`  —  risk: **low** · confidence: low
- *Problem:* flags.map keys each <li> by f.type. If a repo can carry two flags of the same type (e.g. two distinct large-file findings both typed 'oversized-file', or repeated 'name-conflict' entries), React key collision causes state/DOM reconciliation bugs and a console warning. The flag shape comes from the server risk analyzer (outside this slice) so uniqueness isn't enforced here.
- *Fix:* Key by a stable composite — `${f.type}-${i}` or a server-provided flag id — to guarantee uniqueness regardless of how many flags share a type.

**PL-36. Expanded FAB menu has no roving focus / arrow-key navigation and items aren't focused on open**
`src/components/MobileQuickActionsFab.jsx:65-103`  —  risk: **low** · confidence: medium
- *Problem:* The menu is rendered as `role="menu"` with `role="menuitem"` buttons (good), and Escape closes it (line 26-31), but opening the FAB does not move focus into the menu, and there is no arrow-key roving tabindex between items. For a `role="menu"` the WAI-ARIA contract expects focus management and Up/Down navigation; without it keyboard users must Tab through page order to reach the items, and the backdrop click-to-close (line 47) has no keyboard equivalent on the backdrop itself.
- *Fix:* On open, focus the first menuitem; implement Up/Down/Home/End roving focus among the items (or reuse the project's existing menu/focus-trap primitives used in Header dropdowns). This brings the mobile quick-actions menu to the same a11y bar as the desktop dropdowns.

**PL-37. Forks stat falls back to public_gists, mislabeling gists as forks**
`src/components/OrgManagerModal.jsx:227-232`  —  risk: **low** · confidence: medium
- *Problem:* The 'Forks' StatCard uses value={org.public_repos_forks \|\| org.public_gists \|\| 0}. GitHub's user/org API does not return public_repos_forks, so for personal accounts this silently falls through to public_gists — labeling a user's gist count as 'Forks'. This is a correctness/polish gap that shows a confidently-wrong number.
- *Fix:* Derive forks from a real field (or sum repo.forks_count where available) and drop the public_gists fallback; if forks aren't available for the account type, render '—' rather than substituting an unrelated metric.

**PL-38. Org and user avatars have no broken-image fallback (inconsistent with Header)**
`src/components/OrgPanel.jsx:124-128, 221-229`  —  risk: **none** · confidence: high
- *Problem:* OrgPanel renders the user avatar `<img src={user?.avatar_url} />` (line 125) and each OrgItem renders `<img src={org.avatar_url} />` (line 222) with no `onError` handler and no `\|\|` fallback. Header.jsx (lines 255, 504) at least falls back to `https://github.com/ghost.png` for a missing user avatar. When an avatar URL 404s (deleted org, GitHub CDN hiccup) these render a broken-image glyph inside the styled ring, which reads as broken UI. The design system has no shared Avatar component being used here.
- *Fix:* Add `onError={(e) => { e.currentTarget.src = '/fallback-avatar.svg' }}` (or a shared <Avatar> wrapper with initials fallback) on these images, matching the fallback intent already present in Header. Ideally extract a single Avatar component so the fallback logic isn't re-implemented per call-site.

**PL-39. Org search has no empty-results state**
`src/components/OrgPanel.jsx:28-30, 108-118`  —  risk: **none** · confidence: high
- *Problem:* `filteredOrgs` filters the org list by `searchTerm`, but when the filter matches nothing the list area renders only the static "All Orgs" button with no "No organizations match 'x'" message. The user is left staring at a single unrelated button with no feedback that their search returned zero results. Empty states are otherwise handled well in this codebase (e.g. EmptyState component used in TransferModal).
- *Fix:* When `searchTerm` is non-empty and `filteredOrgs.length === 0`, render a small empty hint ("No organizations match '{searchTerm}'") below the All Orgs entry, mirroring the empty-state pattern used elsewhere.

**PL-40. Chat error state Retry button is a no-op**
`src/components/PRReview/AIDeepReview/ChatTab.jsx:83-90`  —  risk: **low** · confidence: medium
- *Problem:* When a chat send fails, AIErrorState renders a Retry affordance whose onRetry is an empty function with a comment '// user retypes'. A visible Retry control that does nothing is a confusing micro-interaction — the user clicks it expecting the failed message to resend and nothing happens. The original input has already been cleared on submit (line 38), so there is no easy retype either.
- *Fix:* Either pass the AIErrorState a variant without a retry button for this case, or implement onRetry to resend the last user message (capture it before clearing input so it can be replayed).

**PL-41. Staggered per-row entry animation re-runs on every list update and adds up to 300ms before rows are interactive**
`src/components/RepoDetail/CommitsTab.jsx:118-120`  —  risk: **low** · confidence: medium
- *Problem:* Each commit row animates in with `transition={{ delay: Math.min(idx * 0.02, 0.3) }}`. Because this is on the mapped rows (not gated to first mount), any reload (StaleDataBadge retry, navigation back to the tab) replays the staggered fade for up to 50 rows, delaying the last rows by 300ms each time and causing layout jank on refresh. For a data list this reads busier than production-grade tools (which animate once or not at all).
- *Fix:* Run the stagger only on initial mount (e.g. gate with a `useRef(true)` first-render flag) or drop the per-row delay in favor of a single container fade. Keeps the first-load polish without re-animating on every refetch.

**PL-42. Issue/PR detail panels have no error/empty distinction for the secondary fetches and silently swallow sidebar failures**
`src/components/RepoDetail/IssueDetailPanel.jsx:316; PRDetailPanel.jsx:55-66`  —  risk: **low** · confidence: medium
- *Problem:* IssueDetailPanel/PRDetailPanel show a single fetchError banner only if the whole Promise.all rejects. Partial failures are masked: e.g. IssueSidebar's loadAvailable and IssueTimeline's load both `catch { setAvailable([]) / setEvents([]) }`, presenting an empty 'No labels in this repo' / 'No timeline events' state that is indistinguishable from a real failure. Users can't tell 'genuinely empty' from 'request failed', and there's no retry affordance on those sub-panels.
- *Fix:* Track an error state separately from the empty array in LabelEditor/AssigneePicker/IssueTimeline and render a small 'Couldn't load — retry' affordance on failure, reserving the empty-state copy for confirmed-empty responses.

**PL-43. Per-row staggered entry animation (delay i*0.04) on every page change adds cumulative jank and re-animates on refetch**
`src/components/Settings/AuditLogSection.jsx:196-224, 48-52`  —  risk: **low** · confidence: medium
- *Problem:* rowVariants applies `transition: { delay: i * 0.04 }` to each <motion.tr>. With a 20-row page the last row waits 0.76s to appear, and because logs is replaced wholesale on every page/filter/refresh, the entire table re-runs the stagger on each refetch (and on Refresh). On a data-dense audit table this reads as slow rather than premium, and the AnimatePresence wrapper around a keyed-by-index fallback (key={log.id \|\| i}) can mis-animate when ids are missing.
- *Fix:* Cap the stagger (e.g. delay: Math.min(i, 8) * 0.03), only animate on first load (not on pagination/refresh), and ensure stable keys (drop the index fallback or synthesize a stable composite key). Keeps the polish on initial reveal without penalizing every refetch.

**PL-44. Server-supplied test-result error text rendered directly, and host echoed into a target=_blank PAT link**
`src/components/Settings/AzureCredentialsSection.jsx:327-339, 535-536`  —  risk: **none** · confidence: low
- *Problem:* Two minor robustness/UX gaps: (1) The test-result banner renders `testResult.error` / `cred.host` as text (lines 336-337) and the new-PAT link interpolates raw `host` into anchor text 'Create a PAT on {host}' (line 536). React escapes text so this is not XSS, but unvalidated host strings can produce confusing/misleading link labels; buildPatSettingsUrl should be the only thing trusted to form the href (it is) — worth confirming it rejects javascript:/non-http hosts. (2) These banners don't use the shared toast/alert components, so error styling drifts from the rest of the app.
- *Fix:* Confirm buildPatSettingsUrl/classifyProvider reject non-http(s) hosts before rendering the anchor (defense-in-depth for the href), and route the success/failure test feedback through the shared alert/toast primitives for consistent design-system styling.

**PL-45. res.json() on a fetchWithRetry response with no guard for empty/non-JSON 2xx body**
`src/components/Settings/LicenseActivationModal.jsx:31-32`  —  risk: **low** · confidence: medium
- *Problem:* handleActivate does `const data = await res.json()` directly on the fetchWithRetry Response (line 31). If the install endpoint returns 204/empty or a non-JSON 2xx body, res.json() throws a raw SyntaxError that falls into the catch and is surfaced via formatUserError as a generic 'Activation failed' even though activation actually succeeded — a confusing false-negative. Other call sites in this slice consistently use `.json().catch(() => ({}))` or `.catch(() => null)`.
- *Fix:* Use the shared safeParseJson (already exported from utils/api) or `await res.json().catch(() => ({}))` so a missing/non-JSON success body doesn't masquerade as an activation failure.

**PL-46. No loading or error UI for the AI section — hook exposes isLoading/error but neither is consumed**
`src/components/Settings/WorkBoard/ai/WorkBoardAISection.jsx:10-15, 66-89`  —  risk: **low** · confidence: high
- *Problem:* useWorkBoardAI returns { isLoading, error } but WorkBoardAISection reads neither. On a non-403/404 failure the hook sets `error` and leaves enabled=true with empty suggestions/activity; the section then renders only the toggle with no indication that suggestions/activity failed to load. On initial mount there is also no skeleton — the cards pop in after the fetch resolves. For a 'premium' surface this is a polish gap (silent failure + layout jank).
- *Fix:* Render a small inline error/retry affordance when ai.error is set, and a lightweight skeleton (reuse ui/Skeleton) for the activity/suggestions cards while ai.isLoading && aiEnabled. Keeps parity with TrackedReposList which already has loading + empty states.

**PL-47. Repos-tab 'Assign Repository' button is a raw native button, not the shared Button/design system**
`src/components/Teams/TeamDetails.jsx:348-356`  —  risk: **low** · confidence: medium
- *Problem:* Most actions in this file use the shared `<Button>` component, but the Assign Repository trigger is a hand-rolled `<button className="...bg-pink-600...">`. It introduces a one-off pink color outside the ds palette and bypasses the Button component's focus-ring/size/variant consistency, making this single control feel off-brand versus the Add Member button right above it (which uses `<Button variant="primary">`).
- *Fix:* Replace with `<Button variant="primary">` (or an appropriate ds variant) so focus ring, sizing, and color come from the design system; drop the bespoke pink-600 styling.

**PL-48. Target-organization picker is a grid of buttons with no keyboard/radio semantics or selected-state announcement**
`src/components/TransferModal.jsx:231-259`  —  risk: **low** · confidence: medium
- *Problem:* The target org selector renders plain `<button>`s in a 2-col grid (line 232-258). There is no `role="radio"`/`radiogroup`, no `aria-pressed`/`aria-checked`, and no grouping label association, so screen-reader users get no announcement of which org is selected or that this is a single-select group. Visually it is a single-select (border-indigo on the chosen one) but the a11y layer doesn't convey it. This is a single-choice control rendered as unrelated buttons.
- *Fix:* Use a radiogroup pattern: wrap in `role="radiogroup" aria-label="Target organization"` and give each button `role="radio" aria-checked={targetOrg === org.login}`, or render real `<input type="radio">`s styled as cards. This matches the `aria-pressed` treatment already used on the action toggle elsewhere in the same file.

**PL-49. Trend line derived from regex-parsing the AI headline string**
`src/components/WorkBoard/AISummaryCard.jsx:161-164`  —  risk: **low** · confidence: medium
- *Problem:* trendLine is computed by regex-matching the free-text AI headline for '(words) up\|down NN%'. This is brittle (locale/phrasing dependent), silently shows nothing when the model phrases differently, and couples presentation to unstructured model output. If the model emits adversarial text it is only rendered as plain text (no XSS), but the feature is effectively unreliable.
- *Fix:* Return structured trend fields (direction, metric, deltaPct) from /ai-summary and render those, instead of regex-scraping the headline. Drop the regex once the backend provides the structured field.

**PL-50. Row hover-action affordances rely on group-hover but row sets role=presentation, weakening keyboard/touch reveal**
`src/components/WorkBoard/tabs/MyReviewsTab.jsx:92-103, 119-129`  —  risk: **med** · confidence: medium
- *Problem:* ReviewRow/StalePRRow wrap the row in a div role='presentation' and reveal InlineActions/kebab via CSS group-hover (InlineActions opacity-0 group-hover:opacity-100). The interactive row itself is the inner WorkBoardRowLink div[role=button]; the outer presentation div is the .group. Keyboard-only users who focus the row link get focus-within reveal, but the InlineActions container's focus-within is on the actions div, and the hover timer (300ms) gates the ChipStrip entirely on mouse hover/isFocused. On touch devices the md:opacity-0 sm:opacity-100 rules partly compensate, but the ChipStrip (Ping/Snooze/View) only appears on hover or keyboard focus, so touch users never see it. This is an a11y/touch parity gap on the primary actions.
- *Fix:* Drive showChips from focus as well as hover for touch (e.g. always render chips on coarse pointers, or add an explicit expand affordance), and ensure the chip strip is reachable without a pointer hover.

**PL-51. dismissToast mutates the ref array in place then passes the same reference to setToasts**
`src/contexts/ToastProvider.jsx:75-83`  —  risk: **med** · confidence: low
- *Problem:* dismissToast does `toastsRef.current = toastsRef.current.filter(...)` then `setToasts(toastsRef.current)`. filter returns a new array so this happens to work, but the pattern of keeping toastsRef and React state in lockstep via manual assignment (also lines 96-108) is fragile: any future edit that mutates instead of replaces, or that calls setToasts(prev => ...) elsewhere, will desync the ref from state and break the synchronous dedupe (lines 90-91). The provider is doing manual state mirroring that a single useReducer over {toasts} would make correct-by-construction.
- *Fix:* Move toast state to a useReducer; derive dedupe from the reducer's current state inside the action, eliminating the parallel toastsRef mirror and the class of ref/state desync bugs.

**PL-52. retryOAuth doesn't restart polling and resumePolling can't recover a timed-out flow**
`src/hooks/useAzureOAuth.js:63-81`  —  risk: **low** · confidence: medium
- *Problem:* `retryOAuth` only stops polling and sets status to 'idle' — it does not re-open the OAuth flow or restart polling, so the caller must remember to re-invoke startOAuth (undocumented coupling). Separately, `resumePolling` only resumes when status is still 'pending'; if the 120s timeout already fired (status 'timeout'), resume silently no-ops, leaving the user with a dead 'timeout' state and no affordance to retry from the same control.
- *Fix:* Document that retryOAuth resets to 'idle' (caller re-triggers), or have it return to a state the UI can act on; and surface a clear retry CTA when status is 'timeout'/'error' so the flow is self-recoverable.

**PL-53. fetchBranches assumes the response is an array and silently swallows all errors with no UI feedback**
`src/hooks/useDevToolkit.js:45-56`  —  risk: **low** · confidence: medium
- *Problem:* `fetchBranches` sets `setBranches(data)` directly and calls `data.find(...)` without confirming `data` is an array; a non-array error body (e.g. `{ error: ... }` on a 200-with-body edge or a rate-limit JSON) would throw inside the try and be swallowed by the bare `catch {}`, leaving the branch selector empty with no error/empty state shown to the user. Several fetches in this hook (`fetchBranches`, `fetchCompare` non-abort failures) fail completely silently.
- *Fix:* Guard with `const list = Array.isArray(data) ? data : []` before `setBranches`/`.find`, and surface at least a minimal error/empty state for the branch picker rather than swallowing.

**PL-54. buildHandlerMap rebuilt object on every keydown**
`src/hooks/useKeyboardShortcuts.js:59`  —  risk: **low** · confidence: medium
- *Problem:* handleKeyDown calls buildHandlerMap({...}) on every keydown event to construct the action->handler map, then looks up a single key. The map is fully recreated per keystroke even though its inputs only change when the callback props change. Low impact (keydowns are infrequent) but it's avoidable allocation on an event hot path and reads slightly amateurish.
- *Fix:* Wrap the handler map in useMemo keyed on the callback deps and reference it from handleKeyDown, or build it once in the effect. Purely a tidy-up; behaviour identical.

**PL-55. Module-level AI-availability flag is global and sticky across the whole session**
`src/utils/aiAvailability.js:17-38`  —  risk: **med** · confidence: medium
- *Problem:* _unavailable/_reason are module singletons set by markAIUnavailable, which short-circuits on the first call (`if (_unavailable) return`). Once any AI surface hits a 400/404/422, every AI feature in the app is disabled for the session until resetAIAvailability() is called (which the comment says production never calls except the settings page). A 404 MODEL_NOT_FOUND on one feature's per-feature model override therefore silently disables unrelated features (chat, embeddings) that may be configured correctly, with no per-feature granularity. That over-broad fallback reads as a coarse UX in a multi-feature AI product.
- *Fix:* Key availability by feature/provider (a Map keyed by featureKey or provider id) instead of one global boolean, so a fatal status on MIGRATION_SIZE doesn't also gate CHAT. Subscribers can scope their notice to the affected feature.

**PL-56. formatFileSize returns inconsistent decimal precision (parseFloat strips zeros)**
`src/utils/format.js:111-122`  —  risk: **low** · confidence: high
- *Problem:* The JSDoc example claims formatFileSize(1024) // "1.00 KB", but the implementation wraps the result in parseFloat(...toFixed(dm)), so 1024 actually renders as "1 KB" and 1048576 as "1 MB" — the fixed-decimal padding promised in the contract is discarded. This makes sizes render with ragged precision ("1 KB" next to "1.25 MB"), which reads inconsistent in a polished UI and contradicts the documented behavior other code may rely on.
- *Fix:* Either honor the documented fixed precision: `(bytes / Math.pow(k,i)).toFixed(dm)` without the parseFloat wrap (keeps trailing zeros), or update the JSDoc examples to reflect the trimmed output. Pick one and make doc + behavior agree.


---

### ♻️ Deduplication (64)

#### High · 2

**DH-1. DevToolkit bypasses the shared apiCall/fetchWithRetry layer with hand-rolled fetch + CSRF**
`src/components/DevToolkit/PRTab/PRTab.jsx:57, 169, 181 (also CommitTab.jsx:64,153; ReviewTab.jsx:36,72,110; QuickActions.jsx:21)`  —  risk: **med** · confidence: high · verify: confirmed
- *Problem:* Every network call in the DevToolkit tabs uses raw `fetch(...)` with manually-assembled headers/credentials instead of the project's shared `apiCall`/`fetchWithRetry` layer in src/utils/api.js. That shared layer already injects the CSRF token on mutations, retries with backoff, normalizes 401 (session-expired bus), 429 (rate-limit bus + Retry-After), 5xx and offline queueing, and drops Sentry breadcrumbs. By going around it, these call sites: (a) duplicate the CSRF plumbing three different ways — `getCsrfToken()` raw in CommitTab.jsx:152, `.catch(()=>null)` in PRTab.jsx:163, try/catch in QuickActions.jsx:20; (b) get no retry, no offline queue, no centralized 401 handling; (c) silently treat non-ok GETs as empty (`r.ok ? r.json() : []` in ReviewTab.jsx:37) so a 403/500 looks identical to 'no PRs'. This is the single biggest consistency gap in the slice.
- *Fix:* Route the non-streaming GETs (pulls list, PR files, commit style, pr-template) through `apiCall(url)` and the mutations (POST /pulls, PATCH /pulls/:n, POST /reviews) through `fetchWithRetry(url, { method, body })` — both already inject CSRF and credentials, so the manual `getCsrfToken()`/header blocks can be deleted. Streaming POSTs legitimately stay on raw fetch (they need the ReadableStream), which useStreaming already handles.

**DH-2. Hand-rolled fetch + manual CSRF bypasses the shared apiCall/fetchWithRetry layer**
`src/components/MigrationWizard/steps/SourceStep/PatPasteGuide.jsx:52-77`  —  risk: **low** · confidence: high · verify: confirmed
- *Problem:* handleSaveForLater (POST /api/azure/credentials) uses raw fetch() and manually fetches/attaches the CSRF token via getCsrfToken(). The shared fetchWithRetry/apiCall in src/utils/api.js already injects the CSRF header on same-origin /api mutations, retries once on 403 csrf_invalid (stale token race), queues mutations while offline, and applies timeouts/session-expiry handling. This bespoke wrapper duplicates the CSRF plumbing and silently loses all of that resilience — a rotated token here just fails instead of auto-retrying. Same pattern is copy-pasted in SavedCredentialsPicker.jsx (GET) and RepoDetailPanel.jsx (3x POST).
- *Fix:* Replace the raw fetch + getCsrfToken block with apiCall('/api/azure/credentials', { method: 'POST', body: JSON.stringify({...}) }). apiCall handles credentials:'include', CSRF injection, the 403 csrf_invalid retry, and JSON parsing, so the manual headers/csrf code can be deleted.


#### Medium · 38

**DM-1. Raw GitHub fetch bypasses the resilient githubApi wrapper**
`server/actions-service.js:335-365`  —  risk: **low** · confidence: high
- *Problem:* syncWorkflowRuns calls `fetch('https://api.github.com/...')` directly (lines 341-350) instead of the shared githubApi() helper. This bypasses the circuit breaker, rate-limit pre-check/Retry-After handling, ETag conditional-request caching, and exponential backoff that lib/github-api.js provides. The same pattern repeats in work-item-service.js (createGitHubIssue, ensureLabel, fetchExistingLabels) and import-service.js (repo create/get). community-health-service.js already uses githubApi correctly, so this is an inconsistent, less-robust parallel path that will hammer GitHub during an incident and count every call against the rate limit.
- *Fix:* Route the read-style GitHub calls (workflow runs sync, label listing) through githubApi() so they share caching, rate-limit awareness, and the circuit breaker. Mutations can stay on fetch if needed but should at least share a thin auth-header/error helper.

**DM-2. Repeated 'AI model not initialized' guard + NOT_FOUND remap copied across 4+ feature modules**
`server/lib/ai-features/repo-analysis.js:19-22, 73-78`  —  risk: **low** · confidence: high
- *Problem:* The exact pattern `if (!provider?.model) throw new Error('AI model not initialized. Please check GEMINI_API_KEY...')` plus the catch block that remaps `AIError(NOT_FOUND)` to a hard-coded 'Please verify GEMINI_MODEL configuration in .env' string is duplicated verbatim in repo-analysis.js, readme-enhance.js, pr-review.js, and (a variant) semantic-search.js. The messages are also Gemini-specific even though the project is multi-provider (Anthropic/OpenAI/etc.), so the error text is misleading for non-Gemini users.
- *Fix:* Extract a small `assertProvider(provider, {needsModel\|needsEmbedding})` helper and a `mapModelNotFound(err)` wrapper into a shared module (e.g. ai-features/provider-guards.js); make the message provider-neutral ('AI model not available / not configured') rather than hard-coding GEMINI_*.

**DM-3. Four near-identical SQL branches for user-scoped vs unscoped + excludeSelf**
`server/lib/ai-features/semantic-search.js:83-103`  —  risk: **low** · confidence: high
- *Problem:* `findSimilarById` builds the 'others' query with a 4-way if/else over (userId present?) × (excludeSelf?), each branch a copy-pasted SELECT differing only by a WHERE clause and an extra join condition. `semanticSearch` repeats the same userId-scoping branch again. This is brittle (a column added to the SELECT must be edited in 6 places) and the duplicated JOIN-on-(repo_id,user_id) logic is easy to get subtly wrong.
- *Fix:* Compose the WHERE clause from conditions/params arrays and use a single prepared SQL string per function (append `AND re.user_id = ?` and `AND re.repo_id != ?` conditionally). Share one helper that returns `{sql, params}` so both functions and both scoping modes reuse it.

**DM-4. _post and _postStream share ~30 lines of near-identical error-extraction; same block duplicated again in anthropic.js**
`server/lib/providers/openai.js:177-241`  —  risk: **low** · confidence: high
- *Problem:* Within openai.js, _post (177-203) and _postStream (213-241) repeat the same non-2xx handling: build `HTTP ${status}` message, try res.json(), pull errBody.error.message/message, extractUpstreamDetails, then mapHttpError(...). anthropic.js _post/_postStream (134-198) repeat their own copy of the same pattern. Four copies of the same response-error decoding logic. A change to error parsing (e.g. reading a `code` field or capping body size) must be applied in four spots and is easy to get inconsistent.
- *Fix:* Extract a private `_throwForResponse(res, mapFn)` helper per provider (or a shared `await readErrorBody(res)` util in ai-provider.js returning {message, details, errType}) and call it from both _post and _postStream. Reduces each provider to one error-decoding path.

**DM-5. Three independent secret-redaction implementations that must agree but don't**
`server/lib/secret-redactor.js:1-31`  —  risk: **low** · confidence: high
- *Problem:* There are three redactors with overlapping-but-divergent coverage: redact-secrets.js (redactSecrets), secret-redactor.js (redact/SECRET_REGEX, line-based), and env/sanitize.js (sanitizeOutput). Each has a different pattern set — sanitize.js has the high-entropy 32-char catch-all and GitHub families; secret-redactor.js has xox/ghp/github_pat; redact-secrets.js has sk-/AIza/basic-auth. A token type covered by one is leaked by another (see the redact-secrets gap above). Maintaining three lists guarantees drift and silent leaks.
- *Fix:* Extract a single `redactor.js` exporting both a `scrubLine(str)` (entropy + provider prefixes) and a `redactLineByLine(content)` helper, then have all three call sites consume it. Keep the line-vs-substring distinction as two exported functions over one shared pattern set.

**DM-6. DEFAULT_DEBT_LABELS duplicated verbatim across two modules**
`server/lib/work-board-github.js:12`  —  risk: **none** · confidence: high
- *Problem:* The exact tech-debt label list is defined twice: event-aggregations.js:319 (DEFAULT_DEBT_LABELS const) and work-board-github.js:12 (exported DEFAULT_DEBT_LABELS). Both list the same 8 labels. They can drift independently, so the DB-fallback path and the live-GitHub path could classify tech debt differently after one is edited.
- *Fix:* Define the label list once (e.g. a shared constants module or export from one file) and import it in the other. Single source of truth eliminates the drift risk.

**DM-7. JSON-fence-strip + JSON.parse + fallback object is copy-pasted across 4+ streaming/non-streaming branches**
`server/routes/ai/dev-toolkit.js:140-141, 256-257, 287, 377, 411, 194, 195`  —  risk: **low** · confidence: high
- *Problem:* The exact pattern `raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')` followed by `JSON.parse` in a try/catch with a hand-built fallback object appears in review-summary (140), generate-commit (256, 287), generate-pr (377, 411), and analyze-context (574), and core.js does the same fence strip at 194. Each copy has slightly different fallback shapes, which is exactly the drift this duplication invites. core.js already imports `safeJsonParse` from lib/utils.js for the same purpose.
- *Fix:* Extract a single helper (e.g. `parseAIJson(raw, fallback)`) in shared.js (or reuse safeJsonParse after a shared `stripCodeFences`) and call it from every branch. Keeps the fence-strip regex in one place.

**DM-8. Per-user in-memory rate limiter is hand-rolled in pr-chat AND pr-commands while a shared limiter helper already exists**
`server/routes/ai/pr-chat.js:51-95`  —  risk: **low** · confidence: high
- *Problem:* pr-chat.js (51-95) and pr-commands.js (44-94) each reimplement the identical bucket Map + window filter + lazy sweep interval + _runRateLimitSweep/_resetRateLimits/ensureSweepInterval scaffolding, differing only in the numeric limit. Meanwhile deep-review.js uses `createInMemoryRateLimiter` and user-ai-config/prompt-studio use `createCooldownLimiter` from lib/in-memory-rate-limiter.js. Two near-identical ~45-line copies that should call the shared factory.
- *Fix:* Replace both hand-rolled limiters with `createInMemoryRateLimiter({ windowMs, max, label })` (as deep-review already does), keeping the test-only `_resetRateLimits` shim pointed at the helper's reset.

**DM-9. Repo-array format validation block duplicated verbatim across 5 endpoints (and redundant with zod)**
`server/routes/bulk.js:46-49`  —  risk: **low** · confidence: medium
- *Problem:* The same three-line guard — `if (!repos?.length) ... MISSING_REPOS`, `if (!Array.isArray(repos) \|\| repos.some(r => typeof r !== 'string' \|\| !r.includes('/'))) ... INVALID_FORMAT` — is copy-pasted in /visibility (46-48), /transfer (140-143), /mirror (199-202), /archive (246-248) and /delete (276-278). Each of these routes already runs `validateBody(bulkXSchema)`, so the zod schema is the right place to enforce shape; the hand-rolled re-checks are both duplicated and largely dead (the schema should already reject a non-array or non-owner/repo string). This is ~20 lines of parallel logic that drift independently (e.g. /transfer adds a `toOrg` check, others don't).
- *Fix:* Push the array-non-empty and owner/repo-string checks into the shared bulk* zod schemas in validators.js (e.g. `z.array(repoFullNameSchema).min(1)`), then delete the inline re-validation blocks from all five handlers. Keep only request-specific checks (e.g. makePublic boolean) where the schema can't express them.

**DM-10. Duplicated Azure Import-API poll loop and batch-queue scaffolding across TFVC handlers**
`server/routes/import/azure/tfvc.js:tfvc.js:335-360 vs 680-701; 117-234 vs 35-112`  —  risk: **low** · confidence: high
- *Problem:* The Import-API polling loop (MAX_POLLS=120, POLL_INTERVAL=5000, 401/403→'PAT expired', completed/failed/abandoned handling, timed-out message) is copy-pasted in runImportApiStrategy (335-360) and runInPlaceTfvcConversion (680-701). Separately, the batch concurrency runner (queue/active Set, while-loops, Promise.race, the crash-recovery UPDATE ... WHERE id IN (placeholders)) is duplicated almost verbatim between import/azure/tfvc.js:180-218 and import/azure/git.js:262-289. Each duplicate is ~30-40 lines of fiddly control flow that must be kept in lockstep.
- *Fix:* Extract two helpers: (1) pollAzureImportRequest({ org, project, repoId, importRequestId, pat, host, onProgress, pctRange }) for the Import-API wait loop, and (2) a runBatchQueue(jobs, worker, { concurrency, onCrash }) for the queue+crash-recovery pattern shared by both batch importers.

**DM-11. ensureSafePublicUrl and ensureSafeAzureClone are byte-identical SSRF guards**
`server/routes/import/url.js, server/routes/import/azure/git.js:url.js:22-36; git.js:18-32`  —  risk: **low** · confidence: high
- *Problem:* ensureSafePublicUrl (url.js) and ensureSafeAzureClone (git.js) implement the exact same logic: assertSafeExternalUrl in a try/catch, strip the 'ssrf_guard:' prefix, then resolveAndValidateHost, returning false/null + a 400. The git.js batch path (lines 185-195) hand-rolls a THIRD copy of the same sequence inline. Three parallel implementations of the same security-critical check is a drift risk — a future hardening to one can silently miss the others.
- *Fix:* Extract one shared helper (e.g. lib/url-validator.js: assertSafeCloneUrl(rawUrl) returning { ok, reason }) and call it from all three sites. Keep the response-writing thin at the call site so the security logic lives in exactly one place.

**DM-12. /global is a near-duplicate of / and drops the safety guards / has present**
`server/routes/stats.js:144-213`  —  risk: **low** · confidence: high
- *Problem:* GET /global re-implements the same repo-pagination-and-aggregation loop as GET / (lines 46-91 vs 148-193) — identical isPersonal logic, identical while-loop, identical languages/stars/forks reducers — but diverges in two unsafe ways: (1) it never validates `org` with isValidGitHubUsername (line 24 does this in /), so an attacker-controlled org string is interpolated straight into the GitHub endpoint path on line 159; and (2) it omits the `if (!Array.isArray(data)) break` defensive check that / added on line 62, so an unexpected non-array response will throw on the spread at line 162. The shared loop should live in one helper.
- *Fix:* Extract a `fetchAllRepos({ org, isPersonal, token })` helper that includes the org-name validation and the Array.isArray guard, and have both / and /global call it. At minimum, add `if (org && !isValidGitHubUsername(org)) return 400` and the Array.isArray break to /global to bring it to parity with /.

**DM-13. assertOk/get/mutate fetch boilerplate duplicated across three AI/work-board clients**
`src/api/workBoardTracking.js:5-36`  —  risk: **low** · confidence: high
- *Problem:* workBoardTracking.js (lines 5-36), workBoardAI.js (lines 5-33) and dashboardInbox.js (lines 62-69) each hand-roll the same fetch wrapper: build error from body.error, attach .status/.body, GET helper, and a CSRF-injecting POST/mutate helper. workBoardAI and workBoardTracking are almost byte-identical (assertOk + get + post/mutate + getCsrfToken). This is parallel implementations of fetchWithRetry minus its retry/offline/CSRF-rotation logic, so each copy also misses the centralized session-expiry, rate-limit-bus and offline-queue behavior that the canonical utils/api client provides.
- *Fix:* Extract one shared helper (e.g. utils/jsonClient.js exposing getJson/mutateJson with the typed-error + CSRF behavior) and have workBoardAI, workBoardTracking and dashboardInbox import it; or better, build them on fetchWithRetry so they inherit retry/offline/CSRF-rotation. Collapses ~90 lines of near-identical code into one.

**DM-14. Auth/system endpoint URLs hardcoded as magic strings despite config.js constants**
`src/App.jsx:413, 432, 441, 488, 517, 597, 659`  —  risk: **low** · confidence: high
- *Problem:* config.js already exports AUTH_ENDPOINTS.login and API_ENDPOINTS, yet App.jsx hardcodes the same paths in several places: '/api/auth/login' appears as a literal on lines 597 and 659 (and as AUTH_ENDPOINTS.login on lines 488 and 517 — two styles for the identical URL), plus '/api/system/status' (413), '/api/auth/mock' (432) and '/api/auth/session' (441) are bare literals. If the API base path or a route changes, these literals drift out of sync with config.js and with each other, and the VITE_API_BASE_URL prefix that AUTH_ENDPOINTS applies is silently dropped on the hardcoded ones (they would break under a non-empty API_BASE_URL deployment).
- *Fix:* Route every auth/system call through the config constants: use AUTH_ENDPOINTS.login on lines 597/659, and add system/session/mock entries to API_ENDPOINTS (or an AUTH_ENDPOINTS extension) so the VITE_API_BASE_URL prefix is honored consistently. Replace all bare literals with the constant.

**DM-15. Desktop and mobile branches duplicate the Files / Metrics / Recommendations markup**
`src/components/CommunityHealthDashboard.jsx:223-339`  —  risk: **low** · confidence: high
- *Problem:* The isDesktop ? (...) : (...) split renders the same three sections (Community Files grid, the 4 MetricCards, and the Recommendations list) twice with near-identical JSX — the only real difference is the desktop tab wrapper vs. mobile stacked layout. The metric cards in particular are copy-pasted verbatim (lines 262-265 vs 311-314). This roughly doubles the section's size and means every visual tweak must be applied in two places.
- *Fix:* Extract <FilesSection>, <ActivityMetrics>, and <RecommendationsSection> components and render them once, choosing only the surrounding layout (TabBar panels vs stacked motion.divs) based on isDesktop.

**DM-16. CSRF-header boilerplate copy-pasted across ~18 components/hooks**
`src/components/CreateRepoModal.jsx:44-46`  —  risk: **low** · confidence: high
- *Problem:* The exact pattern `const headers = { 'Content-Type': 'application/json' }; try { headers['X-CSRF-Token'] = await getCsrfToken() } catch { /* server will 403 */ }` is duplicated verbatim in CreateRepoModal, ErrorBoundary, OrgManagerModal and ~15 other files (confirmed via grep on `X-CSRF-Token'] = await getCsrfToken`). Each copy independently decides how to degrade on token failure, so a fix or policy change must touch every site.
- *Fix:* Add a single helper (e.g. `await jsonHeadersWithCsrf()` in src/utils/api.js) returning the Content-Type + best-effort CSRF header, and replace the inline try/catch blocks with it.

**DM-17. DashboardHero is dead code — a near-verbatim duplicate of TodayPanel's header**
`src/components/Dashboard/DashboardHero.jsx:1-99`  —  risk: **low** · confidence: high
- *Problem:* DashboardHero.jsx is never imported or exported anywhere (it is not in Dashboard/index.js, and a repo-wide grep finds references only inside the file itself). The live dashboard header is TodayPanel.jsx, which contains an essentially identical block: the same imports (HeroOrgChip/HeroTimeRangeChip/HeroSyncChip/WhatNeedsYouGrid, greeting utils, useRelativeTime), the same childVariants/containerVariants constants, and a byte-for-byte copy of formatEyebrow(). This is a stale parallel implementation that will drift from TodayPanel and confuses anyone editing the hero.
- *Fix:* Delete src/components/Dashboard/DashboardHero.jsx. If a shared eyebrow/greeting header is wanted, extract formatEyebrow + the childVariants/containerVariants constants into a small shared module imported by TodayPanel, but the file as-is should simply be removed.

**DM-18. Three near-identical bespoke searchable dropdowns instead of the shared Select**
`src/components/DevToolkit/shared/RepoSelector.jsx:1-81 (parallels RepoBadge.jsx:1-101 and BranchSelector.jsx:1-93)`  —  risk: **med** · confidence: high · verify: adjusted
- *Problem:* RepoSelector, RepoBadge, and BranchSelector each reimplement the same searchable-popover pattern from scratch: identical outside-click `mousedown` effect, identical `useMemo` filter with `.slice(0,30)`, identical AnimatePresence motion popover, identical search Input header, identical option-button styling. RepoSelector and RepoBadge are essentially the same component (RepoBadge just adds a pin button). The project rule mandates 'ALWAYS use the shared premium Select component, never a native <select>' — these custom dropdowns sidestep that shared component entirely, so they drift from its styling/behavior and triple the surface area for bugs.
- *Fix:* Extract one shared searchable-combobox (or adopt the premium Select's async/searchable mode) and have all three consume it. At minimum collapse RepoSelector and RepoBadge into a single component with an optional pin slot.
- *Verifier (severity adjusted):* Triplication is real and accurately described. RepoSelector.jsx, RepoBadge.jsx, and BranchSelector.jsx each reimplement: identical `mousedown` outside-click effect (lines 11-18 in all three), identical AnimatePresence popover with byte-for-byte motion props (initial/animate/exit {opacity,y:-4}, duration 0.15) and identical container classNames, identical sticky search-Input header, identical option-button hover/selected styling. RepoSelector and RepoBadge share the exact same `useMemo` filter with `.slice(0,30)`; RepoBadge only adds a pin button — they are essentially one component. The shared src/components/ui/Select.jsx exists and has a `searchable` mode plus AnimatePresence, outside-click, keyboard nav and ARIA combobox semantics, so the fix is feasible. However severity is overstated: this is pure code duplication/drift with NO behavioral bug, and the literal project rule ('never a native <select>') is not actually violated — these are custom dropdowns, not native selects, and they take richer object shapes than Select's {value,label} contract. A deduplication finding with no correctness/security impact is medium, not high.

**DM-19. Bespoke fetch wrappers bypass the shared apiCall/fetchWithRetry layer**
`src/components/MigrationWizard/hooks/useAzureProjectData.js:38-51, 84-96`  —  risk: **med** · confidence: high · verify: adjusted
- *Problem:* Every data hook in this slice (useAzureProjectData, useBranchCache, useRepoNameConflicts, useSourceStepForm, useWizardNavigation) hand-rolls the same raw fetch boilerplate: build headers, `await getCsrfToken().catch(() => null)`, spread the CSRF header conditionally, `res.json().catch(() => ({}))`, and swallow errors. The shared layer in src/utils/api.js (fetchWithRetry/apiCall) already injects the CSRF token on same-origin /api/* mutations, retries with backoff, handles the 403 csrf_invalid token-rotation retry, queues mutations while offline, fires the 401 session-expiry bus, and categorizes errors. None of that protection applies to these bespoke calls, so e.g. a rotated CSRF token (after re-login) silently 403s the branch/projects/repos fetches with no retry, and a transient 5xx during validation just fails. This is ~6 near-identical copies of logic the codebase already centralizes.
- *Fix:* Route these POSTs through apiCall(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(...) }), dropping the manual getCsrfToken()/header plumbing and the res.json().catch shim (apiCall injects CSRF and parses). Keep AbortController where cancellation is needed by passing signal through. This deletes the duplicated CSRF/parse code in all five hooks and gains retry + offline-queue + session-expiry handling for free.
- *Verifier (severity adjusted):* Confirmed in code. useAzureProjectData.js:38-51 and 84-96 hand-roll raw fetch with `getCsrfToken().catch(() => null)`, conditional X-CSRF-Token spread, `res.json().catch(() => ({}))`, and swallowed errors. Grep confirms the same pattern is duplicated in useBranchCache.js:31-45, useRepoNameConflicts.js:51-63, useSourceStepForm.js (L247/262, L288, L385-386), and useWizardNavigation.js:74-75 — so the '~6 near-identical copies' claim holds. The shared layer in src/utils/api.js genuinely provides what these bypass: CSRF injection on same-origin /api/* mutations (L335-348), 403 csrf_invalid invalidate+refetch+retry (L390-409), offline mutation queue (enqueueMutation L360-361, L451-457), 401 session-expiry bus (notifySessionExpired via categorizeError L236), and error categorization. The technical claims are accurate. However 'high' over-rates a deduplication/maintainability finding: these calls are read-only data loads (POST carries credentials in body, but they fetch projects/repos/branches, not state mutations), and all already fail gracefully (cache stays null, picker falls back). The only real functional gap is a non-retried rotated-CSRF 403 or transient 5xx on a read fetch, which degrades to a silent no-op rather than data loss. Maintainability dedup with a low-impact edge-case gap = medium, not high.

**DM-20. Access-error string sniffing duplicated across SourceStep and OrgField (and divergent)**
`src/components/MigrationWizard/steps/SourceStep/index.jsx:88-91`  —  risk: **low** · confidence: high
- *Problem:* The isAccessError heuristic (validationError.includes('401')\|\|'403'\|\|'insufficient'\|\|'Invalid') is duplicated verbatim in index.jsx:88-91 and OrgField.jsx:96-99, and a near-identical-but-different variant (without 'Invalid', plus 'not found'/'404') lives in OrgField.jsx:84-92. Parsing server error semantics from substring matching in multiple places is fragile: a server message wording change silently breaks the UX in some spots but not others, and the two copies have already drifted.
- *Fix:* Extract a single helper (e.g. classifyValidationError(validationError) -> { isAccessError, isNotFound, kind }) into utils and consume it from both index.jsx and OrgField.jsx so the substring rules live in exactly one place.

**DM-21. Bespoke debounced check-duplicates fetch duplicates useRepoNameConflicts and bypasses apiCall**
`src/components/MigrationWizard/steps/TargetConfigStep.jsx:26-77`  —  risk: **med** · confidence: high
- *Problem:* TargetConfigStep hand-rolls a 500ms-debounced `fetch('/api/import/check-duplicates')` with manual CSRF-token injection and an idle/checking/clear/conflict state machine (lines 26-77). This is the same logic already encapsulated in `src/components/MigrationWizard/hooks/useRepoNameConflicts.js` (the project even flags this duplication: there are 5+ call sites of check-duplicates). It also bypasses the shared `apiCall`/`fetchWithRetry` layer (utils/api.js), which already injects the X-CSRF-Token automatically (lines 332-348), normalizes errors, retries, and queues offline mutations — so this copy reinvents CSRF handling and silently swallows every failure as 'idle' with no retry/offline support.
- *Fix:* Reuse useRepoNameConflicts (or a single-name variant of it) for the status machine, and route the request through `apiCall('/api/import/check-duplicates', { method:'POST', body:... })` so CSRF/retry/error-normalization come from the shared layer instead of the manual `getCsrfToken()` + `X-CSRF-Token` header dance.

**DM-22. Parallel ad-hoc logout implementation that hardcodes the URL and ignores the central auth flow**
`src/components/OrgPanel.jsx:169-172`  —  risk: **low** · confidence: high
- *Problem:* The Sign Out dropdown item calls `fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).finally(() => window.location.reload())`. This is a third, divergent logout path: it hardcodes `/api/auth/logout` (bypassing `API_BASE_URL` / `API_ENDPOINTS.logout` from config.js, so it breaks if the API is hosted on a different origin), has no error handling (a 4xx/5xx still triggers a reload, leaving the user logged in with no feedback), and ignores the app-level `onLogout` handler used everywhere else (Header passes `onLogout`). Logout side-effects (clearing client state, toasts) are skipped.
- *Fix:* Plumb an `onLogout` (or `onSignOut`) callback into OrgPanel and call it here, reusing the same handler the Header/CommandPalette use. At minimum switch the literal to `API_ENDPOINTS.logout` and guard the reload behind a successful response.

**DM-23. Plan/tier feature catalog defined three separate times with drift risk**
`src/components/Pricing/PricingPage.jsx:11-76; Pricing/FeatureComparison.jsx 9-133; Landing/PricingPreview.jsx 4-59`  —  risk: **low** · confidence: high
- *Problem:* The pricing catalog (tiers, prices, per-feature caps like '5,000 AI queries', '200 repositories', API-key counts, team-member limits) is hand-maintained in three independent shapes: PricingPage TIERS_MONTHLY, FeatureComparison CATEGORIES, and the Landing PricingPreview `plans`. They already disagree in places (PricingPreview lists 'Teams + 1 cloud migration / month' for Free while FeatureComparison says 'Up to 3 (5 each)'), and there are two full card renderers (PricingPage/PricingCard vs PricingPreview/PreviewCard) with copy-pasted badge/CTA/feature-row markup. A price change must be edited in 3+ files or marketing/comparison/checkout drift.
- *Fix:* Extract a single pricing source-of-truth module (tiers + features + caps) and derive PricingPage cards, the comparison table, and the Landing preview from it; collapse PreviewCard and PricingCard into one parameterized card.

**DM-24. Extension→language map duplicated verbatim between DiffPanel and DiffRenderer**
`src/components/PRReview/DiffPanel/DiffPanel.jsx:58-99`  —  risk: **none** · confidence: high
- *Problem:* DiffPanel.jsx defines EXT_LANG_MAP + getLang() (lines 58-99) that are a character-for-character copy of LANG_MAP + the inline lang derivation in DiffRenderer.jsx (lines 47-82, 142-147). DiffPanel computes `lang` only to display the language label in the header and then passes it down as highlightLanguage, so the same map is maintained in two files and can silently drift (e.g. adding a new extension in one place only).
- *Fix:* Extract the map and a getLang(filename) helper into a small shared module (e.g. DiffPanel/langMap.js) and import it in both DiffPanel and DiffRenderer.

**DM-25. useReviewAI hand-rolls fetch + manual CSRF instead of shared apiCall layer**
`src/components/PRReview/hooks/useReviewAI.js:119-156`  —  risk: **low** · confidence: high · verify: adjusted
- *Problem:* fetchSummary uses raw fetch() with a manual `getCsrfToken()` call and bespoke res.ok/error parsing. The shared fetchWithRetry/apiCall layer (utils/api.js:332-348) already injects X-CSRF-Token on every same-origin /api/* mutation, plus retries (5xx/network), offline mutation queueing, 401 session-expiry handling, and 429 rate-limit signalling. By bypassing it, this AI POST gets none of that resilience and re-implements CSRF by hand — exactly the kind of bespoke fetch wrapper the shared layer exists to replace. useReviewData.js in the same folder already uses apiCall correctly, so this is an inconsistency within the slice.
- *Fix:* Replace the raw fetch block with `apiCall('/api/ai/review-summary', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) })`. Drop the explicit getCsrfToken import — apiCall injects it. Map the thrown ApiError's .status/.data.code onto err.status/err.code so AIErrorState's CTA mapping still works.
- *Verifier (severity adjusted):* Confirmed in code. useReviewAI.js:119 calls getCsrfToken() and line 120 issues a raw fetch('/api/ai/review-summary') with a manual 'X-CSRF-Token' header (line 123) and bespoke res.ok/res.json().catch() error handling (lines 137-143). The shared fetchWithRetry at api.js:332-348 auto-injects X-CSRF-Token on same-origin /api/* mutations and adds retries, offline mutation queueing (line 361), and 401 session short-circuit (lines 328-329); apiCall (api.js:525) wraps it. Sibling useReviewData.js uses apiCall (lines 80, 93), so the in-slice inconsistency is real. Proposed fix is accurate. However this is a reuse/resilience duplication, not a correctness or security bug — CSRF is still applied by hand so the call functions; the only loss is shared retry/offline/session handling. That is medium-severity, not high.

**DM-26. Markdown 'prose' wrapper + ReactMarkdown duplicated 5x across issue/PR panels**
`src/components/RepoDetail/IssueDetailPanel.jsx:223, 257; PRDetailPanel.jsx:295, 376, 467`  —  risk: **low** · confidence: high
- *Problem:* The exact same `<div className="prose prose-sm dark:prose-invert max-w-none ... [&_code]:... [&_pre]:..."><ReactMarkdown>{x}</ReactMarkdown></div>` block is copy-pasted for issue body, issue comments, PR body, PR comments, and PR reviews, with slightly divergent class strings each time. This is the same content surface repeated, and the project already has a shared markdown renderer (ui/RepoMarkdown). The drift means a styling or sanitization change must be made in five places.
- *Fix:* Extract a single `CommentMarkdown`/`ProseMarkdown` component in components/ui that owns the prose classes and ReactMarkdown config, and use it in all five sites. Keeps one source of truth for markdown styling (and a single place to add rehype-sanitize later if raw HTML rendering is ever enabled).

**DM-27. Bespoke fetch() bypasses the shared fetchWithRetry/apiCall layer (CSRF retry, 401 handling, retry/offline queue)**
`src/components/Settings/ApiKeysSection.jsx:91-99, 361-363, 393-397`  —  risk: **med** · confidence: high · verify: adjusted
- *Problem:* ApiKeysSection (and DangerZoneSection, AzureCredentialsSection, AzureHostsAllowlistSection, LicensePlanSection, AIConfigSection, UsageDashboard, AuditLogSection) call raw fetch() and hand-roll CSRF injection via `try { headers['X-CSRF-Token'] = await getCsrfToken() } catch {}`. The shared fetchWithRetry already injects CSRF automatically on same-origin /api mutations, AND adds a critical behavior these call sites lack: a once-only retry on `403 { code: 'csrf_invalid' }` (stale token after session rotation) and 401->session-expired redirect via categorizeError/notifySessionExpired. With raw fetch, a rotated CSRF token makes create/revoke/delete fail permanently with a generic error, and a 401 shows a local 'Failed to load' instead of routing to re-login. Eight components duplicate the same hand-rolled CSRF dance.
- *Fix:* Route all mutations through fetchWithRetry/apiCall (which already injects CSRF, retries on csrf_invalid, and centralizes 401 handling) and drop the manual getCsrfToken() blocks. For GET loaders, use apiCall so 401 triggers the shared session-expired flow. Keep raw fetch only where a streaming/blob response is needed (e.g. the export blob in DangerZoneSection), and even there add CSRF/401 parity.
- *Verifier (severity adjusted):* Largely confirmed in code. The shared layer exists in src/utils/api.js: fetchWithRetry auto-injects X-CSRF-Token on same-origin /api mutations (lines 335-348), retries once on 403 {code:'csrf_invalid'} after invalidating the cached token (lines 390-409), and 401 routes through categorizeError -> notifySessionExpired with redirect to /?error=session_expired (lines 235-237). ApiKeysSection.jsx cited lines match exactly: hand-rolled `try { headers['X-CSRF-Token'] = await getCsrfToken() } catch {}` at L90 (create) and L392 (revoke/DELETE), and a raw GET loader at L361-362 that throws a generic 'Failed to load API keys' with no 401 session-expired routing. The duplication is real and widespread: DangerZoneSection L72, AzureCredentialsSection L185/207/384, AzureHostsAllowlistSection L211/305, LicensePlanSection L344 all hand-roll the same getCsrfToken() dance for mutations; UsageDashboard L45 and AuditLogSection L77 use raw fetch GET loaders bypassing apiCall/401 handling. The described failure modes are genuine: a rotated CSRF token (post re-login) makes create/revoke/delete fail permanently because these call sites lack the csrf_invalid retry, and loader 401s show a local error instead of re-login. Two reasons to adjust down from high: (1) the finding's component list is partly inaccurate -- AIConfigSection routes its MUTATIONS through fetchWithRetry (L175, L226, L268); only its GET loader at L78 bypasses the layer, so it is not a 'hand-rolled CSRF injection' offender for mutations as stated. (2) Impact is a resilience/UX-consistency gap with a narrow trigger (session/token rotation mid-session) and graceful degradation -- CSRF protection itself is still server-enforced and unbroken, so this is not a security hole or data-loss issue. Medium is the better fit for a duplicated correctness/UX defect behind a specific trigger.

**DM-28. Inline delete-confirm pattern + RowDb delete logic duplicated verbatim between AzureCredentialsSection and AzureHostsAllowlistSection**
`src/components/Settings/AzureCredentialsSection.jsx:155-354, 289-324`  —  risk: **low** · confidence: high
- *Problem:* CredentialRow (AzureCredentialsSection lines 289-324) and RowDb (AzureHostsAllowlistSection lines 250-285) contain byte-for-byte identical inline confirm UI: same Cancel-first ordering comment, same confirmBtnRef/deleteBtnRef focus management, same useEffect(confirming->focus), same cancelConfirm with requestAnimationFrame, same Escape onKeyDown handlers, and the same handleDelete shape (getCsrfToken().catch + DELETE + json error parse). This is a ~40-line copy-paste across two files.
- *Fix:* Extract an <InlineConfirmDelete onConfirm deleting label/> component (owning the two refs, focus restore, and Escape handling) and a shared deleteWithCsrf(url) helper. Both rows then become thin wrappers.

**DM-29. UsageBar / formatLimit / 'Infinity' handling duplicated from ApiKeysSection's UsageMeter and LicensePlanSection seat bar**
`src/components/Settings/UsageDashboard.jsx:4-31, 33-36`  —  risk: **low** · confidence: high
- *Problem:* Three near-identical progress-bar+limit primitives exist: UsageDashboard.UsageBar (line 4), ApiKeysSection.UsageMeter (line 35), and LicensePlanSection's inline seat bar (line 204-211). Each re-implements the same logic: detect unlimited (`max===Infinity \|\| 'Infinity' \|\| >1000`), clamp pct to 100, and colour-threshold (red>80/amber>60 vs >90/>70 — inconsistently). The `isInf` test in UsageBar and `formatLimit` repeat the exact same five-way Infinity check (lines 5, 34).
- *Fix:* Extract a shared <UsageBar current max colorThresholds> (and a formatLimit util) into src/components/ui or src/utils. Replace all three call sites. This also fixes the silent inconsistency where one bar turns red at 80% and another at 90%.

**DM-30. SIGNAL_LABELS map duplicated across two components with divergent casing**
`src/components/Settings/WorkBoard/SearchFilterBar.jsx:9-18 (vs RepoRow.jsx:8-16)`  —  risk: **low** · confidence: high
- *Problem:* SearchFilterBar defines SIGNAL_LABELS as Title Case ('Review requested', 'Authored', 'Assigned'...) and RepoRow defines a second SIGNAL_LABELS as lowercase ('review requested', 'authored PR', 'assigned issue'...). They also disagree on wording ('Authored' vs 'authored PR', 'Assigned' vs 'assigned issue'). Same signal keys, two literal tables — the user sees inconsistent labels for the same concept in the filter chips vs the row metadata, and the SIGNAL_ORDER constant only lives in one of them.
- *Fix:* Extract a single signal config (key → { label, order }) into a shared module (e.g. src/utils/workBoardSignals.js) and consume it in both. Pick one canonical label per signal; use CSS text-transform if a lowercase visual variant is needed in RepoRow.

**DM-31. WorkBoardSectionHeader and AIConfig SectionHeader are byte-for-byte identical components**
`src/components/Settings/WorkBoard/WorkBoardSectionHeader.jsx:1-27 (vs AIConfig/SectionHeader.jsx:1-27)`  —  risk: **low** · confidence: high
- *Problem:* WorkBoardSectionHeader.jsx and SectionHeader.jsx have the same props (step/title/description/meta), same markup, same classes, same padStart(2,'0') step rendering. The only differentiation the WorkBoard doc comment claims ('its own tonal accent') is not actually present — both use text-[color:var(--ds-accent-brand)] / indigo-300. Two copies drift independently over time.
- *Fix:* Delete WorkBoardSectionHeader and import the single shared SectionHeader (move it to src/components/ui/ if a neutral home is wanted). If a tonal variant is genuinely desired, add an `accent` prop to the shared one rather than forking the file.

**DM-32. Hand-rolled CSRF + fetch boilerplate duplicated across every mutation**
`src/components/Teams/TeamDetails.jsx:90-162, 566-595, 729-751; TeamHub.jsx 51-111; Setup/SystemSetup.jsx 22-29; Pricing/PricingPage.jsx 171-204`  —  risk: **low** · confidence: high
- *Problem:* Every mutating handler repeats the same block: `const headers = { 'Content-Type': 'application/json' }; try { headers['X-CSRF-Token'] = await getCsrfToken(); } catch {} ; fetch(url,{method,credentials:'include',headers,body:JSON.stringify(...)})`. It appears ~10 times in TeamDetails alone (handleInviteGivenUsername, handleAssignRepoDirectly, handleUpdateRole, handleRemoveMember, RepoCard.handleInvite, ActionsTab.handleRunWorkflow), again in TeamHub (handleSubmit, handleDelete), SystemSetup, and PricingPage. The shared layer in src/utils/api.js already exposes apiCall/fetchWithRetry which handle credentials and (per the module) retry/error semantics; this bespoke duplication means CSRF/credentials behavior is maintained in a dozen copies and bypasses the retry/error layer the rest of the app relies on.
- *Fix:* Add a thin mutate helper (e.g. apiCall(url,{method,body}) that injects the CSRF header once and routes through fetchWithRetry), then replace the inline header-building blocks with it. Centralizes the `catch {}`-swallow-then-let-server-403 policy in one place.

**DM-33. Identical accent/status border tables duplicated across Input, Textarea (and partly Select)**
`src/components/ui/form/Input.jsx:44-53`  —  risk: **low** · confidence: high
- *Problem:* Input.jsx (lines 44-53) and Textarea.jsx (lines 25-34) contain byte-for-byte identical `accentBorder` and `statusClass` ternary tables (indigo/emerald focus accents, error/success/idle border tints). Select.jsx repeats the same visual vocabulary inline. Three primitives that explicitly aim to "share the visual language" each re-declare it, so a tweak to the focus ring or error tint must be made in 2-3 places and will silently drift.
- *Fix:* Extract a tiny shared helper (e.g. `fieldBorderClasses({ tone, status })` in form/ or in _variants.js) returning the accent+status string, and call it from Input, Textarea, and the Select search input. No behavior change — pure consolidation of the literal class tables.

**DM-34. ChipStrip + RowHover component duplicated near-verbatim between StalePRsTab and MyReviewsTab**
`src/components/WorkBoard/tabs/StalePRsTab.jsx:23-144`  —  risk: **low** · confidence: high
- *Problem:* StalePRsTab's local ChipStrip (lines 23-60) and StalePRRow hover/showChips/hoverTimer logic (66-144) are near-identical to MyReviewsTab's ChipStrip (27-64) and ReviewRow (70-144): same 300ms hover timer, same Snooze-7d chip markup, same View-on-GitHub anchor, same Sparkles overlay, same isFocused ring. Only the icon tone (amber vs purple), ageDays-vs-ageHours field, and presence of Approve/RequestChanges differ. The PingAuthorPopover/AnimatedChipStrip were already extracted; the rest was not, so two copies must be kept in sync.
- *Fix:* Extract a shared WorkBoardRow (or useRowHover hook + RowChipStrip) into shared/ that takes the icon tone, age renderer, and an optional inline-actions slot. Both tabs then become thin mappers, matching the existing extraction pattern documented in PingAuthorPopover's header comment.

**DM-35. Identical runAction(undo/toast) wrapper copy-pasted across three components**
`src/components/WorkBoard/WorkBoardRowMenu.jsx:33-57`  —  risk: **low** · confidence: high
- *Problem:* The runAction helper that calls a tracked-repo mutation, checks result.operation_id, shows a success toast with an Undo action wired to hook.undo, and falls back to toast.errorFromException is duplicated verbatim in WorkBoardRowMenu.jsx (33-51), TrackedChip.jsx (14-32), and ManageReposButton.jsx (26-43). Three copies of the same optimistic-undo pattern drift independently.
- *Fix:* Hoist a useTrackedRepoAction() hook (or a runTrackedAction(hook, toast) util) returning the runAction closure, and consume it in all three components.

**DM-36. The CSRF-aware fetch wrapper is copy-pasted across at least three hooks**
`src/hooks/useReviewAction.js:7-26`  —  risk: **low** · confidence: high
- *Problem:* The `call()` helper (MUTATION_METHODS set, getCsrfToken on mutate, credentials:'include', json-or-{} parse, error with .status/.code) is duplicated nearly verbatim in useReviewAction.js (7-26), useWorkBoardPresets.js (9-27), and useRepoDetail.js apiFetch (6-40), with useDevToolkit/useStreaming hand-rolling the same CSRF header logic. Five parallel implementations of the same request envelope drift independently (e.g. only some forward `err.code`).
- *Fix:* Extract one shared `apiFetch`/`csrfFetch` util (in src/utils/api.js where getCsrfToken already lives) returning normalized json + error.status/.code, and have these hooks import it.

**DM-37. Two parallel hooks re-implement the same Work Board count fetching**
`src/hooks/useWorkBoardBadgeCounts.js:42-77 (and src/hooks/useYourWork.js 63-126)`  —  risk: **med** · confidence: high · verify: adjusted
- *Problem:* useWorkBoardBadgeCounts and useYourWork are near-identical parallel implementations: both fetch /api/v1/work-board/my-reviews?limit=50 and /stale-prs?limit=50, both duplicate the isProOrAbove(tier) gating to avoid a 403, both hardcode the same mock counts (my-reviews=5, stale-prs=10), both poll/refresh on focus/visibility, and both maintain their own count math. useYourWork additionally fetches my-issues. Neither shares a cache with the other nor with useWorkBoard.js's useMyPendingReviews/useStalePRs (which fetch the SAME endpoints but via the swrCache module-level cache). When the Work Board view is open and the sidebar badge is shown, /my-reviews is fetched by at least two independent hooks with no coalescing — wasted round-trips plus drift risk (the badge count and the tile count are computed by different code paths and can disagree).
- *Fix:* Extract the shared 'fetch a work-board count for an endpoint, with Pro gating + mock map' into one helper (or fold the badge count into useYourWork's already-richer state). Route all three consumers (badge, Your Work tiles, Work Board panels) through the existing swrCache so /my-reviews and /stale-prs are fetched once per TTL and shared. Keep the per-surface presentation separate but the fetch/cache layer single.
- *Verifier (severity adjusted):* All factual claims confirmed by reading the files. useWorkBoardBadgeCounts.js:42-77 and useYourWork.js:63-126 are near-identical parallel implementations: both fetch /api/v1/work-board/my-reviews?limit=50 and /stale-prs?limit=50 (badge L53/55; yourwork ENDPOINTS L5-6); both duplicate isProOrAbove(tier) gating with the same 403-avoidance comment (badge L50-56; yourwork L78-84); both hardcode the same mock counts my-reviews=5 / stale-prs=10 (badge L28-29; yourwork L13-14, plus yourwork adds my-issues=3); both refresh on tab activation (badge: interval + focus L67-69; yourwork: visibilitychange L115-123); both maintain their own count math. Neither uses useWorkBoard.js's module-level swrCache (badge uses localStorage CACHE_KEY; yourwork uses sessionStorage 'your-work:'; useWorkBoard.js uses getCached/setCached at L12/42/87). Consumers are mounted concurrently: Header.jsx:59 uses the badge hook, WhatNeedsYouGrid.jsx:146 (Dashboard) uses useYourWork, so /my-reviews?limit=50 is fetched by at least two independent uncoalesced hooks. Drift risk is real (different refresh cadences, different caches, separate count math). Real issue. Severity adjusted to medium: this is a deduplication/maintainability concern with bounded blast radius (one sidebar badge + dashboard tiles, redundant fetches every ~5min/on-focus) and only count-drift as user impact, not a correctness or security bug warranting high.

**DM-38. Model pricing duplicated across providerModels.js and providerPricing.js**
`src/utils/providerModels.js:31, 45, 59, 75, 89, 103, 117, 130, 143, 156, 172, 186, 200, 214, 228, 242, 256, 270, 281, 292, 303 (every model's pricing: block) vs src/utils/providerPricing.js:14-44`  —  risk: **low** · confidence: high
- *Problem:* Each entry in COMPLETION_MODELS embeds a `pricing: { input, output, currency, per }` object that is byte-for-byte identical to the value keyed by the same model id in PROVIDER_PRICING (providerPricing.js). E.g. gemini-2.5-flash is `{ input: 0.30, output: 2.50, ... }` in both files; claude-opus-4-7, gpt-5.4-mini, etc. all repeat. This is two sources of truth for the same numbers: a price change (the file is dated, PRICING_LAST_UPDATED='2026-05-12') must be edited in two places and will silently drift. getPricingForModel() and the inline `pricing` field can return different numbers for the same model.
- *Fix:* Keep PROVIDER_PRICING as the single source. In providerModels.js, drop the inline `pricing` object and have consumers resolve price via getPricingForModel(model.id), or build the inline field at module-load time from PROVIDER_PRICING (e.g. `pricing: PROVIDER_PRICING[id]`). Add a unit test asserting every COMPLETION_MODELS id has a matching PROVIDER_PRICING entry so they cannot drift.


#### Low · 24

**DL-1. escapeWiql duplicated across azure-service and work-item-service**
`server/azure-service.js:663-665`  —  risk: **none** · confidence: high
- *Problem:* Identical escapeWiql(value) => value.replace(/'/g, "''") helpers are defined in both server/azure-service.js (line 663) and server/work-item-service.js (line 17). Two copies of a security-relevant escaping primitive risk drifting (one getting hardened, the other not). The same WIQL-building logic (TeamProject filter + type IN list) is also re-implemented in both files.
- *Fix:* Extract escapeWiql (and ideally a buildWiql helper) into a single shared lib module (e.g. lib/wiql.js) and import it in both services so the escaping rule has one source of truth.

**DL-2. Fence-escape sanitisation (FENCE_ESCAPE_RE) and suggestion-cap logic duplicated across pr-deep-review and pr-commands**
`server/lib/ai-features/pr-deep-review.js:8, 190-197`  —  risk: **low** · confidence: high
- *Problem:* Both pr-deep-review.js and pr-commands.js define the same `const FENCE_ESCAPE_RE = /`{7,}/` and independently implement 'strip the suggestion field if it contains a long backtick run or exceeds the char cap' logic (postProcess vs postProcessImprove). pr-deep-review-publish.js separately reimplements safe fencing via `pickFence`. Three slightly different defenses against the same backtick-fence-break attack invite drift where one path is hardened and another isn't.
- *Fix:* Extract a shared `sanitizeSuggestion(text, maxChars)` (and reuse `pickFence`) into a single ai-features util so all command/review/publish paths share one fence-injection defense.

**DL-3. daysSince/hoursSince and JSON-parse helpers reimplemented in multiple slice files**
`server/lib/event-aggregations.js:29`  —  risk: **low** · confidence: medium
- *Problem:* daysSince/hoursSince exist in event-aggregations.js (29-37), attention-feed.js (33-41, with a now-arg variant), and work-board-github.js (26-27). The defensive try/catch JSON.parse('[]') pattern for labels/assignees is hand-rolled at least 5 times in event-aggregations.js (lines 205, 209, 393, 398) and elsewhere. Same percentile helper `p(pct)` is copy-pasted in leadTimeForChanges (302) and meanTimeToRecovery (528).
- *Fix:* Extract a tiny time-delta util and a safeJsonArray(raw) helper into a shared module (dates.js already exists and is imported by kpi-snapshots), and hoist the percentile function to a shared stats helper. Reduces surface area and keeps the rounding/edge-case logic consistent.

**DL-4. createInMemoryRateLimiter and createCooldownLimiter diverge: no stop() and no test-skip on the sliding-window limiter**
`server/lib/in-memory-rate-limiter.js:40-97 vs 104-164`  —  risk: **low** · confidence: high
- *Problem:* The two factories in this same file are near-parallel implementations but inconsistent: createCooldownLimiter skips the sweep interval under NODE_ENV==='test'/VITEST and exposes stop() to clear it, while createInMemoryRateLimiter unconditionally starts a setInterval and exposes no stop(). Tests that build many sliding-window limiters leak intervals (mitigated only by unref), and the two return shapes differ for no functional reason. This is exactly the 'one file's fix never reaches the other' hazard the module was created to eliminate.
- *Fix:* Factor the shared sweep-timer lifecycle (test-skip + unref + stop()) into one helper used by both factories, and add stop() + the test-skip to createInMemoryRateLimiter so both expose an identical control surface.

**DL-5. stripMarkdownFences duplicated verbatim across three files**
`server/lib/providers/openai.js:30-32`  —  risk: **none** · confidence: high
- *Problem:* The identical stripMarkdownFences implementation (`text.replace(/```json/g,'').replace(/```/g,'').trim()`) is copy-pasted in server/lib/ai-provider.js:321-323, server/lib/providers/openai.js:30-32, and server/lib/providers/anthropic.js:32-34. The shared error helpers (toAIError, throwIfCanceled) were already extracted into ai-provider.js and imported by the providers; this one was missed. Three copies means a fence-handling fix (e.g. handling ```JSON uppercase or leading whitespace) must be made in three places.
- *Fix:* Export stripMarkdownFences from ai-provider.js (alongside throwIfCanceled/toAIError which the providers already import) and delete the two provider-local copies.

**DL-6. Next-month-reset timestamp and per-tier feature labels are recomputed/duplicated across the meter module**
`server/lib/usage-meter.js:116-117, 160, 53-55`  —  risk: **low** · confidence: medium
- *Problem:* The 'first of next month UTC' resetAt is computed identically in quotaExceededResponse (116-117) and quotaErrorPayload (160). Separately, two overlapping label maps exist: METRIC_TO_FEATURE (47-58) and FEATURE_LABELS (102-108), and quotaExceededResponse hardcodes the upgrade target 'pro'/'/pricing' that the rest of the billing surface also hardcodes elsewhere. The deprecated quotaErrorPayload (per its own comment) has no production callers yet still carries a full second implementation of the reset/label logic.
- *Fix:* Extract a `nextMonthResetAtIso(now)` helper and reuse it in both builders; consider deleting quotaErrorPayload now that the comment confirms it has zero production callers (keep only if the pinning test is still wanted, in which case move it into the test file).

**DL-7. snapshotForUndo and snapshotRow are identical functions**
`server/lib/work-board-tracking.js:14`  —  risk: **none** · confidence: high
- *Problem:* snapshotForUndo (line 14) and snapshotRow (line 25) return the exact same object shape from the same row fields. The doc comments claim they differ ('only columns that matter for reverting' vs 'includes source_signal for UI') but both already include source_signal — they are byte-for-byte equivalent. This is dead duplication that misleads future readers into thinking the undo snapshot is narrower than the UI snapshot.
- *Fix:* Delete one and use the other for both call sites, or if a genuine divergence is intended, make the bodies actually differ. As-is, collapse to a single snapshot helper.

**DL-8. Email-DLQ and Webhook-DLQ handlers are near-identical copy-paste pairs**
`server/routes/admin-dlq.js:82-233`  —  risk: **low** · confidence: high
- *Problem:* The two DLQ surfaces (email_dead_letter and webhook_events_dead_letter) implement list / fetch-by-id / retry / soft-delete as four pairs of almost-identical handlers differing only in table name and projected columns. The resolved-filter SQL assembly, limit/id parsing, 404-on-zero-changes logic, audit action string, and error envelopes are duplicated verbatim. ~250 lines could be ~80 via a small factory makeDlqRouter({ table, listCols, fullCols, auditPrefix }).
- *Fix:* Introduce a factory that takes the table name, the listing/full column sets, and an audit-action prefix, and emits the four routes. Mount it twice (email, webhook). Table/column names come from a hardcoded config object (never request input) so parameterization safety is preserved.

**DL-9. Identical owner/repo/pr param validators duplicated across pr-chat, pr-commands, and deep-review**
`server/routes/ai/pr-chat.js:101-120`  —  risk: **low** · confidence: high
- *Problem:* The `GITHUB_NAME_RE` constant plus the three `router.param('owner'\|'repo'\|'pr', ...)` validators are byte-for-byte identical in pr-chat.js (101-120), pr-commands.js (100-119), and deep-review.js (68-87). The PR-context fetch via gh-cache (readThrough pulls + pull_files) is likewise duplicated between pr-chat (188-211) and pr-commands' fetchPRContext (131-156).
- *Fix:* Move the shared param validators into a small `applyPRParams(router)` helper and the PR/files fetch into a shared `fetchPRContext` in shared.js (or a new ai/pr-shared.js), then import in all three routers.

**DL-10. Tier resolution literal and per-user feature lookup duplicated across api-keys/usage/billing routes**
`server/routes/audit.js:25-41`  —  risk: **low** · confidence: medium
- *Problem:* The pattern `req.session.user?.tier \|\| req.userTier \|\| 'free'` then getFeatures(tier) is repeated in api-keys.js (lines 20-21, 41-42) and the tier/flags resolution recurs in usage.js (lines 19-20) and billing logic. Each route re-derives the active tier and feature flags slightly differently (some via req.session.user?.tier, some via getUserTier(userId), some via req.userTier), which is both duplicated and a correctness hazard — a stale req.session.user.tier can disagree with the authoritative getUserTier(userId).
- *Fix:* Standardize on a single helper/middleware (attachTier already exists in require-tier.js) that always populates req.userTier via getUserTier(userId), and have api-keys/usage read only req.userTier. Remove the req.session.user?.tier fallback so the authoritative subscription/license tier is the single source of truth.

**DL-11. validate/projects/repos handlers re-implement the org+host+pat resolution that resolveAzureContext already centralizes**
`server/routes/azure/proxy.js:14-61,116-148`  —  risk: **med** · confidence: medium
- *Problem:* _shared.js provides resolveAzureContext to centralize the org/host/pat quartet, and most endpoints (wikis, work-items, project-info, branches, activity, etc.) use it. But /azure/validate, /azure/projects and /azure/repos hand-roll the same four steps (org required check, host=DEFAULT_AZURE_HOST + isValidGitHubUsername guard, resolvePatFromRequest, resolveHost) inline — three near-duplicate copies of ~12 lines each. The only real difference is /azure/validate returns 200 {valid:false} instead of an error status when the PAT is missing.
- *Fix:* Route these through resolveAzureContext with options (e.g. { requireProject:false } for validate/projects, and a softMissingPat flag for validate's 200-vs-401 PAT behavior). Removes ~30 lines and makes the org-name/host validation consistent with the rest of the router.

**DL-12. Mock-mode detection re-derived inline instead of reusing MOCK_MODE / isMockMode**
`src/App.jsx:139, 322`  —  risk: **none** · confidence: high
- *Problem:* The app already imports MOCK_MODE from config.js (line 10) and receives isMockMode from useGitHub (line 163), but two effects re-derive mock mode inline with `import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true'` (lines 139 and 322). This is a third parallel definition of the same concept; the env-string comparison is duplicated and easy to get subtly wrong (e.g. MOCK_MODE already encodes the === 'true' check). Three sources of truth for 'are we in mock mode' invite divergence.
- *Fix:* Extract a single exported helper in config.js, e.g. `export const IS_E2E_MOCK = import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true'`, and import it at both call sites so the DEV-guarded mock predicate is defined once.

**DL-13. formatTimestamp duplicated verbatim across the two DLQ components**
`src/components/Admin/DLQTable.jsx:20-28; Admin/DLQDetailPanel.jsx 21-27`  —  risk: **none** · confidence: high
- *Problem:* The SQLite-UTC-aware `formatTimestamp` helper (treating space-separated timestamps as UTC by appending 'Z') is copy-pasted identically in DLQTable.jsx and DLQDetailPanel.jsx. Both sit in the same Admin folder and parse the same backend timestamps, so any timezone fix must be made in two places.
- *Fix:* Extract to a shared util (e.g. src/utils/datetime.js) and import in both DLQ components; this matches the existing pattern of shared hooks like useStickyHeaderShadow they already both import.

**DL-14. Dismissible banner state/handler logic duplicated between the two AI banners**
`src/components/AI/AINotConfiguredBanner.jsx:22-37`  —  risk: **low** · confidence: medium
- *Problem:* AINotConfiguredBanner and AINotHealthyBanner (src/components/AI/AINotHealthyBanner.jsx lines 23-32) carry identical reduced-motion variant selection, `useState(false)` dismissed flag, `if (dismissed) return null`, and `handleDismiss` (setDismissed + onDismiss?.()), plus an identical dismiss `<button>` block. Two near-identical banners differing only in tone/copy/CTA is a parallel implementation that will drift.
- *Fix:* Extract a shared `<DismissibleBanner tone title description cta dismissible onDismiss>` shell (handling motion variants + dismiss state + the X button) and have both banners render through it with their specific copy/CTA.

**DL-15. Source badge and formatBytes/confidence styling duplicated across AI components**
`src/components/AI/PremiumRationale.jsx:9-13, 17-30`  —  risk: **low** · confidence: high
- *Problem:* PremiumRationale defines a local `formatBytes` and an inline AI/Heuristic SourceBadge (lines 17-30). SuggestNameDescriptionModal.jsx (lines 17-30) defines a byte-for-byte identical `SourceBadge`, and FileTreePicker.jsx/PremiumRationale.jsx each define their own `formatBytes` with slightly different output (`KB` vs `B`/` B`). The confidence dot/label map also reappears (PolishReview.jsx inlines the same high/medium/low → emerald/amber/rose mapping at lines 158-162). These are copy-pasted presentation primitives that should be shared.
- *Fix:* Extract a shared `<AISourceBadge source>` component, a single `formatBytes` util, and a `confidenceTone(level)` helper into ui/ (or a small ai/ shared module) and import them in PremiumRationale, SuggestNameDescriptionModal, FileTreePicker and PolishReview.

**DL-16. Repo predicate/classification logic duplicated across QuickFilters, SmartSelectMenu and risk rules**
`src/components/MigrationWizard/steps/RepoSelectStep/QuickFilters.jsx:4-12`  —  risk: **low** · confidence: medium
- *Problem:* Repo-category predicates (risk?.level==='ok' && !isDisabled for 'recommended', stale flag check, archived, blockers, large >1GiB, tfvc, name-conflict) are defined as CHIP_DEFS here and again, nearly identically, as PRESETS in SmartSelectMenu.jsx:6-15 (recommended/active/exclude-stale/exclude-blockers). The 'large' threshold (1024^3) is also a separate literal from SIZE_CRITICAL_BYTES used by AutoFixDrawer. These should share one predicate catalog so a definition of 'recommended'/'stale'/'large' can't drift between the filter chips and the smart-select menu.
- *Fix:* Extract a single repoPredicates module (id -> { label, icon, match }) consumed by both QuickFilters and SmartSelectMenu, and reference SIZE_CRITICAL_BYTES (or a shared LARGE_REPO_BYTES) instead of the inline 1024*1024*1024 literal.

**DL-17. ExistingProjectForm re-implements the existing useAzureProjectData projects loader**
`src/components/MigrationWizard/steps/TargetConfigStep/AzureTargetForm.jsx:112-141`  —  risk: **med** · confidence: high · verify: adjusted
- *Problem:* ExistingProjectForm contains a bespoke `useEffect` + `fetch('/api/azure/projects')` + loading/error state machine to list Azure projects. This is a near-verbatim parallel implementation of `src/components/MigrationWizard/hooks/useAzureProjectData.js` (lines 74-106), which already returns `{ azureProjects, projectsLoading }` from the same endpoint, with the same cancellation guard, and with the correct credential payload. Maintaining two copies means fixes (like the credential-payload fix above) must be made twice and will drift — useAzureProjectData already has the correct `azureCredPayload` spread while this copy does not.
- *Fix:* Delete the local effect/state in ExistingProjectForm and consume `useAzureProjectData({ isAzureDevops: true, source, targetProject: source.azureTargetProject })` (or extract a thinner `useAzureProjects(source)` hook the two callers share). Render the picker from `azureProjects`/`projectsLoading`.
- *Verifier (severity adjusted):* REAL. ExistingProjectForm (AzureTargetForm.jsx:112-141) contains a bespoke useEffect + fetch('/api/azure/projects') + loading/error state that duplicates the projects loader in useAzureProjectData.js:74-106 — same endpoint, same cancellation guard, same purpose. The drift concern is valid: the hook spreads ...azureCredPayload(source) (line 94) while this copy hand-builds host/org/pat, so the idx-0 credential fix would have to be applied twice. Confirmed not byte-identical (the hook returns {id,name} and has no inline error state; the form keeps a local error string and renders it), so it is a code-reuse/maintainability finding, not a behavioral bug. Severity adjusted from high to low: a pure deduplication finding with no correctness or security impact of its own (the credential divergence is already captured under idx 0) is a low-priority cleanup, not high.

**DL-18. AI-comment _idx stamping duplicated between PRReviewView and AIReviewPanel**
`src/components/PRReview/PRReviewView.jsx:94-97`  —  risk: **low** · confidence: medium
- *Problem:* PRReviewView builds stampedAIComments by mapping draft.lineComments to add a stable _idx (94-97). AIReviewPanel independently re-derives the exact same array with the same map for CommentsListTab (AIReviewPanel.jsx:30-33). Both consume the same deep.draft.lineComments and must stay in lockstep on what _idx means (the dismiss/edit target), so the canonical-index convention lives in two places.
- *Fix:* Stamp _idx once at the source — inside useAIDeepReview when it produces draft.lineComments — and have both PRReviewView and AIReviewPanel consume the already-stamped array.

**DL-19. Inline success/error 'message' banner reimplemented in four tabs**
`src/components/RepoDetail/IssuesTab.jsx:162-168; PullRequestsTab.jsx:191-197; BranchesTab.jsx:157-163; ReleasesTab.jsx:97-103`  —  risk: **med** · confidence: high
- *Problem:* BranchesTab, IssuesTab, PullRequestsTab, and ReleasesTab each carry an identical `const [message, setMessage] = useState(null)` plus the same JSX banner block (CheckCircle2/XCircle + green/red classes). This duplicates an inline status banner that the app already largely supersedes with `toast` (all four also call toast on the same paths), so the message state is both copy-pasted and partially redundant with the toast it sits next to.
- *Fix:* Either extract a shared <InlineStatusBanner type text /> component, or (preferred) drop the local `message` state entirely where a toast already covers the same event, removing ~10 lines of duplicated state+JSX per tab.

**DL-20. Bespoke INPUT_CLS duplicates the shared ui/form Input styling**
`src/components/Settings/AIConfig/constants.js:14-18 (used in ModelCombobox.jsx:114)`  —  risk: **low** · confidence: medium
- *Problem:* constants.js defines INPUT_CLS (border/rounded-xl/focus-ring/dark variants) that visually reimplements the shared <Input> from components/ui/form, which ProviderFields and EmbeddingSection already use for every other text field. ModelCombobox's no-options fallback branch (line 107-116) and its combobox input (line 140) use this raw class instead of the shared component, so the model input can drift from the rest of the form's styling and a11y affordances over time.
- *Fix:* Use the shared <Input> for the no-options fallback, and have the combobox input adopt the same base classes the shared Input exposes (or a shared className export from ui/form) so there is one input style source of truth.

**DL-21. Cents→USD formatting reimplemented three times with inconsistent null handling**
`src/components/Settings/WorkBoard/ai/AIActivityCard.jsx:4-6 (vs ai/WorkBoardCapReachedBanner.jsx:5-9)`  —  risk: **low** · confidence: high
- *Problem:* AIActivityCard has centsToUsd(c) => `$${(c/100).toFixed(2)}`; WorkBoardCapReachedBanner has formatCents(cents) with a null guard; ModelRow.jsx:12 has its own formatDollars(n). All three format a number as a dollar string, none shared. The two AI ones differ only in null-handling, which is exactly the kind of subtle divergence that causes '$NaN' bugs when one call site forgets the guard.
- *Fix:* Add a single formatUsdFromCents(cents) (and reuse the existing currency formatter if one already lives in src/utils/format.js alongside formatRelativeTime) and import it in both AI components; route ModelRow through the shared money formatter too.

**DL-22. SIZE_CLASSES / SHEET_SIZE_CLASSES duplicate the same width scale with only an md: prefix**
`src/components/ui/Modal.jsx:30-48`  —  risk: **none** · confidence: medium
- *Problem:* Modal defines two near-identical size tables (lines 30-48): SHEET_SIZE_CLASSES is SIZE_CLASSES with every value prefixed by `md:`. Any future size tweak must be mirrored in both or the desktop/sheet widths silently diverge. The comment already warns that Tailwind needs static literals, so they can't be programmatically prefixed — but the two tables are still a maintenance hazard worth flagging.
- *Fix:* Keep both literal tables (required for JIT) but co-locate them with a comment cross-link, or generate SHEET via a build-time/codegen step that emits literals. Lowest-risk option: a unit test asserting the two tables stay in lockstep (same keys, sheet = md:+base). Pure safety net, no runtime change.

**DL-23. Inline AI-search debounce re-implements existing debounce hooks**
`src/hooks/useRepoFiltering.js:88-114`  —  risk: **low** · confidence: medium
- *Problem:* useRepoFiltering hand-rolls a 500ms setTimeout/clearTimeout debounce inside a useEffect for the AI search, while the codebase already ships useDebounce(value, ms) and useDebouncedCallback(fn, ms) — both in this hooks directory — that exist precisely to avoid this boilerplate. The inline version also re-fires the effect on every searchQuery keystroke and re-creates the timer.
- *Fix:* Debounce searchQuery via useDebounce(searchQuery, 500) and run the aiApi.search effect off the debounced value, deleting the manual timer bookkeeping. Behaviour (500ms, >2 chars, abort on change) is preserved with less code.

**DL-24. Magic millisecond literals re-derived despite time.js constants existing**
`src/utils/time.js:30-43`  —  risk: **none** · confidence: high
- *Problem:* time.js exists specifically to centralize ms-per-unit constants, yet several siblings in the same slice re-derive them inline: format.js uses `86_400_000`, `3_600_000`, `60_000` (lines 199-203) and `/ 1000` everywhere; providerModels.js isNewModel computes `const dayMs = 24*60*60*1000` (line 376); statsAggregator/prRisk correctly import MS_PER_DAY. This is the exact duplication time.js's own header comment says it was created to kill, so the codified intent is being violated.
- *Fix:* Import MS_PER_DAY / MS_PER_HOUR / MS_PER_MINUTE from time.js in format.js and providerModels.js instead of inlining the literals. Pure refactor, identical values.


---

### 🪶 Simplification (64)

#### High · 1

**SH-1. Work-item migration ignores on-prem/VSTS host — hardcodes dev.azure.com**
`server/work-item-service.js:431-482`  —  risk: **low** · confidence: high · verify: confirmed
- *Problem:* task-runners.js (runWorkItems) passes `host: azureHost` into migrateWorkItems' config, but migrateWorkItems only destructures `{ org, project, types, labelMapping }` (line 432) and never reads config.host. The WIQL request is hardcoded to `https://dev.azure.com/${org}/${project}/_apis/wit/wiql` (line 452-453), and the follow-up `fetchWorkItems(org, project, pat, workItemIds)` (line 482) omits the host arg so it also defaults to dev.azure.com. For any on-prem TFS or *.visualstudio.com source the PAT is sent to the wrong host with an org/collection that does not exist there — work-item migration silently fails (404) for every non-cloud source the wizard explicitly advertises support for.
- *Fix:* Destructure `host` from config, route the WIQL POST through the host-aware azure-service (orgBaseFor(host, org)/azureFetch) instead of a literal dev.azure.com fetch, and pass `host` through to fetchWorkItems(org, project, pat, ids, host). Reuse azure-service.getWorkItemCounts' URL-building rather than re-implementing the fetch inline.


#### Medium · 12

**SM-1. Silent DROP TABLE of legacy tables during initDB**
`server/db.js:30-40`  —  risk: **med** · confidence: medium
- *Problem:* initDB iterates tablesNeedingUserId and, for any table that exists but lacks a user_id column, executes `DROP TABLE IF EXISTS ${table}` (line 38) — silently destroying all rows in repo_metadata, repo_embeddings, community_health_cache, workflow_runs, and workflows_meta on the next boot after an old schema. This is an irreversible data-loss path baked into normal startup. The ALLOWED_MIGRATION_TABLES guard only protects against table-name injection, not against the data loss itself, and there is no logging when a drop occurs.
- *Fix:* Replace the drop-and-recreate with an additive `ALTER TABLE ... ADD COLUMN user_id` migration (defaulting to 0) handled by the versioned runMigrations framework, or at minimum log.warn loudly before dropping so an operator can see data was discarded. Long term, retire this legacy path entirely once all deployments are past the user_id migration.

**SM-2. Embedding key-health probe always calls generate(), never embed() — embedding state is wrong**
`server/lib/ai-health-probe.js:139-165, 215-234`  —  risk: **low** · confidence: high
- *Problem:* runProbe() unconditionally calls `provider.generate({ prompt: 'ping' })` even when feature==='embedding'. resolveProvider(f) correctly resolves the embedding provider, but probing it with a chat completion is incorrect: for a dedicated OpenAI embedding provider this sends the embedding model name to /chat/completions and fails (reported as 'invalid'/'unknown'); for Anthropic/OpenRouter embedding providers it tests the wrong capability entirely. So keyHealth for the 'embedding' feature shown in /config/ai-status does not reflect whether the embedding key actually works.
- *Fix:* Branch on feature in runProbe: when feature==='embedding' call `await provider.embed('ping')` (and treat the NOT_FOUND thrown by Anthropic/OpenRouter as 'unknown'/'n-a' rather than 'invalid'); otherwise call generate() as today. Add a unit test for the embedding branch.

**SM-3. aiApi.search GET sends no CSRF but mixes contracts; getHeaders() is dead indirection**
`src/api/ai.js:180-202`  —  risk: **low** · confidence: high
- *Problem:* aiApi inconsistently uses three header strategies: getHeaders() (line 24, returns only Content-Type), mutationHeaders() (line 34), and inline literals. getHeaders() is only used on two GET requests (search line 189, getMetadata line 217) where a Content-Type request header on a body-less GET is meaningless, so it is pure dead indirection. Meanwhile the two AI client modules (ai.js 'placeholder' contract and aiFetch.js 'typed-throw' contract) duplicate 429/403/503 mapping, getAIStatus gating, and CSRF injection with subtly different behavior — the file itself flags the deferred unification (lines 11-14). The result is a large, hard-to-reason-about surface.
- *Fix:* Delete getHeaders() and drop the header arg from the two GETs. Track the documented ai.js/aiFetch.js unification (docs/architecture/ai-client-contracts.md) so the 429/403/503 + status-gating logic lives in one place instead of being maintained twice.

**SM-4. Unguarded duplicated JSON.parse on data.topics can throw and abort the whole fetch**
`src/components/AI/RepoInsightsModal.jsx:151-152`  —  risk: **low** · confidence: high
- *Problem:* fetchAnalysis does `if (typeof data.topics === 'string') data.suggested_topics = JSON.parse(data.topics)` immediately followed by `if (data.topics && !data.suggested_topics) data.suggested_topics = JSON.parse(data.topics)`. The two branches overlap (a string topics value satisfies both), the parse is duplicated, and neither is wrapped in try/catch — a malformed/non-JSON `topics` string (e.g. a plain comma list from an older index row) throws, lands in the catch as a generic error, and shows the AI error card instead of the insights. This is brittle normalization that belongs in the api layer.
- *Fix:* Normalize topics once with a guarded helper (try/catch returning [] on parse failure, and handling the already-array case), ideally in aiApi.getMetadata so the component just consumes `suggested_topics`. Remove the redundant second branch.

**SM-5. Suggestion dismissal keyed by array index breaks after first dismissal**
`src/components/DevToolkit/DevToolkitPanel.jsx:95-108`  —  risk: **low** · confidence: medium
- *Problem:* `filteredAnalysis` filters `suggestions` by index against `dismissedSuggestions`, and `handleDismissSuggestion(index)` stores the index emitted by SmartContextBar's `.map((s,i) => ...)`. But SmartContextBar maps over the ALREADY-filtered list, so its `i` is the post-filter position, while the filter compares against original positions. After dismissing one suggestion, every subsequent dismiss removes the wrong item (indices shift). SmartContextBar also uses `key={i}` (line 53), compounding the identity confusion.
- *Fix:* Dismiss by a stable identity (e.g. suggestion id or message string) rather than by index: store dismissed ids in a Set and filter `suggestions.filter(s => !dismissed.has(s.id))`. Use that same id as the React `key`.

**SM-6. OutputSection.jsx is dead code, superseded by StreamingOutput**
`src/components/DevToolkit/shared/OutputSection.jsx:1-68`  —  risk: **none** · confidence: high
- *Problem:* OutputSection is imported nowhere except itself (grep across src/ returns only the file). It is a near-duplicate of StreamingOutput.jsx (same copy-message/copy-as-git-command buttons, same `git commit -m "$(cat <<'EOF'...` builder, same CopyButton sub-component) minus the streaming affordances. CommitTab now uses StreamingOutput exclusively. Keeping it around invites accidental use of the stale variant and doubles maintenance of the shell-escaping logic.
- *Fix:* Delete src/components/DevToolkit/shared/OutputSection.jsx. If any of its plain (non-streaming) rendering is ever needed, derive it from StreamingOutput with `isStreaming=false`.

**SM-7. handleStartImport advances the wizard on success AND both failure paths**
`src/components/MigrationWizard/hooks/useWizardNavigation.js:83-102`  —  risk: **med** · confidence: medium
- *Problem:* All three outcomes (success, data.success===false, and the catch) call nextStep(). On failure the code sets jobStatus to 'failed' and then still advances to the progress step. Combined with the auto-advance effect (L31-39) that fires nextStep() when sourceType is first set, the navigation has multiple uncoordinated callers of nextStep(), making the step machine hard to reason about and risking a double-advance if handleStartImport is somehow invoked while the auto-advance tick is pending. The 'advance even on failure' behavior is plausibly intentional (so the progress step can show the error) but is undocumented and easy to break.
- *Fix:* Advance once at the end of handleStartImport regardless of branch (single nextStep() after the try/catch sets state), and add a comment that failure intentionally lands on Progress to surface jobStatus. Guard the auto-advance effect so it cannot race a manual advance.

**SM-8. Dead reducer cases and unused aiLoading state**
`src/components/PRReview/hooks/useReviewState.js:116-151`  —  risk: **low** · confidence: high
- *Problem:* ADD_SUBMITTED_COMMENT (135), REMOVE_PENDING_COMMENT (116) and SET_AI_LOADING (149) are never dispatched anywhere in the codebase (verified by grep). state.aiLoading (initialised line 68, written by SET_AI_SUMMARY/SET_AI_LOADING) is never read — PRReviewView consumes `aiLoading` from the useReviewAI hook return value, not from this reducer state. This is redundant state plus three dead branches that imply behaviour (optimistic submitted-comment insert, pending removal) that doesn't actually exist.
- *Fix:* Either wire ADD_SUBMITTED_COMMENT into the submit flow (see the optimistic-UI finding) and remove the others, or delete all three unused cases plus the aiLoading state field to keep the reducer honest about what the surface actually does.

**SM-9. BranchHygieneCard never receives the repo's real default branch**
`src/components/RepoDetail/BranchesTab.jsx:155`  —  risk: **low** · confidence: high
- *Problem:* BranchesTab renders `<BranchHygieneCard branches={branches} />` without passing `defaultBranch`, so the card falls back to the hardcoded default of 'main' (BranchHygieneCard.jsx:16). For any repo whose default branch is not 'main' (master, develop, trunk, etc.) the hygiene heuristics in computeBranchHygiene treat the actual default branch as a normal branch — it can be counted as a 'suspicious'/throwaway branch, included in prefix clusters, and skews the protected-ratio denominator. repoData.default_branch is already available in this component (used on lines 67, 227, 232, 242).
- *Fix:* Pass the known default branch through: `<BranchHygieneCard branches={branches} defaultBranch={repoData?.default_branch \|\| 'main'} />`.

**SM-10. Two parallel load implementations: standalone `load` and a near-identical inlined effect loader**
`src/components/Settings/AIInstructionsSection.jsx:392-426`  —  risk: **low** · confidence: high
- *Problem:* The component defines `load` (lines 392-404) used by the Retry button, then the mount effect (lines 406-426) re-implements the same fetch/setPrompts/setError/toast logic inline with a `cancelled` guard and an eslint-disable, instead of just calling `load()`. Two copies of the same loader drift apart over time and the duplicate body adds ~20 lines for no behavioral gain (the cancelled guard could live in load or be replaced by useTabData like the other admin sections).
- *Fix:* Replace the inlined effect body with `useEffect(() => { load() }, [])`, or migrate the whole section to the shared useTabData hook (already used by ProbeStatsSection/EnvironmentToolingSection) to get AbortController cancellation for free and delete `load` entirely.

**SM-11. ModalSticky re-implements footer layout the base Modal already provides**
`src/components/ui/ModalSticky.jsx:41-69`  —  risk: **med** · confidence: medium
- *Problem:* ModalSticky wraps <Modal> but deliberately does NOT pass `footer` to it; instead it renders its own body+footer inside Modal's children with hand-rolled sticky/safe-area classes (lines 45-68). The base Modal already has a full sticky-footer + safe-area-inset implementation (Modal.jsx lines 251-260, including `pb-[calc(1rem+env(safe-area-inset-bottom))]` for sheet mode). The result is two parallel footer systems: a consumer choosing ModalSticky vs Modal gets subtly different footer chrome (different min-height, padding, border treatment) for the same intent, and the mobile-keyboard/scroll-lock behavior diverges because ModalSticky measures viewport height itself instead of reusing Modal's hooks.
- *Fix:* Fold ModalSticky's needs into Modal (it already supports `mobileVariant="sheet"` with a sticky footer) and either delete ModalSticky or make it a thin alias that forwards `footer` to Modal. If the mobile max-height clamp is still wanted, express it via a Modal prop rather than a separate DOM tree.

**SM-12. Reading state via a setState callback that resolves a Promise is a fragile anti-pattern**
`src/hooks/useAIPolish.js:127-137`  —  risk: **low** · confidence: high
- *Problem:* To re-read the freshly-set `repoId`, the hook does `await new Promise(resolve => { setRows(prev => { resolve(prev.find(...)); return prev }) })`. Using a setState updater purely to read current state (returning `prev` unchanged) abuses React's batching, is non-obvious, and breaks under StrictMode double-invocation of updaters (the resolve can fire twice). The value it needs (`repoMeta.id`) was already in scope a few lines earlier at line 118.
- *Fix:* Capture `const repoId = repoMeta?.id ?? null` from the resolve at line 118 and use it directly for the null-check and the `aiApi.polish.getDescription(repoId, ...)` call, removing the Promise/setRows round-trip entirely.


#### Low · 51

**SL-1. Async run/get/all façade on the SQLite adapter is unused indirection**
`server/lib/adapters/sqlite-adapter.js:131-157`  —  risk: **low** · confidence: medium
- *Problem:* SQLiteAdapter exposes async run/get/all wrappers 'for adapter-agnostic code', but every route in the codebase uses the synchronous db.prepare(...).get/all/run path (the file's own comment says so), and the Postgres adapter is the only async consumer — which has its own implementation. These three async methods re-prepare statements on each call (no caching) and add a parallel API surface nobody calls, increasing the chance of someone picking the slow path by accident.
- *Fix:* Either delete the async façade from SQLiteAdapter until a caller actually needs it, or, if kept for interface parity, mark it clearly as not-for-hot-paths and reuse prepared statements. Verify with a grep that no production code calls adapter.run/get/all on the SQLite instance before removing.

**SL-2. Hand-rolled glob matcher via sentinel-token string replacement is fragile and hard to read**
`server/lib/ai-features/pr-deep-review.js:164-172`  —  risk: **low** · confidence: medium
- *Problem:* `globMatches` converts a glob to regex by mapping every `*` to a literal `__STAR__` sentinel, escaping the rest char-by-char, then doing two `.replace` passes to turn `__STAR____STAR__`→`.*` and `__STAR__`→`[^/]*`. It works for common cases (verified), but the sentinel approach breaks if a path/glob literally contains the token, doesn't support `?`/character classes, and is much harder to reason about than a single tokenizing pass. There is no anchoring difference between `**` mid-path vs trailing.
- *Fix:* Replace with a single regex builder that splits on `**`/`*` tokens explicitly, or adopt the project's existing minimatch/picomatch if one is already a dependency. At minimum drop the sentinel and build the pattern in one pass.

**SL-3. Audit anticipated-id derived from sqlite_sequence is fragile and only used to emit a warning**
`server/lib/audit.js:45-58`  —  risk: **med** · confidence: medium
- *Problem:* getStmts queries sqlite_sequence to predict the next rowid (anticipatedId) before insert, then auditLog/auditLogDirect compare it against the actual lastInsertRowid only to log a warning. sqlite_sequence exists only for AUTOINCREMENT tables and tracks the highest-ever id, so after any delete or on a non-AUTOINCREMENT schema the prediction can diverge even though the chain is still valid — producing spurious warnings. The computed hash itself already uses anticipatedId, so a divergence would actually break verifyAuditChain, not merely warrant a log line; the warning gives false comfort.
- *Fix:* Drop the sqlite_sequence pre-read and instead insert with a placeholder, read back lastInsertRowid, compute the hash from the real id, and UPDATE row_hash within the same transaction (or compute prev_hash/id deterministically without sqlite_sequence). This removes the AUTOINCREMENT assumption and makes the hash always match the stored id. If the current scheme is kept, document that it requires AUTOINCREMENT and never-deleted rows.

**SL-4. composeInbox dedupes by SECTION_PRIORITY but builds output from `requested` order, and stub-removal comment outlived its config**
`server/lib/dashboard-aggregator.js:129`  —  risk: **low** · confidence: medium
- *Problem:* dedupBySection is computed by iterating SECTION_PRIORITY, but the returned sections iterate `requested` (the caller's order). The mismatch works only because dedupBySection[key] defaults to [] — but it means a section present in requested yet absent from SECTION_PRIORITY would silently render empty. SECTION_PRIORITY and SECTION_KEYS are also two parallel arrays that must be kept in sync by hand (the long comment at 22-26 about removed stubs underlines how fragile this is).
- *Fix:* Derive both arrays from a single ordered SECTION_CONFIG (keys in priority order) and assert at module load that every requested key has a priority. Removes the two-list-in-sync hazard and the empty-section footgun.

**SL-5. addColumnIfMissing interpolates table/column/definition directly into SQL (safe today, fragile by construction)**
`server/lib/db-migrations.js:27-32`  —  risk: **none** · confidence: medium
- *Problem:* addColumnIfMissing builds `PRAGMA table_info(${table})` and `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}` via string interpolation. SQLite parameter binding can't bind identifiers, so this is unavoidable for DDL, and every current caller passes hardcoded literals — so there is no live injection. The risk is purely forward-looking: if a future migration ever feeds a non-literal here it becomes SQL injection with zero compile-time signal. Worth a guard given this is the security-critical slice.
- *Fix:* Add a cheap identifier allow-list assertion at the top of addColumnIfMissing (e.g. throw unless table/column match /^[A-Za-z_][A-Za-z0-9_]*$/), documenting that only trusted literals are permitted. Pure defence-in-depth; no behavior change for existing callers.

**SL-6. 'bytes' is actually UTF-16 code-unit length, so the byte budget can be exceeded by multibyte content**
`server/lib/repo-context-builder.js:93-103, 239`  —  risk: **low** · confidence: high
- *Problem:* `pushSection` truncates with `content.slice(0, byteCap)` and records `bytes: cleaned.length`. `.slice`/`.length` count UTF-16 code units, not bytes. For non-ASCII READMEs/manifests, the real UTF-8 byte size (what actually costs prompt tokens / what `byteCap` is meant to bound) can be 2-4x the reported value, so the 8192 'byte' cap and the custom-file budget math (`remaining`, `perFile`) under-count. The field name `bytes` is also misleading.
- *Fix:* Either rename the field to `chars` and document that the cap is char-based, or measure/truncate using `Buffer.byteLength(s,'utf8')` if a true byte budget is intended.

**SL-7. Private-IP classification logic is duplicated three times within one file**
`server/lib/url-validator.js:76-137 / 222-264`  —  risk: **low** · confidence: high
- *Problem:* The same IPv4 RFC1918/loopback/link-local checks are hand-written three times: inline in assertSafeExternalUrl (lines 82-98), inline in isInternalUrl (lines 165-173), and again as isPrivateIpv4Parts (lines 222-228) used by isPrivateAddress. The IPv6-mapped-v4 decode is written twice (lines 118-136 and 245-253). This is exactly the kind of divergence that produced the isInternalUrl gap above.
- *Fix:* Have assertSafeExternalUrl and isInternalUrl both call isPrivateIpv4Parts / a shared isPrivateAddress(hostnameOrIp) helper for the literal checks, and a single decodeV4MappedV6(hostname) helper. One source of truth for the ranges.

**SL-8. Two parallel SSRF implementations: isInternalUrl duplicates the (stricter) assertSafeExternalUrl checks with weaker coverage**
`server/lib/url-validator.js:145-180`  —  risk: **med** · confidence: medium
- *Problem:* isInternalUrl re-implements private-range detection that assertSafeExternalUrl already does more completely (it misses 127.0.0.0/8 beyond exact 127.0.0.1, .local suffixes, IPv6 link-local/unique-local, and IPv4-mapped IPv6). Having two SSRF deciders with different coverage is a classic source of bypasses: a caller using isInternalUrl believes it is protected to the same standard as the AI-endpoint path but is not. Within this slice the AI path correctly uses assertSafeAIEndpoint/assertSafeExternalUrl, but the duplicate weaker validator invites a future caller to use the wrong one.
- *Fix:* Reimplement isInternalUrl in terms of assertSafeExternalUrl (return true on throw, false on success) so there is a single canonical block-list, or deprecate it. Keep one source of truth for private-range detection.

**SL-9. getModelForFeature issues a second SELECT * via getUserAIConfig instead of reading the already-available config**
`server/lib/user-ai-config.js:276-282`  —  risk: **low** · confidence: medium
- *Problem:* getModelForFeature(userId, featureKey, fallbackModel) calls getUserAIConfig(userId) — a fresh `SELECT * FROM user_ai_config` plus toPublicShape — solely to read featureOverrides. Callers that already hold the config (or already resolved a provider) pay a duplicate query. It also re-parses feature_overrides_json that getDecryptedConfig/getUserAIConfig already parsed elsewhere in the same request.
- *Fix:* Either accept an optional pre-fetched config argument, or fold per-feature model resolution into the single config object callers already obtain (createProviderForUser already reads featureOverrides directly). Avoid a standalone query when the data is in hand.

**SL-10. computeNextRetryIso duplicated verbatim across the email and webhook retry workers (plus a third copy of the SQLite-datetime formatter)**
`server/lib/webhook-retry-worker.js:32-36`  —  risk: **low** · confidence: high
- *Problem:* webhook-retry-worker.js re-implements computeNextRetryIso (line 32-36) and inlines the `toISOString().replace('T',' ').replace(/\.\d{3}Z$/,'')` SQLite-datetime formatting, which is byte-for-byte the same logic as email-retry-worker.js:32-35 plus email.js:53-55 (toSqliteDatetime). The two workers share an identical DLQ shape (resolved_at / attempts / next_retry_at), identical MAX_ATTEMPTS/MAX_BACKOFF constants, identical backoff formula, and near-identical pick/loop/update structure — only the per-row action differs.
- *Fix:* Import toSqliteDatetime from email.js instead of re-inlining it, and extract the shared backoff (`computeNextRetryIso`) plus the generic 'drain a DLQ' loop into a small server/lib/dlq-worker.js the two callers parameterize with their SELECT, their per-row handler, and their give-up predicate. Cuts ~150 lines and keeps the backoff policy in one place.

**SL-11. deleteTrackedRepo exported as a throwing stub**
`server/lib/work-board-tracking.js:263`  —  risk: **low** · confidence: high
- *Problem:* `export function deleteTrackedRepo() { throw new Error('not implemented'); }` is dead surface area mid-file (line 263). It is exported, so it advertises an API that crashes if called, and clutters the module's public interface.
- *Fix:* Remove the stub entirely. untrack is already handled by upsertTrackedRepo/bulkUpdate, so there is no caller to break. If a placeholder is needed for a tracked TODO, keep it in an issue, not in exported code.

**SL-12. Dead/misleading model label in /ai/readme: modelName computed from GEMINI_MODEL but generation uses the per-user provider**
`server/routes/ai/core.js:475, 479`  —  risk: **low** · confidence: high
- *Problem:* The handler builds `const modelName = process.env.GEMINI_MODEL \|\| 'gemini-2.5-flash'` and returns it as `model` in the response and audit, but the actual generation runs through guardedGenerate → req.aiProvider, which for a BYOK user is Anthropic/OpenAI/etc. So a Claude user gets a response claiming `model: 'gemini-2.5-flash'`. The same misleading GEMINI_MODEL label is echoed in migration.js (384, 445). It's cosmetic but reads as a correctness bug to anyone inspecting the response/audit.
- *Fix:* Report the real model: use `req.aiProvider?.model \|\| req.aiProvider?.modelId` (as the chat/audit paths already do) instead of the hardcoded GEMINI_MODEL env default.

**SL-13. Redundant empty-message check after Zod already enforces message.min(1)**
`server/routes/ai/core.js:150-157`  —  risk: **low** · confidence: medium
- *Problem:* aiChatSchema validates `message: z.string().min(1).max(10000)` (validators.js:199), so by the time the handler runs, an empty/whitespace-trimmed-to-empty message is mostly already rejected. The handler then re-checks `!message \|\| message.trim().length === 0` and returns a different code (MESSAGE_REQUIRED). This is dead-ish defensive code that duplicates validation and produces a second, inconsistent error contract for the same condition.
- *Fix:* Either drop the in-handler check (rely on the schema) or move the trim requirement into the schema (`.trim().min(1)`) so there's one validation source and one error shape.

**SL-14. Mock-login duplicates the OAuth upsert SQL and could be extracted**
`server/routes/auth.js:189-226`  —  risk: **low** · confidence: high
- *Problem:* The user-upsert INSERT ... ON CONFLICT block in /mock (lines 210-218) is a byte-for-byte copy of the OAuth /callback upsert (lines 109-117). The mock route also lacks the session.regenerate fixation hardening the real callback has — minor inconsistency. Two copies of the same statement will drift when the users schema changes.
- *Fix:* Extract an upsertUser(db, { id, username, avatar_url, email }) helper used by both callback and mock paths. This removes the duplication and ensures both paths stay in sync with the users schema.

**SL-15. Stale/misleading comment claims the per-name route is not user-scoped**
`server/routes/migration-marks.js:36-37`  —  risk: **none** · confidence: high
- *Problem:* The comment on /mine warns that "the per-name route below is not user-scoped — tracked as a follow-up", implying an open IDOR. But the actual GET / route (lines 13-30) DOES scope by `p.user_id = ?` (line 17), as do /mine and /plan/:id. The comment is stale and actively misleading — a reader auditing for IDOR will waste time, or worse, a maintainer may 'fix' an already-correct route. No functional bug, but the documentation contradicts the code.
- *Fix:* Delete the parenthetical follow-up note (or correct it to state that all three routes are user-scoped via the migration_plans join). Confirm no other unscoped marks route exists elsewhere before removing.

**SL-16. Five migration plan handlers repeat the identical load-plan + resolve-PAT + build-credentials boilerplate**
`server/routes/migration.js:457-531,560-607,614-647,653-684`  —  risk: **low** · confidence: medium
- *Problem:* execute, resume, retry, replace-retry and retry-lfs each repeat: parseInt(id) → SELECT * FROM migration_plans WHERE id=? AND user_id=? → 404 if missing → resolvePlanExecutionPat → abort check → build the same credentials object { githubToken: req.session.accessToken, azurePat, azureHost: plan.azure_host\|\|'dev.azure.com', azureOrg: plan.source_org, azureProject: plan.source_project }. The credentials object literal appears 5 times verbatim. replace-retry and retry-lfs are nearly identical except for one withReplaceOnConflict/withLfsMigrate line.
- *Fix:* Add a small middleware/helper loadOwnedPlan(req,res) that loads+authorizes the plan (or 404s) and a buildPlanCredentials(plan, pat) factory. Collapse replace-retry and retry-lfs into one handler parameterized by the config-patch function. Cuts ~80 lines and removes the risk of the credential fields drifting between handlers.

**SL-17. formatTaskForApi emits both repoName and sourceRef from the same column**
`server/routes/migration.js:179-200`  —  risk: **med** · confidence: medium
- *Problem:* formatTaskForApi sets sourceRef: row.source_ref AND repoName: row.source_ref — two API fields backed by the identical DB column. This is dead redundancy in the response payload: every consumer gets two keys that are always equal, and a future rename of one without the other will silently desync the contract.
- *Fix:* Drop repoName from the formatter and have the (one) UI consumer read sourceRef, or alias it in a single place. If kept for backwards compat, add a comment stating it is an intentional alias and is slated for removal.

**SL-18. Usage response ships three overlapping shapes (flat, aiFeatures, legacy metrics) for the same data**
`server/routes/usage.js:31-59`  —  risk: **med** · confidence: low
- *Problem:* The endpoint returns aiQueries both at top level AND nested under metrics.ai_queries, plus a separate aiFeatures block and a 'Legacy nested shape kept for backwards compatibility' block. Three representations of the same counters increase payload size and create three places to keep in sync; the legacy nested block is explicitly dead-weight for current consumers.
- *Fix:* Confirm no live client reads the legacy `metrics` block (grep the frontend), then remove it and standardize on the flat + aiFeatures shape. If a deprecation window is needed, version the endpoint rather than carrying both indefinitely.

**SL-19. Five DORA endpoints repeat identical param-parsing boilerplate**
`server/routes/work-board.js:270-363`  —  risk: **none** · confidence: high
- *Problem:* /deploy-freq, /lead-time, /change-failure-rate, /mttr, /dora and /dora.csv each open with the same three lines parsing `environment`, `repoIds`, and `since` from the query (e.g. 271-274, 286-288, 300-303, 315-318, 331-333, 377-379). The combined /dora and /dora.csv then re-invoke all four aggregation functions with those same args (335-338 and 381-384) — that block is duplicated verbatim between the JSON and CSV variants. This is low-risk pure boilerplate but it is ~6 copies of the same parse and 2 copies of the same 4-call fan-out.
- *Fix:* Add a tiny `parseDoraQuery(req)` helper returning `{ environment, repoIds, since }`, and a `computeDora({environment, since, repoIds})` helper returning `{ deploy, lead, cfr, mttr }`. Have all six handlers call them. Keeps each route to its response-shaping concern.

**SL-20. Webhook DLQ functions are a verbatim copy of the Email DLQ block**
`src/api/admin-dlq.js:133-154`  —  risk: **low** · confidence: high
- *Problem:* listWebhookDLQ/getWebhookEntry/retryWebhookEntry/resolveWebhookEntry (lines 137-154) are identical to the Email block (lines 100-131) except the path segment 'email' vs 'webhook'. Four functions duplicated purely to swap a string literal.
- *Fix:* Generate both from one factory: `const makeDlqClient = (kind) => ({ list: f => getJson(`/${kind}?resolved=...`)..., get, retry, resolve })`, then `export const emailDLQ = makeDlqClient('email')` / `webhookDLQ = makeDlqClient('webhook')`. Halves the file.

**SL-21. mutate() always fetches CSRF even though fetchWithRetry already would**
`src/api/workBoardTracking.js:23-36`  —  risk: **low** · confidence: high
- *Problem:* Both workBoardTracking.mutate and workBoardAI.post call getCsrfToken() manually and set X-CSRF-Token, then raw-fetch. This duplicates the exact logic fetchWithRetry already performs (utils/api.js:335-348), but without its 403-csrf_invalid auto-rotation (utils/api.js:390-409). So after a logout+re-login that rotates the token, these work-board writes will hard-fail with no retry, while every apiCall-based write self-heals. It is both redundant code and a behavioral regression vs the canonical client.
- *Fix:* Replace the bespoke mutate/post helpers with fetchWithRetry (which injects + rotates CSRF) and keep only the thin endpoint wrappers. Removes the manual getCsrfToken calls and gains token-rotation recovery.

**SL-22. Mock-auth POST ignores response status and lacks error handling**
`src/App.jsx:431-436`  —  risk: **low** · confidence: medium
- *Problem:* In checkAuth the mock branch does `await fetch('/api/auth/mock', { method: 'POST' })` (line 432) and immediately treats it as success, setting a hardcoded session { userId: 999999, accessToken: 'mock_token' } regardless of whether the request 4xx/5xx'd. There is also no `credentials: 'include'` on this fetch even though every other auth call in the file sends credentials, so the mock session cookie may not round-trip in some configurations. While mock-only, a silent failure here yields a fake-authenticated UI with no backend session, which is confusing to debug in e2e.
- *Fix:* Check res.ok and add credentials: 'include' to the mock fetch; on a non-ok response fall through to the login screen (setAppLoading(false) without setting a session) so the failure is visible rather than masked.

**SL-23. Dead accumulator variable in runBatch**
`src/components/AI/BatchIndexProgressModal.jsx:33-41`  —  risk: **none** · confidence: high
- *Problem:* `runBatch` builds a local `acc` array (`const acc = []; ... acc.push(...(res.results \|\| []))`) but `acc` is never read after the loop — progress is reported entirely via `setResults(prev => [...prev, ...])`. The accumulator is dead code that suggests an abandoned intent and adds noise to a function that already carries multiple lint-suppression comments.
- *Fix:* Delete the `acc` declaration and its push; rely solely on the `setResults` functional update (or, if a final snapshot is wanted, derive it from the push and drop the redundant setState pattern).

**SL-24. OrganizationSelector appears to be unused (only the barrel re-exports it)**
`src/components/Dashboard/OrganizationSelector.jsx:1-114`  —  risk: **low** · confidence: medium
- *Problem:* OrganizationSelector.jsx is re-exported from Dashboard/index.js but no component imports it — a repo-wide grep for 'OrganizationSelector' returns only the component file and the barrel. The dashboard now uses HeroOrgChip for org selection. This is ~115 lines of dead UI plus a getOrgRepoCount dependency kept alive only by the barrel export.
- *Fix:* Confirm there are no dynamic/string-based imports, then remove OrganizationSelector.jsx and its line in Dashboard/index.js. If retained intentionally for an external consumer, add a comment documenting where it is used.

**SL-25. Redundant parallel state: qaHistory and qaResponses hold the same messages**
`src/components/DevToolkit/ReviewTab/ReviewTab.jsx:23-24, 105-125`  —  risk: **low** · confidence: high
- *Problem:* ReviewTab maintains two state arrays that are updated in lockstep with identical `{role, content}` entries: `qaHistory` (sent to the model as conversation history) and `qaResponses` (rendered in the UI). Every push updates both (lines 105-107, 123-124), and they only ever diverge in that the model gets `newHistory.slice(-10)`. This is duplicated state that can desync and doubles the bookkeeping.
- *Fix:* Keep a single `messages` array; derive the model-history slice inline (`messages.slice(-10)`) at call time and render from the same array. Removes ~4 setState pairs and the desync risk.

**SL-26. Dead/leftover props and a stray leading blank line in Header**
`src/components/Header.jsx:1, 39-40, 28-51`  —  risk: **low** · confidence: high
- *Problem:* Line 1 is an empty leading line before the imports. `syncStatus: _syncStatus` (line 39) is destructured only to be discarded (underscore-prefixed, never used). The block comment at lines 30-32 documents an `isMockMode` prop that no longer exists in the signature. These are small leftovers from the LicenseBadge refactor that add noise to a 835-line shell component.
- *Fix:* Remove the leading blank line, drop the unused `syncStatus: _syncStatus` destructure (and its prop at call sites if nothing passes it meaningfully), and delete the stale isMockMode comment. Pure cleanup.

**SL-27. applyUrlPreview is a no-op duplicate of dismissUrlPreview kept only for prop compatibility**
`src/components/MigrationWizard/hooks/useSourceStepForm.js:175-184`  —  risk: **low** · confidence: high
- *Problem:* applyUrlPreview was reduced to setUrlPreview(null) — byte-for-byte identical to dismissUrlPreview — and is still wired into SourceStep (onApply={applyUrlPreview} at SourceStep/index.jsx:157). Two distinctly-named callbacks doing the same thing, plus the explanatory comment about 'Aplicar' no longer being needed, is residual complexity that invites the next reader to assume they differ. The 'Apply' affordance in the UI is now redundant since paste auto-applies.
- *Fix:* Drop applyUrlPreview from the hook return and the SourceStep onApply prop, and remove the now-redundant 'Apply' button (paste already commits state in handleUrlInput). If the visual confirmation button must stay, point its onClick at dismissUrlPreview and delete applyUrlPreview.

**SL-28. Dead ternary always yields the same value ('failed' === 'failed')**
`src/components/MigrationWizard/hooks/useWizardStepStatus.js:42`  —  risk: **none** · confidence: high
- *Problem:* currentStepStatusDetail builds `${failed} ${failed === 1 ? 'failed' : 'failed'} · ${running} running` — both ternary branches are the literal 'failed', so the conditional is dead and the singular/plural intent ('failure'/'failures') was lost. Minor, but it's a clear copy-paste slip in user-facing status text.
- *Fix:* Either drop the ternary to `${failed} failed · ${running} running`, or fix the pluralization to `${failed === 1 ? 'failure' : 'failures'}` if a noun was intended.

**SL-29. Dead displayRef in AnimatedCounter**
`src/components/MigrationWizard/steps/AIReview/AnimatedCounter.jsx:9-23`  —  risk: **none** · confidence: high
- *Problem:* `displayRef` is created with `useRef(0)` (line 9) and written on every animation frame (lines 12, 15, 18) but is never read anywhere — the rendered value comes solely from the `display` state. It is pure dead code that adds noise and a misleading impression that the ref participates in rendering.
- *Fix:* Delete the `displayRef` declaration and all three `displayRef.current = ...` assignments; keep only `setDisplay`.

**SL-30. Risk bucketing does three passes plus a merge that the backend could return ordered**
`src/components/MigrationWizard/steps/AIReviewStep.jsx:106-109`  —  risk: **low** · confidence: medium
- *Problem:* highRisks/mediumRisks/lowRisks each filter the full `aiPlan.risks` array independently and then `allRisks` concatenates them — four memoized derived arrays purely to render risks high→medium→low. This is more state/derivation than needed and the per-severity counts (used for the badges) re-walk the data again. It's not expensive at typical sizes but it is redundant work and extra surface area.
- *Fix:* Compute a single `useMemo` that returns `{ ordered, counts }` in one pass (e.g. sort by a severity rank and tally counts), and drive both the badges and the list from it. Removes three of the four memos.

**SL-31. Dead branch: stateFor's `ready` arg is computed and threaded but never affects the 'available' result**
`src/components/MigrationWizard/steps/SourceStep/CredentialsForm.jsx:72-76`  —  risk: **low** · confidence: high
- *Problem:* stateFor(mode, ready, available) ends with `return ready ? 'available' : 'available'` — both ternary arms are identical, so the `ready` parameter is meaningless for non-selected cards. Callers still compute and pass serverReady/personalReady/oauthReady into this slot (line 94, 134), implying intent that an available-and-ready card should look different from available-and-not-ready, but it doesn't. Either dead code or an unfinished feature.
- *Fix:* If the distinction isn't wanted, drop the `ready` param from the non-selected path and simplify to `return 'available'`. If it is wanted, return a distinct 'ready'/'available' state and style it. Remove the now-unused ready args at call sites.

**SL-32. Module-level console.warn monkeypatch to silence a third-party dev warning**
`src/components/PRReview/DiffPanel/DiffRenderer.jsx:21-32`  —  risk: **low** · confidence: low
- *Problem:* At import time DiffRenderer globally replaces console.warn with a filtered wrapper to suppress a specific @git-diff-view/core dev-only mismatch warning. Mutating the global console as a module side-effect is a heavy, surprising mechanism: it affects the whole app (not just this component), runs even if DiffRenderer is never actually rendered for a given file, and the suppressed warning is the library's own signal that it cannot reconstruct file content from partial GitHub patches.
- *Fix:* If the warning must be hidden, scope it as narrowly as possible (e.g. only while DiffView is mounting) or document/accept it as a known dev-only noise instead of patching the global console. At minimum confirm the node_modules line reference in the comment still matches the pinned @git-diff-view version, since it will rot on upgrade.

**SL-33. handleSync calls load() twice on failure**
`src/components/RepoDetail/ActionsTab.jsx:37-45`  —  risk: **low** · confidence: high
- *Problem:* handleSync awaits syncRuns then awaits load(); the catch block also awaits load() again. On the error path this fires two back-to-back reloads (and on success the try path already reloaded). The catch comment says 'load() will surface the error', but the try block's load() already does that, making the second call redundant work / a double fetch.
- *Fix:* Move a single `await load()` into a finally block (or just let the try-path load() run and drop the catch's reload), so sync triggers exactly one reload regardless of outcome.

**SL-34. InlineEditField can fire two commits (Enter then blur) for one edit**
`src/components/RepoDetail/InlineEditField.jsx:39-54, 56-64, 77`  —  risk: **low** · confidence: medium
- *Problem:* Pressing Enter calls commit() (async). commit() does not blur the input until React re-renders out of edit mode after the await resolves; meanwhile the Enter handler doesn't stop the input from also firing onBlur when focus moves, and any programmatic re-render can trigger an extra commit. There is no in-flight guard beyond `saving`, and commit() reads `value` (the prop) for the no-op check, not the just-saved value, so a fast second commit can re-issue the same PATCH. Low impact because the equality short-circuit usually catches it, but it's a latent double-write.
- *Fix:* Guard commit() with a ref flag (`if (committingRef.current) return`) set for the duration of the async save, and/or blur the input synchronously before awaiting. Ensures exactly one save per edit session.

**SL-35. SelectionBar and SelectionSheet duplicate the action-registry-to-pill mapping**
`src/components/RepoList/SelectionBar.jsx:1-99`  —  risk: **low** · confidence: medium
- *Problem:* SelectionBar.jsx and SelectionSheet.jsx both define a near-identical ICONS map, an ORDER array, the same `resolve = (val, repos) => typeof val === 'function' ? val(repos) : val` helper, and the same 'map ORDER -> repoActions[id] -> {label, Icon}' pipeline. They are the desktop/mobile variants of one concept and have drifted (different ordering, different icon sets, SelectionSheet adds description). Two copies of the resolve helper and the mapping invite divergence bugs.
- *Fix:* Extract a shared selectionActions helper (the resolve fn + a buildSelectionActions(order, repos) that returns [{id,label,description,Icon,danger}]) and have both SelectionBar and SelectionSheet consume it with their own order constant.

**SL-36. Search is debounced+lifted into filters then re-filtered client-side — two layers doing the same job**
`src/components/Settings/WorkBoard/SearchFilterBar.jsx:21-29 (with WorkBoardSettingsSection.jsx:33-45)`  —  risk: **low** · confidence: medium
- *Problem:* SearchFilterBar keeps local searchInput, debounces it, and pushes it up into the parent's `filters.search`. WorkBoardSettingsSection then re-filters hook.repos client-side by that same search string (useMemo). Since the filtering is purely in-memory (no server round-trip for search), the debounce + lifted-state + round-trip through the parent adds indirection and a one-frame lag for no benefit; the list could filter directly off the local input. The redundant state also makes the 'clear filter' empty-state branch in TrackedReposList depend on a value that lags the input.
- *Fix:* Either (a) drop the debounce since filtering is synchronous/in-memory, or (b) if debounce is wanted for large lists keep it but treat filters.search as the single source and remove the duplicate intent. Consider colocating the search filter with the useMemo that consumes it.

**SL-37. SlimSidebar popovers render hardcoded placeholder content (effectively dead UI)**
`src/components/Sidebar.jsx:89-184`  —  risk: **low** · confidence: medium
- *Problem:* SlimSidebarBase wires up three popovers (Quick Actions, Action History, Recent Activity) but their bodies are static placeholders ('No recent actions', 'No recent activity', 'Select repos for actions') — they never receive results/activity data even though the full SidebarBase right beside it does. The slim rail thus presents controls that can never show real content, which reads as unfinished and adds focus-trap/listener overhead for no value.
- *Fix:* Either thread the same results/activity/selection data into the slim popovers so they mirror the expanded sidebar, or drop the non-functional History/Activity popovers from the slim rail and keep only the working Quick Actions + Import affordances.

**SL-38. ActivityTab bypasses the shared API/MOCK layer and reads actor without guarding**
`src/components/Teams/ActivityTab.jsx:29-36, 130-134`  —  risk: **low** · confidence: medium
- *Problem:* ActivityTab calls bare `fetch('/api/teams/.../activity')` and re-implements MOCK_MODE fallback inline, duplicating the pattern the teams API client (src/api/teams.js) was created to centralize ('App.jsx fired a background GET... we treat it as...'). Separately, getEventDescription accesses `event.actor.login` (line 132) and `event.actor.avatar_url` (line 171) without guarding `event.actor`; the mock data always has it, but real GitHub events can have a null actor, which would throw and blank the whole feed.
- *Fix:* Route the activity fetch through the shared api/teams client (or apiCall) so MOCK_MODE and error shaping live in one place, and null-guard `event.actor` (optional chaining + fallback) in getEventDescription and the avatar render.

**SL-39. selectedRepoToAssign state overloaded as both a selection and a search box**
`src/components/Teams/TeamDetails.jsx:34, 362-373`  —  risk: **none** · confidence: high
- *Problem:* `selectedRepoToAssign` is initialized/named as a repo selection but is actually wired to the repo-search Input's onChange ('Using this state for search temporarily', line 367) and used as the filter substring (line 373). The misleading name plus the 'temporarily' comment signal accreted intent; a reader must trace usage to realize no repo is ever 'selected' — assignment happens directly via handleAssignRepoDirectly.
- *Fix:* Rename to `repoAssignQuery` (or similar) to reflect its real role as the search filter, and drop the stale comment.

**SL-40. Conflict resolutions keyed by bare repo name collide when two selected repos share a name**
`src/components/TransferModal.jsx:104, 169, 287, 322-327`  —  risk: **med** · confidence: medium
- *Problem:* The server keys the conflicts map by bare name (`repoFullName.split('/').pop()` in server/routes/bulk.js:84), and the modal mirrors that by reading `conflicts?.[repo.name]` and storing `resolutions[repo.name]` everywhere (lines 104, 169, 287-289, 322-326). The actual transfer is keyed by `full_name` (line 114-120 builds `strategies[repo.full_name]`). If the selection contains two repos with the same bare name from different owners (e.g. `team-a/api` and `team-b/api`), they collapse to one `resolutions` entry and one conflict row state — the second repo silently inherits the first's resolution, and the conflict panel state is shared. The unresolved-conflict guard (line 104) can also mis-count.
- *Fix:* Key conflicts and resolutions by `repo.full_name` end-to-end (have the server return the map keyed by full_name, and read/write `conflicts?.[repo.full_name]` / `resolutions[repo.full_name]` in the modal). This aligns the conflict map, the resolutions map, and the `strategies` map on one stable key.

**SL-41. Three overlapping memos (filteredSections / filteredOptions / indexedSections) encode the same flatten twice**
`src/components/ui/Select.jsx:63-91`  —  risk: **med** · confidence: medium
- *Problem:* Sections handling is spread across filteredSections (63-79), filteredOptions (81-91) and indexedSections (252-258). filteredOptions re-flattens filteredSections, and indexedSections re-flattens filteredSections\|\|sections again to attach _globalIndex. The flatten of the same section tree happens twice, and the `if (!q) return null` sentinel in filteredSections (line 77-78) is a non-obvious signal consumed three lines later. It works, but it is more state than the feature needs and is easy to break when editing.
- *Fix:* Compute one `displayedSections` (filtered, with _globalIndex attached) and derive filteredOptions = displayedSections.flatMap(...) from it. One source of truth for the flattened+indexed list removes the duplicate flatten and the null-sentinel branch.

**SL-42. PremiumSpinnerSvg and SpinnerIcon are the same SVG twice, differing only by role/aria**
`src/components/ui/Spinner.jsx:75-146`  —  risk: **low** · confidence: medium
- *Problem:* PremiumSpinnerSvg (75-88) and SpinnerIcon (134-146) render an identical <svg viewBox animate-spin> wrapping PremiumRingArt; the only difference is one has role="status"+aria-label and the other aria-hidden. That's a reasonable split, but the two svg wrappers (defs, viewBox, className composition, useId) are copy-pasted rather than sharing one inner component parameterized by the a11y props.
- *Fix:* Factor a single `<SpinnerSvg a11y={...} className={...}/>` that both Spinner and SpinnerIcon render, passing either the status/aria-label set or aria-hidden. Removes the duplicated svg shell; behavior identical.

**SL-43. Dead 'editing' state — 'Edit first' button has no effect**
`src/components/WorkBoard/shared/PingAuthorPopover.jsx:37, 118-126`  —  risk: **low** · confidence: high
- *Problem:* The `editing` state defaults to false and is only ever set true by the 'Edit first' button, which then hides itself ({!editing && ...}). But the Textarea is always editable regardless of `editing`, so the flag changes nothing except removing its own button. It's confusing dead UX: clicking 'Edit first' appears to do nothing visible.
- *Fix:* Either remove the `editing` state and the 'Edit first' button entirely (the textarea is already editable), or gate the textarea behind it (render read-only preview until 'Edit first' is clicked) to give the button real meaning.

**SL-44. Unused imports (Loader2, motion) across tabs and InlineActions**
`src/components/WorkBoard/tabs/MyReviewsTab.jsx:1-3`  —  risk: **none** · confidence: high
- *Problem:* MyReviewsTab imports `motion` (line 2) and `Loader2` (line 3) but uses neither (it uses AnimatePresence and the Sparkles/Clock icons only). StalePRsTab imports `Loader2` (line 3) unused. InlineActions imports `Loader2` (line 3) unused. Dead imports add to the chunk and signal copy-paste drift; if eslint no-unused-vars isn't catching these (lucide icons are easy to miss) they accumulate.
- *Fix:* Remove the unused `motion` import from MyReviewsTab and the unused `Loader2` imports from MyReviewsTab, StalePRsTab, and InlineActions.

**SL-45. API_ENDPOINTS bakes in VITE_API_BASE_URL at module load but several are unused / inconsistently consumed**
`src/config.js:26-41, 7, 17`  —  risk: **none** · confidence: medium
- *Problem:* API_ENDPOINTS is computed once at import time from API_BASE_URL. Many feature endpoints (azureWikis, azureWorkItemCounts, migrationStream, etc.) are listed here, yet App.jsx and other hooks build the same paths manually with API_BASE or bare literals (see finding above), so this map is a partially-followed convention rather than the single source of truth it implies. Maintaining a hand-curated endpoint map that callers selectively ignore is the worst of both worlds: it looks authoritative but doesn't prevent drift.
- *Fix:* Either (a) make API_ENDPOINTS the enforced source of truth and migrate the manual URL builders to it, or (b) drop the unused entries and let the per-feature api/* modules own their paths. Pick one model so contributors aren't guessing which convention applies.

**SL-46. Two near-identical fetch-list hooks with copy-pasted load/cancel/error boilerplate**
`src/hooks/useMigrationMarks.js:7-32, 38-69`  —  risk: **low** · confidence: medium
- *Problem:* `useMigrationMarksFor` and `useMarksForPlan` are the same shape (cancel-guarded fetch → `r.ok ? json : reject` → set list/loading/error), differing only in URL and the extra `byScope`/`reloadToken`. The fetch-with-cancel-guard pattern here is also re-implemented across many hooks in this slice (useIsAdmin, useLicense, useMigrationMarks) instead of using the existing useTabData/useResilientFetch helpers.
- *Fix:* Build both on top of the existing useTabData (which already does abort-guarded load+loading+error), passing the URL-specific loader; or extract a tiny shared `useFetchJson(url)` and derive byScope from its data.

**SL-47. reload() returns a cleanup function instead of the data it resolves, contradicting its documented contract**
`src/hooks/useTabData.js:38-53`  —  risk: **med** · confidence: medium
- *Problem:* The JSDoc (lines 36-37) says callers can `await reload()` after a mutation 'before re-rendering UI that depends on the new data', implying reload resolves once data is loaded. But reload returns `() => controller.abort()` (line 51) — a teardown function, not the data. Also `reload` creates its own AbortController separate from the effect's, so a `reload()` in flight isn't cancelled by an unmount/dep-change of the effect, and vice-versa (two concurrent fetches can both setData).
- *Fix:* Return the loaded result (or void) from reload, and share a single ref'd AbortController between the effect and reload so the latest call cancels the previous one.

**SL-48. useRef() with no initial value; clearInterval may receive undefined**
`src/hooks/useWorkBoardBadgeCounts.js:47, 67-73`  —  risk: **low** · confidence: medium
- *Problem:* intervalRef = useRef() is created without an initial value, then the cleanup calls clearInterval(intervalRef.current). On the first effect run intervalRef.current is set before cleanup, so it's currently safe, but the uninitialized ref + unconditional clearInterval is a fragile pattern (clearInterval(undefined) is a no-op today but reads as a latent bug). The onFocus refresh also fires a network call on every window focus with no min-interval guard, unlike useYourWork which gates re-fetch behind VISIBILITY_REFRESH_THRESHOLD_MS.
- *Fix:* Initialize useRef(null) and guard the clear; add a min-interval guard on the focus refresh (mirror useYourWork's 30s threshold) so rapid focus/blur cycles don't spam /my-reviews and /stale-prs.

**SL-49. getAST self-references the module-level `highlighter` const instead of local state**
`src/lib/diff-highlighter-shim.js:166-187, 199`  —  risk: **low** · confidence: high
- *Problem:* Inside Object.defineProperty(instance,'getAST',...) the body reads `highlighter.ignoreSyntaxHighlightList` (line 177) — i.e. the method reaches back through the exported const `highlighter` (defined later at line 199, assigned to `instance`) to read state it already owns as the local `_ignoreSyntaxHighlightList`. It works only because getAST is never called during module init, but it's a fragile circular self-reference: any eager call (or a future refactor that invokes it at load) hits a TDZ ReferenceError, and it reads less clearly than using the local array.
- *Fix:* Replace `highlighter.ignoreSyntaxHighlightList` with the closure-local `_ignoreSyntaxHighlightList` (same array `instance.ignoreSyntaxHighlightList` returns). No behavior change, removes the self-reference.

**SL-50. categorizeError() has a hidden side effect (notifySessionExpired)**
`src/utils/api.js:214-258, 236`  —  risk: **med** · confidence: medium
- *Problem:* categorizeError is named and used like a pure classifier (it is exported and called from replayFetch and fetchWithRetry), but the 401 branch calls notifySessionExpired({ url }) — which can hard-redirect the whole app (window.location.href = '/?error=session_expired'). A side effect that triggers a full navigation buried inside a 'categorize' helper is surprising; any future caller using categorizeError purely to map a status to a type would unexpectedly log the user out. replayFetch (line 289) already calls categorizeError on every >=400 replay, so an offline-queued mutation that replays into a 401 will fire the redirect from the retry path.
- *Fix:* Move the notifySessionExpired side effect out of categorizeError into the fetchWithRetry call site (which already inspects status), or split into a pure categorize() plus an explicit handleAuthFailure(). At minimum document that categorizeError is impure and must not be called from non-request contexts.

**SL-51. formatPricing number formatter uses a brittle nested-ternary precision heuristic**
`src/utils/providerPricing.js:83`  —  risk: **low** · confidence: medium
- *Problem:* `const fmt = (n) => `$${n % 1 === 0 ? n.toFixed(0) : n % 0.1 === 0 ? n.toFixed(1) : n.toFixed(2)}`` relies on floating-point modulo (`n % 0.1 === 0`) to decide decimals. Float math makes `n % 0.1 === 0` unreliable (e.g. 0.3 % 0.1 is not exactly 0 in IEEE-754), so the branch that should print one decimal can fall through to two. The intent (show the fewest meaningful decimals) is fine but the implementation is fragile and hard to read.
- *Fix:* Use a deterministic formatter, e.g. `Number.isInteger(n) ? n.toFixed(0) : n.toFixed(2).replace(/0$/,'')` or an Intl.NumberFormat with maximumFractionDigits:2, minimumFractionDigits:0. Removes the float-modulo correctness risk.

---

*Generated from a read-only multi-agent audit panel (20/30 slices). Findings are advisory; no code was changed. Re-run completes the remaining 11 frontend slices.*
