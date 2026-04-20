# Work Board Mega-Upgrade — Design Spec

**Date:** 2026-04-20
**Status:** Draft — pending user review
**Author:** Bruno + Claude
**Scope tag:** `work-board`

## Problem Statement

The Work Board (`/work-board`) is the cross-repo activity hub. In its current shape it has two fundamental problems:

1. **It is webhook-only.** All six endpoints ([`server/routes/work-board.js`](server/routes/work-board.js)) read from local SQLite tables (`pr_events`, `issue_events`, `review_assignments`, `deployment_events`). If the user has not configured a GitHub webhook against `POST /api/v1/webhooks/github`, every tab renders `0`. For a new install this is indistinguishable from a broken product — which is exactly what the screenshot shows today (30 repos tracked, every KPI at 0).
2. **It is a passive list.** Even with data, the user can only *look*. No filters, no keyboard navigation, no inline actions, no context synthesis. The board is a read-only digest, not a cockpit.

This spec defines a single large upgrade that closes both gaps: the board becomes **zero-config** (populates from the live GitHub API when webhook data is missing), **live** (auto-refreshes, pushes updates), **interactive** (filter, keyboard-drive, approve/snooze inline), and **intelligent** (LLM-generated headline summary across all configured BYOK providers).

## Goals

1. Any authenticated user sees real data within 5 s of opening the page — no setup required.
2. The page stays fresh while open, without forcing F5.
3. A keyboard-first user can triage reviews without ever touching the mouse.
4. Filters persist across reloads and across devices (server-stored presets).
5. Users with a configured AI provider see a 1-sentence headline + 3-5 bullet summary of what matters *right now*.
6. All five provider families (Anthropic, OpenAI, Gemini, OpenRouter, Local) produce high-quality summaries with the same prompt. Anthropic receives `cache_control` optimisation when available.

## Non-Goals

- Replacing the webhook ingestion pipeline. Webhooks remain the primary path and the only source for DORA metrics and review-load aggregates (which need deduplicated event history the search API cannot provide).
- Cross-org admin views. Scope stays per-user.
- Slack / email digests. Summary stays in-product for v1.
- Merge-queue orchestration, stacked PRs, review drafts. Out of scope.
- Multi-user collaboration on a single snooze / preset. Each user owns their own.
- GraphQL migration. REST `/search/issues` is sufficient; moving the whole codebase to GraphQL is disproportionate.

## Constraints

- **GitHub search rate limit:** 30 requests/minute/token. At 60 s polling with 4 queries, a single user consumes 4/min — comfortable margin for ETag re-validation and manual refresh spikes.
- **OAuth scopes required:**
  - `repo` or `public_repo` to read PRs / issues (already granted at login).
  - `repo` to submit a review (approve / request-changes). Missing scope → endpoint returns `403 { code: "scope_required" }` and the UI shows a "Re-authorize to approve" CTA.
- **AI quota:** All providers are BYOK. The server enforces 1 summary request / 5 min / user and caches the response for 5 min in `work_board_cache`.
- **Data freshness contract:** A cache row is considered fresh for 5 minutes. `If-None-Match` ETag revalidation can extend that indefinitely at near-zero rate-limit cost.

---

## Architecture Overview

The upgrade is split into five cohesive layers that ship together:

| Layer | Responsibility | New code | Reused code |
|-------|----------------|----------|-------------|
| **L1 — Live fetch** | Pull missing data directly from GitHub API, cache with ETag | `server/lib/work-board-github.js`, `server/lib/work-board-cache.js` | [`server/lib/github-api.js`](server/lib/github-api.js) for HTTP + rate-limit |
| **L2 — Unified route layer** | Merge webhook data + live data, serve single envelope | Modifications to `server/routes/work-board.js` | existing `requireAuth`, `requireTier`, `errorResponse` |
| **L3 — Mutations** | Approve / request-changes / snooze, via GitHub PR review API + local snooze table | `server/routes/work-board-actions.js`, `server/lib/work-board-snooze.js` | Existing middleware stack |
| **L4 — AI summary** | BYOK-aware cross-provider headline generator | `server/lib/work-board-summary.js`, `server/routes/work-board-ai.js` | [`server/lib/ai-provider.js`](server/lib/ai-provider.js) + `createProviderForUser` |
| **L5 — Frontend** | Auto-refresh, filter bar, keyboard, AI card, palette extension | Modifications to [`src/components/WorkBoard/WorkBoardPage.jsx`](src/components/WorkBoard/WorkBoardPage.jsx) + 5 new files | `useCommandPalette`, `useKeyboardShortcuts`, `useToast`, `useModal`, `Chip`, design-system classes |

All five layers are deployed in a single release. No feature flag; rollout is controlled by standard git merge + CI.

---

## L1 — Live GitHub Fetch + Cache

### `server/lib/work-board-github.js`

Four pure functions, each returns `{ items: [...], etag: string, fetchedAt: Date }`. All accept `{ token, login, ...params }` and call the existing [`githubApi()`](server/lib/github-api.js) wrapper so ETag caching and rate-limit handling happen for free.

```js
// Pseudo-signatures
export async function fetchMyPendingReviews({ token, login }) { ... }
export async function fetchStalePRs({ token, login, staleAfterDays = 7 }) { ... }
export async function fetchMyOpenIssues({ token, login }) { ... }
export async function fetchTechDebtIssues({ token, labels = DEFAULT_DEBT_LABELS, limit = 100 }) { ... }
```

**Queries used** (REST `/search/issues`, `sort=updated&order=desc`, `per_page=100`):

| Function | Qualifier string |
|----------|------------------|
| `fetchMyPendingReviews` | `review-requested:${login} is:open is:pr archived:false` |
| `fetchStalePRs` | `author:${login} is:open is:pr updated:<${cutoffISO} archived:false` |
| `fetchMyOpenIssues` | `assignee:${login} is:open is:issue archived:false` |
| `fetchTechDebtIssues` | `is:open is:issue archived:false (${labels.map(l => `label:"${l}"`).join(' OR ')})` |

Each function **normalises the GitHub response into the same shape currently emitted by `event-aggregations.js`** so route handlers and the frontend are agnostic about origin.

### `server/lib/work-board-cache.js`

Thin helper over a new SQLite table `work_board_cache`. API:

```js
getCached(userId, queryType) → { payload, etag, fetchedAt, expiresAt } | null
putCached(userId, queryType, payload, etag, ttlSeconds = 300)
invalidate(userId, queryType?) // all types if queryType omitted
purgeExpired() // called at server start + hourly
```

Write-through pattern: the route handler calls `getCached` first; if present and fresh, returns it; otherwise calls the fetch function with any stored ETag as `If-None-Match`, stores the new response, returns it. 304 responses refresh `expires_at` without paying a quota credit.

---

## L2 — Unified Route Layer

Current endpoints are preserved; their internals change. Envelope gains provenance:

```jsonc
{
  "data": [ /* items — unchanged shape */ ],
  "meta": {
    "source": "webhook" | "live" | "cache" | "merged",
    "fetchedAt": "2026-04-20T20:15:03.412Z",
    "cacheExpiresAt": "2026-04-20T20:20:03.412Z",
    "rateLimitRemaining": 4872
  }
}
```

**Merge strategy per endpoint:**

| Endpoint | Source policy |
|----------|---------------|
| `/my-reviews` | If webhook table empty → live. Else: live if cache-fresh, webhook if stale. Prefer freshest. |
| `/my-issues` | Same as above. |
| `/stale-prs` | Same as above. Uses `staleAfterDays` in both paths. |
| `/tech-debt` | Same. Label set param respected by both paths. |
| `/review-load` | **Webhook-only** — needs deduplicated event history; search API cannot reproduce. Returns empty + `meta.requiresWebhook: true` when empty. |
| `/dora` family | **Webhook-only** — same reason. Enterprise tier; unaffected. |

The frontend treats `meta.requiresWebhook` as "show the webhook setup hint" (existing `<WebhookHint />` component).

---

## L3 — Inline Mutations + Snooze

### `POST /api/v1/work-board/review-action` (Free+)

Body: `{ repoFullName, prNumber, action: "approve" | "request_changes" | "comment", body?: string }`

- Resolves `owner/repo` from `repoFullName`.
- Calls `POST /repos/:owner/:repo/pulls/:prNumber/reviews` with `event: APPROVE | REQUEST_CHANGES | COMMENT`.
- On `401`/`403` with missing-scope hint → returns `403 { code: "scope_required", requiredScopes: ["repo"] }`.
- Invalidates `work_board_cache` entry for `my_reviews` on success (so next poll re-fetches fresh).
- Audit-logged via existing [`auditLog()`](server/lib/audit.js).

### `POST /api/v1/work-board/snooze` (Free+)

Body: `{ repoFullName, prNumber, hours: 24 | 72 | 168 }`

Writes a row to `work_board_snooze` (see Data Model). Existing list endpoints filter out snoozed items when `until_at > now()`.

### `DELETE /api/v1/work-board/snooze` (Free+)

Body: `{ repoFullName, prNumber }` — unsnooze.

### `GET /api/v1/work-board/snoozes` (Free+)

Returns all active snoozes for the user. Used by the Filters → "Show snoozed" toggle.

---

## L4 — AI Summary (All Providers)

### Why this works cross-provider

The existing abstraction ([`server/lib/ai-provider.js:12-23`](server/lib/ai-provider.js#L12-L23)) already exposes:

- `generate({ prompt, systemPrompt, schema })` → `{ text, parsed }`
- JSON-schema-constrained output across Gemini, Anthropic, OpenAI, OpenRouter, Local.
- Error normalisation to `AIError` with typed codes.

Only Anthropic prompt caching is absent; this spec adds it as an **optional optimisation** (see below) — the feature ships without it.

### Endpoint: `POST /api/v1/work-board/ai-summary` (Free+, BYOK-gated)

Request body: none (reads data from `work_board_cache`).

Behaviour:

1. If `createProviderForUser(userId, 'completion', { featureKey: 'WORK_BOARD_SUMMARY' })` returns `null` → `404 { code: "ai_not_configured" }`.
2. Enforce `1 call / 5 min / user` rate limit (in-memory `Map<userId, lastCalledAt>`, mirrors existing [`testLastCall`](server/routes/user-ai-config.js) pattern).
3. Load the four cached summaries (my_reviews, stale_prs, my_issues, tech_debt). If all absent, populate them first via L1.
4. Build a compact fact sheet (≤ 1 500 tokens) — counts + top 5 items per category.
5. Call `provider.generate({ systemPrompt: SYSTEM_PROMPT, prompt: factSheet, schema: SUMMARY_SCHEMA })`.
6. Cache the result in `work_board_cache` under `query_type: 'ai_summary'` for 5 min.
7. Return envelope:

```jsonc
{
  "data": {
    "headline": "3 urgent reviews and a stale PR need attention today.",
    "bullets": [
      { "text": "@alice's PR on acme/backend is blocking 2 downstream.", "severity": "high", "link": { "type": "pr", "repo": "acme/backend", "number": 142 } },
      { "text": "1 stale PR in acme/infra has been open 32 days.", "severity": "medium", "link": { "type": "pr", "repo": "acme/infra", "number": 31 } },
      { "text": "No tech-debt hotspots added this week.", "severity": "info" }
    ],
    "urgencyScore": 0.78,
    "model": "claude-sonnet-4-5",
    "provider": "anthropic"
  },
  "meta": { "cached": false, "generatedAt": "..." }
}
```

### Prompt design

System prompt (≈ 800 tokens, **cacheable**):

```
You are a senior engineering lead reviewing a developer's cross-repo work board.
Produce a concise, actionable headline + 3-5 bullets that surface the single
most important thing they should do next.

Rules:
- ≤ 120 chars in the headline. No emoji. No hedging. Active voice.
- Each bullet ≤ 160 chars. Reference specific repos, PR numbers, people when helpful.
- Severity: "high" only if it blocks others or is past SLA; "medium" for old-but-not-blocking; "info" for observations.
- urgencyScore 0..1: 0.0 = quiet day, 1.0 = drop everything.
- Never invent items. If the input has no urgent work, say so and propose one quick win.
- Output ONLY valid JSON matching the provided schema. No prose.
```

User prompt contains the fact sheet. Same across all providers.

### Schema

```js
const SUMMARY_SCHEMA = {
  type: 'object',
  required: ['headline', 'bullets', 'urgencyScore'],
  properties: {
    headline: { type: 'string', maxLength: 200 },
    bullets: {
      type: 'array', minItems: 1, maxItems: 5,
      items: {
        type: 'object',
        required: ['text', 'severity'],
        properties: {
          text: { type: 'string', maxLength: 240 },
          severity: { enum: ['high', 'medium', 'info'] },
          link: {
            type: 'object',
            properties: {
              type: { enum: ['pr', 'issue'] },
              repo: { type: 'string' },
              number: { type: 'integer' },
            },
          },
        },
      },
    },
    urgencyScore: { type: 'number', minimum: 0, maximum: 1 },
  },
};
```

### Anthropic cache_control optimisation (optional)

When `provider.type === 'anthropic'`, wrap the system prompt in a `cache_control: { type: 'ephemeral' }` block. This is a future patch to [`server/lib/providers/anthropic.js`](server/lib/providers/anthropic.js); the abstraction is extended to forward `systemPromptCacheable: true` from the caller. Cost saving: ~90 % of system tokens reused across the 5-minute cache window. **Not blocking for v1** — documented in Rollout § "Follow-up optimisations".

### Provider validation notes

- **Gemini 2.5 Flash** (free tier available): handles 1 500-token fact sheet + schema reliably; ~1 s latency.
- **GPT-4o-mini** (cheap): same.
- **Claude Sonnet 4.5**: best bullet quality in manual spot-check; benefits most from cache_control once wired.
- **OpenRouter Llama 3.3 70B** (free on some backends): usable; occasional schema drift → relies on existing `extractJson()` helper ([server/lib/ai-provider.js](server/lib/ai-provider.js)).
- **Local (Ollama qwen2.5:7b)**: works; slower (5-8 s); adequate for offline users.

The prompt is tuned conservatively (rules before data, schema strict, "never invent" clause) so quality is consistent across providers.

---

## L5 — Frontend

### 5.1 — Auto-refresh + "updated Ns ago"

`useWorkBoardFetch` in [`src/hooks/useWorkBoard.js`](src/hooks/useWorkBoard.js) gains:

- `refreshIntervalMs` (default 60 000).
- Page Visibility API: pauses polling when `document.hidden`, triggers immediate refresh on return.
- Exposes `lastFetchedAt: Date | null` plus `isStale: boolean` (older than `refreshIntervalMs * 1.5`).

A new small hook `useRelativeTime(date)` returns a human string ("updated 23 s ago", "2 min ago", "just now") that re-renders every 15 s.

The KPI row gains a "refresh" icon button (top-right, inside the header area) that calls `refresh()` on all four KPIs at once; animates with Framer Motion `rotate` on click.

### 5.2 — Filter bar + URL sync + presets

New components in `src/components/WorkBoard/filters/`:

- `WorkBoardFilterBar.jsx` — horizontal chip strip (repo / author / label / age bucket / "hide snoozed").
- `FilterChip.jsx` — adapts the existing pattern from [`QuickFilters.jsx`](src/components/MigrationWizard/steps/RepoSelectStep/QuickFilters.jsx).
- `PresetDropdown.jsx` — save / load / rename / delete named filter presets.

URL sync via `useUrlParams(['repos','authors','labels','age','tab'])` — a light wrapper around `URLSearchParams` + `history.replaceState`. No React Router.

Presets stored server-side in `work_board_presets` (see Data Model) so they follow the user across devices. API:

- `GET /api/v1/work-board/presets` → array.
- `POST /api/v1/work-board/presets` `{ name, filters }` → `{ id }`.
- `PATCH /api/v1/work-board/presets/:id` `{ name?, filters? }`.
- `DELETE /api/v1/work-board/presets/:id`.

### 5.3 — Keyboard navigation

New hook `useRowNavigation({ rows, onOpen, onAction })` returns `{ activeIndex, handlers, ariaProps }`.

Bindings registered via an extended `useKeyboardShortcuts` (adding context-scoped tab-level shortcuts — the hook today is only global):

| Key | Action |
|-----|--------|
| `j` / `↓` | Next row |
| `k` / `↑` | Previous row |
| `Enter` | Open on GitHub (new tab) |
| `.` | Approve (PR rows) |
| `x` | Request changes (PR rows, opens modal for body) |
| `s` | Snooze 24 h |
| `Shift-S` | Snooze 7 d |
| `u` | Unsnooze (in snoozed view) |
| `r` | Re-request review |
| `/` | Focus filter search |
| `?` | Show keyboard help modal |
| `g` then `r`/`s`/`i`/`t`/`l`/`d` | Go-to tab (reviews / stale / issues / techdebt / review-load / dora) |

Help modal lists everything; reuses [`ModalContext`](src/contexts/ModalContext.jsx).

### 5.4 — Inline action UI

Each row in PR tabs gets three icon buttons on hover (`<ApproveButton>`, `<RequestChangesButton>`, `<SnoozeButton>`). Mobile: always visible. No pre-action confirmation modal — deliberate keyboard input or button click is confirmation enough; `x` (request-changes) already opens a modal for the body, `s` (snooze) is one-click reversible.

Optimistic UI: on click, the row fades out and shows "Approved ✓" pill for 2 s, then removes itself. On server error, the row returns and a toast fires via `useToast`.

### 5.5 — AI Summary card

New `<AISummaryCard>` above the KPI row.

Layout:

- Headline in `ds-gradient-text`, display font, 20 px.
- Bullets as a vertical list with coloured dots (red / amber / slate per severity).
- Right column: circular urgency gauge (SVG, 0..1 → arc) + regenerate icon button.
- Dismissable (session-level; respawns on next load).
- Hidden entirely when `GET /api/v1/work-board/ai-summary` returns `404 ai_not_configured`.

Uses `ds-card-shimmer` + `ds-glass` for premium feel. Framer Motion `AnimatePresence` on bullet list (stagger).

### 5.6 — Command palette extension

Extend the existing [`CommandPalette`](src/components/CommandPalette.jsx) with a dynamic "Work Board" group (only shown when page === 'work-board'). Items:

- `Open My Reviews` / `Stale PRs` / `My Issues` / `Tech Debt` / `DORA`
- `Approve current row` (enabled only if a PR row has keyboard focus)
- `Snooze current row 24h` / `7d`
- `Filter by repo…` → opens submenu with repos from current data
- `Save current filter as preset…`
- `Regenerate AI summary`

---

## Data Model

Three new tables + indices. All follow the existing `try/catch duplicate column` migration pattern in [`server/db.js`](server/db.js).

```sql
-- M010: live-data cache
CREATE TABLE IF NOT EXISTS work_board_cache (
    user_id     INTEGER NOT NULL,
    query_type  TEXT    NOT NULL,  -- 'my_reviews' | 'stale_prs' | 'my_issues' | 'tech_debt' | 'ai_summary'
    payload     TEXT    NOT NULL,  -- JSON
    etag        TEXT,
    fetched_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at  DATETIME NOT NULL,
    PRIMARY KEY (user_id, query_type),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_wbc_expires ON work_board_cache(expires_at);

-- M011: snoozed PRs / issues
CREATE TABLE IF NOT EXISTS work_board_snooze (
    user_id        INTEGER NOT NULL,
    repo_full_name TEXT    NOT NULL,
    item_type      TEXT    NOT NULL,  -- 'pr' | 'issue'
    item_number    INTEGER NOT NULL,
    until_at       DATETIME NOT NULL,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, repo_full_name, item_type, item_number),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_wbs_until ON work_board_snooze(until_at);

-- M012: filter presets
CREATE TABLE IF NOT EXISTS work_board_presets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    name       TEXT    NOT NULL,
    filters    TEXT    NOT NULL,  -- JSON
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, name),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_wbp_user ON work_board_presets(user_id);
```

A background sweeper runs every 10 min to delete `work_board_cache` rows where `expires_at < NOW() - 1 day` and `work_board_snooze` rows where `until_at < NOW() - 1 day`. Implementation: new file `server/lib/work-board-sweeper.js` exporting `startWorkBoardSweeper()` / `stopWorkBoardSweeper()`, invoked from [`server/index.js`](server/index.js) startup sequence alongside the existing migration-engine scheduler and cleared on graceful shutdown.

---

## API Summary

| Method | Path | Tier | New / Modified |
|--------|------|------|----------------|
| GET | `/api/v1/work-board/my-reviews` | Free+ | **Modified** — adds live fallback, `meta` envelope |
| GET | `/api/v1/work-board/stale-prs` | Pro+ | Modified |
| GET | `/api/v1/work-board/my-issues` | Free+ | Modified |
| GET | `/api/v1/work-board/tech-debt` | Pro+ | Modified |
| GET | `/api/v1/work-board/review-load` | Pro+ | Modified (`meta.requiresWebhook`) |
| GET | `/api/v1/work-board/dora` | Ent+ | Modified (envelope only) |
| POST | `/api/v1/work-board/review-action` | Free+ | **New** |
| POST | `/api/v1/work-board/snooze` | Free+ | **New** |
| DELETE | `/api/v1/work-board/snooze` | Free+ | **New** |
| GET | `/api/v1/work-board/snoozes` | Free+ | **New** |
| GET | `/api/v1/work-board/presets` | Free+ | **New** |
| POST | `/api/v1/work-board/presets` | Free+ | **New** |
| PATCH | `/api/v1/work-board/presets/:id` | Free+ | **New** |
| DELETE | `/api/v1/work-board/presets/:id` | Free+ | **New** |
| POST | `/api/v1/work-board/ai-summary` | Free+ BYOK | **New** |

---

## Testing Strategy

| Layer | Style | Location | Notes |
|-------|-------|----------|-------|
| `work-board-github.js` | Unit, mock `githubApi` | `server/__tests__/work-board-github.test.js` | One test per query type + rate-limit 429 path |
| `work-board-cache.js` | Unit, in-memory sqlite | `server/__tests__/work-board-cache.test.js` | Fresh / stale / ETag revalidation |
| Route layer | Integration, `supertest` | `server/__tests__/work-board-routes.test.js` (extend) | Webhook-only / live-only / merged paths |
| `review-action` | Integration with `githubApi` mock | `server/__tests__/work-board-actions.test.js` | `scope_required` 403 path included |
| Snooze + presets | Unit | `server/__tests__/work-board-snooze.test.js`, `work-board-presets.test.js` | Standard CRUD |
| `ai-summary` | Integration, mock `createProviderForUser` | `server/__tests__/work-board-ai-summary.test.js` | Per-provider: one test each for Gemini / Anthropic / OpenAI mocks |
| Frontend hooks | Unit, `vitest` + RTL | `tests/hooks/useWorkBoard.test.js` (new) | Auto-refresh pause on hidden tab |
| WorkBoardPage | Component, `vitest` | `tests/components/WorkBoard/WorkBoardPage.test.jsx` (extend) | Filter bar, keyboard nav, AI card visible/hidden |
| E2E | 1 Playwright test | `e2e/work-board-zero-config.spec.js` | Fresh user, no webhook → KPIs populate |

Cross-provider AI validation: a single parametrised test that mocks four providers in turn, asserts the response validates against `SUMMARY_SCHEMA`.

---

## Rollout Plan

**Single release.** No feature flag. Branch: `work-board-megaplan` → PR → merge to main.

**Order of commits inside the PR** (for review legibility):

1. DB migrations (M010, M011, M012).
2. `work-board-cache.js` + tests.
3. `work-board-github.js` + tests.
4. Route integration (live/webhook merge).
5. Snooze + presets endpoints + tests.
6. Review-action endpoint + tests.
7. `work-board-summary.js` + route + tests.
8. Frontend: hooks + filter bar + URL sync.
9. Frontend: keyboard nav + inline actions.
10. Frontend: AI summary card + palette extension.
11. E2E test.
12. Docs: `docs/work-board.md` update, `CHANGELOG`.

**Post-merge follow-ups** (not in this spec):

- Anthropic `cache_control` optimisation in [`server/lib/providers/anthropic.js`](server/lib/providers/anthropic.js).
- Slack / email digest of the daily AI summary (opt-in).
- Team-scoped work board (requires Teams product decisions).

---

## Risks & Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|-----------|
| 1 | GitHub search rate limit burst | Low | Medium | 60 s poll → 4 req/min vs 30 cap; ETag re-validation doesn't charge quota |
| 2 | OAuth scope missing for review submit | Medium | High | Server returns `scope_required`; UI shows "Re-authorize" CTA |
| 3 | AI provider cost runaway | Low | Medium | Per-user 5-min cache + 5-min cooldown → ≤ 12 calls/hour/user |
| 4 | Schema drift on weaker models (Llama-based OpenRouter) | Medium | Low | Existing `extractJson()` tolerant parser; fall back to regenerate-once on invalid JSON |
| 5 | Clock skew between client and server on "updated N s ago" | Low | Low | Backend returns `fetchedAt` ISO; frontend diffs against client time for relative label only |
| 6 | Large search results (≥ 100) truncated | Low | Low | GitHub caps at 1 000; we cap at 100 per query (sufficient for a personal queue); banner if `total_count > 100` |
| 7 | Preset name collisions | Low | Low | `UNIQUE (user_id, name)` constraint; UI rejects duplicates with inline error |

---

## Appendix A — Why not GraphQL?

GitHub's GraphQL can answer `viewer { pullRequests(first: 50, states: OPEN, filterBy: {reviewRequested: VIEWER}) }` in a single round-trip, which is elegant. We chose REST `/search/issues` because:

- The codebase has zero GraphQL usage today. Adding it means a client, a schema, and a mental model split.
- REST search handles all four queries with identical ergonomics.
- The rate-limit budget is identical (30 req/min search is the bottleneck either way).
- Migrating later is a one-file swap if we choose to.

## Appendix B — Why server-side snooze instead of localStorage?

localStorage is tempting (zero server cost) but:

- Fails across devices (laptop ↔ desktop).
- Fails in incognito.
- Lost on "clear site data".
- Cannot participate in future features (team-shared snoozes, mobile app).

Cost of server storage: ≤ 100 bytes per snooze, ~100 active snoozes per power user → 10 KB/user. Negligible. Endpoint already exists in the auth/middleware stack. Chosen.

## Appendix C — Why all providers in v1?

The abstraction ([`server/lib/ai-provider.js`](server/lib/ai-provider.js)) already pipes all five provider families through a uniform `generate({ prompt, systemPrompt, schema })` interface. Supporting them all is a single code path; restricting to Anthropic would mean hiding capability that users have already paid for via BYOK. Small-model providers (Gemini Flash, Llama 3.3 70B free on OpenRouter, Qwen 2.5 7B local) can produce acceptable summaries at zero or near-zero cost — the strict prompt + schema keeps output quality consistent.
