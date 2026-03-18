# Responsive Layout Redesign — Collapsible Symmetry

**Date:** 2026-03-18
**Status:** Draft
**Scope:** Layout alignment, responsive sidebars, adaptive grid, mobile navigation

## Problem

The current layout has several alignment and responsiveness issues:

1. Sidebars use hardcoded `w-80` (320px) — don't adapt to intermediate screens
2. Repo grid only shifts at 2 breakpoints (768px, 1800px) — large gap with no adaptation
3. OrgPanel disappears entirely below 1024px (`hidden lg:block`) with no accessible alternative
4. Sidebar disappears below 1280px (`hidden xl:block`) — different threshold than OrgPanel, creating asymmetry
5. Sticky positioning uses hardcoded pixel offsets (`top-20`, `top-[108px]`) that break across breakpoints
6. No tablet-specific optimizations (768-1024px) — layout jumps from mobile to desktop
7. Fixed `max-w-[1920px]` container (in both App.jsx and Header.jsx) wastes space on ultrawide, constrains on laptop

**Intentional behavior change:** Currently OrgPanel appears at `lg` (1024px) and Sidebar at `xl` (1280px). This redesign unifies both panels to appear in slim mode at `md` (768px) and expand at `xl` (1280px). Users on tablets (768-1279px) who currently see no sidebars will now see slim icon sidebars on both sides.

## Design

### Approach: Collapsible Symmetry

Both sidebars transition through 3 states based on viewport width, with the center grid auto-filling available space. The layout is symmetric — both panels follow the same collapse pattern.

### Breakpoint Strategy

| Breakpoint | OrgPanel (Left) | Center Grid | Sidebar (Right) | Header |
|---|---|---|---|---|
| **Mobile** (<768px) | Drawer (hamburger) | 1 col, full-width | Drawer (FAB) | Slim top + bottom nav |
| **Tablet** (768-1023px) | Slim 60px (icons) | Auto-fill ~1-2 cols | Slim 60px (icons) | Full header |
| **Laptop** (1024-1279px) | Slim 60px (icons) | Auto-fill ~2-3 cols | Slim 60px (icons) | Full header |
| **Desktop** (1280px+) | Expanded 280px | Auto-fill ~2-4 cols | Expanded 280px | Full header |

### 1. Layout System

**Container:**
- Remove hardcoded `max-w-[1920px]` from both `App.jsx` and `Header.jsx`
- Use `max-w-screen-2xl` (1536px) with responsive horizontal padding for main content
- Header remains full-bleed (background spans full width), but inner content constrained to same max-width
- On ultrawide, content breathes without stretching indefinitely

**Main flex layout (App.jsx):**
- 3-column flex with dynamic sidebar widths
- Sidebars transition width with `transition-[width] duration-300 ease-in-out`
- Center column uses `flex-1 min-w-0` (prevents flex overflow)

**New hook — `useResponsiveLayout.js`:**
```js
// Returns reactive layout state based on viewport width
{ leftMode, rightMode, toggleLeft, toggleRight }
// leftMode/rightMode: "expanded" | "slim" | "drawer"
```
- Uses `window.matchMedia` listeners for breakpoints
- Provides manual toggle overrides (user can expand/collapse at any time)
- **Toggle preferences persist in `localStorage`** (`repo-manager-layout-prefs`). When viewport crosses a breakpoint boundary (e.g., resize from desktop to tablet), the breakpoint-determined mode takes precedence. Persisted preference only applies within the same breakpoint range.
- **Initial render default:** defaults to `"expanded"` on desktop, `"slim"` on tablet/laptop, `"drawer"` on mobile — based on `window.innerWidth` check in an initializer function (not in effect). This prevents layout flash on first render. Uses `useLayoutEffect` for the matchMedia listener setup.
- Safe under React 19 StrictMode (double-mount): matchMedia listeners are cleaned up in the effect return, re-attached on re-mount.
- Memoized to prevent unnecessary re-renders

### 2. Sidebar Collapse System

#### OrgPanel (Left) — 3 States

**Expanded (280px) — Desktop 1280px+:**
- Current layout preserved: avatar, name, counter badges, search, org list
- Width reduced from 320px → 280px for more center space
- User profile footer maintained

**Slim (60px) — Tablet/Laptop 768-1279px:**
- Org avatars stacked vertically (40px each)
- Selected org has colored left border (accent)
- Tooltip on hover: org name + repo/member counts
- Click on an org avatar selects it (same as current click behavior)
- "All Orgs" icon at top, user profile icon at bottom
- **Expand overlay:** A dedicated expand/chevron button at the top of the slim bar opens the full OrgPanel as an overlay:
  - Overlay uses `z-30` (above grid content `z-10`, below modals `z-40`)
  - Semi-transparent backdrop scrim (`bg-black/20`) behind overlay, click to dismiss
  - Escape key also dismisses
  - Animate in with Framer Motion `animate={{ x: 0 }}` from `initial={{ x: -280 }}`
  - If viewport resizes to desktop (1280px+) while overlay is open, overlay closes and panel switches to expanded mode
  - Uses a dedicated overlay div, not `MobileDrawer` (which is for <768px only)
- **Accessibility:**
  - All slim icon buttons have `aria-label` (e.g., "All Organizations", org name)
  - Expand button: `aria-label="Expand organization panel"`, `aria-expanded` state
  - Keyboard: Enter/Space activates icon buttons and expand

**Drawer (<768px):**
- Reuses existing `MobileDrawer` component
- Triggered by hamburger icon in mobile header

#### Sidebar (Right) — 3 States

**Expanded (280px) — Desktop 1280px+:**
- Current layout preserved: Quick Actions, Action History, Recent Activity
- Width reduced from 320px → 280px

**Slim (60px) — Tablet/Laptop 768-1279px:**
- Icon buttons stacked vertically:
  - ⚡ Quick Actions → opens floating popover with action grid
  - 📋 Action History → opens popover with scrollable list
  - 🕐 Recent Activity → opens popover with activity feed
  - ⬇️ Import Repository → accent highlight, opens import flow
- Popovers positioned to the left of icons with arrow
- Click outside or Escape closes popover
- **Accessibility:**
  - All icon buttons have `aria-label` (e.g., "Quick Actions", "Action History")
  - `aria-haspopup="true"` and `aria-expanded` on popover triggers
  - Keyboard: Enter/Space opens popover, Escape closes, Tab navigates within popover
  - Focus returns to trigger button when popover closes

**Drawer (<768px):**
- Existing FAB + `MobileDrawer` behavior preserved

#### CollapsiblePanel Component

New reusable wrapper: `src/components/ui/CollapsiblePanel.jsx`

Props:
- `side`: "left" | "right"
- `mode`: "expanded" | "slim" | "drawer"
- `expandedWidth`: number (default 280)
- `slimWidth`: number (default 60)
- `children`: expanded content
- `slimContent`: React node for slim icons
- `onToggle`: callback

Handles:
- Width transitions with `transition-[width] duration-300 ease-in-out`
- **Transition overflow strategy:** Uses `overflow-hidden` only on the outer wrapper during the transition (detected via `transitionstart`/`transitionend` events). Inner scrollable areas preserve their scroll position because they remain mounted and untouched — only the outer clip changes. After transition completes, overflow returns to `visible` (for slim popovers) or `auto` (for expanded scroll).
- Sticky positioning with `top: var(--header-height)`

### 3. Grid & Cards

#### Responsive Grid

Replace fixed grid columns with auto-fill:

```css
grid-template-columns: repeat(auto-fill, minmax(var(--card-min-width), 1fr));
```

**Note:** `--card-min-width` is a layout token, not a design-system token. It lives in `:root` in `index.css` alongside existing layout variables like safe-area insets. It does NOT use the `ds-*` prefix (reserved for design-system visual tokens in `design-system.css`).

`--card-min-width` varies by breakpoint:

| Breakpoint | --card-min-width | Typical columns |
|---|---|---|
| Mobile (<640px) | 100% (forced 1 col) | 1 |
| sm (640-767px) | 280px | 1-2 |
| md (768px+) | 300px | 2+ |
| xl (1280px+) | 320px | 2-3 |
| 2xl (1536px+) | 320px | 3-4 |

The browser automatically calculates columns — when sidebars collapse, center space grows and grid adapts without manual breakpoints.

**The existing custom `--breakpoint-3xl: 1800px`** in `index.css` becomes unused by the grid since auto-fill replaces fixed column breakpoints. Remove the `3xl` breakpoint definition and any `3xl:` utility usage (currently only `3xl:grid-cols-3` in RepoList.jsx). If other components use `3xl:` in the future it can be re-added.

#### Adaptive Cards (Progressive Disclosure)

**Mobile (<640px) — Compact card:**
- Reduced padding: `p-3`
- Name + org + language badge (text only, no color dot)
- Description: max 1 line, truncated
- Stars + forks inline

**Tablet/Laptop (640-1279px) — Standard card:**
- Current layout maintained
- Language color dot + name
- Description: max 2 lines
- Standard padding: `p-4`

**Desktop (1280px+) — Expanded card:**
- Description: up to 3 lines
- Additional subtle line: relative time of last push (`text-xs text-slate-500 dark:text-slate-400`)
- Generous padding: `p-5`

#### List View

- Mobile: vertical stack (name + org on top, stats below)
- Desktop: horizontal with all fields in one row (current behavior)

#### Toolbar Alignment

- Stack breakpoint adjusted from `lg` to `md` (horizontal earlier)
- Search bar uses `flex-1` instead of fixed width
- View mode buttons (grid/list) + type filter grouped with consistent `gap-2`
- Range slider aligned to the right
- **Sticky offset fix:** toolbar currently uses hardcoded `top-[108px] lg:top-16`. Replace with `top: calc(var(--header-height) + 0.5rem)` to stay aligned regardless of header height changes. The extra `0.5rem` accounts for visual breathing room below the header.

### 4. Header & Mobile Navigation

#### Desktop Header (768px+)

Compact and clean:

```
┌──────────────────────────────────────────────────────────────────┐
│  🐙 Repo Manager    │ Dashboard  Repositories  Teams │  + ⬇ ✨ 🔄 🔔  🌙  👤 │
└──────────────────────────────────────────────────────────────────┘
```

- Height: `h-14` (56px) — more compact
- Nav tabs centered with `gap-1`, active state with animated underline (Framer Motion `layoutId`)
- Action icons grouped with subtle visual separator between groups
- Responsive padding maintained: `px-5 sm:px-8 lg:px-12 xl:px-16`
- Inner content constrained to `max-w-screen-2xl`, background full-bleed

#### Mobile Header (<768px)

**Top bar (slim):**
```
┌────────────────────────────────┐
│  ☰  🐙 Repo Manager     🔔 👤 │
└────────────────────────────────┘
```
- Hamburger opens OrgPanel drawer
- Height: `h-12` (48px)
- Only logo, notifications, avatar

**Bottom nav bar (fixed):**
```
┌────────────────────────────────┐
│  📊       📦       👥      ✨  │
│ Dashboard  Repos   Teams    AI │
└────────────────────────────────┘
```
- `fixed bottom-0` with `safe-area-inset-bottom`
- Icons + small labels (`text-xs`)
- Active state: filled icon + accent color
- Glass background: `backdrop-blur-xl bg-white/80 dark:bg-slate-900/80` (respects both light and dark mode, uses `slate-*` consistent with the codebase)
- Replaces current secondary nav bar below header (saves vertical space)
- Main content gets `pb-16 md:pb-0` to avoid being covered on mobile only
- Touch targets: min 44x44px per nav item

#### Nav Transition

- Bottom nav: visible with `md:hidden`
- Inline header nav: visible with `hidden md:flex`
- No duplicate navigation — single source of truth per breakpoint

#### Sticky Positioning Fix

CSS custom properties for consistent heights:

```css
:root {
  --header-height: 3.5rem;
  --bottom-nav-height: 0px;
}
@media (max-width: 767px) {
  :root {
    --header-height: 3rem;
    --bottom-nav-height: 4rem;
  }
}
```

All sticky elements use `top: var(--header-height)` — never hardcoded pixel offsets. The toolbar in RepoList uses `top: calc(var(--header-height) + 0.5rem)`.

**Note:** These are layout tokens in `:root`, not `ds-*` design-system tokens. They live alongside existing safe-area custom properties in `index.css`.

## Accessibility

This section summarizes accessibility requirements for new interaction patterns:

- **Slim sidebar icon buttons:** All require `aria-label` with descriptive text
- **Popover triggers:** `aria-haspopup="true"`, `aria-expanded` state tracking
- **Keyboard navigation:** Enter/Space to activate buttons and open popovers, Escape to dismiss, Tab to navigate within popovers
- **Focus management:** Focus moves into popover/overlay on open, returns to trigger on close
- **Panel state changes:** `aria-expanded` on collapse/expand toggles
- **Bottom nav bar:** `role="navigation"`, `aria-label="Main navigation"`, active item uses `aria-current="page"`
- **Existing patterns maintained:** Skip links and ARIA roles already in App.jsx remain unchanged

## Files Changed

### New Files
| File | Purpose |
|---|---|
| `src/components/ui/CollapsiblePanel.jsx` | Reusable collapsible sidebar wrapper |
| `src/hooks/useResponsiveLayout.js` | Reactive layout state management with localStorage persistence |

### Modified Files
| File | Changes |
|---|---|
| `src/App.jsx` | Flex layout with CollapsiblePanel, remove secondary nav, remove `max-w-[1920px]`, responsive padding |
| `src/components/Header.jsx` | Slim header, bottom nav bar for mobile, remove `max-w-[1920px]` (keep full-bleed bg), CSS var heights |
| `src/components/RepoList.jsx` | Auto-fill grid, adaptive cards, toolbar alignment, replace `top-[108px]` with CSS var, remove `3xl:grid-cols-3` |
| `src/components/Sidebar.jsx` | Add slim content (icons + popovers with ARIA) |
| `src/index.css` | CSS custom properties (--header-height, --card-min-width, --bottom-nav-height), remove `--breakpoint-3xl` |

## Testing Strategy

- Resize browser from 360px to 2560px — verify smooth transitions at each breakpoint
- Test sidebar collapse/expand animation smoothness (no scroll position loss)
- Verify grid reflows correctly when sidebars change state
- Test mobile bottom nav touch targets (min 44px) in both light and dark mode
- Verify sticky toolbar stays aligned at all breakpoints (no hardcoded offset remnants)
- Test OrgPanel slim mode: hover tooltips, click to select org, expand overlay with backdrop
- Test OrgPanel overlay: dismiss via click-outside, Escape, and viewport resize to desktop
- Test Sidebar slim mode: popover positioning and dismiss behavior
- Test drawer behavior on mobile for both panels
- Verify no horizontal scroll at any viewport width
- **Accessibility:** Tab through slim sidebar icons, verify ARIA labels with screen reader, test popover keyboard flow
- **Persistence:** Collapse a sidebar on desktop, reload — verify it stays collapsed. Resize to tablet — verify breakpoint mode overrides. Resize back to desktop — verify persisted preference restores.

## Out of Scope

- Card content changes beyond progressive disclosure (no new data fields beyond last-push timestamp)
- Sidebar content redesign (only collapse behavior)
- Color/theme changes
- New features or functionality
- Swipe gestures for drawers (MobileDrawer currently doesn't support swipe — this is a separate enhancement)
