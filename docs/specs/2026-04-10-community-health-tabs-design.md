# Community Health Dashboard — Tabbed Layout

**Date:** 2026-04-10
**Status:** Draft
**Scope:** `src/components/CommunityHealthDashboard.jsx`

## Problem

The Community Health Dashboard renders all sections (Files, Activity, Recommendations) in a single scrollable modal. On desktop, the content feels spread out and lacks visual hierarchy. On mobile, scrolling is natural and the layout works well.

## Solution

Add a tabbed interface on desktop (`lg:` breakpoint, >= 1024px) while preserving the current scroll layout on mobile.

## Layout

### Desktop (>= 1024px)

```
┌──────────────────────────────────────────────────┐
│  Header (sticky) — title, badge, refresh, close  │
├──────────────────────────────────────────────────┤
│  Health Score Ring + percentage (always visible)  │
│                                                  │
│  ┌──────────┐ ┌──────────┐ ┌────────────────┐   │
│  │  Files   │ │ Activity │ │ Recommendations│   │
│  └──────────┘ └──────────┘ └────────────────┘   │
│  ─────────────                                   │
│                                                  │
│  (active tab content with AnimatePresence)       │
│                                                  │
│  Last updated: ... (cached)                      │
└──────────────────────────────────────────────────┘
```

### Mobile (< 1024px)

No change — all sections render stacked in scroll order:
Score → Files → Activity → Recommendations → Last updated.

## Tabs

| Tab | Icon | Content |
|-----|------|---------|
| Files | `FileText` | Grid of `FileCheckItem` components |
| Activity | `Activity` | Grid of 4 `MetricCard` components |
| Recommendations | `TrendingUp` | List of `RecommendationItem` components |

Default active tab: **Files**.

## Tab Bar Design

- Container: subtle background with rounded corners (`rounded-2xl`)
- Active tab: solid background with animated sliding indicator (`motion.div` with `layoutId`)
- Inactive tab: `text-slate-500` with hover state
- Each tab shows icon + label

## Transitions

- `AnimatePresence` with `mode="wait"` for tab content switching
- Directional slide based on tab index (left-to-right or right-to-left)
- Short duration (~200ms) for snappy feel

## Responsive Detection

Define a small inline `useIsDesktop` hook directly inside `CommunityHealthDashboard.jsx`, following the same `matchMedia` pattern as the existing `useMobileBreakpoint` hook but targeting `(min-width: 1024px)`. No separate file needed — this is a single-use concern.

## State

```js
const [activeTab, setActiveTab] = useState('files');
const isDesktop = /* lg breakpoint check */;
```

- `activeTab` only matters when `isDesktop` is true
- On mobile, all sections render regardless of `activeTab`

## Loading State

No change to the skeleton. During loading, all skeleton sections render stacked (no tabs). When data loads, the tabbed layout (desktop) or scroll layout (mobile) appears.

## Sub-components

### New (internal to the file)

- `TabBar({ activeTab, onTabChange })` — renders the 3 tabs with sliding indicator

### Unchanged

- `HealthScoreRing` — no changes
- `ScoreBadge` — no changes
- `FileCheckItem` — no changes
- `MetricCard` — no changes
- `AnimatedNumber` — no changes
- `RecommendationItem` — no changes
- `SkeletonState` — no changes

## Files Changed

- `src/components/CommunityHealthDashboard.jsx` — add TabBar, responsive branching, activeTab state

## Testing

- Existing tests should continue to pass (mobile path is identical to current)
- New tests: verify tab bar renders on desktop, tab switching works, mobile does not show tabs
