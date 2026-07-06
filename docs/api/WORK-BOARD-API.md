# Work Board API Reference

**Mount path:** `/api/v1/work-board` (also reachable via the legacy `/api/work-board` alias)
**Router files:** `server/routes/work-board-tracking.js` (tracked repos, prefs, discovery — documented in full below), plus `work-board.js` (analytics/DORA), `work-board-actions.js` (snooze, presets, review actions), and `work-board-ai.js` (mounted at `/api/v1/work-board/ai`). The latter three are summarised under [Additional Work Board routes](#actions-and-presets).
**Last updated:** 2026-07-06

All endpoints require an authenticated session (`requireAuth`). Authentication
is via session cookie (GitHub OAuth) or an API key passed as
`Authorization: Bearer grm_live_...`.

Mutating requests (POST, PATCH, DELETE) must include a valid CSRF token in the
`X-CSRF-Token` header.

---

## Table of Contents

- [`GET /tracked-repos`](#get-tracked-repos)
- [`POST /tracked-repos`](#post-tracked-repos)
- [`POST /tracked-repos/bulk`](#post-tracked-reposbulk)
- [`GET /prefs`](#get-prefs)
- [`PATCH /prefs`](#patch-prefs)
- [`POST /undo/:operation_id`](#post-undooperation_id)
- [`POST /discover`](#post-discover)
- [`GET /ping`](#get-ping)
- [`GET /repo-search`](#get-repo-search)
- [Additional Work Board routes — Actions and presets](#actions-and-presets)
- [Additional Work Board routes — Analytics and DORA metrics](#analytics-and-dora-metrics)
- [Additional Work Board routes — Work Board AI assistant](#work-board-ai-assistant)

---

## `GET /tracked-repos`

Returns the paginated list of repos the authenticated user has in their tracked
set, along with per-signal counts.

### Query Parameters

| Param | Type | Description |
|---|---|---|
| `search` | string | Case-insensitive substring match on `repo_full_name` |
| `signal` | string | Exact match on `source_signal` (`review_requested`, `authored_pr`, `assigned_issue`, `owned`, `recent_commit`, `pinned`, `webhook`) |
| `org` | string | Prefix match — returns repos whose name starts with `{org}/` |
| `muted` | `true` \| `false` | `true` returns only muted repos; `false` returns only non-muted; omit for all |
| `pinned` | `true` \| `false` | Same semantics as `muted` |
| `limit` | integer | Page size. Clamped to 1–500. Default: 500 |
| `offset` | integer | Zero-based page offset. Default: 0 |

All filters are AND-combined. `countsBySignal` is always computed over all
repos for the user (not the filtered subset) so that filter chips can show
global counts.

### Response `200`

```json
{
  "items": [
    {
      "repo_full_name": "acme/backend",
      "repo_id": 123456789,
      "source_signal": "review_requested",
      "is_pinned": 0,
      "is_muted": 0,
      "last_activity_at": "2026-04-23T14:05:00Z",
      "discovered_at": "2026-04-20T09:00:00Z",
      "last_synced_at": "2026-04-23T14:05:00Z"
    }
  ],
  "total": 42,
  "countsBySignal": {
    "review_requested": 5,
    "authored_pr": 3,
    "owned": 12,
    "webhook": 22
  }
}
```

### Example

```bash
curl -b session.cookie \
  "https://example.com/api/v1/work-board/tracked-repos?signal=review_requested&muted=false&limit=20"
```

---

## `POST /tracked-repos`

Apply a single action to one repository. Creates the row if it does not exist
(for `track` and `pin`). Returns an `operation_id` that can be passed to
`POST /undo/:operation_id` within 24 hours.

### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `repo` | string | Yes | Full repository name `owner/repo`. Must match `^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}\/[a-zA-Z0-9_.-]{1,100}$` |
| `action` | string | Yes | One of: `pin`, `unpin`, `mute`, `unmute`, `track`, `untrack` |

### Response `200`

```json
{
  "operation_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "new_state": {
    "repo_full_name": "acme/backend",
    "is_pinned": 1,
    "is_muted": 0,
    "source_signal": "pinned"
  }
}
```

`new_state` is `null` when the action is `untrack` (the row was deleted).
`operation_id` is `null` if there was nothing to do (e.g. `untrack` on a repo
that was not tracked).

### Error Codes

| Status | Condition |
|---|---|
| `400` | Missing or invalid `repo` (fails regex) |
| `400` | Invalid `action` |
| `500` | Database error |

### Example

```bash
curl -b session.cookie -X POST \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <token>" \
  -d '{"repo":"acme/backend","action":"pin"}' \
  "https://example.com/api/v1/work-board/tracked-repos"
```

---

## `POST /tracked-repos/bulk`

Apply a single action to up to 200 repositories in one atomic operation. All
mutations are committed in a single SQLite transaction; the batch gets one
shared `operation_id` for undo.

Actions that require the row to exist (`pin`, `unpin`, `mute`, `unmute`,
`untrack`) silently skip repos that are not yet tracked; skipped names appear
in the `skipped` array.

### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `repos` | string[] | Yes | Array of `owner/repo` strings. Entries failing the regex are filtered out silently |
| `action` | string | Yes | One of: `pin`, `unpin`, `mute`, `unmute`, `track`, `untrack` |

### Response `200`

```json
{
  "operation_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "updated": 18,
  "skipped": ["acme/old-repo", "acme/archived"]
}
```

`operation_id` is `null` if no rows were actually changed.

### Error Codes

| Status | Condition |
|---|---|
| `400` | `repos` is not an array |
| `400` | `repos.length > 200` ("Bulk size exceeds 200") |
| `400` | Invalid `action` |
| `500` | Database error |

### Example

```bash
curl -b session.cookie -X POST \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <token>" \
  -d '{"repos":["acme/backend","acme/frontend"],"action":"mute"}' \
  "https://example.com/api/v1/work-board/tracked-repos/bulk"
```

---

## `GET /prefs`

Returns the authenticated user's Work Board preferences. If no preferences
have been saved yet, defaults are returned (identical to what the server would
insert on first `/ping`).

### Response `200`

```json
{
  "discovery_window_days": 60,
  "max_auto_repos": 50,
  "auto_mute_bots": 0,
  "ai_assistant_enabled": 0,
  "ai_monthly_cap_cents": 500,
  "ai_response_locale": null,
  "last_discovery_at": "2026-04-23T10:00:00.000Z"
}
```

### Example

```bash
curl -b session.cookie "https://example.com/api/v1/work-board/prefs"
```

---

## `PATCH /prefs`

Update one or more preference fields. Unknown keys are rejected. Validated
fields are merged with existing values (partial update — omitted fields are
unchanged).

### Request Body

Any subset of the following validated fields:

| Field | Type | Valid range / values | Description |
|---|---|---|---|
| `discovery_window_days` | integer | 30–180 | Look-back window for authored-PR and recent-commit signals |
| `max_auto_repos` | integer | 20–200 | Cap on auto-discovered repos |
| `auto_mute_bots` | integer | `0` or `1` | Auto-mute bot-created repos (reserved) |
| `ai_assistant_enabled` | integer | `0` or `1` | Enable AI assistant features |
| `ai_monthly_cap_cents` | integer | 0–100000 | Monthly AI spend cap in US cents |
| `ai_response_locale` | string \| null | ≤ 10 chars or `null` | Locale prepended to AI prompts |

### Response `200`

Full merged prefs object (same shape as `GET /prefs`).

### Error Codes

| Status | Condition |
|---|---|
| `400` | Unknown pref key |
| `400` | Value out of range (message names the field and the allowed range) |

### Example

```bash
curl -b session.cookie -X PATCH \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <token>" \
  -d '{"discovery_window_days":90,"max_auto_repos":75}' \
  "https://example.com/api/v1/work-board/prefs"
```

---

## `POST /undo/:operation_id`

Revert a previously recorded mutation. The operation record is deleted
immediately after a successful undo (each `operation_id` can only be used
once). Operations expire 24 hours after they are created.

The undo router re-applies the `before_state` in a transaction:
rows that did not exist before the original operation are hard-deleted; rows
that did exist are restored to their prior `is_pinned`/`is_muted` values.

### Path Parameter

| Param | Description |
|---|---|
| `operation_id` | UUID v4 returned by the original mutation |

### Response `200`

```json
{
  "reverted": true,
  "operation_type": "bulk"
}
```

### Response `404`

```json
{ "error": "Operation not found or expired" }
```

Returned when the `operation_id` does not exist, belongs to a different user,
or has passed its 24-hour TTL.

### Example

```bash
curl -b session.cookie -X POST \
  -H "X-CSRF-Token: <token>" \
  "https://example.com/api/v1/work-board/undo/f47ac10b-58cc-4372-a567-0e02b2c3d479"
```

---

## `POST /discover`

Trigger a full discovery run synchronously. The server hits five GitHub API
signals in parallel, merges results with the existing tracked set, and returns
a snapshot of what changed.

Pass `?reset=1` to wipe all non-pinned rows before discovery (not yet
enforced in the current router; reserved for a future reset-and-rediscover
flow).

### Response `200`

```json
{
  "discovered": 31,
  "added": 8,
  "removed": 2,
  "duration_ms": 1247,
  "sso_orgs_blocked": []
}
```

| Field | Description |
|---|---|
| `discovered` | Distinct repos found across all five signals |
| `added` | New rows inserted |
| `removed` | Unprotected rows deleted (not pinned, not muted, not webhook-sourced) |
| `duration_ms` | Wall-clock time for the entire run |
| `sso_orgs_blocked` | GitHub org slugs that returned `403 SSO` (empty in Phase 1; surfaced for future UI banners) |

### Error Codes

| Status | Condition |
|---|---|
| `500` | GitHub API error or database error |

### Example

```bash
curl -b session.cookie -X POST \
  -H "X-CSRF-Token: <token>" \
  "https://example.com/api/v1/work-board/discover"
```

---

## `GET /ping`

First-visit health check and stale-while-revalidate trigger. The Work Board
frontend calls this on every page load.

Behaviour:
1. Ensures a `work_board_prefs` row exists for the user (upserts defaults if
   absent — this is the auto-migration for new and existing webhook-only users).
2. If `last_discovery_at` is null or older than 24 hours **and** a GitHub
   access token is available in the session, fires `runDiscovery`
   fire-and-forget and sets `discovery_in_flight: true`.
3. Returns immediately with the current prefs.

The frontend polls every 500 ms (up to 5 s) while `discovery_in_flight` is
true. When `last_discovery_at` becomes non-null the frontend refetches tab
data without a full page reload.

### Response `200`

```json
{
  "prefs": {
    "discovery_window_days": 60,
    "max_auto_repos": 50,
    "auto_mute_bots": 0,
    "ai_assistant_enabled": 0,
    "ai_monthly_cap_cents": 500,
    "ai_response_locale": null,
    "last_discovery_at": null
  },
  "discovery_in_flight": true
}
```

`discovery_in_flight` is `false` when discovery was not triggered (cache is
fresh or no session token is available).

### Example

```bash
curl -b session.cookie "https://example.com/api/v1/work-board/ping"
```

---

## `GET /repo-search`

Search for repositories by name fragment. Returns matching tracked repos from
the local database immediately. The `untracked` array is reserved for a future
pass that queries the GitHub Search API — it is always `[]` in Phase 1.

Results are ranked: repos whose name starts with the query prefix rank above
those where it appears mid-string. Within each tier, repos are sorted by
`last_activity_at DESC`. Maximum 20 results returned.

### Query Parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `q` | string | Yes | Search fragment (case-insensitive). Empty string returns `{tracked:[], untracked:[]}` immediately |

### Response `200`

```json
{
  "tracked": [
    {
      "repo_full_name": "acme/backend",
      "source_signal": "review_requested",
      "is_pinned": 0,
      "is_muted": 0,
      "last_activity_at": "2026-04-23T14:05:00Z"
    }
  ],
  "untracked": []
}
```

### Example

```bash
curl -b session.cookie \
  "https://example.com/api/v1/work-board/repo-search?q=acme%2Fback"
```

---

## Additional Work Board routes

The following routers are mounted alongside the tracking router at
`/api/v1/work-board` (the AI router at `/api/v1/work-board/ai`). Paths below are
relative to `/api/v1/work-board`. All require `requireAuth`; mutations require
the `X-CSRF-Token` header. Bodies marked with a `*Schema` are Zod-validated.

### Actions and presets

`server/routes/work-board-actions.js`. Snooze management, saved filter presets,
and AI-assisted review actions.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/snooze` | Yes | Snooze an item (`snoozeBodySchema`) |
| `DELETE` | `/snooze` | Yes | Un-snooze an item (`unsnoozeBodySchema`) |
| `GET` | `/snoozes` | Yes | List the caller's active snoozes |
| `POST` | `/review-action` | Yes | Apply a review action to a PR (`reviewActionBodySchema`) |
| `GET` | `/presets` | Yes | List saved filter presets |
| `POST` | `/presets` | Yes | Create a preset (`presetCreateBodySchema`) |
| `PATCH` | `/presets/:id` | Yes | Update a preset (`presetIdParamsSchema` + `presetUpdateBodySchema`) |
| `DELETE` | `/presets/:id` | Yes | Delete a preset (`presetIdParamsSchema`) |
| `POST` | `/ai-summary` | Yes | AI summary of the current board slice |
| `POST` | `/suggest-action` | Yes | Suggest a next action (`suggestActionBodySchema`) |
| `POST` | `/draft-comment` | Yes | Draft a PR/issue comment (`draftCommentBodySchema`; rate-limited) |

### Analytics and DORA metrics

`server/routes/work-board.js`. Personal queues and delivery metrics. The DORA
family requires the **Enterprise** tier (`requireTier('enterprise')` →
`403 TIER_REQUIRED_ENTERPRISE`); the rest are available to all tiers.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/my-reviews` | Yes | PRs awaiting the caller's review |
| `GET` | `/my-issues` | Yes | Issues assigned to the caller |
| `GET` | `/stale-prs` | Yes | Stale/aging PRs across tracked repos |
| `GET` | `/review-load` | Yes | Reviewer-load distribution |
| `GET` | `/tech-debt` | Yes | Tech-debt signals across tracked repos |
| `GET` | `/kpi-snapshots` | Yes | Stored KPI snapshots |
| `GET` | `/deploy-freq` | Enterprise | DORA: deployment frequency |
| `GET` | `/lead-time` | Enterprise | DORA: lead time for changes |
| `GET` | `/change-failure-rate` | Enterprise | DORA: change-failure rate |
| `GET` | `/mttr` | Enterprise | DORA: mean time to restore |
| `GET` | `/dora` | Enterprise | Combined DORA metrics |
| `GET` | `/dora.csv` | Enterprise | Combined DORA metrics as CSV |

### Work Board AI assistant

`server/routes/work-board-ai.js`, mounted at `/api/v1/work-board/ai`. Paths below
are relative to that prefix. Every route except `/status` requires the Work Board
AI feature to be enabled (`requireWorkBoardAI`).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/ai/status` | Yes | Whether the Work Board AI assistant is enabled/configured |
| `GET` | `/ai/suggestions` | Yes | Current AI suggestions for the board |
| `POST` | `/ai/dismiss-suggestion` | Yes | Dismiss a suggestion |
| `POST` | `/ai/interpret` | Yes | Interpret a natural-language board command (rate-limited) |
| `POST` | `/ai/apply` | Yes | Apply an interpreted action |
| `GET` | `/ai/activity` | Yes | Recent AI-assistant activity |
