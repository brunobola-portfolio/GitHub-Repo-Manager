# AI Quota — Premium Indicators & Exhaustion Hero

**Date:** 2026-05-12
**Owner:** Bruno Silva Marques
**Status:** Draft

## Problem

The AI quota system currently surfaces in two places, and both feel unfinished:

1. **Inside `AttentionFeed`** (`src/components/Dashboard/AttentionFeed.jsx:248-272`): a flat amber banner appears **only after the user hits 100%**. Before that, the UI gives zero feedback about how much budget remains. The user discovers the limit by crashing into it.
2. **Inside `Settings → Usage`** (`src/components/Settings/UsageDashboard.jsx`): functional progress bars exist, but they live three clicks away inside Settings and have a utilitarian look that does not match the rest of the premium dashboard surface.

The result is a UX gap: free-tier and pro users alike feel the product *takes away* AI capability without ever showing them where they stand or what comes next. The exhausted-state banner uses warning-yellow tones that read as "error" rather than as a premium product communicating constraints.

## Goals

- **Always-visible quota awareness** on the main dashboard surface — users see usage *before* it runs out.
- **Premium exhausted state** — when quota is reached, the moment becomes a clear value handoff (free → pro), not a yellow warning band.
- **Consistent across consumers** — `AttentionFeed` and `Premium/InboxPanel` (the two hooks that fan-out narrative AI calls) use the same indicator.
- **Conservative tier adjustments** — small, defensible bumps on under-used per-feature caps; no change to the global `aiQueriesPerMonth`.

## Non-goals

- Redesigning `Settings/UsageDashboard` — the full per-feature breakdown stays there.
- Building a new `/usage` page.
- Changing AI billing, provider routing, or the BYOK escape hatch.
- Touching pro/enterprise pricing.

## Design

### Component 1 — `AIQuotaMeter` (new)

A compact, always-visible indicator. Two presentation modes selected by prop:

**Mode A — `compact` (default)**: pill-sized control, ~96×28px. Fits into a card header.

```text
┌────────────────┐
│ ◐  47 / 200    │   ← thin progress ring (3px) + numeric label
└────────────────┘
```

**Mode B — `extended`**: same content but adds reset countdown and an `Upgrade` chip for free-tier users. Used on top-of-dashboard placement.

```text
┌─────────────────────────────────────────────────┐
│ ◐  47 / 200 AI requests  ·  resets in 18 days   │
│                                  ┌────────────┐ │
│                                  │ Upgrade ↗  │ │
│                                  └────────────┘ │
└─────────────────────────────────────────────────┘
```

**Color thresholds** (driven by `pct = used/limit`):

| Range     | Ring + label color                        | Reasoning              |
| --------- | ----------------------------------------- | ---------------------- |
| 0–60%     | `indigo-500` (matches dashboard accent)   | Healthy, on-brand      |
| 60–90%    | `amber-500`                               | Soft heads-up          |
| 90–99%    | `rose-500`                                | Imminent exhaustion    |
| 100%      | `rose-500` with subtle pulse animation    | Exhausted (calls hero) |
| Unlimited | `emerald-500` static check icon, no ring  | Pro/Enterprise tier    |

**Interaction**:

- Click → opens a popover with: full progress bar, exact reset timestamp, link `Manage usage →` (deep-link to Settings/Usage), and `Upgrade to Pro` if free.
- Keyboard accessible (`role="button"`, focus ring matches dashboard).
- Framer Motion fade-in on first paint; ring fills with a 600ms ease.

**Placement**:

- Header of `AttentionFeed` next to the refresh button (compact mode).
- Optional `extended` mode in a future dashboard header pass — out of scope for this spec but the component supports it.

### Component 2 — `AIQuotaExhaustedCard` (replaces inline `QuotaNotice`)

Replaces the amber banner in `AttentionFeed.jsx:248-272` (and the same construct in `InboxPanel`) with a premium card whose vocabulary matches the existing `QuotaExceededState.jsx`:

```text
┌───────────────────────────────────────────────────────┐
│                                                       │
│   ╭───╮   AI insights paused                          │
│   │ ◐ │   200 / 200 requests used this month          │
│   ╰───╯   Resets in 18 days · Tue, 1 Jun              │
│                                                       │
│   The signals below are still live — only the AI      │
│   narrative is muted.                                 │
│                                                       │
│   ┌────────────────────┐   Manage usage →             │
│   │ Upgrade to Pro  →  │   5,000 queries · unlimited  │
│   └────────────────────┘   semantic search & insights │
│                                                       │
└───────────────────────────────────────────────────────┘
```

**Design details**:

- Outer card: glassmorphism (`bg-white/85 dark:bg-slate-900/85`, `backdrop-blur-xl`), gradient hairline ring (rose→amber, 1px), matching the parent `AttentionFeed` shell.
- Gauge icon: 40×40 rounded square, `bg-gradient-to-br from-rose-500 to-amber-500`, white `Gauge` icon (same gradient family as `QuotaExceededState`).
- Two-line lead: bold title + numeric usage; secondary line for reset (relative + absolute date).
- CTA group: primary `Upgrade to Pro` button (gradient indigo→purple, matches existing premium buttons) + secondary `Manage usage` link.
- Below CTA: 2–3 concrete benefits of upgrade as muted micro-copy ("5,000 queries / month", "Unlimited semantic search").
- Hidden for non-free tiers (`upgradeTo` null) — shows the same card minus the upgrade CTA.
- Motion: `initial={{opacity:0, y:8}} animate={{opacity:1, y:0}}` (same as `QuotaExceededState`).

### Component 3 — `useAIUsage` hook (new)

Lightweight subscription to `/api/v1/usage`:

```jsx
const { aiQueries, aiFeatures, tier, loading } = useAIUsage()
// aiQueries = { current: 47, limit: 200, percent: 0.235 }
// tier = 'free' | 'pro' | 'enterprise'
```

Hook behaviour:

- Fetches once on mount, then revalidates on focus (`window.addEventListener('focus', …)`).
- Also revalidates when `useAIQuotaState` flips (quota gate closed → usage worth refetching).
- Returns `null` limits as `Infinity`; meter renders the unlimited variant.
- 30-second TTL to coalesce repeated calls from multiple consumers.
- Lives at `src/hooks/useAIUsage.js`.

### Component 4 — Tier adjustments (conservative)

| Metric                     | Current | Proposed  | Why                                                                    |
| -------------------------- | ------- | --------- | ---------------------------------------------------------------------- |
| `aiQueriesPerMonth` (free) | 200     | **200**   | Just doubled 100→200 in `2026-04-15-free-tier-expansion`. Hold.        |
| `semanticSearchPerMonth`   | 50      | **75**    | Search is the conversion hook; low per-call token cost.                |
| `repoInsightsPerMonth`     | 10      | **15**    | 10 felt mean for users with 50 repos; insights are cached server-side. |
| `commitGenPerMonth`        | 50      | 50        | Unchanged.                                                             |
| `readmeGenPerMonth`        | 5       | 5         | Unchanged (high token cost).                                           |
| `migrationRiskPerMonth`    | 5       | 5         | Unchanged (Pro is the path).                                           |
| `migrationAssistPerMonth`  | 5       | 5         | Unchanged.                                                             |
| Pro tier                   | —       | unchanged | Already Infinity for per-feature caps.                                 |

Rationale: bump only the two metrics where free users hit the cap most often (per audit log inspection during validation) and where token cost per call is lowest. Skip the global `ai_queries` change — the previous spec flagged it as the cost knob to *tighten* on abuse, not loosen.

## Files touched

**New**:

- `src/components/ui/AIQuotaMeter.jsx` — both modes.
- `src/components/ui/AIQuotaExhaustedCard.jsx` — replaces inline `QuotaNotice`.
- `src/hooks/useAIUsage.js` — `/api/v1/usage` subscription.
- `tests/components/ui/AIQuotaMeter.test.jsx` — color thresholds, popover, a11y.
- `tests/components/ui/AIQuotaExhaustedCard.test.jsx` — render variants (free vs pro).
- `tests/hooks/useAIUsage.test.js` — caching + refresh-on-focus.

**Modified**:

- `src/components/Dashboard/AttentionFeed.jsx` — header gets `<AIQuotaMeter compact />`; inline `QuotaNotice` swapped for `<AIQuotaExhaustedCard />`.
- `src/components/Dashboard/Premium/InboxPanel.jsx` — add `<AIQuotaMeter compact />` to the panel header **and** render `<AIQuotaExhaustedCard />` above the list when `quota` is set. Today the panel silently stops generating narratives when the gate closes, with zero UI hint — fixing that is part of this spec.
- `server/lib/feature-flags.js` — bump `semanticSearchPerMonth: 75`, `repoInsightsPerMonth: 15` on `free`.
- `tests/components/Dashboard/AttentionFeed.test.jsx` — update assertions for new component names.
- `docs/specs/2026-04-15-free-tier-expansion.md` — add a short "amended on 2026-05-12" line under the tier matrix.

**Not touched**:

- `src/components/Settings/UsageDashboard.jsx` — the detailed view stays as is; we just deep-link to it.
- `server/lib/usage-meter.js` — only constants change in `feature-flags.js`; counter logic is correct.
- `src/api/aiFetch.js` / `useAIQuotaState` — the quota gate is the right primitive; we add `useAIUsage` *alongside* it, not replace.

## Data flow

```text
mount AttentionFeed
  → useAIUsage()   ─── GET /api/v1/usage ───→ server/routes/usage.js
                                                returns { aiQueries, aiFeatures, tier }
  → useAIQuotaState()  ── in-memory gate from aiFetch.js
                          (set when ANY AI call returns 429)

render:
  if (aiQueries.limit === Infinity) → unlimited variant of <AIQuotaMeter />
  else if (quotaGateClosed)         → <AIQuotaExhaustedCard /> above the list
                                       + meter shows 100% rose pulse
  else                              → <AIQuotaMeter /> with current %

focus event → useAIUsage refetches (covers "I upgraded in another tab")
quota gate flip → useAIUsage refetches (covers "I just hit the wall this session")
```

## Accessibility

- `AIQuotaMeter` is a real `<button>` with `aria-label="AI quota: 47 of 200 requests used. Resets in 18 days. Click for details."`
- Popover gets `role="dialog"` with focus trap; Escape closes.
- Color is never the only signal — the numeric label is always present, and the icon shape changes between meter (ring) and unlimited (check).
- `prefers-reduced-motion` disables the ring-fill animation and the rose-pulse on exhausted state.

## Test plan

**Component unit (Vitest + RTL)**:

- `AIQuotaMeter`: renders correct color per pct bucket; renders unlimited variant when limit is Infinity; popover opens on click; Escape closes; numbers update reactively when props change.
- `AIQuotaExhaustedCard`: free-tier renders upgrade CTA; pro-tier hides it; renders reset date in both relative ("in 18 days") and absolute ("Tue, 1 Jun") forms.
- `useAIUsage`: fetches once, caches 30s, refetches on focus, refetches when quota state flips.

**Integration (existing `AttentionFeed.test.jsx`)**:

- When quota state is set, the new exhausted card is rendered (not the old amber banner).
- When `aiQueries.current < limit`, the meter is rendered in the header with the right color.

**Server (existing `usage-meter-ai-features.test.js`, `ai-tier-and-limits.test.js`)**:

- New `free` values 75 / 15 surface through `/api/v1/usage` and the new caps enforce correctly.

**Manual / Playwright**:

- Dashboard loads → meter visible in `AttentionFeed` header showing real current/limit.
- Hover meter → popover shows reset date + correct CTA per tier.
- Force quota exhaustion (test seed) → exhausted card renders, meter shows rose pulse, narratives are muted but rows still render.

## Migration & compatibility

- The existing `QuotaNotice` is local to `AttentionFeed.jsx`; replacing it is a refactor with no external API. The only ripple is two assertions in `AttentionFeed.test.jsx`.
- `server/lib/feature-flags.js` change is additive (loosening, not tightening) — existing free users get more, never less.
- `/api/v1/usage` shape is unchanged. The new `useAIUsage` hook is opt-in; no other consumer is affected.

## Risks

- **AI cost** (small): bumping `semanticSearchPerMonth` 50→75 and `repoInsightsPerMonth` 10→15 raises worst-case per-user spend by ~30% on these two features. Lower-token features and Pro conversion offset. Monitor via the existing audit-log `ai.*` actions; revert here if abuse appears.
- **Meter perceived as noisy**: extra UI in a header that's already busy. Mitigation: compact mode is 96×28, monochrome at <60%, and only "premium-feels-active" colors kick in past 60% — staying calm in the common case.
- **Popover focus management**: opening from inside a card with its own click handlers (the attention rows) needs careful `stopPropagation` to avoid double-firing. Covered by the unit test for clicks.

## Out of scope (follow-ups)

- A dedicated `/dashboard/usage` route (the popover + Settings link is enough for now).
- Per-feature meters in the dashboard header (only the global `ai_queries` meter ships in this spec).
- Animated cost-savings card on upgrade.
