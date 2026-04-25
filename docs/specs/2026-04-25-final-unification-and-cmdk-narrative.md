# Final UI Unification, Universal Cmd+K, and AI Attention Narrative

**Date:** 2026-04-25
**Owner:** Bruno
**Status:** draft — pending approval

## Goal

Close the visible drift between primitives and ad-hoc markup, push the
command palette from "useful" to "universal/Linear-style", and surface
AI-generated narrative on the Attention Feed top item when AI is
configured and healthy.

After this lands, the visible surfaces of the app should be uniform
(no raw H1 drift, no ad-hoc page cards, no raw page loaders), the
palette should feel like a real navigation layer (contextual commands
+ recents + fuzzy local search), and the dashboard should "speak" via
AI when the user has opted in.

## Non-goals

- Migrating every raw card / button across the codebase. Out of ~380
  raw button candidates, this spec only touches what shows up on
  page-shell surfaces. The button refactor sprint stays separate.
- Touching `AutoFixDrawer` (intentional drawer pattern) or
  `MobileDrawer` (intentional mobile sheet).
- Building an LLM-router or multi-provider fan-out for the narrative.
  Use the same `aiHandler` the rest of the app already uses.
- Adding telemetry beyond what already exists.

## Slice A — Final visual unification

### H1 migration (6 places)

Migrate these to `PageHeader`:

| File | Current | Action |
|---|---|---|
| `src/components/Dashboard/DashboardPremium.jsx` | raw `<h1>` with `ds-gradient-text` | replace with `<PageHeader>`, keep gradient via prop |
| `src/components/RepoDetail/RepoDetail.jsx` | raw `<h1>` extra-bold | replace with `<PageHeader>` |
| `src/components/Teams/TeamDetails.jsx` | raw `<h1>` extra-bold | replace with `<PageHeader>` |
| `src/components/PublicStatus/StatusPage.jsx` | raw `<h1>` semibold | replace with `<PageHeader>` |
| `src/components/Setup/SystemSetup.jsx` | raw `<h1>` bold | replace with `<PageHeader>` |
| `src/components/Header.jsx` | small inline logo title | **leave alone** — chrome, not page H1 |

Net: **5 migrations**, Header stays.

If `PageHeader` doesn't already accept `gradient` / `as` / `subtitle`
props for these cases, extend it minimally (single new optional prop,
default off). Do not break existing call sites.

### Page-level cards (4 files)

Migrate large page-surface cards to the `Card` primitive:

- `src/components/MigrationHistory.jsx` — main listing card
- `src/components/Teams/TeamDetails.jsx` — info card + member list card
- `src/components/Teams/TeamHub.jsx` — section cards
- `src/components/CommunityHealthDashboard.jsx` — outer container

Skip: tiny pill-shaped chips, inline row badges, in-button containers.

### Full-page loaders (~5 places)

Replace bespoke "centered spinner + text" blocks with the existing
`PageSpinner` primitive. Candidates from grep — confirm at edit time:

- Migration progress full-screen states (where applicable)
- Settings tab initial load
- Teams page initial load
- Dashboard initial load
- AdminDLQPage initial load

In-button spinners (`<Loader2 className="animate-spin"/>` inside
`<button>`) stay as-is.

## Slice B — Universal Cmd+K (Linear-style)

### What already exists

- `useCommandPalette` registers Cmd/Ctrl+K at `window` (global).
- `CommandPalette` mounted in `App.jsx`, has nav, actions, admin, work
  board, AI, tracked-repo commands and a debounced GitHub live search.

### Gaps to close

**1. Contextual command groups by `activeView`.**

Today only `work-board` has a contextual group. Add:

- `repos` view → "Filter by language", "Show only pinned",
  "Sort by stars/updated/name" (dispatch to existing filter context).
- `repo-detail` view → "Open on GitHub", "Copy clone URL",
  "Run audit", "Open Branches/PRs/Issues/Releases tab",
  "Pin repo", "Untrack repo".
- `teams` view → "Create team", "Open team manager".

Pattern: each group is a small file under
`src/components/CommandPalette/<view>Commands.js` exporting a builder
function. CommandPalette imports them and conditionally renders by
`activeView`.

**2. Recent items.**

Track last 5 navigations and last 5 repo opens in `localStorage`
(key: `cmdk:recents:v1`). Render as a "Recent" group at the top
when input is empty. Bump on each open.

**3. Local fuzzy repo search.**

Today `repos` is sliced to first 10 — only useful when input matches
GitHub live search. Add a small fuzzy match (substring + case-fold,
no external dep) over `repos` so typing "myr" surfaces local matches
even when offline.

**4. Tiny polish.**

- Show keyboard hint footer (`↑↓` navigate, `↵` select, `esc` close)
  via a single line at the bottom of the dialog.
- When loading live search, show inline shimmer instead of plain
  spinner to feel snappier.

### Out of scope for slice B

- "Conversational repo search" (NL-to-query). Tracked separately.
- Notifications digest in header. Tracked separately.

## Slice C — AI Attention Narrative

### What exists

- `AttentionFeed` shows top items by severity.
- `useAIStatus` exposes `configured`, `keyHealth`, `provider`.
- `aiFetch` helper short-circuits on `!configured` / `keyHealth==='invalid'`.

### Backend — `POST /api/ai/attention-narrative`

Body:

```jsonc
{
  "repo": "owner/name",
  "kind": "failed_migration | stale_pinned | abandoned | hot",
  "signal": { /* the small typed payload the feed already builds */ }
}
```

Response:

```jsonc
{
  "narrative": "This repo has 3 stale PRs from your team and a failing CI on main since Tuesday.",
  "cached": false,
  "model": "gemini-2.5-flash"
}
```

Behaviour:

- Validates body (kind enum, repo `owner/name` shape, signal object).
- Reads user AI config the same way other AI endpoints do.
- Returns `{ status: 503, error: 'AI_NOT_CONFIGURED' }` if no key.
- Returns `{ status: 503, error: 'AI_KEY_INVALID' }` if status probe
  cache says `invalid`.
- Caches successful narratives **per (user, repo, kind)** for 1 hour
  in-memory. Cache key includes a short hash of `signal` so a fresh
  signal busts the cache automatically.
- Prompt template lives in `server/ai/prompts/attention-narrative.js`.
  Constraints: max 240 chars output, plain text, no markdown, no
  enumeration of more than 3 facts, no "I" / "we" voice.
- Cost: capped at ~80 output tokens. Counted against the existing AI
  monthly cap.

### Frontend integration

In `AttentionFeed`:

- Read `useAIStatus` once.
- When `feed.items[0]` changes AND `configured && keyHealth==='ok'`,
  fire `aiFetch('/api/ai/attention-narrative', …)` for the top item.
- Render the response under the top item's title in italic, indigo,
  smaller font. Render a 1-line shimmer while loading.
- Errors: silent. The feed is the primary content; narrative is a
  garnish. Failures must not change layout.
- When `!configured`, render nothing extra. The existing
  `AINotConfiguredBanner` (already on Settings) covers messaging
  globally; we don't repeat it on the dashboard.
- When `keyHealth==='invalid'`, render nothing extra (the
  `AINotHealthyBanner` is the canonical surface).

### Tests

| Layer | What |
|---|---|
| Backend | endpoint validation, cache hit, cache bust on signal change, 503 paths, max 240 chars enforced, monthly cap counted |
| Frontend | renders narrative, shimmer while loading, silent on error, doesn't fire when `!configured` |

Target: ~12 new tests. Keep current 2507 green.

## Shipping plan

One commit per slice section, in this order, each independently green:

1. `refactor(ui): migrate page H1s to PageHeader`
2. `refactor(ui): migrate page-level cards to Card primitive`
3. `refactor(ui): migrate full-page loaders to PageSpinner`
4. `feat(cmdk): contextual command groups per view`
5. `feat(cmdk): recents + local fuzzy repo search + footer`
6. `feat(ai): /attention-narrative endpoint with 1h cache`
7. `feat(dashboard): wire AI narrative into AttentionFeed top item`
8. `test(ai): cover attention-narrative endpoint + AttentionFeed integration`

Push to `origin/main` only after `npx vitest run` green and a manual
smoke of: (a) Cmd+K opens, contextual group changes per view; (b)
AttentionFeed renders narrative when AI is configured.

## Risks

- **AI narrative perceived as vaporware** — mitigated by hard
  fail-silent on the frontend and by gating on `keyHealth==='ok'`
  not just `configured`.
- **Cache poisoning** — narrative is per-user + per-signal-hash; not
  shared across users.
- **PageHeader prop creep** — keep additions minimal (one optional
  prop max), don't refactor PageHeader as part of this work.
- **Cmd+K regressions** — new groups dispatch the same kinds of
  events the existing groups use; preserve `cmdk` semantics.

## Out of scope (future)

- Notifications digest in header
- Conversational repo search ("PRs touching payment that I haven't reviewed")
- Per-feature key health (probes only completion provider today)
- Universal undo for all CMDK actions
