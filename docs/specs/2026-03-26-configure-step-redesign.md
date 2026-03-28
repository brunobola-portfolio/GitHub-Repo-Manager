# Configure Repositories Step — Premium Redesign

**Date:** 2026-03-26
**Status:** Draft
**Approach:** Dashboard + Compact Card-Rows (Option C)

## Overview

Redesign the Configure Repositories step (step 4) of the Migration Wizard to be visually premium, information-rich, and include a global destination organization selector. The current flat table layout is replaced with a dashboard header + compact card-row pattern.

## Goals

1. Premium visual experience with rich stats and gradient accents
2. Global GitHub destination org selector (all repos → same org)
3. Show repo metadata inline (language, size, branches)
4. Better information density without clutter
5. Smooth animations via Framer Motion

## Design

### Section 1: Dashboard Header

A gradient-bordered panel at the top of the step with two rows:

**Row 1 — Destination & Actions:**
- Left: Org icon + "Importing to" label + `Select` dropdown showing GitHub orgs (uses existing `useOrgs` data via `orgs` prop already passed to MigrationWizard). Dropdown shows avatar + org name. Personal account is first option.
- Right: "All Private" and "All Public" bulk action buttons with purple/cyan tinted backgrounds

**Row 2 — Live Stats Grid:**
Four mini stat cards in a `grid-cols-4` layout:
- **Repositories**: count of selected repos (purple/violet accent)
- **Total Size**: sum of all repo sizes, formatted (cyan accent)
- **Private**: count of repos with `visibility: 'private'` (emerald accent)
- **Public**: count of repos with `visibility: 'public'` (orange accent)

Each stat card: dark background (`bg-slate-900/50`), large bold number on top, uppercase label below. Stats update reactively when user changes visibility.

**Styling:**
- Background: `bg-gradient-to-br from-violet-500/10 to-indigo-500/10`
- Border: `border border-violet-500/20`
- Border radius: `rounded-2xl`
- Padding: `p-5`

### Section 2: Repo Card-Rows

Each selected repo is rendered as a compact card-row (not a table row). The list is scrollable with `max-h-[calc(100vh-400px)] overflow-y-auto`.

**Card-Row Structure:**

```
┌─[gradient left border 3px]──────────────────────────────────────────┐
│  📦 SourceName  →  [target name input]     🔒 Private  ● Ready  ⋯ │
│      C# • 2.4 MB • 3 branches                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Left section:**
- Gradient left border (violet → cyan, 3px wide, `rounded-l-xl`)
- Repo icon in a tinted square (32×32, `bg-violet-500/15 rounded-lg`)
- Source name as bold text
- Arrow separator (`→` in `text-slate-500`)
- Target name input field (inline, dark background)

**Metadata line (below name):**
- Language badge (if available)
- Size badge (formatted: KB/MB/GB)
- Branch count badge (e.g., "3 branches")
- TFVC badge if `isTfvc === true`
- All badges: `text-[10px] bg-slate-900 text-slate-500 px-1.5 py-0.5 rounded`

**Right section:**
- Visibility badge: purple tinted for Private, cyan tinted for Public — clickable to toggle
- Status indicator: glowing dot (green = ready, amber = checking, red = conflict) + text label
- Expand button (`⋯`) to reveal advanced options

**Expanded state (when ⋯ is clicked):**
Slides down with Framer Motion `AnimatePresence`:
- Description textarea (full width)
- LFS toggle with label
- Branch filter section (same as current: "Mirror all branches" checkbox, branch multi-select)
- Conflict resolution buttons (if conflict detected)

**Card-Row Styling:**
- Background: `bg-slate-800 hover:bg-slate-800/80`
- Border: `border border-slate-700`
- Border radius: `rounded-xl`
- Spacing between cards: `space-y-3`
- Hover: subtle brightness increase
- Entry animation: `ds-animate-fade-in-up` with staggered delay per card

### Section 3: Conflict Handling

Conflict detection stays the same (debounced 500ms check on target name change). Visual changes:

- **Checking**: Status dot pulses amber, label says "Checking..."
- **Clear**: Status dot glows green, label says "Ready"
- **Conflict**: Status dot glows red, label says "Conflict". Card border changes to `border-red-500/30`. Expanded section auto-opens showing resolution options (Replace / Rename / Skip) as styled buttons.

### Section 4: Empty State

When no repos are selected:
- Centered content with large icon
- "No repositories selected" heading
- "Go back and select repositories to configure" subtitle
- "← Back to Selection" ghost button

### Section 5: LFS Warning Banner

If any repo has `lfsEnabled: true`, shows a warning banner between the dashboard header and the repo list:
- Amber tinted background with warning icon
- "LFS repositories detected — migration may take longer for large files"
- Compact, single line

## Data Flow

### Destination Org

1. `orgs` prop is already available in MigrationWizard (passed from App.jsx)
2. RepoConfigStep receives new prop: `orgs`
3. User selects org → calls `onChangeDestination(orgLogin)` → updates `source.targetOrg` in wizard state
4. The selected org is passed to `/api/import/check-duplicates` as `targetOwner` for conflict detection
5. Default value: current `source.targetOrg` if set, otherwise first org in list (personal account)
6. When destination org changes, clear all conflict states and re-run duplicate check for every repo that has a `targetName`

### Stats Computation

Computed reactively from the `repos` array (no API calls):
```javascript
const stats = useMemo(() => ({
  count: repos.length,
  totalSize: repos.reduce((sum, r) => sum + (r.size || 0), 0),
  privateCount: repos.filter(r => r.visibility === 'private').length,
  publicCount: repos.filter(r => r.visibility === 'public').length,
}), [repos])
```

## Components Changed

### Modified Files:
1. **`src/components/MigrationWizard/steps/RepoConfigStep.jsx`** — Full rewrite of layout. Same logic, new visual structure.
2. **`src/components/MigrationWizard/MigrationWizard.jsx`** — Pass `orgs` prop to RepoConfigStep. Add `onChangeDestination` handler.

### No New Files:
- Reuse existing `Select.jsx` for the org dropdown
- No new hooks needed (`orgs` already fetched by `useOrgs`)
- No new API endpoints needed

## Animations

All via Framer Motion (already in project):
- Dashboard header: `fade-in` on mount
- Stat numbers: count-up animation (optional, nice-to-have)
- Card-rows: staggered `fade-in-up` (50ms delay per card)
- Expand/collapse: `AnimatePresence` with height animation
- Visibility toggle: color transition
- Status dot: CSS `box-shadow` pulse for checking state

## Accessibility

- Org dropdown: keyboard navigable (existing Select.jsx handles this)
- All interactive elements: proper `aria-label` attributes
- Visibility toggle: `role="button"` with `aria-pressed`
- Expand button: `aria-expanded` state
- Color is not the only indicator — text labels accompany all status dots
- Focus management: expand button returns focus on collapse

## Edge Cases

- **No orgs available**: Dropdown shows only "Personal Account" (already handled by existing API)
- **0 repos selected**: Shows empty state with back button
- **Many repos (20+)**: Scrollable list with virtual scrolling not needed (migration wizard typically handles <50 repos)
- **Long repo names**: Truncate with ellipsis, full name on hover tooltip
- **TFVC repos**: Show "TFVC" badge instead of branch count, hide branch filter in expanded section
- **Conflict on org change**: When destination org changes, re-run duplicate check for all repos
