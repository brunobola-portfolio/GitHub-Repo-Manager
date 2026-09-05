# Work Board Tracking — Architecture

**Phase:** 1 (Foundations)
**Files:** `server/lib/work-board-*.js`, `server/routes/work-board-tracking.js`, `server/db.js`
**Last updated:** 2026-04-24

---

## 1. Overview

`work_board_tracked_repos` is a per-user registry of GitHub repositories that
should appear on the Work Board. Before Phase 1, the Work Board was sourced
exclusively from webhook deliveries: nothing appeared until a webhook fired,
and there was no way to control which repositories were surfaced. The new model
replaces that with **signal-based discovery**: on first visit the server
queries five GitHub API signals in parallel, unions the results, and persists a
ranked set of repositories for the user. Subsequent page loads are served from
this table instantly, with a background re-discovery triggered whenever the
cached result is more than 24 hours old (stale-while-revalidate). Webhook
delivery remains supported and now auto-inserts rows with `source_signal='webhook'`
rather than being the sole source of truth.

---

## 2. Schema

All four tables are added in `server/db.js` lines 418–467 using
`CREATE TABLE IF NOT EXISTS`, the same pattern used for `user_ai_config` and
`work_board_presets`. No migration tool is needed; they are bootstrapped on
every server start.

### `work_board_tracked_repos`

`db.js` lines 418–432.

| Column | Type | Notes |
|---|---|---|
| `user_id` | INTEGER NOT NULL | FK → `users(id)` ON DELETE CASCADE |
| `repo_full_name` | TEXT NOT NULL | "owner/repo" |
| `repo_id` | INTEGER | GitHub numeric ID (nullable) |
| `source_signal` | TEXT NOT NULL | One of: `review_requested`, `authored_pr`, `assigned_issue`, `owned`, `recent_commit`, `pinned`, `webhook` |
| `is_pinned` | INTEGER NOT NULL DEFAULT 0 | 0 or 1 (SQLite boolean) |
| `is_muted` | INTEGER NOT NULL DEFAULT 0 | 0 or 1 |
| `last_activity_at` | DATETIME | Latest activity timestamp from GitHub |
| `discovered_at` | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP | When the row was first created |
| `last_synced_at` | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP | Updated on every upsert |

**Primary key:** `(user_id, repo_full_name)`
**Index:** `idx_wbtr_user_active` on `(user_id, is_muted, last_activity_at DESC)` — covers the common "show active, non-muted repos for user" query.

### `work_board_prefs`

`db.js` lines 434–445.

| Column | Type | Default | Notes |
|---|---|---|---|
| `user_id` | INTEGER PRIMARY KEY | — | FK → `users(id)` ON DELETE CASCADE |
| `discovery_window_days` | INTEGER NOT NULL | 60 | Look-back window for `authored_pr` and `recent_commit` signals |
| `max_auto_repos` | INTEGER NOT NULL | 50 | Cap applied after merge/sort |
| `auto_mute_bots` | INTEGER NOT NULL | 0 | Reserved; not yet enforced in discovery |
| `ai_assistant_enabled` | INTEGER NOT NULL | 0 | AI assistant feature gate |
| `ai_monthly_cap_cents` | INTEGER NOT NULL | 500 | Spend cap ($5.00) |
| `ai_response_locale` | TEXT | NULL | Prepended as system-prompt locale hint |
| `last_discovery_at` | DATETIME | NULL | Set by `runDiscovery` on completion; NULL triggers auto-migration on `/ping` |

### `work_board_ai_dismissed`

`db.js` lines 446–454.

Tracks AI suggestion patterns dismissed by the user so they are not re-surfaced.

| Column | Type | Notes |
|---|---|---|
| `user_id` | INTEGER NOT NULL | FK → `users(id)` ON DELETE CASCADE |
| `pattern_key` | TEXT NOT NULL | Pattern identifier (e.g. `StaleNoActivity`) |
| `repo_full_name` | TEXT NOT NULL DEFAULT '' | Empty string for non-repo-specific dismissals; NOT NULL because SQLite PK members cannot be NULL |
| `dismissed_at` | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP | — |

**Primary key:** `(user_id, pattern_key, repo_full_name)`

### `work_board_undo_log`

`db.js` lines 455–467.

| Column | Type | Notes |
|---|---|---|
| `operation_id` | TEXT PRIMARY KEY | UUID v4 |
| `user_id` | INTEGER NOT NULL | FK → `users(id)` ON DELETE CASCADE |
| `operation_type` | TEXT NOT NULL | `pin`, `unpin`, `mute`, `unmute`, `track`, `untrack`, `bulk`, `ai_bulk` |
| `before_state` | TEXT NOT NULL | JSON array of compact row snapshots |
| `after_state` | TEXT NOT NULL | JSON array of compact row snapshots |
| `created_at` | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP | — |
| `expires_at` | DATETIME NOT NULL | `created_at + 24h`; computed by `work-board-undo-log.js` |

**Index:** `idx_undo_user_expires` on `(user_id, expires_at)` — used by `undoOperation` to filter expired rows and by `cleanupExpired` for bulk deletes.

---

## 3. Discovery Algorithm

**Orchestrator:** `server/lib/work-board-discovery.js` → `runDiscovery(userId, token, prefs)`
**Merge logic:** `server/lib/work-board-discovery-merge.js` → `mergeCandidates(existing, candidates, prefs)`

### Signal collectors

Five collectors run in `Promise.all` (parallel, non-blocking):

| Collector | GitHub API call | Signal value | Rate type |
|---|---|---|---|
| `collectReviewRequested` | `GET /search/issues?q=is:open+archived:false+review-requested:@me` | `review_requested` | Search API |
| `collectAuthoredPRs` | `GET /search/issues?q=is:open+is:pr+archived:false+author:@me+updated:>=Nd-ago` | `authored_pr` | Search API |
| `collectAssignedIssues` | `GET /search/issues?q=is:open+is:issue+archived:false+assignee:@me` | `assigned_issue` | Search API |
| `collectOwnedRepos` | `GET /user/repos?affiliation=owner&sort=pushed&per_page=30` | `owned` | Core API |
| `collectRecentCommits` | `GET /user` then `GET /users/{login}/events?per_page=100` (PushEvent filter) | `recent_commit` | Core API (2 calls) |

**Rate budget:** 3 Search API calls + 2 Core API calls per discovery run. The Search API allows 30 authenticated requests/minute; the Core API allows 5,000/hour — both comfortably within limits even at hundreds of concurrent users.

`403` SSO responses degrade gracefully to empty arrays. The return value includes a `sso_orgs_blocked` field (currently always `[]`; future work surfaces per-org reconnect links).

### Merge rules

`mergeCandidates` in `server/lib/work-board-discovery-merge.js`:

1. **Deduplicate** candidates by `repo_full_name`. When multiple signals match the same repo, the highest-priority signal wins using the order: `review_requested` > `authored_pr` > `assigned_issue` > `owned` > `recent_commit`. The latest `last_activity_at` across all matching signals is kept.

2. **Preserve user intent:** any existing row with `is_pinned=1`, `is_muted=1`, or `source_signal='webhook'` is always kept, regardless of whether the repo appears in the current discovery result.

3. **Remove stale auto-discovered rows:** existing rows that are neither protected (pinned/muted/webhook) nor present in the new candidates are added to the `remove` list.

4. **Insert net-new repos:** candidates not already in the table are added to the `add` list.

5. **Cap:** the `add` list is sorted by `last_activity_at DESC` and truncated to `prefs.max_auto_repos`.

The orchestrator (`runDiscovery`) executes removes and upserts in a single SQLite transaction, then stamps `work_board_prefs.last_discovery_at = CURRENT_TIMESTAMP`.

### Stale-while-revalidate

On every Work Board page load the frontend calls `GET /ping`. If
`last_discovery_at` is null or older than 24 hours, the server fires
`runDiscovery` as a fire-and-forget (`.catch()` logged via Pino) and
immediately returns the cached data. The next page load reflects the updated
result. No cron infrastructure is required.

---

## 4. Mutation and Undo Log

**CRUD library:** `server/lib/work-board-tracking.js`
**Undo library:** `server/lib/work-board-undo-log.js`

### Upsert semantics

`upsertTrackedRepo(userId, repoFullName, action)` handles six actions:

| Action | Behaviour |
|---|---|
| `track` | Inserts row with `is_pinned=1, source_signal='pinned'` if new; no-op if existing |
| `pin` | Sets `is_pinned=1`; inserts with `source_signal='pinned'` if new |
| `unpin` | Sets `is_pinned=0` |
| `mute` | Sets `is_muted=1` |
| `unmute` | Sets `is_muted=0` |
| `untrack` | Hard-deletes the row |

All mutations use `INSERT … ON CONFLICT DO UPDATE` (upsert) so they are
idempotent at the row level. `source_signal` is preserved on update — only
the boolean flags change.

### Bulk actions

`bulkUpdate(userId, repoFullNames, action)` wraps all mutations in a single
SQLite transaction so the entire batch either commits or rolls back. Maximum
200 repos per call (enforced at both the library and router levels). Actions
that require an existing row (`pin`, `unpin`, `mute`, `unmute`, `untrack`)
silently skip repos that are not yet tracked; those names are returned in the
`skipped` array. The whole batch shares a single `operation_id` for undo.

### Undo log

`recordOperation(userId, operationType, beforeState, afterState)` in
`server/lib/work-board-undo-log.js`:

- `operation_id` is a UUID v4 from Node's `crypto.randomUUID()`.
- `before_state` and `after_state` are compact JSON arrays containing only
  `{repo_full_name, is_pinned, is_muted, source_signal}` — not full row snapshots.
  A bulk-of-200 op typically serialises to ~6 KB.
- `expires_at` is set to `now + 24h` at write time.
- `undoOperation` fetches the row (checking `expires_at > now`), deletes it, and
  returns the before/after state for the router to re-apply in a transaction.
- Expired rows are eligible for cleanup via `cleanupExpired()` (called by a
  nightly job or opportunistically).

Statements are lazy-initialised to allow `vi.mock('../db.js')` to substitute an
in-memory schema before the prepared statements compile. A `_resetStatementsForTests()` export allows test suites to reset the cache between runs.

---

## 5. Auto-migration (First-Visit)

`GET /api/v1/work-board/ping` is the first request the Work Board frontend
makes on load. Its behaviour:

1. Calls `patchPrefs(userId, {})` — a cheap upsert that creates the prefs row
   with defaults if it does not exist. This is the auto-migration trigger: a
   user who has never visited the Work Board gets a `work_board_prefs` row
   on their first `/ping` call, with `last_discovery_at = NULL`.

2. Reads back the prefs. If `last_discovery_at` is null or older than 24h
   **and** `req.session.accessToken` is available, fires `runDiscovery`
   fire-and-forget and returns `discovery_in_flight: true`.

3. Returns `{ prefs, discovery_in_flight }` immediately.

The frontend polls `GET /ping` every 500 ms for up to 5 seconds when
`discovery_in_flight` is true. When `last_discovery_at` transitions from null
to a non-null value the frontend refetches all tab data without a full page
reload — no banner required in the fallback path.

Existing webhook-only users (no prefs row) are handled identically: the
first `/ping` creates their prefs row and triggers background discovery.
Until `last_discovery_at` is set, `applyTrackedFilter` (see §7) returns items
unchanged, so the Work Board continues to show webhook-sourced data during the
migration window.

---

## 6. Webhook Coherence

`server/routes/github-events-webhook.js` imports
`upsertTrackedRepoFromWebhook` from `server/lib/work-board-tracking.js`.

After every successfully handled webhook event (PR, review, issue,
deployment_status), the handler:

1. Extracts `payload.repository.owner.login` and `payload.repository.full_name`.
2. Looks up the matching user by `username`.
3. Calls `upsertTrackedRepoFromWebhook(userId, repoFullName, repoId)`.

The upsert uses `ON CONFLICT DO UPDATE SET last_activity_at = CURRENT_TIMESTAMP` —
so:
- **First delivery** for an unknown repo → inserts with `source_signal='webhook'`, `is_pinned=0`, `is_muted=0`.
- **Subsequent deliveries** → updates `last_activity_at` only.

The `source_signal='webhook'` sentinel is treated as "protected" in
`mergeCandidates` (see §3), so discovery never auto-removes a webhook-sourced
repo even if none of the five GitHub API signals match it. Installing a webhook
on an org is thus semantically equivalent to pinning all repos in that org.

This call is fire-and-forget and wrapped in its own `try/catch`; failures are
logged at `warn` level and must not route the delivery to the dead-letter queue.

---

## 7. Retrocompat (`applyTrackedFilter`)

`server/lib/work-board-filter.js` exports `applyTrackedFilter(userId, items)`.
It is called in `server/routes/work-board.js` on the results of all four
existing endpoints: `/my-reviews`, `/my-issues`, `/stale-prs`, and `/tech-debt`.

Behaviour:

- If `userId` is absent → return items unchanged.
- If the user has no row in `work_board_prefs` → return items unchanged (retrocompat no-op for existing webhook-only users).
- If the user has prefs → fetch all `is_muted=1` repos for that user and filter them out of the result set by `item.repoFullName`.

Items without a `repoFullName` field are passed through untouched. Statements
are lazy-initialised for the same mock-compatibility reason as the undo-log
module.

The net effect: Phase 1 is a zero-regression drop-in for all existing users.
Mute filtering only activates after the user has a `work_board_prefs` row,
which only happens after their first Work Board page load.

---

## Phase 2 UI (shipped)

Settings → Work Board provides:

- **Discovery panel** (refresh, activity-window select, auto-mute bots toggle)
- **Virtualized tracked-repos list** with search, signal filters, bulk selection
- **Per-row menu** (pin / mute / untrack with undo toast)
- **Add-repo autocomplete** (cmdk + /repo-search endpoint)
- **Webhook connect panel** (tier-gated via useLicense)
- **Danger zone** (reset discovery, clear all)

State is shared via `TrackedReposContext` mounted at the App root under the
authenticated tree. The hook `useTrackedRepos` (src/hooks/useTrackedRepos.js)
exposes optimistic mutations with rollback and matches existing
`ModalContext`/`SelectionContext` patterns.

### Files

| Layer | Path |
| --- | --- |
| API wrappers | src/api/workBoardTracking.js |
| Context | src/contexts/TrackedReposContext.jsx + src/contexts/contexts.js |
| Hook | src/hooks/useTrackedRepos.js |
| License tier hook | src/hooks/useLicense.js |
| Section | src/components/Settings/WorkBoard/WorkBoardSettingsSection.jsx |
| Leaf components | src/components/Settings/WorkBoard/{DiscoveryPanel,TrackedReposList,RepoRow,SearchFilterBar,BulkActionsBar,AddRepoInput,WebhookConnectPanel,DangerZoneCard}.jsx |

### Tests

~40 new unit/integration tests in `tests/api/workBoardTracking.test.js`,
`tests/hooks/useTrackedRepos.test.jsx`, and
`tests/components/Settings/WorkBoard/*.test.jsx`. E2E happy-path deferred
until dev-server seeding is set up.

## Phase 3 Inline Actions (shipped)

The Work Board page now has tracking operations inline on every row, plus a
compact management popover in the header. No backend changes — all mutations
go through the existing Phase 1 endpoints via the Phase 2 `useTrackedRepos`
hook with optimistic UI + undo toasts.

### Surfaces

- **WorkBoardRowMenu** (`src/components/WorkBoard/WorkBoardRowMenu.jsx`) —
  `⋯` button injected into every row across MyIssuesTab, MyReviewsTab,
  StalePRsTab, TechDebtTab. Actions: copy link, open GitHub, pin/unpin
  repo, mute/unmute repo, stop tracking.

- **ManageReposButton** (`src/components/WorkBoard/ManageReposButton.jsx`) —
  header popover (320px) with search + top 10 recent tracked repos with
  quick pin/mute toggles + "See all in Settings" link (uses ModalContext
  `openModalWithData` with `initialTab: 'work-board'`).

- **EmptyStateDiscovery** (`src/components/WorkBoard/EmptyStateDiscovery.jsx`) —
  replaces the sparse "no data" fallback with a "Let's find your work"
  CTA that triggers `discover()`. Shows a plain empty state once the user
  has tracked repos (not a first-visit case).

### UX contract

- ChipStrips/InlineActions (per-item actions: snooze, ping, draft comment)
  coexist with the new menu (per-repo actions). Different semantics,
  different visual weight.
- Menu button's `opacity-0 group-hover:opacity-100` keeps rows clean at
  rest; on hover the ⋯ becomes visible.
- Undo toast on every mutation, matches Phase 2 Settings behaviour.
- Click propagation: menu trigger uses `stopPropagation` so clicking it on
  a link-wrapped row does not navigate.

## Phase 4 Cross-App Integration (shipped)

Tracked-repos state is now visible and actionable across the app — not only
inside Work Board and Settings. No backend changes; every surface consumes
the Phase 2 `useTrackedRepos` context.

### New surfaces

- **TrackedDot** (`src/components/WorkBoard/TrackedDot.jsx`) — tiny (6 px)
  dot shown inline on `RepoCard` title rows. Indigo filled when tracked
  and not muted; hollow slate when muted; renders nothing otherwise.

- **TrackedChip** (`src/components/WorkBoard/TrackedChip.jsx`) — pill for
  modal/page headers. Placed in `RepoDetail` header and in `ReviewToolbar`
  of `PRReviewView`. Tracked → a brand-toned `Tracked` chip opening a popover
  with pin/mute/untrack. Not tracked → ghost `Track` button calling
  `hook.track()` directly.

- **Dashboard "What needs you" row** (`src/components/Dashboard/WhatNeedsYouGrid.jsx`,
  rendered from `TodayPanel.jsx`; the `DashboardHero.jsx` this used to
  reference was a stale fork of `TodayPanel` and was deleted in the 2026-09
  sweep, and `TodayPanel` itself earlier replaced `YourWorkCard`) — KPI tiles for
  `reviews waiting · stale PRs · issues` with an "Open Work Board →" link that
  routes to the Work Board page. Silently degrades to zeros when the
  aggregation endpoints are gated or unreachable.
- **Header nav badge** — `NavButton` extended with optional `badge` prop.
  `useWorkBoardBadgeCounts` hook provides the count (reviews + stale PRs);
  hidden when 0, rendered as `9+` when > 9. Cached in `localStorage` to
  avoid flicker on navigation.

### Known limitations (Phase 4.1 follow-ups)

- `YourWorkCard` is NOT org-scoped — counts are user-wide. Adding
  `?org=` filtering on `/my-reviews`, `/stale-prs`, `/my-issues`
  endpoints will close this gap.
- `RepoCard` context menu does not yet include pin/mute/untrack items
  (the menu lives outside `RepoCard` in the list container; a follow-up
  can extend it).

## Phase 5 Command Palette (shipped)

The ⌘K palette (existing `src/components/CommandPalette.jsx`) now includes
two new command groups that let power users do tracking operations
keyboard-first from anywhere in the app.

### New command groups

- **Work Board Actions** (global — always visible):
  - Refresh discovery
  - Refresh Work Board (dispatches `workboard:refresh-all`)
  - Toggle muted repos in Work Board (dispatches `workboard:toggle-muted`)
  - Clear Work Board filters (dispatches `workboard:clear-filters`)

- **Tracked Repositories** (rendered only when `useTrackedRepos().repos.length > 0`):
  - `Pin <repo>` / `Unpin <repo>`
  - `Mute <repo>` / `Unmute <repo>`
  - `Stop tracking <repo>`

### Discovery chip

A small `⌘K` pill lives in the Header next to the logo (hidden on
mobile). Clicking it opens the palette via the existing ModalContext
flow.

### Architecture

Commands come from two pure builders:

- `buildTrackedRepoCommands(repos)` in `src/components/CommandPalette/trackedRepoCommands.js`
- `WORK_BOARD_GLOBAL_COMMANDS` in `src/components/CommandPalette/workBoardGlobalCommands.js`

Both are framework-free and unit-tested in isolation. `CommandPalette.jsx`
resolves lucide icons from string names and wires handlers via a single
`runWorkBoardCommand(item)` dispatcher that calls `useTrackedRepos` for
repo-scoped actions and `window.dispatchEvent` for view-scoped ones.

Every mutation surfaces an undo toast, matching the Phase 2/3 UX.

## Phase 6 AI Assistant Backend (shipped)

The first slice of AI Assistant — all backend infrastructure. Frontend
lands in Phase 7.

### Feature gate

Three layers (in order):

1. `WORK_BOARD_AI_ENABLED=true` env var — global kill switch. Off = 404.
2. `work_board_prefs.ai_assistant_enabled = 1` — per-user opt-in. Off = 403.
3. `ai_monthly_cap_cents` vs `work_board_ai_spend.cents` — 429 when cap reached. Cap of 0 means unlimited.

Enforcement: `requireWorkBoardAI` middleware (`server/middleware/work-board-ai-gate.js`).

### Endpoints (`/api/v1/work-board/ai/*`)

- `GET /suggestions` — heuristic pattern suggestions (no LLM). Patterns: `BotPrefix` (≥3 muted with common prefix), `StaleNoActivity` (90+ days inactive).
- `POST /dismiss-suggestion` — records a dismissal in `work_board_ai_dismissed`.
- `POST /interpret { prompt }` — calls user's LLM. Returns actions + summary + HMAC-signed validity token (5 min TTL). Invalid repos filtered out. Spend recorded.
- `POST /apply { validity_token }` — verifies HMAC, groups actions by type, executes via `bulkUpdate`. Returns `operation_id` for undo.
- `GET /activity` — privacy dashboard data: month, spent cents, cap.

### HMAC validity tokens

Stateless. Format: `<b64url(payload)>.<b64url(hmac)>`. Signing key from `AI_DIFF_SIGNING_KEY` env var, or derived from `SESSION_SECRET`. TTL 5 min.

### Prompts versioning

Prompts live under `server/lib/ai-features/work-board-assistant/prompts/<version>/<name>.md`. Current version: `v1`. Loader (`prompts/index.js`) exports `CURRENT_VERSION` and `loadPrompt(name)`.

### Cost accounting

`work_board_ai_spend(user_id, month, cents)` — one row per user per month. `recordSpend()` upserts. `/interpret` records a flat 1 cent per call as MVP estimate.

## Phase 7 AI Assistant Frontend (shipped)

Completes the AI Assistant end-to-end. Frontend consumes the Phase 6
backend via `useWorkBoardAI` and a fresh `src/api/workBoardAI.js` client.

### Settings → Work Board → AI Assistant

Composed at `src/components/Settings/WorkBoard/ai/WorkBoardAISection.jsx`:

- **AIAssistantToggle** — on/off + monthly cap selector (`$1 / $5 / $20 / Unlimited`). Writes through `useTrackedRepos().updatePrefs`.
- **AIActivityCard** — current-month spend + cap + progress bar. Hidden when AI is disabled.
- **SuggestionsPanel** — lists `computeSuggestions()` results with Apply / Dismiss. Apply mutes the suggested repos via `bulkUpdate` with undo toast. Dismiss writes to `work_board_ai_dismissed`.
- **ConversationalEdit** — textarea → "Preview" calls `/ai/interpret` → renders diff summary + action count → "Apply" calls `/ai/apply` with the HMAC validity token. Every mutation surfaces an undo toast.

### Command palette

New "AI Assistant" group (one command in MVP: "AI: Open conversational edit") — gated on `ai_assistant_enabled=1`. Selecting routes the user to Settings → Work Board via the `app:open-settings` event.

### Hook contract

```javascript
const {
    suggestions,   // from /ai/suggestions
    activity,      // from /ai/activity
    enabled,       // false on 403/404 from backend
    isLoading,
    error,
    interpret,     // (prompt) → { summary, actions, validity_token, skipped }
    apply,         // (validity_token) → { applied, operation_id }
    dismiss,       // (pattern_key, repo_full_name_or_key) → void
    reload,        // re-fetch suggestions + activity
} = useWorkBoardAI()
```

### Defer list (Phase 7.1+)

- `/ai/plan-my-day` with SSE streaming
- Per-command palette endpoints: summarize, suggest-reviewer, draft-comment, find-similar
- Token-count-based cost estimates (still flat cent/call)
- i18n via `ai_response_locale`
- Dry-run onboarding (3 free preview calls before full enable)
