# Work Board AI Upgrade — Design Spec

> **Status:** Approved for implementation
> **Date:** 2026-04-23
> **Scope:** Trend-Aware AI (A) + AI Actions Layer (B)

---

## Goal

Make the Work Board feel alive, intelligent, and premium: KPI tiles show
momentum (not just counts), the AI summary explains *why* things changed,
each stale item offers one-click AI-suggested next actions, and the empty
state guides new users to real data instead of showing zeros.

---

## Background

The current Work Board is feature-complete but static: the AI summary
restates what is already visible, KPI tiles show raw counts with no trend
context, and the empty state looks broken. The board has all the right data
sources (three-tier fallback: cache → live → webhook); what is missing is a
historical layer that gives AI meaningful context and surfaces that context
in the UI.

---

## Scope

### In scope

- `work_board_kpi_snapshots` DB table (migration 015)
- Daily KPI snapshot job (extend existing sweeper)
- `GET /api/v1/work-board/kpi-snapshots` read endpoint
- Trend-aware AI summary (extend `buildFactSheet` + system prompt)
- `POST /api/v1/work-board/suggest-action` endpoint
- `POST /api/v1/work-board/draft-comment` endpoint
- KPI tiles — sparklines + delta badges + count-up animation
- AI Summary Card — rebuilt layout + glow on high urgency
- Tab active indicator (sliding pill)
- Row-level suggestion chips (hover + keyboard focus)
- Draft comment typewriter fill
- Keyboard navigation `j`/`k` rows (`useFocusedRow` hook)
- Honest empty state with webhook-aware progress checklist
- Tier-gate tooltip replacing upsell modal on locked tab click
- Configurable snapshot retention (`WORK_BOARD_SNAPSHOT_RETENTION_DAYS`)

### Out of scope

- Auto-snooze rule engine (needs its own spec)
- Proactive email/Slack digests (Enterprise, future spec)
- Natural language filter querying (future spec)
- DORA time-range selector (separate concern)
- Pagination (separate concern)

---

## Architecture

Two capabilities layered on top of the existing Work Board without breaking
any existing path:

**Trend Engine:** A daily snapshot job writes per-user KPI totals into a new
`work_board_kpi_snapshots` table. The existing sweeper module is extended to
start this job alongside cache/snooze cleanup. A new read endpoint exposes
the last N days of snapshots. The AI summary endpoint and `buildFactSheet`
are extended to include trend context — existing callers without snapshots
degrade cleanly (trend section simply absent).

**AI Actions Layer:** Two new mutation endpoints in `work-board-actions.js`,
following the existing Zod-validated, `requireAuth`-gated pattern. Suggestion
generation is partly rule-based (snooze always offered for items ≥ 14 days
old, no AI call needed) and partly AI-driven (ping comment body).
Draft comment fetches the first 4 KB of PR diff from GitHub, passes it with
intent context to the BYOK provider, and returns a draft string. Both
endpoints are BYOK-gated — return 403 if no provider configured.

---

## Data Model

### New table — `work_board_kpi_snapshots` (migration 015)

```sql
CREATE TABLE IF NOT EXISTS work_board_kpi_snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    snapped_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviews     INTEGER NOT NULL DEFAULT 0,
    stale_prs   INTEGER NOT NULL DEFAULT 0,
    issues      INTEGER NOT NULL DEFAULT 0,
    tech_debt   INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_wbks_user_time
    ON work_board_kpi_snapshots(user_id, snapped_at DESC);
```

One row per user per day. The job de-duplicates by checking whether a row
already exists for the current UTC date before inserting.

### Retention

Controlled by `WORK_BOARD_SNAPSHOT_RETENTION_DAYS` (env var, default `90`).
The sweeper prunes rows where `snapped_at < now - retention_days` on each
daily tick.

---

## Backend

### `server/lib/work-board-kpi-snapshots.js` (new)

Three synchronous functions (better-sqlite3):

```js
writeSnapshot(db, userId)
// Reads current KPI counts via existing aggregation functions.
// Skips write if a row already exists for today (UTC date).
// Returns { inserted: bool }.

getSnapshots(db, userId, days = 7)
// Returns last `days` rows ordered snapped_at ASC.
// Shape: [{ snappedAt, reviews, stalePRs, issues, techDebt }]

pruneSnapshots(db, retentionDays = 90)
// Deletes rows older than retentionDays. Returns count deleted.
```

### `server/lib/work-board-sweeper.js` (extend)

Add `startKpiSnapshotJob({ intervalMs = 24 * 60 * 60 * 1000 } = {})`:

- Fires once at startup (same pattern as `runSweepOnce`)
- Then every 24 h via `setInterval` + `timer.unref()`
- On each tick: query active user IDs (users with a `work_board_cache` row
  updated in the last 7 days), call `writeSnapshot` for each
- Pruning happens on the same tick via `pruneSnapshots`

Called from `server/index.js` alongside `startWorkBoardSweeper`.

### `GET /api/v1/work-board/kpi-snapshots` (new, `work-board.js`)

```http
Auth: requireAuth (Free+)
Query: ?days=7  (integer 1–30, default 7)
Response: { data: [ { snappedAt, reviews, stalePRs, issues, techDebt } ] }
```

### `buildFactSheet` extension (`work-board-summary.js`)

Accepts optional `trend7d` array. When present, appends:

```text
trend 7d (daily snapshots, oldest first):
  2026-04-16: reviews=3 stale=8 issues=5 debt=12
  ...
  today: reviews=2 stale=12 issues=4 debt=15
delta vs 7d ago: stale_prs=+50% reviews=-33% issues=-20% tech_debt=+25%
```

### System prompt addition (`work-board-summary.js`)

One new rule appended to `SYSTEM_PROMPT`:

```text
- If trend data is present, lead the headline with the single most
  significant week-over-week change (e.g. "Stale PRs up 50% — 3 in org/api
  untouched for 14+ days"). Do not mention trend if no snapshots provided.
```

### `POST /api/v1/work-board/ai-summary` (extend, `work-board-actions.js`)

Before calling `generateSummary`, fetch `getSnapshots(db, userId, 7)` and
pass as `trend7d`. No other changes to the endpoint contract.

### `POST /api/v1/work-board/suggest-action` (new, `work-board-actions.js`)

```http
Auth: requireAuth + BYOK check (403 if no provider)
Body (Zod):
  { repoFullName, itemType: "pr"|"issue",
    itemNumber, title, ageDays, authorLogin }

Logic:
  1. Always include snooze suggestion (rule-based, no AI):
     { label: "Snooze 7d", action: "snooze", hours: 168 }
  2. Call AI with item context → get comment body.
     System prompt instructs: produce JSON with a "pingComment" string
     (≤ 280 chars). Active voice. Reference item title and author.
  3. Return up to 3 suggestions ordered: ping → snooze → view on GitHub.

Per-item cooldown: 30 min keyed by "userId:repo:number:suggest"
  in work_board_cache (reuse existing put/get).

Response:
  { suggestions: [
      { label: "Ping author",     action: "comment", body: "..." },
      { label: "Snooze 7d",      action: "snooze",  hours: 168 },
      { label: "View on GitHub",  action: "open",    url: "https://github.com/..." }
  ] }
```

Executing "Ping author" fires the existing
`POST /api/v1/work-board/review-action` with `action: "comment"`.
"View on GitHub" opens the item URL in a new tab — no server call needed.
The review-action endpoint does not support `close`; rather than adding it
in this cycle, the "Close" chip is replaced with "View on GitHub" (simpler,
zero server scope, avoids accidental destructive action from the board).

### `POST /api/v1/work-board/draft-comment` (new, `work-board-actions.js`)

```http
Auth: requireAuth + BYOK check (403 if no provider)
Body (Zod): { repoFullName, prNumber, intent: "request_changes"|"comment" }

Logic:
  1. Fetch PR files from GitHub API via
     `GET /repos/:owner/:repo/pulls/:number/files`.
     Concatenate the `patch` field from each file entry (unified diff hunks).
     Truncate concatenated result to first 4 096 chars.
  2. Build prompt: "Draft a code review comment for intent=<intent>.
     PR title: <title>. Diff summary: <first 4 KB>. ≤ 300 chars. Direct,
     specific, professional."
  3. Return { draft: "string" }.

Rate limit: 10 calls/user/hour (existing rate-limit middleware, new key
  "draft-comment"). No cache — intentionally fresh each time.
```

---

## Frontend

### New hook: `useKpiSnapshots(days = 7)` (`src/hooks/useWorkBoard.js`)

Fetches `/api/v1/work-board/kpi-snapshots?days=7`. Returns
`{ data, loading, error }`. SWR-cached for 5 min (same pattern as other
work board hooks). Called once in `WorkBoardPage` and passed down as a prop.

### New hook: `useFocusedRow` (`src/hooks/useFocusedRow.js`)

```js
// Returns { focusedIndex, setFocusedIndex, focusedItem }
// Registers keydown listener for j/k (next/prev), Enter (open on GitHub),
// Escape (clear focus). Exported and used in each tab component.
// Focused row renders ring-2 ring-indigo-500/40 on its container.
```

### `KpiRow.jsx` changes

1. Accept `snapshots` prop (array from `useKpiSnapshots`).
2. Each `KpiTile` receives `history` (filtered to that KPI's column) and
   `delta` (percent change vs. first snapshot, null if < 2 points).
3. Inside `KpiTile`:
   - **Count-up animation**: wrap value in `useSpring` (Framer Motion,
     stiffness 80, damping 20). Display capped at 999+.
   - **Sparkline**: rendered only when `history.length >= 3`. Simple SVG
     polyline, 40 × 16 px, accent color, 10% fill opacity. `pathLength`
     animates 0 → 1 on mount (600 ms ease-out).
   - **Delta badge**: rendered when `history.length >= 2`. Arrow + percent
     in amber (up) or emerald (down) or slate (flat, < 5% change).
     Fades in 300 ms after sparkline completes.

Tile vertical height grows by ~28 px. Grid layout unchanged.

### `AISummaryCard.jsx` — rebuilt layout

Two-column flex layout (gap-6), breakpoint-aware (stacks on mobile):

**Left column (min-w-[160px]):**

- Urgency gauge SVG (existing, kept as-is)
- Large urgency percentage below gauge (`ds-font-display`, 28 px)
- Severity label: "Critical" (rose) / "Elevated" (amber) / "Nominal" (indigo)
- Model + provider pill (`claude-opus-4-5 · Anthropic`, slate-700 bg, 10 px, rounded-full)

**Right column (flex-1):**

- Headline (`ds-font-display`, 15 px, font-semibold)
- Trend line (when available): muted slate-400 text, 12 px. Example: `↑ Stale PRs +50% vs last week`
- Bullet list (existing severity dots + text)
- Freshness timestamp bottom-right (`Generated 3 min ago`, slate-400, 11 px)

**Urgency glow (urgency > 0.8):**
Framer Motion `animate={{ boxShadow: ['0 0 0 rgba(244,63,94,0)', '0 0 24px rgba(244,63,94,0.18)', '0 0 0 rgba(244,63,94,0)'] }}`
`transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}`
Applied to the card wrapper div. Never triggers below 0.8.

### Tab bar — sliding indicator

Replace current active-tab background swap with a `motion.div` underline
using `layoutId="work-board-tab-indicator"`:

```jsx
{tab.id === activeTab && (
  <motion.div
    layoutId="work-board-tab-indicator"
    className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full"
  />
)}
```

Each tab button gets `relative` positioning. The indicator slides smoothly
between tabs on selection. Active tab text remains bold; no background color
change needed.

### Row-level suggestion chips

Each row component (`MyReviewsTab`, `StalePRsTab`) wraps its item in a
container that tracks hover state (`useState(false)`) and whether it is the
focused row (from `useFocusedRow`).

When `hovered || focused`:

- After 300 ms debounce, show chip strip below item content via `AnimatePresence` height animation (0 → auto, 200 ms ease-out).
- Chip strip is rendered lazily — no AI fetch triggered by hover alone.
- A `Sparkles` icon (12 px, slate-400) appears top-right of the row to signal AI availability. **Only rendered when AI is available** — check `hasCompletionKey || serverFallbackAvailable` from `GET /api/user/ai-config` (already called at app load; pass result down as a prop or context value).

**Chips:**

| Label           | Style                                          | Trigger                                                      |
| --------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| Ping author     | indigo outline pill + `MessageSquare` icon     | Fetches `/suggest-action` on first click, then shows popover |
| Snooze 7d       | amber filled pill                              | Fires immediately (no AI), same as `Shift+S`                 |
| View on GitHub  | slate outline pill + `ExternalLink` icon       | Opens item URL in new tab immediately, no AI call            |

**Suggestion popover** (Radix Popover, `avoidCollisions` enabled):

- Shows AI-drafted text in a read-only textarea (gray bg)
- Three buttons: "Send" (fires review-action), "Edit first" (makes textarea editable), "Cancel"
- Loading state: chip shows `Loader2` spin icon for up to 2 s while fetching
- Error state: chip shows "Try again" in rose text, no popover

**First-click fetch:** `suggest-action` is called when the user clicks "Ping author", not on hover. After the first successful fetch for an item, results are cached in component state for 30 min (matches server cooldown) — clicking again reuses cached suggestions without re-fetching.

### Draft comment — typewriter fill

In the review action flow, when "Request Changes" or "Comment" is clicked:

1. Textarea appears immediately with `placeholder="Drafting review comment…"` +
   a `Loader2` spinner in the top-right corner of the textarea wrapper.
2. `POST /draft-comment` fires.
3. On success: text is revealed character-by-character at 40 chars/s via
   `setInterval(16ms)`. A `Sparkles` badge appears below the textarea:
   "AI draft — edit before sending".
4. If user clicks inside the textarea before completion: `clearInterval`,
   set full text immediately, remove spinner.
5. On error: textarea opens empty as today — no regression, no error banner.

### Empty state — honest + webhook-aware

When all four KPI counts are zero and data source is `live` (no webhook):

Centered card (max-w-md, mx-auto, mt-16):

- SVG illustration: inbox with empty tray, monochrome, 80 × 80 px, slate-300
- Headline: "Your Work Board is ready" (`ds-font-display`, 18 px)
- Subtext: "Connect a webhook to see your real-time engineering data." (slate-400, 14 px)
- Two-step checklist tiles:
  1. "Connect GitHub webhook" — pre-checked (emerald) if `meta.webhookConnected` is true. This boolean is added to the existing `meta` object returned by `GET /api/v1/work-board/my-reviews`; server sets it to `true` when the `webhook_events` table has at least one row for the current user's tracked repos. Links to the webhook setup guide.
  2. "Open a PR or issue" — always unchecked until first real data arrives.
- Below checklist: "Already connected? Pull fresh data →" button that triggers full refresh (existing `refresh()` from hook).

This state is only shown when all four counts are zero AND source is `live`.
If source is `webhook` with zero data, the existing "No data yet" hint is
shown (different cause — webhooks connected but nothing happened yet).

### Tier-gate tooltip (locked tabs)

Locked tabs (Pro / Enterprise) replace on-click upsell modal with a Radix
Popover tooltip (using `@radix-ui/react-popover`, already a dep — no new
package needed). The popover opens on hover via `onMouseEnter`/`onMouseLeave`:

```jsx
<Popover.Root open={hovered}>
  <Popover.Trigger asChild onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
    <button aria-disabled="true" tabIndex={-1}>
      <Lock className="w-3 h-3 mr-1 opacity-50" />
      {tab.label}
      <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider
        text-slate-400">{tab.badge}</span>
    </button>
  </Popover.Trigger>
  <Popover.Content side="bottom" className="px-3 py-1.5 text-xs rounded-lg
    bg-slate-900 text-slate-100 shadow-lg pointer-events-none">
    Upgrade to {tab.badge} to unlock {tab.label}
    <Popover.Arrow className="fill-slate-900" />
  </Popover.Content>
</Popover.Root>
```

No modal shown on click. Tab content area unchanged.

---

## Testing

### Unit tests (`tests/`)

- `tests/lib/work-board-kpi-snapshots.test.js`
  - `writeSnapshot` inserts row, skips duplicate for same UTC day
  - `getSnapshots` returns correct count, ordered ASC
  - `pruneSnapshots` deletes only rows beyond retention window
- `tests/lib/work-board-summary.test.js` (extend existing)
  - `buildFactSheet` with `trend7d` produces correct delta lines
  - `buildFactSheet` without `trend7d` output is unchanged

### E2E tests (`e2e/`)

- `e2e/work-board-trends.spec.js`
  - Seed 3 snapshot rows via DB helper
  - Load Work Board → KPI tiles show delta badge (not hidden)
  - Sparkline SVG `<polyline>` element exists in tile
- `e2e/work-board-suggestions.spec.js`
  - Mock `/api/v1/work-board/suggest-action` to return 3 suggestions
  - Hover a My Reviews row → chip strip appears after 300 ms
  - Click "Snooze 7d" → item optimistically removed (no AI fetch)
  - Click "Ping author" → popover with draft text appears

### Backend integration tests (`server/__tests__/`)

- `server/__tests__/work-board-kpi-snapshots.test.js`
  - `GET /api/v1/work-board/kpi-snapshots` returns 200 with data array
  - Returns 401 without session
- `server/__tests__/work-board-suggest-action.test.js`
  - Returns 403 when no BYOK configured
  - Returns suggestions array on success (mock provider)
  - Returns cached result within 30-min cooldown window
- `server/__tests__/work-board-draft-comment.test.js`
  - Returns 403 when no BYOK
  - Returns `{ draft }` on success (mock provider + mock GitHub diff)
  - Respects 10/hour rate limit

---

## Rollout & feature flags

No feature flags — the snapshot job is additive (new table, new endpoints).
If no snapshots exist yet, UI degrades to current state cleanly. BYOK-gated
features (suggest-action, draft-comment) already degrade to 403 → hidden.

`WORK_BOARD_SNAPSHOT_RETENTION_DAYS` env var (default `90`) is the only
operator-facing knob.

---

## File map

| Action  | Path                                                    |
| ------- | ------------------------------------------------------- |
| Create  | `server/lib/work-board-kpi-snapshots.js`                |
| Modify  | `server/lib/work-board-sweeper.js`                      |
| Modify  | `server/lib/work-board-summary.js`                      |
| Modify  | `server/routes/work-board.js`                           |
| Modify  | `server/routes/work-board-actions.js`                   |
| Modify  | `server/db.js` (migration 015)                          |
| Create  | `src/hooks/useFocusedRow.js`                            |
| Modify  | `src/hooks/useWorkBoard.js` (add `useKpiSnapshots`)     |
| Modify  | `src/components/WorkBoard/KpiRow.jsx`                   |
| Modify  | `src/components/WorkBoard/AISummaryCard.jsx`            |
| Modify  | `src/components/WorkBoard/WorkBoardPage.jsx`            |
| Modify  | `src/components/WorkBoard/tabs/MyReviewsTab.jsx`        |
| Modify  | `src/components/WorkBoard/tabs/StalePRsTab.jsx`         |
| Create  | `tests/lib/work-board-kpi-snapshots.test.js`            |
| Modify  | `tests/lib/work-board-summary.test.js`                  |
| Create  | `server/__tests__/work-board-kpi-snapshots.test.js`     |
| Create  | `server/__tests__/work-board-suggest-action.test.js`    |
| Create  | `server/__tests__/work-board-draft-comment.test.js`     |
| Create  | `e2e/work-board-trends.spec.js`                         |
| Create  | `e2e/work-board-suggestions.spec.js`                    |
