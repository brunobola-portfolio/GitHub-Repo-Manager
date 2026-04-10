# Reusable TabBar Component — Codebase Uniformization

**Date:** 2026-04-10
**Status:** Draft
**Scope:** Extract shared TabBar, migrate 8 consumers

## Problem

The codebase has 8 components with tab-like navigation patterns. Each implements its own tab buttons inline, resulting in:
- Zero WAI-ARIA semantics (no `role="tablist"`, `role="tab"`, `aria-selected`)
- No keyboard navigation (ArrowLeft/Right, Home/End)
- No `tabIndex` management (active=0, inactive=-1)
- No `aria-controls` / `aria-labelledby` linkage between tabs and panels
- Duplicated styling logic across components

The only exception is `CommunityHealthDashboard`, which was recently given full ARIA and keyboard support — but its `TabBar` is defined inline and not reusable.

## Solution

Extract a shared `<TabBar>` component to `src/components/ui/TabBar.jsx` with 3 visual variants, full WAI-ARIA compliance, and keyboard navigation. Migrate all 8 consumers to use it.

## Component API

```jsx
<TabBar
  tabs={TABS}              // [{ id: string, label: string, icon?: LucideIcon }]
  activeTab={activeTab}    // string
  onTabChange={setActiveTab} // (id: string) => void
  variant="pill"           // "pill" | "underline" | "segmented"
  layoutId="unique-id"     // unique per instance, required for animation
  className=""             // optional extra classes on container
  size="md"                // "sm" | "md" (default "md")
/>
```

## Variants

### `pill` (default)

Rounded container with solid sliding background indicator.

```
┌─────────────────────────────────────────────┐
│  ┌[  Files  ]┐   Activity    Recommendations│
│  └───────────┘                              │
└─────────────────────────────────────────────┘
```

- Container: `rounded-2xl bg-slate-100/80 dark:bg-slate-800/60 border p-1`
- Active indicator: `motion.div` with `layoutId`, `bg-white dark:bg-slate-700 shadow-sm rounded-xl`
- Used by: **CommunityHealthDashboard**, **TeamDetails**

### `underline`

Flat bar with animated bottom border indicator.

```
  Files     Activity     Recommendations
  ═════
```

- Container: `flex border-b border-slate-200/50 dark:border-slate-800/40`
- Active indicator: `motion.div` with `layoutId`, `h-0.5 bg-indigo-500 rounded-full` at bottom
- Active text: `text-indigo-600 dark:text-indigo-400`
- Used by: **SettingsModal**, **RepoDetail**, **RepoInsightsModal**, **OrgManagerModal**

### `segmented`

Compact button group with border container, active background fill.

```
┌─────────┬────────────┐
│ ■ Plans │  Legacy    │
└─────────┴────────────┘
```

- Container: `rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 overflow-hidden`
- Active: `bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-md`
- No `motion.div` indicator (instant switch, no spring animation)
- Used by: **MigrationHistory**, **PRDetailPanel**

## Size

- `md` (default): `px-4 py-2.5 text-sm` — used by most consumers
- `sm`: `px-3 py-1.5 text-xs` — used by MigrationHistory

## Accessibility (all variants)

- Container: `role="tablist"`
- Each tab button: `role="tab"`, `id={tab-${layoutId}-${id}}`, `aria-selected`, `aria-controls={tabpanel-${layoutId}-${id}}`, `tabIndex={isActive ? 0 : -1}`
- Keyboard: `ArrowRight` (next, wraps), `ArrowLeft` (prev, wraps), `Home` (first), `End` (last)
- On key nav: focus moves to new active tab

Consumers add to their tab content container:
- `role="tabpanel"`, `id={tabpanel-${layoutId}-${tabId}}`, `aria-labelledby={tab-${layoutId}-${tabId}}`

## Consumer Migration Map

| Component | File | Current Style | Target Variant | Notes |
|-----------|------|---------------|----------------|-------|
| CommunityHealthDashboard | `src/components/CommunityHealthDashboard.jsx` | inline TabBar + useIsDesktop | `pill` | Remove inline TabBar, TABS, handleKeyDown. Keep useIsDesktop and handleTabChange for direction state. |
| SettingsModal | `src/components/SettingsModal.jsx` | inline buttons + layoutId underline | `underline` | Remove inline tab rendering. Keep TABS constant. |
| RepoDetail | `src/components/RepoDetail/RepoDetail.jsx` | inline buttons + border-b-2 | `underline` | Remove inline nav. Keep TABS constant. |
| RepoInsightsModal | `src/components/AI/RepoInsightsModal.jsx` | inline buttons + border-b-2 | `underline` | Remove inline tab rendering. Tabs only shown when `analysis && !loading`. |
| OrgManagerModal | `src/components/OrgManagerModal.jsx` | inline buttons + border-b-2 | `underline` | Remove inline tab rendering. Tabs use string array, needs conversion to `{id, label}` format. |
| PRDetailPanel | `src/components/RepoDetail/PRDetailPanel.jsx` | inline segmented buttons | `segmented` | Remove inline tab rendering. No icons on tabs. |
| TeamDetails | `src/components/Teams/TeamDetails.jsx` | custom TabButton component | `pill` | Remove inline TabButton function. Has 4 tabs with icons. Current style is pill-like (rounded bg with shadow). |
| MigrationHistory | `src/components/MigrationHistory.jsx` | inline segmented buttons | `segmented`, `size="sm"` | Remove inline tab rendering. 2 tabs with icons. |

## Files Changed

- **Create:** `src/components/ui/TabBar.jsx`
- **Create:** `tests/components/ui/TabBar.test.jsx`
- **Modify:** `src/components/ui/index.js` (add export)
- **Modify:** 8 consumer components (see migration map)
- **Modify:** `tests/components/CommunityHealthDashboard.test.jsx` (update assertions if tab IDs change)

## Testing

### TabBar unit tests (`tests/components/ui/TabBar.test.jsx`)

- Renders all 3 variants with correct ARIA attributes
- Keyboard navigation: ArrowRight, ArrowLeft, Home, End (with wrapping)
- `tabIndex` management: active=0, inactive=-1
- Calls `onTabChange` on click and keyboard
- Renders icons when provided, omits when not
- Applies `className` to container
- Renders `size="sm"` with compact styling

### Consumer tests

- Existing tests should pass without modification (mobile path unchanged for CommunityHealthDashboard)
- CommunityHealthDashboard desktop tests may need minor ID updates if tab IDs include layoutId prefix
