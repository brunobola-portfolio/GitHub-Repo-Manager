# Dashboard "Live Inbox" — live GitHub data (hybrid)

**Date:** 2026-06-14
**Status:** Design — pending review
**Area:** Dashboard Live Inbox (server: `routes/dashboard.js`, `lib/dashboard-aggregator.js`, `lib/work-board-github.js`)

## Problem

The Dashboard "Live Inbox" (sections: **Needs my review**, **My open PRs**, **Mentions**, **Stale drafts**) shows `0` in every section even when the user has real open PRs / review requests on GitHub.

Investigated root cause (evidence-backed):

- The inbox is composed by `composeInbox` ([dashboard-aggregator.js](../../server/lib/dashboard-aggregator.js)), which reads **only webhook-derived DB tables** via `event-aggregations.js` (`pr_events`, `issue_events`, `review_assignments`). The aggregator header states *"No GitHub round-trips."*
- The running instance's `pr_events` table has **0 rows** — no GitHub webhook has ever been ingested (expected for an instance with no public webhook endpoint configured). So every inbox section is empty regardless of real GitHub state.
- By contrast, the **Work Board** uses **live GitHub Search** ([work-board-github.js](../../server/lib/work-board-github.js)) with a webhook fallback (`resolveTabData` in [work-board.js:84](../../server/routes/work-board.js#L84)), so it reflects reality.

Confirmed via GitHub search: the user *does* have an open authored PR (#158) and *no* review-requested PRs — so the Work Board's `0` pending reviews is correct, but the Dashboard's `0` "My open PRs" is wrong (it should list #158).

## Goal

Make the Dashboard inbox reflect live GitHub state by reusing the Work Board's existing live-search + hybrid-fallback pattern, so authenticated users see their real PRs/reviews/issues — without changing the frontend or removing webhook ingestion.

## Non-goals

- Removing webhook ingestion or the `pr_events`/`issue_events`/`review_assignments` tables (kept as fallback).
- Changing the inbox UI/shape, archive/snooze semantics, or the DORA/other dashboard surfaces.
- Adding new inbox sections.

## Decisions

- **Hybrid data strategy:** when a GitHub token is present → live search; otherwise → existing webhook/DB functions (fallback). Mirrors `resolveTabData`.
- **All four sections** go live: `needs_review`, `my_prs`, `mentions`, `stale_drafts`.

## Design

### 1. New live fetcher

`server/lib/work-board-github.js` gains the one missing query (the others already exist):

```js
export async function fetchMyOpenPRs({ token, login, limit = 100 }) {
    const q = `author:${login} is:open is:pr archived:false`;
    const r = await callSearch({ token, q, perPage: limit });
    return { ...r, items: r.items.map(normalisePR) };
}
```

`normalisePR` already returns `openedAt`, `ageHours`, etc. — matching what the `my_prs` section builder consumes.

### 2. `composeInbox` becomes async + hybrid

`server/lib/dashboard-aggregator.js`:

- `composeInbox(userId, opts)` becomes **async**; `opts` gains `token`.
- Each section builder becomes async and is rewritten as **live-first with webhook fallback**, keyed on `token`:

  | Section | Live fetcher (token present) | Fallback (no token / live error) |
  |---|---|---|
  | `needs_review` | `fetchMyPendingReviews({ token, login })` | `listMyPendingReviews({ reviewerLogin })` |
  | `my_prs` | `fetchMyOpenPRs({ token, login })` *(new)* | `listMyOpenPRs({ authorLogin })` |
  | `mentions` | `fetchMyOpenIssues({ token, login })` | `listMyOpenIssues({ assigneeLogin })` |
  | `stale_drafts` | `fetchStalePRs({ token, login })` then filter `authorLogin === userLogin` | `listStalePRs({ staleAfterDays: 7 })` filtered to author |

- The mapping from a fetched/queried row to an inbox item (the `id` = `prKey`/`issueKey`, `kind`, `section`, `title`, `since`, `ageHours`/`ageDays`) is **unchanged** — both live and DB sources already return the same normalized shape (work-board-github.js documents this contract). Extract the row→item mapping per section into a small pure mapper so live and fallback share it.
- Sections are fetched **in parallel** (`Promise.all`). If a section's live fetch throws, that section independently falls back to its DB function and logs a warning; other sections are unaffected.
- After sourcing, the existing pipeline is **unchanged**: archive/snooze filtering from `dashboard_inbox_state`, `SECTION_PRIORITY` dedup, and the returned `{ sections: [{ key, label, items }] }` shape.

### 3. Route wiring

`server/routes/dashboard.js` `/inbox` handler becomes `async` and passes the token:

```js
const result = await composeInbox(req.session.userId, {
    userLogin: req.session.userLogin,
    token: req.session.accessToken,
    sections,
    includeArchived,
});
```

Archive/restore/snooze handlers are unchanged (they operate on `dashboard_inbox_state` by `item_id`, and the `id` scheme is preserved).

## Data flow (after)

```
GET /api/v1/dashboard/inbox
  └─ composeInbox(userId, { userLogin, token })           [async]
       └─ per section, in parallel:
            token ? liveFetcher(work-board-github)         [GitHub Search, ETag-cached]
                  : dbFallback(event-aggregations)         [pr_events / issue_events]
            → shared row→item mapper (id = pr:owner/repo#num)
       └─ archive/snooze filter (dashboard_inbox_state)
       └─ SECTION_PRIORITY dedup
       └─ { sections: [...] }
```

## Error handling

- **Per-section isolation:** a live-search failure (rate limit, network, 5xx) for one section falls back to that section's DB function; logged via `req.log`/module logger. Other sections still render.
- **No token:** all sections use the DB fallback (current behaviour) — no regression for webhook-only deployments.
- **Rate limiting / 304:** handled inside `githubApi()` (ETag revalidation, rate-limit tracking) — no new logic.

## Security

- No new scopes. Uses the same `req.session.accessToken` the Work Board already uses for live search.
- Search queries interpolate the authenticated user's own `login` only.

## Testing

- **`server/__tests__/work-board-github.test.js`** — add a case asserting `fetchMyOpenPRs` issues `author:<login> is:open is:pr archived:false` and normalizes items (mirror the existing fetcher tests).
- **`server/__tests__/dashboard-aggregator.test.js`** — with `token` set, sections use the live fetchers (mock work-board-github) and produce correct ids; with no `token`, falls back to event-aggregations (existing behaviour); a live fetcher throwing for one section falls back without breaking others; archive/snooze filtering and `SECTION_PRIORITY` dedup still apply; section shape unchanged.
- **`server/__tests__/dashboard-routes.test.js`** — `/inbox` awaits `composeInbox` and passes `token` + `userLogin`; archive/snooze/restore unchanged.

## Rollout

Single PR, backend-only, no schema/data changes, no frontend change. Behaviour-additive: token users get live data; tokenless/webhook deployments keep current behaviour.
