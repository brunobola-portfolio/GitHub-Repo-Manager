# Notifications Digest, Conversational Search, Cards Cleanup

**Date:** 2026-04-26
**Owner:** Bruno
**Status:** draft — pending approval

## Goal

Three follow-on items from the unification arc, in order:

1. Replace the placeholder Notifications dropdown in the Header with a
   real digest of activity since the user last opened it.
2. Let the user ask the Cmd+K palette in plain language ("PRs touching
   payment that I haven't reviewed") and route the result through the
   AI provider already configured.
3. Migrate the most-frequent micro-card surfaces (Admin, DevToolkit
   shared, a few Settings sections) to the `Card` primitive so the
   visible drift drops further.

After this lands, the bell tells the user something useful, the
palette feels intelligent, and the four most-touched surfaces stop
duplicating ad-hoc card markup.

## Non-goals

- Push / desktop notifications. The digest is pull-only on demand.
- Real-time updates (websockets). Refresh on bell click + on app focus.
- Replacing every micro-card. This spec touches Admin + DevToolkit
  shared + a small Settings slice. The remaining ~50 card sites stay
  for a later sweep.
- Generating *new* search syntax for GitHub. The translator emits
  GitHub's existing search query syntax (`is:pr`, `repo:owner/x`,
  `review-requested:@me`) and feeds it to the same `searchApi.github`
  the palette already calls.

## Slice 1 — Notifications digest

### Backend — `GET /api/notifications/digest`

Returns categorized counts + top-3 per category, plus a
`since` timestamp the frontend uses to render "since 14:32".

```jsonc
{
  "since": "2026-04-26T13:00:00Z",   // last_seen_at, or 7d ago on first call
  "now":   "2026-04-26T14:32:00Z",
  "totals": { "reviews": 4, "issues": 2, "failed_migrations": 1, "stale_pinned": 3 },
  "items": {
    "reviews":           [ { repo, title, url, since } ],
    "issues":            [ { repo, title, url, since } ],
    "failed_migrations": [ { repo, jobId, since, reason } ],
    "stale_pinned":      [ { repo, since, lastActivity } ]
  }
}
```

Implementation:

- Reuses existing aggregations from `attention-feed.js` (failed
  migrations, stale_pinned) and from the work-board queries (reviews,
  issues). Pure DB joins — no GitHub API calls.
- Per-user `users.notifications_last_seen_at` column. Migration:
  `ALTER TABLE users ADD COLUMN notifications_last_seen_at TEXT`.
- First call seeds it to NOW − 7 days so the user sees something on
  first paint.

### Backend — `POST /api/notifications/mark-seen`

Updates the user's `notifications_last_seen_at` to NOW. Returns 204.
Idempotent. Audit-logged as `notifications.mark_seen`.

### Frontend — `useNotificationsDigest` hook

`{ digest, loading, error, refresh, markSeen }` — fetches on mount,
re-fetches when the dropdown opens, refreshes on `window.focus`.

### Frontend — `NotificationsDropdown` rewrite

Replaces the current sync-status placeholder. New layout:

- Header row: "Since 14:32" (relative) + "Mark all as read" button.
- Four collapsed categories with count badge + top-3 items expanded:
  *Reviews waiting* / *Issues for you* / *Failed migrations* /
  *Stale pinned*.
- Each item is a row with repo, one-line title, relative time. Click
  → opens GitHub URL in a new tab (issues/PRs) or focuses the repo
  detail (failed migration / stale pinned).
- Empty digest renders an EmptyState with "You're all caught up."
- Shows a tiny indigo dot on the bell when `totals` sums > 0 *and*
  any item.since > last_seen_at.

### Tests

| Layer | What |
|---|---|
| Backend | endpoint shape, first-call seeding (7d ago), mark-seen idempotent, audit log written, totals sum equals item array sums |
| Hook | mount fetch, refresh on focus, markSeen optimistic clear, error swallowed |
| Dropdown | renders all four categories, empty state, mark-as-read clears the dot, click on item opens correct URL |

Target: ~14 new tests.

## Slice 2 — Conversational palette search

### Trigger

User types `?` as the first character in the palette input → switches
to Ask mode. Visual: input chrome turns indigo, placeholder swaps to
"Ask anything — e.g. PRs touching payment I haven't reviewed".

`?` removed from the query before send. Empty → no request.

### Backend — `POST /api/ai/translate-search`

Takes `{ q: string }`, returns:

```jsonc
{
  "summary": "PRs touching payment you haven't reviewed yet",
  "queries": [
    { "type": "pr",    "ghQuery": "is:pr review-requested:@me payment in:title,body" },
    { "type": "issue", "ghQuery": "is:issue assignee:@me label:payment" }
  ],
  "fallback": false
}
```

Behaviour:

- Validated by `aiTranslateSearchSchema` — `q` 1-500 chars.
- 503 / 401 paths reuse the standard AI handlers.
- Counts against the `ai_queries` cap (cheap — ~120 output tokens).
- Cached 5 min per `(userId, q)` so re-typing the same query doesn't
  re-bill. Pure in-memory (memory-cache.js).
- Prompt forces plain JSON, ≤2 queries, no `org:` prefix the user
  didn't supply.

### Frontend — palette wiring

- `useTranslateSearch(q)` hook with the same debounce shape as
  `useDebouncedGitHubSearch`.
- When in Ask mode, the existing live-GitHub-search call is suppressed.
- Renders an "AI interpretation" group at the top showing
  `summary` + per-`queries[i]` group of results obtained via
  `searchApi.github(ghQuery, { type })`.
- Failure path: degrade silently to literal text search of the typed
  query — never blank the palette.

### Tests

| Layer | What |
|---|---|
| Backend | validates `q` length, returns ≥1 query, rejects empty, 5-min cache hit, quota gate |
| Hook | debounce, abort on input change, error → null |
| Palette | `?` toggles Ask mode, summary renders, results render under each query group |

Target: ~10 new tests.

## Slice 3 — Card cleanup (Admin + DevToolkit shared + Settings slice)

### Targets

| File | What | Action |
|---|---|---|
| Admin/AdminDLQPage.jsx | outer page panel | Card wrapper |
| Admin/DLQDetailPanel.jsx | side-panel sections | Card wrapper |
| Admin/DLQTable.jsx | table chrome | Card wrapper |
| DevToolkit/shared/SectionCard.jsx | wrapper itself | Compose Card internally |
| DevToolkit/shared/RepoBadge.jsx | pill chrome | Leave (badge, not card) |
| DevToolkit/shared/RepoSelector.jsx | dropdown panel | Card with shadow-sm |
| DevToolkit/shared/BranchSelector.jsx | dropdown panel | Card with shadow-sm |
| DevToolkit/shared/SmartContextBar.jsx | bar shell | Card flat, no hover |
| Settings/AuditLogSection.jsx | outer panel | Card wrapper |
| Settings/WorkBoard/RepoRow.jsx | row chrome | Leave (row, not card) |
| Settings/WorkBoard/AddRepoInput.jsx | input wrapper | Leave (input chrome) |

Roughly **8 migrations** that visibly improve uniformity. The other
~25 sites in this surface family are list rows / badges / inputs and
are deliberately not Card candidates.

### Tests

This is a visual unification — no behaviour changes. We rely on the
existing test suites for these surfaces (each already has at least
smoke coverage). The risk is purely visual; we accept that and check
manually after the slice ships.

## Shipping plan

One commit per slice section, each independently green:

1. `feat(db): users.notifications_last_seen_at + digest aggregator`
2. `feat(api): /notifications/digest + /notifications/mark-seen`
3. `feat(header): real notifications digest dropdown`
4. `feat(api): /ai/translate-search with 5min cache`
5. `feat(cmdk): conversational ?query mode with AI interpretation`
6. `refactor(ui): migrate Admin DLQ panels to Card primitive`
7. `refactor(ui): migrate DevToolkit shared dropdowns to Card`
8. `refactor(ui): migrate AuditLogSection + remaining Settings panels to Card`

Push to `origin/main` only after `npx vitest run` green.

## Risks

- **Digest perceived as duplicating Attention Feed** — mitigated by
  framing the bell as "since you last looked", a pull-only
  notifications metaphor distinct from the Dashboard's "what to fix
  today".
- **Translator emits noisy GitHub queries** — mitigated by capping at
  2 queries per response and requiring the AI to explain in plain
  English what it interpreted (the user can see and ignore it).
- **Card migration regressing visuals** — Card is heavier (shadow-lg)
  than some current chrome. We use `glass={false}` + a tighter
  `className` override on the few sites where the heavier glass
  doesn't fit (Admin tables in particular need a flatter look).

## Out of scope (future)

- Per-category mute (e.g. "stop showing failed migrations")
- Notifications sound / desktop notifications
- AI search across more types (org members, releases, gists)
- Card primitive refactor itself (one-off `flat` prop if needed)
