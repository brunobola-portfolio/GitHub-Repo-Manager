# Pixel-Perfect Layout Consistency & Responsive Spacing

**Date:** 2026-03-18
**Status:** Approved

## Summary

Improve visual consistency across the entire app layout: unify header group styling, align sidebars perfectly with the center content (top and bottom), and make all spacing dynamic and responsive across breakpoints.

## Problems

1. **Header groups inconsistent** — The left (logo), center (nav tabs), and right (actions) groups use different padding, icon sizes, border-radius, and container styles. The right side has grouped icon buttons but the left logo has no container, and the center nav uses a different background treatment.

2. **Sidebar scroll misalignment** — The left and right `CollapsiblePanel` components use `sticky` positioning with `top: var(--header-height)`, but the RepoList toolbar uses `top: calc(var(--header-height) + 0.5rem)`. This creates a visual gap where sidebars start at a different vertical position than the center content.

3. **Bottom alignment missing** — Sidebars have `maxHeight: calc(100vh - var(--header-height) - 1rem)` but this doesn't account for the main content's padding, causing inconsistent bottom edges.

4. **Static spacing** — Gaps and padding don't scale across breakpoints, feeling too tight on mobile and not spacious enough on desktop.

## Design

### 1. Header Unification

**Goal:** All 3 header groups share identical visual container tokens.

**Shared container tokens:**
- Background: `bg-slate-100 dark:bg-slate-950`
- Border: `border border-slate-200/50 dark:border-slate-700/50`
- Border-radius: `rounded-[14px]`
- Padding: `p-[5px]`
- Icon size: `w-4 h-4` (16px — stays on Tailwind's spacing scale, consistent with the rest of the app)
- Icon button size: `w-9 h-9 rounded-[10px]` (36px — matches accessible touch target when combined with container padding)

**Left group (logo):**
- Wrap the Git icon + "Repo Manager" text in a container div with the shared tokens
- Container padding: `p-[5px] pr-2.5` (extra right padding for text breathing room)
- Git icon inner padding: `p-2.5` with `rounded-[10px]`
- Git icon SVG size: `w-5 h-5` (20px — slightly larger as brand mark)

**Center group (nav tabs):**
- Change from `bg-slate-100/80 dark:bg-slate-700/60 p-1 rounded-xl` to shared container tokens
- Active tab: `bg-white dark:bg-slate-600` with `rounded-[10px]` and `shadow-sm`
- Tab padding: `px-4 py-2`
- Tab icon size: `w-4 h-4`

**Right group (actions):**
- Split into 2 sub-containers with shared tokens:
  - Quick actions group: Plus, Download, Wand2 icon buttons
  - Utility group: Theme toggle, Sync, Notifications, User avatar
- Each icon button: `w-9 h-9 rounded-[10px]` — use plain `<button>` elements instead of `<Button>` component to avoid min-h/min-w 44px constraints (the container padding provides sufficient touch area)
- Icon size inside buttons: `w-4 h-4`

**ThemeToggleButton:**
- Replace the current pill shape (`rounded-full` with text label) with the shared container style
- Active state (dark/light) shown via filled background: `bg-white dark:bg-slate-600 rounded-[10px]`
- Keep the text label on `sm:` screens, icon-only on mobile
- Button sizing: same `w-9 h-9` when icon-only, auto width when showing label

**Header height:**
- Desktop: Change from `h-14` (56px) to `h-16` (64px), update `--header-height: 4rem`
- Mobile (<640px): Change from `3rem` to `3.5rem` (slightly more breathing room)

**Header horizontal padding (same as main for alignment):**
- `px-3 sm:px-5 lg:px-6 xl:px-8` (unchanged from current — keeps header and main aligned)

### 2. Sidebar Alignment (Top & Bottom)

**Goal:** Left sidebar, center content, and right sidebar share the same top and bottom edges at all scroll positions.

**How it works:**
- All three panels are already inside the same flex container (`flex gap-3 lg:gap-4 min-h-0`). The flex layout naturally aligns them.
- The sidebars use `sticky` with `top: var(--header-height)`. The issue is `maxHeight` not accounting for main padding.

**Changes to `CollapsiblePanel`:**
- Use CSS custom property for main padding: `--layout-py` (defined in `:root` via `@media` queries in `index.css`)
- `top: calc(var(--header-height) + var(--layout-py))`
- `maxHeight: calc(100vh - var(--header-height) - 2 * var(--layout-py))`
- This ensures the sidebar's top edge aligns with the content area's top, and the bottom edge aligns with the viewport bottom minus the same padding.

**Changes to RepoList toolbar:**
- Update sticky top to use the same formula: `top: calc(var(--header-height) + var(--layout-py))`
- This ensures toolbar and sidebars share the exact same sticky top position.

**Changes to org overlay panel (App.jsx):**
- The `orgOverlayOpen` overlay panel also uses `top: var(--header-height)` and the same `maxHeight` formula
- Update to use `--layout-py` for consistency: `top: calc(var(--header-height) + var(--layout-py))` and `maxHeight: calc(100vh - var(--header-height) - 2 * var(--layout-py))`

**New CSS variable `--layout-py` in `src/index.css` (via `@media` queries, same pattern as `--header-height`):**
```css
:root {
  --layout-py: 0.75rem;   /* 12px - default/mobile */
}
@media (min-width: 768px) {
  :root {
    --layout-py: 1rem;     /* 16px */
  }
}
@media (min-width: 1024px) {
  :root {
    --layout-py: 1.25rem;  /* 20px */
  }
}
```

### 3. Responsive Spacing Tokens

**Goal:** All spacing scales dynamically across breakpoints.

**Horizontal padding (header + main — identical for alignment):**
| Breakpoint | Value | Class |
|---|---|---|
| default | 12px | `px-3` |
| sm (640px) | 20px | `px-5` |
| lg (1024px) | 24px | `px-6` |
| xl (1280px) | 32px | `px-8` |

**Gap between panels:**
| Breakpoint | Value | Class |
|---|---|---|
| default | 8px | `gap-2` |
| md (768px) | 12px | `gap-3` |
| lg (1024px) | 16px | `gap-4` |

**Vertical padding (main content) — driven by `--layout-py`:**
| Breakpoint | `--layout-py` | Tailwind class |
|---|---|---|
| default | 0.75rem (12px) | `py-3` |
| md (768px) | 1rem (16px) | `py-4` |
| lg (1024px) | 1.25rem (20px) | `py-5` |

The `<main>` element uses responsive Tailwind classes (`py-3 md:py-4 lg:py-5`) that match the `--layout-py` values. The CSS variable is used by `CollapsiblePanel` and `RepoList` for sticky positioning formulas; the Tailwind classes provide the actual padding on `<main>`.

**Bottom padding (mobile):**
- Mobile bottom padding remains `pb-20 md:pb-6` to account for the fixed bottom navigation bar (`--bottom-nav-height: 4rem` on mobile). This is separate from `--layout-py` because the bottom nav only exists on mobile.

### 4. Responsive Layout Behavior

**Mobile (<640px):**
- Sidebars hidden completely (mode `drawer`)
- Single column content
- Bottom navigation visible (`--bottom-nav-height: 4rem`)
- Header shows: hamburger menu + logo (compact) + avatar
- Header height: `3.5rem`

**Tablet (640-1023px):**
- Slim sidebars (60px)
- 2-column card grid
- Header shows: logo container + compact nav + compact actions

**Desktop (≥1024px):**
- Full expanded or slim sidebars (user toggleable)
- 3+ column card grid
- Header shows: all 3 groups with full containers
- Header height: `4rem`

## Files to Modify

1. **`src/index.css`** — Update `--header-height` (default: `4rem`, mobile: `3.5rem`), add `--layout-py` custom property via `@media` queries
2. **`src/components/Header.jsx`** — Restructure header into 3 container groups with shared tokens, replace `ThemeToggleButton` pill with container style, change icon buttons from `<Button>` to plain `<button>`, adjust header height to `h-16`
3. **`src/components/ui/CollapsiblePanel.jsx`** — Update `top` and `maxHeight` to use `--layout-py`
4. **`src/components/RepoList.jsx`** — Update toolbar sticky `top` to use `--layout-py`
5. **`src/App.jsx`** — Update main element padding classes (`py-3 md:py-4 lg:py-5`), update panel gap classes (`gap-2 md:gap-3 lg:gap-4`), update org overlay panel to use `--layout-py`

## Out of Scope

- Sidebar content changes (OrgPanel, Sidebar, SlimSidebar internal layouts)
- Color scheme or theme changes beyond header container tokens
- New features or functionality
- Mobile bottom navigation layout changes
- Button component refactoring (icon buttons in header will bypass `<Button>` component directly)
