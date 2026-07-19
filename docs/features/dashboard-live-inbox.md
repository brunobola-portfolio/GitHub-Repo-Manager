# Premium Dashboard — Live Inbox

> **Feature flag:** `localStorage.setItem('dashboard_premium_v2_inbox', '1')` — reload the page after setting.

![Live Inbox — needs_review section](../images/10_dashboard_live_inbox_needs_review_hd.png)

## What it does

The Live Inbox replaces the static "Attention Feed" on the dashboard with a sectioned, keyboard-driven view of everything waiting for you across your GitHub repositories. Instead of a hand-picked sample, the inbox is composed from live aggregators: PRs where you are a requested reviewer, your own open PRs, issues assigned to you or mentioning you, and your stale draft PRs. Archive or snooze any item and it stays out of your way until the snooze expires or you explicitly restore it. All state is persisted per user in the database — it survives page reloads and sessions.

## Sections

| Section key | What appears here |
| --- | --- |
| `needs_review` | PRs where you are a requested reviewer |
| `my_prs` | PRs you authored that are still open |
| `mentions` | Issues assigned to you |
| `stale_drafts` | Your own PRs that have been open > 7 days |
| `failing_ci` | *(Phase 2 — stub in Phase 1, always empty)* |
| `dependabot_ready` | *(Phase 3 — stub in Phase 1, always empty)* |

An item that qualifies for multiple sections is shown in only the highest-priority one. Priority order: `failing_ci` > `needs_review` > `stale_drafts` > `mentions` > `dependabot_ready` > `my_prs`.

![Live Inbox — my open PRs](../images/11_dashboard_live_inbox_my_prs_hd.png)

## AI narrative

The top 3 items in the active section receive a Gemini-generated one-line summary alongside the row details. Narratives are fetched via the existing `POST /api/ai/attention-narrative` endpoint and cached for 1 hour. If your AI quota is exhausted the fan-out stops cleanly — rows render without AI text. Requires a BYOK Gemini key configured in Settings → AI Configuration.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `e` | Archive the first item of the active section |
| `s` | Open the snooze modal for the first item of the active section |
| Chevron click | Expand / collapse the row in-place |
| Title click | Navigate to the PR or issue on GitHub |

Shortcuts are suppressed when focus is inside an `<input>`, `<textarea>`, `<select>`, or contenteditable element.

![Expanded inbox row](../images/12_dashboard_live_inbox_row_expanded_hd.png)

## Archive and snooze

- **Archive** removes an item from the inbox. It can be restored via `POST /api/v1/dashboard/inbox/:itemId/restore`.
- **Snooze** hides an item until a future ISO timestamp. The snooze modal offers preset durations (1 hour, Tomorrow 9am, Next Monday, 1 week). Snoozed items reappear automatically when the timestamp passes.

![Snooze modal with 4 presets](../images/13_dashboard_live_inbox_snooze_modal_hd.png)

## Stale drafts

Your own PRs that have been open more than 7 days surface in their own section so they do not get lost between the higher-urgency sections. Archive or snooze them just like any other item.

![Stale drafts section](../images/14_dashboard_live_inbox_stale_drafts_hd.png)

## Dark mode

The inbox respects the global theme and uses the dashboard's existing dark-mode design tokens. No separate styling code.

![Live Inbox — dark mode](../images/15_dashboard_live_inbox_dark_hd.png)

## Mobile

Below the `md` breakpoint the section sidebar collapses to a horizontally-scrollable strip, rows stack their secondary metadata under the title, and tap-and-hold replaces the hover-revealed action buttons.

![Live Inbox — mobile 375 px](../images/16_dashboard_live_inbox_mobile_hd.png)

## Tier gating

All inbox actions — view, archive, snooze, restore — are available on the **free tier**. No upgrade required.

## Enabling / disabling

Enable:

```js
localStorage.setItem('dashboard_premium_v2_inbox', '1')
// then reload
```

Disable:

```js
localStorage.removeItem('dashboard_premium_v2_inbox')
// then reload
```

The flag controls a `React.lazy()` split; disabling it restores the legacy Attention Feed with no bundle cost.

## What is NOT in Phase 1

- `failing_ci` and `dependabot_ready` sections are stubs.
- The DORA card widget is deferred to Phase 2.
- The Service Scorecard rings on Work Board tiles are deferred to Phase 3.

## API reference

See [API Reference — Dashboard](../api/API.md#dashboard-apiv1dashboard) for the four endpoint signatures (GET inbox, POST archive, POST restore, POST snooze).

## Related

- Spec: [`docs/specs/2026-05-10-premium-dashboard-three-pillars.md`](../specs/2026-05-10-premium-dashboard-three-pillars.md)
- Plan: [`docs/plans/2026-05-10-premium-dashboard-phase-1-inbox.md`](../plans/2026-05-10-premium-dashboard-phase-1-inbox.md)
- Aggregator: [`server/lib/dashboard-aggregator.js`](../../server/lib/dashboard-aggregator.js)
- Routes: [`server/routes/dashboard.js`](../../server/routes/dashboard.js)
- Frontend panel: [`src/components/Dashboard/Premium/InboxPanel.jsx`](../../src/components/Dashboard/Premium/InboxPanel.jsx)
