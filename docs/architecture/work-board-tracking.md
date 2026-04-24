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
