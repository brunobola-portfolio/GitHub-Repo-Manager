# Work Board — Premium UX & Cross-App Tracking

**Status:** Design approved, ready for implementation planning
**Author:** Bruno Marques
**Date:** 2026-04-24
**Related:** PR #24 (AI BYOK fallback fix), existing Work Board webhook-only model

---

## Summary

The Work Board today is webhook-fed only: nothing appears until a GitHub webhook fires, there's no settings UI to choose what's monitored, and the page feels disconnected from the rest of the app (Dashboard, Repositories, RepoDetail, PRReview don't know which repos are "tracked").

This spec redesigns the Work Board experience along five layers:

1. **Auto-discovery** — scan the user's GitHub and pre-populate a tracked-repos set using signal-based heuristics (review-requested, authored, assigned, owned, recent commit).
2. **Settings page** for full control (pin/mute/bulk/advanced filters).
3. **Inline actions** in the Work Board page (row menus, manage popover).
4. **Command palette** extension for keyboard-driven operations.
5. **AI Assistant (opt-in)** for natural-language config, smart suggestions, and `/ai` commands — fully gated behind a feature flag with cost cap, dry-run onboarding, and undo history.

Integration is the critical non-functional requirement: tracked_repos becomes a first-class concept visible in Dashboard, Repositories, RepoDetail, PRReview, and Header navigation — so the Work Board stops feeling like a separate product.

## Goals

- First visit to `/work-board` shows 10–30 relevant repos within 3 seconds, zero config.
- Any "this repo is in my Work Board" state is visible and actionable from 7+ entry points in the app.
- Webhook installation becomes an optional upgrade (live updates) rather than a setup requirement.
- AI features differentiate without surprising the user on cost or privacy.
- Zero regression for existing webhook-only users.

## Non-goals

- Automatic actions driven by AI (every mutation requires user click).
- Cross-user learning (zero data leaves per-user boundary).
- Scheduled/push notifications (email, Slack) — app-surface only.
- Team `repo_assignments` auto-syncing into tracked_repos (explicit user action only).
- Mobile-first redesign (tablets+ supported, phones degrade to smaller viewport).

## Glossary

- **Tracked repo** — a row in `work_board_tracked_repos` for a given user. Appears in Work Board unless muted.
- **Pinned** — user explicitly marked the repo as always-keep; discovery never auto-removes it.
- **Muted** — user explicitly hides this repo from Work Board views. Row remains; `is_muted=1`.
- **Source signal** — why a repo entered `work_board_tracked_repos`. Allowed values: `review_requested`, `authored_pr`, `assigned_issue`, `owned`, `recent_commit` (all from discovery), `pinned` (manual user add), `webhook` (auto-added on first webhook delivery for an unknown repo).
- **Discovery** — the batch process that hits GitHub API, unions results, and updates `work_board_tracked_repos`.
- **BYOK** — Bring Your Own Key (Anthropic, OpenAI, Gemini, OpenRouter, Local). Established in existing AI Configuration feature.

---

## §1. Data model + auto-discovery

### Schema

```sql
CREATE TABLE work_board_tracked_repos (
    user_id              INTEGER NOT NULL,
    repo_full_name       TEXT NOT NULL,
    repo_id              INTEGER,
    source_signal        TEXT NOT NULL,
    is_pinned            BOOLEAN DEFAULT 0,
    is_muted             BOOLEAN DEFAULT 0,
    last_activity_at     DATETIME,
    discovered_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_synced_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, repo_full_name),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_wbtr_user_active ON work_board_tracked_repos(user_id, is_muted, last_activity_at DESC);

CREATE TABLE work_board_prefs (
    user_id                 INTEGER PRIMARY KEY,
    discovery_window_days   INTEGER DEFAULT 60,
    max_auto_repos          INTEGER DEFAULT 50,
    auto_mute_bots          BOOLEAN DEFAULT 0,
    ai_assistant_enabled    BOOLEAN DEFAULT 0,
    ai_monthly_cap_cents    INTEGER DEFAULT 500,
    ai_response_locale      TEXT DEFAULT NULL,
    last_discovery_at       DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE work_board_ai_dismissed (
    user_id        INTEGER NOT NULL,
    pattern_key    TEXT NOT NULL,
    repo_full_name TEXT,
    dismissed_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, pattern_key, repo_full_name),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE work_board_undo_log (
    operation_id     TEXT PRIMARY KEY,
    user_id          INTEGER NOT NULL,
    operation_type   TEXT NOT NULL,
    before_state     TEXT NOT NULL,
    after_state      TEXT NOT NULL,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at       DATETIME NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_undo_user_expires ON work_board_undo_log(user_id, expires_at);
```

All four tables added via the existing `server/db.js` schema bootstrap (which runs `CREATE TABLE IF NOT EXISTS` on every startup). No separate migration tool needed; matches the pattern already in use for `user_ai_config`, `work_board_presets`, etc.

### Discovery algorithm

`server/lib/work-board-discovery.js`:

```
INPUT: userId, oauthToken, prefs (window_days, max_auto_repos)

1. Parallel fetch (Promise.all):
   - GET /search/issues?q=is:open+archived:false+review-requested:@me
   - GET /search/issues?q=is:open+archived:false+author:@me+updated:>=Nd-ago
   - GET /search/issues?q=is:open+archived:false+assignee:@me
   - GET /user/repos?affiliation=owner&sort=pushed&per_page=30
   - GET /users/{me}/events?per_page=100 (filter PushEvent, last Nd)

2. Union distinct by repo_full_name, assign earliest signal:
   review_requested > authored_pr > assigned_issue > owned > recent_commit

3. Merge with existing table rows, preserving explicit user state:
   - If existing row has `is_pinned=1` OR `is_muted=1` → always keep (user expressed intent).
   - If existing row is neither pinned nor muted and the repo is NOT in the current discovery result → remove it from the table.
   - If the repo IS in the current result, update `last_activity_at` and `source_signal` (earliest wins per priority order above).

4. Cap at prefs.max_auto_repos, ordered by last_activity_at DESC.

5. Update work_board_prefs.last_discovery_at = NOW().

OUTPUT: { discovered: N, added: N, removed: N, duration_ms, sso_orgs_blocked: [...] }
```

Rate budget: 3 Search API calls (Search limit 30/min) + 2 Core API calls (Core limit 5000/hr) in parallel — well within both limits even for hundreds of concurrent users. 403 SSO responses collected per-org and returned in `sso_orgs_blocked`, surfaced as banner in Settings with `[Reconnect {org} →]` action.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/work-board/discover` | Trigger discovery. Sync (200 + snapshot). Accepts `?reset=1` to wipe non-pinned first. |
| `GET` | `/api/v1/work-board/tracked-repos` | Paginated list with `?search`, `?signal`, `?muted`, `?pinned`, `?org` filters. Returns `counts_by_signal`. |
| `POST` | `/api/v1/work-board/tracked-repos` | Body: `{ repo, action: 'pin'\|'mute'\|'unpin'\|'unmute'\|'track'\|'untrack' }`. Returns `{ operation_id, new_state: { is_pinned, is_muted, source_signal } }`. `operation_id` feeds the undo endpoint. |
| `DELETE` | `/api/v1/work-board/tracked-repos/:owner/:repo` | Hard delete (discovery may re-add). |
| `POST` | `/api/v1/work-board/tracked-repos/bulk` | `{ repos: [...], action }`. Max 200 per call. |
| `GET` | `/api/v1/work-board/prefs` | Read prefs. |
| `PATCH` | `/api/v1/work-board/prefs` | Update prefs (validated). |
| `POST` | `/api/v1/work-board/undo/:operation_id` | Revert operation. Expires after 24h. |

All gated by `requireAuth`. Existing `/my-reviews`, `/stale-prs`, `/my-issues`, `/tech-debt` add `JOIN work_board_tracked_repos wbtr ON wbtr.user_id = ? AND wbtr.repo_full_name = <row>.repo_full_name AND wbtr.is_muted = 0`.

### Stale-while-revalidate refresh

On every Work Board page load:
- If `last_discovery_at > 24h ago` OR null → trigger discovery in background (fire-and-forget), serve cached data immediately.
- Next load shows updated data.
- No separate cron infrastructure.

### First-visit migration

Existing users (no row in `work_board_prefs`) get auto-migrated on first `/work-board` visit:
- Server inserts `work_board_prefs` row with defaults.
- Triggers discovery in background (fire-and-forget).
- Endpoints fall back to current behavior ("show all repos with events") until `last_discovery_at` is set.
- Frontend shows dismissible banner "Personalising your board…" and polls `GET /prefs` every 500ms up to 5s. When `last_discovery_at` transitions non-null, refetch tab data without a full page reload (Context propagates the update).

### Webhook coherence

When webhook fires for repo not in `work_board_tracked_repos`:
- Auto-insert row with `source_signal='webhook'`, `is_pinned=0`, `is_muted=0`.
- Semantics: installing a webhook on an org intentionally tracks everything; user can mute later.

---

## §2. Settings page (Layer 1)

### Location

New section in existing `/settings` page, inserted between "AI Configuration" and "License & Plan" in the sidebar. Uses the same shell (no new navigation).

### Components

Reuses: `InsightCard`, `ConfirmModal`, `useToast`, `WebhookHint`, `ds-card-shimmer`, `ds-glass`, `ds-animate-scale-in`, `ds-hover-lift` — zero new "shell" code.

Adds:

| Component | Purpose | Base |
|---|---|---|
| `WorkBoardSettingsSection` | Top-level container | `InsightCard` layout |
| `DiscoveryPanel` | Sync status + window slider + max cap + auto-mute toggle | `InsightCard` |
| `TrackedReposList` | Virtualized list via `@tanstack/react-virtual` | — |
| `RepoRow` | Single row with avatar, signal badge, last-activity, `⋯` menu | Radix Popover |
| `BulkActionsBar` | Sticky bottom bar when selection > 0 | `ds-animate-scale-in` |
| `AddRepoInput` | Autocomplete via `cmdk`, validates via `GET /repos/:owner/:repo` before insert | `cmdk` |
| `WebhookConnectPanel` | Pro+ gate, links to webhook setup docs | Reuses `WebhookHint` |
| `DangerZone` | Reset discovery + Clear all data | `ConfirmModal` |

### Interactions

- Search debounced 150ms, filter chips AND-combined.
- Sort default `last_activity_at DESC`; toggle to `repo_full_name ASC`.
- Click ⋯ → Popover with Pin / Mute / Remove. Single click + toast Undo 5s (10s for Remove).
- Bulk: checkbox per row (Gmail-sticky), bar slides up, single-click action + toast with `operation_id` for Undo.
- Add repo: server validates access before insert, errors inline (e.g., "Can't access this repo").
- Virtualized: 20 rows rendered of N.

### Accessibility

Tab navigation in logical order, `j`/`k` row navigation, Space to check, Enter opens menu. ARIA labels on all actions. High-contrast borders for WCAG AA.

---

## §3. Work Board inline actions (Layer 2)

### Header

```
Work Board
30 repos tracked · updated 4 min ago    [↻] [⚙ Manage repos]
```

`⚙ Manage repos` button opens compact Radix Popover (320px) with search, top 10 recent with pin/mute toggles, link "See all in Settings →". Never leaves the Work Board page.

### Row menu

Every row in MyReviews, StalePRs, MyIssues, TechDebt tabs gets a `⋯` menu (visible on hover desktop, always on mobile):

```
📎  Copy link
💬  Open in GitHub
⏰  Snooze this PR… [7d ▾]
──────────────
🔕  Mute {repo}
📌  Pin {repo}
👁  Stop tracking {repo}
──────────────
✨  Ask AI about this…  (shown only if AI enabled)
```

Actions dispatch to existing endpoints (§1). Optimistic UI: row animates out in 200ms (slide + collapse), then server confirmation. Rollback with error toast on failure.

### Empty state

Replaces current "Connect a GitHub webhook…" with:

```
✨  Let's find your work
We'll scan your GitHub and surface everything where you're
a reviewer, author, or assignee.

[ Discover my work → ]

Or:  [ Add a repo manually ]
     [ Connect webhook (Pro) ]
```

### Filter changes

Existing "repos" filter now shows only tracked + not-muted by default. New toggle "Show muted" for power users.

### Micro-interactions

- Row hover: `ds-hover-lift`
- Row focus (j/k): indigo ring + subtle pulse
- Pinned rows: leading `📌`, stronger `ds-glass`
- Muted rows (if "Show muted" on): 0.5 opacity + diagonal stripe pattern
- Optimistic remove: 200ms slide-out + collapse height, paired with Undo toast

### Files

| File | Change |
|---|---|
| `src/components/WorkBoard/WorkBoardPage.jsx` | +ManageReposButton, new empty state |
| `src/components/WorkBoard/ManageReposButton.jsx` | New popover |
| `src/components/WorkBoard/RowMenu.jsx` | New shared component |
| `src/components/WorkBoard/tabs/*Tab.jsx` | Each row gets `<RowMenu>` |
| `src/components/WorkBoard/EmptyStateDiscovery.jsx` | New default empty |
| `src/hooks/useTrackedRepos.js` | Shared hook (Context-backed) |
| `server/routes/work-board-actions.js` | +pin/mute/remove handlers |
| `server/lib/work-board-tracking.js` | CRUD lib |

---

## §3.5. Cross-app integration

### Visual language

One indicator per repo, three states:

| State | Visual | Tooltip |
|---|---|---|
| Tracked (active) | `●` indigo-500 6px filled dot | "Tracked in Work Board" |
| Tracked (muted) | `○` slate-400 hollow dot | "Muted from Work Board" |
| Not tracked | (absent) or `+ Track` ghost chip | context-dependent |

Pinned is a detail-level distinction (📌 in Settings list), not a card-face indicator.

### Entry points

1. **Dashboard** — new card "Your work [in {org}]" showing counts (pending reviews, stale PRs, issues) with "Open board →" CTA. Respects existing org selector; backend endpoints accept `?org=` filter.
2. **Repositories page** — `RepoCard` gets the dot indicator top-right. Context menu `⋯` (existing, line 189 RepoCard.jsx) gains Pin / Mute / Remove items. Bulk menu adds Pin to Work Board / Mute from Work Board. New filter chip "Tracked only" in the grid filters.
3. **RepoDetail modal** — header chip `● Tracked` (indigo) or `+ Track` (ghost), clickable → menu. No banners.
4. **PRReviewView** — same chip pattern as RepoDetail header.
5. **Header nav** — badge next to "Work Board" link with `pending_reviews + stale_prs` count. Shows `9+` for >9. Hides when 0. Updates on window focus + 5min background interval. Cached in localStorage.
6. **Sidebar / OrgPanel** — no per-org counter (clutter). "Tracked only" chip in the Repositories filter bar covers this need.

### Shared state

`TrackedReposContext` (new) wraps `<App>` at the top level. Hook `useTrackedRepos()` exposes `{ repos, isLoading, pin, mute, untrack, track, refresh }`. All mutations optimistic, rollback on error. Pattern matches existing `ModalContext`, `SelectionContext`.

### Net effect

User can pin/mute/track from 7 places (Settings, Work Board header, Work Board row, RepoCard, RepoCard bulk, RepoDetail, PRReview). State propagates everywhere in <16ms. Dashboard and Header give ambient awareness without opening Work Board.

---

## §4. Command palette (Layer 3)

### Base

Existing `src/components/CommandPalette.jsx` (uses `cmdk`). Extended, not rewritten.

### New command groups

**Work Board:**
- `pin <repo>` — fuzzy all repos (tracked + untracked), pin selected.
- `mute <repo>` — fuzzy tracked only.
- `untrack <repo>` — fuzzy tracked only, 10s Undo.
- `track <repo>` — fuzzy untracked only, add as pinned.
- `refresh discovery` — trigger `POST /discover`, spinner inline.
- `refresh board` — re-fetch KPIs + tabs.
- `go to <repo>` — navigate to RepoDetail.
- `go to pr #<n> in <repo>` — navigate to PRReviewView.
- `go to reviews | stale | issues | tech debt` — switch Work Board tab.
- `show only <filter>` — apply URL-param filters.
- `toggle muted` — invert "Show muted" filter.
- `clear all filters` — reset URL.

**AI (reserved, active only if §5 enabled):**
- `/ai summarize`
- `/ai suggest-reviewer <pr>`
- `/ai draft-comment <pr>`
- `/ai plan-my-day`
- `/ai find-similar <repo>`

If user types `/ai` with AI disabled, show hint: "Enable AI Assistant in Settings".

### Fuzzy search scaling

"Pin" with `pin acme/` hitting thousands of repos: `GET /api/v1/work-board/repo-search?q=<query>&scope=all` endpoint — searches tracked first (instant), then GitHub API with `q=<query>` (debounced 300ms server-side).

### Keyboard

Existing: ↑/↓, Enter, Esc, Tab. Adds:
- `⌘+Enter` — execute action without closing palette (chain ops).

### Discovery

- `⌘K` chip in Header next to logo with tooltip.
- First-visit dismissable hint on Work Board page after feature ships.

### Mobile

Chip becomes 🔍 icon, palette goes full-screen on open, top 5 actions are context-aware (on Work Board: "Refresh board" first; on RepoDetail: "Pin this repo" first).

### Files

| File | Change |
|---|---|
| `src/components/CommandPalette.jsx` | +Work Board groups |
| `src/components/CommandPalette/groups/workBoard.js` | New: commands + handlers |
| `src/components/CommandPalette/groups/navigation.js` | Refactor existing into group |
| `src/components/CommandPalette/groups/ai.js` | New: AI commands (gated) |
| `src/components/Header.jsx` | +⌘K chip |
| `server/routes/work-board-actions.js` | +`GET /repo-search` endpoint |

---

## §5. AI Assistant (Layer 4, opt-in)

### Global feature flag

- Env var `WORK_BOARD_AI_ENABLED=false` by default.
- When `false`: toggle not shown in Settings, all `/ai/*` endpoints return 404.
- Canary list: `WORK_BOARD_AI_ENABLED_USERS=id1,id2` for beta rollout.

### Per-user gating

- Settings toggle `ai_assistant_enabled` (default 0).
- Enabling requires: user has BYOK configured OR server fallback key available.
- If neither, toggle disabled with link to AI Configuration.

### 5.1 Dry-run onboarding

First enable flow presents 3 free preview calls with canned prompts:

1. "Summarize my pending reviews" (~0.3k tokens)
2. "Suggest muting patterns" (~0.5k tokens)
3. "Plan my day" (~0.8k tokens)

Each uses user's BYOK. Estimated cost shown upfront (~$0.002 total). User sees real latency, quality, cost before committing. After 3 previews (or skip): [Enable AI Assistant] / [Not for me].

### 5.2 Monthly cost cap

- Default `$5/month`, options `$1 / $5 / $20 / unlimited`.
- Server tracks `ai_spend_this_month_cents` per user.
- When exceeded: endpoints return 429 "Monthly AI limit reached. [Raise limit]".
- Auto-reset first of month.

### 5.3 Conversational edit

Prompt → structured actions → preview → apply.

Flow:

1. `POST /ai/interpret { prompt }` — LLM receives only metadata (repo names, source_signals, fork/archive flags, counts). Returns `{ actions[], summary, validity_token }`. Token is HMAC-signed `{user_id, actions_hash, expires_at: now+5min}`, signed with a new env var `AI_DIFF_SIGNING_KEY` (generated at install time, or derives from `SESSION_SECRET` if unset). No DB rows involved in the interpret→apply handoff.
2. Preview renders diff visually.
3. `POST /ai/apply { validity_token }` — server verifies HMAC, re-validates actions (repo access via `GET /repos/:owner/:repo`), executes.
4. Invalid repos skipped silently, summary reports "3 repos skipped (no access)".
5. Entire bulk gets single `operation_id` in `work_board_undo_log` → single-click revert for 24h.

### 5.4 Smart suggestions — pattern library

Heuristics computed daily via stale-while-revalidate. LLM only used for phrasing (optional).

| Pattern | Trigger | Suggested action |
|---|---|---|
| BotPrefix | ≥ 3 muted with common prefix | "Always mute `prefix`-*" |
| StaleNoActivity | `last_activity_at > 90 days` AND not pinned | "Mute `repo` (no activity 3mo)" |
| OrgCoverage | ≥ 80% of org X tracked | "Track all repos in org X" |
| RepeatUnmute | User unmuted same repo 3+ times | "Never auto-mute `repo` again" |
| SignalStale | `source_signal=recent_commit` but push > 60d ago | "Re-evaluate signal" |
| ArchivedTracked | Tracked repo now archived on GitHub | "Archive-aware: remove or keep?" |

Cap 3 per visit, rotated. Dismissed suggestions tracked in `work_board_ai_dismissed`.

### 5.5 Ambient summary (refinement of existing)

Existing `AISummaryCard` gains:
- "AI" badge in header.
- "Why these bullets?" modal with prompt + source data + raw response + token estimate.
- "Dismiss until I ask" (permanent until manual Generate).
- `aria-live="polite"` region for screen readers.

### 5.6 Palette `/ai` with streaming

SSE for long responses:
- Spinner → text grows token-by-token.
- `Esc` cancels mid-stream (abort fetch).

Short-term context (5 min, in-memory only):

- `/ai plan my day` → `/ai make it shorter` remembers previous response.
- Never persisted to DB. Lost on server restart (acceptable — user re-issues command).
- Single-instance assumption. Multi-instance deploy would need Redis; deferred.

Endpoints (specific, rate-limited 10/min/user each):
- `POST /ai/summarize`
- `POST /ai/suggest-reviewer`
- `POST /ai/draft-comment`
- `POST /ai/plan-my-day` (SSE streaming)
- `POST /ai/find-similar`

### 5.7 Undo history

`work_board_undo_log` table holds last 24h of mutations. `before_state` and `after_state` columns store **compact JSON** — only the delta (array of `{repo_full_name, is_pinned, is_muted}` rows that changed), not full row snapshots. Typical bulk-of-200 op serializes to ~6 KB. Settings → Work Board → "Recent changes" card shows last 5 with one-click revert. Expired rows cleaned by nightly job (`DELETE FROM work_board_undo_log WHERE expires_at < NOW()`).

### 5.8 Graceful degradation

| Failure | UX |
|---|---|
| 429 from provider | "AI temporarily rate-limited. Retry in 60s." |
| 500 from provider | "AI provider error. [Report] [Retry]" |
| Timeout > 30s | "Taking too long. Cancelled." |
| Invalid JSON response | "AI returned invalid response. [Show raw] [Retry]" |
| No provider | Banner "Set up BYOK in AI Configuration" |
| Cost cap hit | 429 "Monthly AI limit reached. [Raise limit]" |

### 5.9 Prompt versioning

```
server/lib/ai-features/work-board-assistant/
  prompts/
    v1/ v2/
  index.js  (exports CURRENT_VERSION)
```

Stored suggestions include `prompt_version`. On version bump, old suggestions show "Refresh suggestion" badge rather than silently breaking. PR template codifies: new prompt → bump version.

### 5.10 Privacy dashboard

Activity card shows:
- Calls this month + estimated cost range ±20%.
- Bullet list of what data is sent (dynamic per provider).
- [Download activity log (30d CSV)].
- [Pause AI for 24h] / [Disable AI Assistant].

### 5.11 i18n

`work_board_prefs.ai_response_locale` (default = browser locale). Prepended as system prompt prefix: `"Respond in {locale}."`

### Data boundary (never sent to LLM)

- PR bodies / issue bodies
- Commit contents / diffs
- Private user data (email, name beyond GitHub handle)
- Other users' data

Sent (documented):
- Repo full names
- Source signals + counts
- PR titles (only for explicit `/ai` commands that reference a PR)
- PR metadata (author, age, reviewer list)

### Files

| File | Purpose |
|---|---|
| `server/lib/ai-features/work-board-assistant/` | Versioned prompts + index |
| `server/lib/work-board-suggestions-engine.js` | Deterministic rules + LLM rephrase |
| `server/lib/work-board-undo-log.js` | Snapshot/restore |
| `server/routes/work-board-ai.js` | 8 endpoints |
| `server/middleware/ai-cost-cap.js` | Cap enforcement |
| `src/components/Settings/WorkBoardAISection.jsx` | Onboarding + config + activity + undo |
| `src/components/WorkBoard/AISummaryCard.jsx` | Refinements |
| `src/components/CommandPalette/groups/ai.js` | `/ai` commands with streaming |
| `src/hooks/useWorkBoardAI.js` | Stream handling, abort, tracking |
| `src/hooks/useAIActivityLog.js` | Activity dashboard data |

---

## §6. Rollout, testing, metrics

### Phased rollout

| Phase | Scope | Gate |
|---|---|---|
| 1 | Foundations (schema, endpoints §1, discovery lib, auto-migration) | Tests + manual QA |
| 2 | Settings page §2 | Standalone functional |
| 3 | Work Board inline §3 | Zero webhook regression |
| 4 | Cross-app integrations §3.5 | App-wide consistency |
| 5 | Palette §4 | Power-user validation |
| 6 | AI Assistant gated §5 (flag=false) | Beta feedback |
| 7 | AI Assistant GA (flag=true default) | Positive feedback + cost within estimates |

Each phase = independent mergeable PR. Feature works without AI; AI is additive.

### Testing

| Layer | Strategy |
|---|---|
| Discovery lib | Unit with GitHub API mocked (0 repos, 500+, archived, 403 SSO, rate limit) |
| Endpoints | Integration via supertest — including HMAC validity token (5.3), cost cap middleware |
| Context + hooks | React Testing Library — optimistic update, rollback, cross-component sync |
| UI components | Snapshot + interaction tests for Settings, row menus, empty states |
| E2E (Playwright) | (1) first visit → discover → see repos; (2) pin from RepoList → appears in Work Board; (3) mute via palette → row disappears; (4) undo via toast; (5) cost cap triggers (simulated) |
| AI endpoints | Mock LLM provider (never real calls in CI), validate prompt + schema parsing |
| Regression | All 2070 existing tests remain green |

### Metrics (opt-in telemetry)

- Discovery: latency p50/p95, repos discovered, rate-limit hits, 403 SSO count.
- Usage: pin/mute/untrack/day, bulk vs single ratio.
- UX: time-to-first-productive-action, empty-state CTA click-through.
- AI: calls/day per feature, token estimates, cap triggers, dry-run completion, suggestion dismissal rate.
- Errors: % discovery failures, % LLM failures, % optimistic rollbacks.

Surface via existing `trackBreadcrumb` → Sentry.

### Docs

- `docs/architecture/work-board-tracking.md`
- `docs/api/WORK-BOARD-API.md` (or extend existing API.md)
- Screenshots in `docs/images/` — `0X_workboard_*_hd.png` convention
- Release notes section in README

### Success criteria

1. First visit populates Work Board in ≤ 3s with 10–30 relevant repos, zero config.
2. Pin/mute from any entry point reflects in all other surfaces in ≤ 100ms.
3. Command palette opens in ≤ 16ms, fuzzy match ≤ 50ms.
4. Dry-run AI onboarding costs ≤ $0.01 for 95% of users.
5. 2070 existing tests green + 150+ new tests for the feature.
6. Zero regression in webhook flow for existing users.

---

## Open questions / future extensions

1. **Team integration** — "Import tracked from Team X" option in Settings (explicit, not auto). Out of scope for MVP.
2. **Scheduled digests** — daily/weekly email or Slack summary. Out of scope.
3. **AI learning across users** — federated pattern learning. Explicitly never.
4. **Multi-account GitHub** — current design assumes one active session token. Multi-account would need per-account `tracked_repos`. Deferred.
5. **Mobile-first UI** — responsive covered, but dedicated mobile UX is future work.

---

## Appendix: component reuse matrix

| New component | Reuses | Pattern source |
|---|---|---|
| `WorkBoardSettingsSection` | `InsightCard`, `ds-glass` | `AIConfigSection.jsx` |
| `DiscoveryPanel` | `InsightCard` header pattern | `AIConfigSection.jsx` |
| `TrackedReposList` | `@tanstack/react-virtual` | Already in deps |
| `RepoRow` ⋯ menu | Radix `Popover` | `WorkBoard/tabs/ChipStrip` |
| `BulkActionsBar` | `ds-animate-scale-in` | Existing design system |
| `AddRepoInput` | `cmdk` | `CommandPalette.jsx` |
| `ManageReposButton` | Radix `Popover` | `ChipStrip` |
| `RowMenu` | Radix `Popover` | `ChipStrip` |
| `EmptyStateDiscovery` | `InsightCard`, `ds-btn-shimmer` | Generic empty-state pattern |
| `TrackedReposContext` | React `createContext` | `ModalContext.jsx`, `SelectionContext.jsx` |
| `WorkBoardAISection` | `InsightCard`, `ConfirmModal`, `useToast` | `AIConfigSection.jsx` |

Zero new "shell" or "layout" components — every new UI element drops into an existing idiom.
