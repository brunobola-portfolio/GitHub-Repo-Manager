# Responsive Layout Redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 3-panel layout responsive across all screen sizes with collapsible sidebars, auto-fill grid, and native mobile navigation.

**Architecture:** Both sidebars collapse from expanded (280px) → slim icons (60px) → drawer (mobile) based on viewport width. A new `useResponsiveLayout` hook manages state with `matchMedia`. The repo grid uses CSS `auto-fill` to adapt automatically. Mobile gets a bottom nav bar replacing the secondary nav.

**Tech Stack:** React 19, Tailwind CSS v4, Framer Motion, CSS custom properties

**Spec:** `docs/specs/2026-03-18-responsive-layout-redesign.md`

---

## File Structure

### New Files

| File | Responsibility |
| --- | --- |
| `src/hooks/useResponsiveLayout.js` | Reactive layout state (expanded/slim/drawer) based on viewport width, localStorage persistence, matchMedia listeners |
| `src/components/ui/CollapsiblePanel.jsx` | Reusable wrapper that handles width transitions, overflow management, sticky positioning for both sidebars |

### Modified Files

| File | Key Changes |
| --- | --- |
| `src/index.css` | Add `--header-height`, `--bottom-nav-height`, `--card-min-width` layout tokens to existing `:root` block; remove `--breakpoint-3xl` |
| `src/components/Header.jsx` | Compact `h-14` desktop header; replace mobile secondary nav with fixed bottom nav bar; remove `max-w-[1920px]` inner constraint; add `onToggleOrgDrawer` prop |
| `src/components/Sidebar.jsx` | Add `SlimSidebar` named export with icon buttons + popovers for slim mode |
| `src/components/RepoList.jsx` | Auto-fill grid replacing fixed columns; adaptive card sizing; toolbar sticky fix; remove `3xl:` usage |
| `src/components/OrgPanel.jsx` | Remove hardcoded `w-80` from root div (width now controlled by CollapsiblePanel) |
| `src/components/MobileDrawer.jsx` | Add `side` prop for left/right slide direction |
| `src/App.jsx` | Integrate `useResponsiveLayout` + `CollapsiblePanel`; OrgPanel slim mode with avatars + expand overlay; remove `max-w-[1920px]`; add OrgPanel mobile drawer |

---

## Task 1: CSS Custom Properties

**Files:**

- Modify: `src/index.css` (lines 4-6 for `@theme` block, lines 12-17 for existing `:root`)

- [ ] **Step 1: Add layout CSS custom properties to existing `:root` block**

In `src/index.css`, find the existing `:root` block (line ~12) that contains safe-area inset variables. Add the layout tokens to that same block:

```css
:root {
  /* existing safe-area variables stay here */
  --safe-area-inset-top: env(safe-area-inset-top, 0px);
  --safe-area-inset-right: env(safe-area-inset-right, 0px);
  --safe-area-inset-bottom: env(safe-area-inset-bottom, 0px);
  --safe-area-inset-left: env(safe-area-inset-left, 0px);

  /* Layout tokens (not ds-* design tokens — these are layout concerns) */
  --header-height: 3.5rem;
  --bottom-nav-height: 0px;
  --card-min-width: 300px;
}

@media (max-width: 639px) {
  :root {
    --header-height: 3rem;
    --bottom-nav-height: 4rem;
    --card-min-width: 100%;
  }
}

@media (min-width: 640px) and (max-width: 767px) {
  :root {
    --card-min-width: 280px;
  }
}

@media (min-width: 1280px) {
  :root {
    --card-min-width: 320px;
  }
}
```

Note: The mobile breakpoint uses `max-width: 639px` (not 767px) so there's no overlap with the 640-767px range.

- [ ] **Step 2: Remove the 3xl custom breakpoint**

In the `@theme` block (line ~5), delete the line:
```
--breakpoint-3xl: 1800px;
```

- [ ] **Step 3: Verify dev server starts**

Run: `npm run dev`

Expected: Vite dev server starts without CSS errors. Open browser at localhost:5173 — app loads normally.

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "refactor(css): add layout custom properties, remove 3xl breakpoint"
```

---

## Task 2: useResponsiveLayout Hook

**Files:**

- Create: `src/hooks/useResponsiveLayout.js`

- [ ] **Step 1: Create the hook file**

```js
import { useState, useLayoutEffect, useCallback, useRef } from 'react'

const STORAGE_KEY = 'repo-manager-layout-prefs'
const BREAKPOINTS = {
  md: 768,
  xl: 1280,
}

function getDefaultMode(width) {
  if (width < BREAKPOINTS.md) return 'drawer'
  if (width < BREAKPOINTS.xl) return 'slim'
  return 'expanded'
}

function loadPrefs() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // localStorage unavailable
  }
}

export function useResponsiveLayout() {
  const initialWidth = typeof window !== 'undefined' ? window.innerWidth : 1280
  const initialMode = getDefaultMode(initialWidth)

  const [breakpointMode, setBreakpointMode] = useState(initialMode)
  const [overrides, setOverrides] = useState(() => loadPrefs())
  const prevBreakpointMode = useRef(initialMode)

  useLayoutEffect(() => {
    const mqMd = window.matchMedia(`(min-width: ${BREAKPOINTS.md}px)`)
    const mqXl = window.matchMedia(`(min-width: ${BREAKPOINTS.xl}px)`)

    function update() {
      const width = window.innerWidth
      const mode = getDefaultMode(width)
      setBreakpointMode(prev => {
        if (prev !== mode) {
          prevBreakpointMode.current = prev
        }
        return mode
      })
    }

    update()
    mqMd.addEventListener('change', update)
    mqXl.addEventListener('change', update)

    return () => {
      mqMd.removeEventListener('change', update)
      mqXl.removeEventListener('change', update)
    }
  }, [])

  // Overrides only apply within the expanded breakpoint range
  const leftMode = overrides.left && breakpointMode === 'expanded'
    ? overrides.left
    : breakpointMode

  const rightMode = overrides.right && breakpointMode === 'expanded'
    ? overrides.right
    : breakpointMode

  const toggleLeft = useCallback(() => {
    setOverrides(prev => {
      const current = prev.left || breakpointMode
      const next = current === 'expanded' ? 'slim' : 'expanded'
      const updated = { ...prev, left: next }
      savePrefs(updated)
      return updated
    })
  }, [breakpointMode])

  const toggleRight = useCallback(() => {
    setOverrides(prev => {
      const current = prev.right || breakpointMode
      const next = current === 'expanded' ? 'slim' : 'expanded'
      const updated = { ...prev, right: next }
      savePrefs(updated)
      return updated
    })
  }, [breakpointMode])

  return { leftMode, rightMode, breakpointMode, toggleLeft, toggleRight }
}
```

- [ ] **Step 2: Verify no import errors**

Run: `npm run dev`

Expected: Dev server runs. The hook isn't used yet so no visible change, but no build errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useResponsiveLayout.js
git commit -m "feat(hooks): add useResponsiveLayout for collapsible sidebar state"
```

---

## Task 3: CollapsiblePanel Component

**Files:**

- Create: `src/components/ui/CollapsiblePanel.jsx`

- [ ] **Step 1: Create the component**

Note: `onTransitionStart` is NOT a standard React synthetic event. We must use a ref-based `addEventListener` for `transitionstart`, while `onTransitionEnd` IS a valid React event.

```jsx
import { useState, useRef, useEffect, useCallback } from 'react'

export default function CollapsiblePanel({
  side = 'left',
  mode = 'expanded',
  expandedWidth = 280,
  slimWidth = 60,
  children,
  slimContent,
  className = '',
}) {
  const [isTransitioning, setIsTransitioning] = useState(false)
  const panelRef = useRef(null)

  // onTransitionStart is not a React synthetic event — use native listener via ref
  useEffect(() => {
    const el = panelRef.current
    if (!el) return

    const handleStart = (e) => {
      if (e.propertyName === 'width') setIsTransitioning(true)
    }
    el.addEventListener('transitionstart', handleStart)
    return () => el.removeEventListener('transitionstart', handleStart)
  }, [])

  const handleTransitionEnd = useCallback((e) => {
    if (e.propertyName === 'width') setIsTransitioning(false)
  }, [])

  if (mode === 'drawer') {
    return null
  }

  const width = mode === 'expanded' ? expandedWidth : slimWidth
  const overflowClass = isTransitioning
    ? 'overflow-hidden'
    : mode === 'slim'
      ? 'overflow-visible'
      : 'overflow-y-auto custom-scrollbar'

  return (
    <div
      ref={panelRef}
      className={`flex-shrink-0 sticky transition-[width] duration-300 ease-in-out ${overflowClass} ${className}`}
      style={{
        width: `${width}px`,
        top: 'var(--header-height)',
        maxHeight: 'calc(100vh - var(--header-height) - 1rem)',
      }}
      onTransitionEnd={handleTransitionEnd}
    >
      {mode === 'expanded' && (
        <div className="h-full overflow-y-auto custom-scrollbar">
          {children}
        </div>
      )}
      {mode === 'slim' && (
        <div className="h-full flex flex-col items-center py-3 gap-2">
          {slimContent}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify no build errors**

Run: `npm run dev`

Expected: Dev server runs. Component isn't used yet, no visible change.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/CollapsiblePanel.jsx
git commit -m "feat(ui): add CollapsiblePanel component for collapsible sidebars"
```

---

## Task 4: MobileDrawer Left-Side Support

**Files:**

- Modify: `src/components/MobileDrawer.jsx`

- [ ] **Step 1: Read the current MobileDrawer.jsx**

Read `src/components/MobileDrawer.jsx` fully. Current structure:
- Backdrop: `fixed inset-0 bg-black/60 z-50`
- Drawer panel: `fixed right-0 top-0 bottom-0 w-80 max-w-[90vw]`
- Animation: `initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}`

- [ ] **Step 2: Add `side` prop with left/right support**

Update the component to accept a `side` prop (default `'right'`):

```jsx
export function MobileDrawer({ isOpen, onClose, children, side = 'right' }) {
```

Then update the motion.div for the drawer panel:

```jsx
const isLeft = side === 'left'
```

Change the motion.div props:
- `initial={{ x: isLeft ? '-100%' : '100%' }}`
- `animate={{ x: 0 }}`
- `exit={{ x: isLeft ? '-100%' : '100%' }}`
- className position: replace `right-0` with `${isLeft ? 'left-0' : 'right-0'}`

- [ ] **Step 3: Verify drawer still works**

Run: `npm run dev`

Expected: The existing Sidebar drawer (right-side) still opens/closes correctly. No visible change yet since no left drawer is used.

- [ ] **Step 4: Commit**

```bash
git add src/components/MobileDrawer.jsx
git commit -m "feat(drawer): add side prop for left/right slide direction"
```

---

## Task 5: Header Redesign

**Files:**

- Modify: `src/components/Header.jsx`

Current Header props (line 11-28): `user, isMockMode, onLogin, onLogout, onCheck, onCreateRepo, activeView, onViewChange, onRefreshOrgs, orgs, syncStatus, onReauthorize, onOpenOrgManager, onOpenCommitGen, onOpenSettings, onImport, onMigrationHistory`

- [ ] **Step 1: Read the current Header.jsx**

Read `src/components/Header.jsx` fully.

- [ ] **Step 2: Add `onToggleOrgDrawer` prop**

Add to the destructured props (line ~28, after `onMigrationHistory`):
```jsx
onToggleOrgDrawer
```

- [ ] **Step 3: Update header container height and max-width**

Find the inner container div (line ~58) that has `max-w-[1920px]` and `h-16`.

Change `h-16` to `h-14` and replace `max-w-[1920px]` with `max-w-screen-2xl`.

- [ ] **Step 4: Add hamburger button for mobile OrgPanel drawer**

In the left section of the header (line ~60), before the logo icon, add a hamburger button visible only on mobile. `Menu` is already imported in the codebase (used by the FAB in App.jsx), but check if Header.jsx imports it — if not, add it to the lucide-react import.

```jsx
{user && (
  <button
    onClick={onToggleOrgDrawer}
    className="md:hidden p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
    aria-label="Open organizations"
  >
    <Menu className="w-5 h-5 text-slate-600 dark:text-slate-300" />
  </button>
)}
```

- [ ] **Step 5: Change desktop nav visibility breakpoint**

Find the desktop navigation section (line ~79) with `hidden lg:flex`. Change to `hidden md:flex`.

- [ ] **Step 6: Replace mobile secondary nav with bottom nav bar**

Find the mobile nav bar section (lines 241-262) — the `<nav>` with `flex lg:hidden`. Replace the entire block (including the `{user && (` wrapper) with:

```jsx
{user && (
  <nav
    className="fixed bottom-0 left-0 right-0 z-40 md:hidden backdrop-blur-xl bg-white/80 dark:bg-slate-900/80 border-t border-slate-200/60 dark:border-slate-700/50"
    role="navigation"
    aria-label="Main navigation"
    style={{ paddingBottom: 'var(--safe-area-inset-bottom, 0px)' }}
  >
    <div className="flex items-center justify-around h-14 px-4">
      {[
        { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
        { id: 'repos', icon: FolderGit2, label: 'Repos' },
        { id: 'teams', icon: Users, label: 'Teams' },
        { id: 'ai', icon: Sparkles, label: 'AI' },
      ].map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          onClick={() => onViewChange?.(id === 'ai' ? 'repos' : id)}
          className={`flex flex-col items-center justify-center gap-0.5 min-w-[44px] min-h-[44px] rounded-xl transition-colors ${
            activeView === id
              ? 'text-indigo-600 dark:text-indigo-400'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
          aria-current={activeView === id ? 'page' : undefined}
        >
          <Icon className="w-5 h-5" />
          <span className="text-[10px] font-medium leading-none">{label}</span>
        </button>
      ))}
    </div>
  </nav>
)}
```

Note: Uses `FolderGit2` (not `BookOpen`) for Repos — matches the desktop nav icon for consistency. Uses `activeView` (the existing prop name) not `currentView`. All icons (`LayoutDashboard`, `FolderGit2`, `Users`, `Sparkles`) are already imported in Header.jsx (lines 3-6).

- [ ] **Step 7: Verify header changes**

Run: `npm run dev`

Expected:
- Desktop (1280px+): Header is slightly more compact (`h-14`), nav tabs visible
- Tablet (768-1279px): Header shows nav tabs (no secondary bar below)
- Mobile (<768px): Slim header with hamburger, fixed bottom nav bar with 4 items

- [ ] **Step 8: Commit**

```bash
git add src/components/Header.jsx
git commit -m "feat(header): compact h-14 header with mobile bottom nav bar"
```

---

## Task 6: Sidebar Slim Mode

**Files:**

- Modify: `src/components/Sidebar.jsx`

The main `Sidebar` is a **named export** (`export function Sidebar`). `SlimSidebar` will also be a named export in the same file.

- [ ] **Step 1: Read the current Sidebar.jsx**

Read `src/components/Sidebar.jsx` fully. Note the existing imports — `Zap`, `History`, `Clock` should already be imported. Check for `Download`.

- [ ] **Step 2: Add SlimSidebar components after imports**

After the existing import block, add the helper components and `SlimSidebar`:

```jsx
import { useState, useRef, useEffect } from 'react'

function SlimPopover({ isOpen, onClose, children, triggerRef }) {
  const popoverRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(e) {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target) &&
        triggerRef.current && !triggerRef.current.contains(e.target)
      ) {
        onClose()
      }
    }

    function handleEscape(e) {
      if (e.key === 'Escape') {
        onClose()
        // Return focus to trigger button
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)

    // Focus the popover on open
    popoverRef.current?.focus()

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, onClose, triggerRef])

  if (!isOpen) return null

  return (
    <div
      ref={popoverRef}
      tabIndex={-1}
      className="absolute right-full mr-2 top-0 w-72 max-h-80 overflow-y-auto rounded-2xl border border-slate-200/60 dark:border-slate-700/50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl shadow-xl z-40 p-3 outline-none"
    >
      {children}
    </div>
  )
}

function SlimIconButton({ icon: Icon, label, isActive, onClick, accent, buttonRef }) {
  return (
    <button
      ref={buttonRef}
      onClick={onClick}
      className={`relative w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 group ${
        accent
          ? 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-500/25'
          : isActive
            ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400'
            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-300'
      }`}
      aria-label={label}
      aria-haspopup={accent ? undefined : 'true'}
      aria-expanded={isActive || undefined}
    >
      <Icon className="w-5 h-5" />
      <span className="absolute left-full ml-3 px-2 py-1 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
        {label}
      </span>
    </button>
  )
}

export function SlimSidebar({ selectedRepos, onOpenImport }) {
  const [openPopover, setOpenPopover] = useState(null)
  const triggerRefs = {
    actions: useRef(null),
    history: useRef(null),
    activity: useRef(null),
  }

  const togglePopover = (name) => {
    setOpenPopover(prev => prev === name ? null : name)
  }

  return (
    <div className="flex flex-col items-center gap-2 py-3">
      <SlimIconButton
        icon={Zap}
        label="Quick Actions"
        isActive={openPopover === 'actions'}
        onClick={() => togglePopover('actions')}
        buttonRef={triggerRefs.actions}
      />
      <div className="relative">
        <SlimPopover
          isOpen={openPopover === 'actions'}
          onClose={() => setOpenPopover(null)}
          triggerRef={triggerRefs.actions}
        >
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Quick Actions</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {selectedRepos?.length > 0
              ? `${selectedRepos.length} repos selected`
              : 'Select repos for actions'}
          </p>
        </SlimPopover>
      </div>

      <div className="w-6 border-t border-slate-200 dark:border-slate-700/50" />

      <SlimIconButton
        icon={History}
        label="Action History"
        isActive={openPopover === 'history'}
        onClick={() => togglePopover('history')}
        buttonRef={triggerRefs.history}
      />
      <div className="relative">
        <SlimPopover
          isOpen={openPopover === 'history'}
          onClose={() => setOpenPopover(null)}
          triggerRef={triggerRefs.history}
        >
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Action History</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">No recent actions</p>
        </SlimPopover>
      </div>

      <SlimIconButton
        icon={Clock}
        label="Recent Activity"
        isActive={openPopover === 'activity'}
        onClick={() => togglePopover('activity')}
        buttonRef={triggerRefs.activity}
      />
      <div className="relative">
        <SlimPopover
          isOpen={openPopover === 'activity'}
          onClose={() => setOpenPopover(null)}
          triggerRef={triggerRefs.activity}
        >
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Recent Activity</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">No recent activity</p>
        </SlimPopover>
      </div>

      <div className="flex-1" />

      <SlimIconButton
        icon={Download}
        label="Import Repository"
        accent
        onClick={onOpenImport}
      />
    </div>
  )
}
```

Ensure `useState, useRef, useEffect` are imported from `react` at the top of the file (add to existing react import if needed). Verify `Zap`, `History`, `Clock`, `Download` are in the lucide-react import — add any missing ones.

- [ ] **Step 3: Verify no build errors**

Run: `npm run dev`

Expected: No errors. SlimSidebar isn't rendered yet.

- [ ] **Step 4: Commit**

```bash
git add src/components/Sidebar.jsx
git commit -m "feat(sidebar): add SlimSidebar with icon buttons, popovers, focus management"
```

---

## Task 7: OrgPanel Width Fix

**Files:**

- Modify: `src/components/OrgPanel.jsx` (line ~30)

- [ ] **Step 1: Read OrgPanel.jsx**

Read `src/components/OrgPanel.jsx`. Find the root div with `w-80` class (likely line ~30).

- [ ] **Step 2: Remove hardcoded `w-80`**

The root div currently has `w-80` (320px). Remove it — the width is now controlled by the `CollapsiblePanel` wrapper in App.jsx. Replace `w-80` with `w-full`:

```
Before: className="h-full flex flex-col bg-transparent w-80 transition-all duration-300"
After:  className="h-full flex flex-col bg-transparent w-full transition-all duration-300"
```

- [ ] **Step 3: Verify OrgPanel still renders**

Run: `npm run dev`

Expected: OrgPanel still displays normally at its current 320px container width (the `w-80` wrapper in App.jsx hasn't been removed yet).

- [ ] **Step 4: Commit**

```bash
git add src/components/OrgPanel.jsx
git commit -m "refactor(orgpanel): remove hardcoded w-80, width controlled by parent"
```

---

## Task 8: RepoList Grid & Cards

**Files:**

- Modify: `src/components/RepoList.jsx`

- [ ] **Step 1: Read the current RepoList.jsx**

Read `src/components/RepoList.jsx` fully before editing.

- [ ] **Step 2: Update grid layout to auto-fill**

Find the grid container (line ~398) with:
```
grid grid-cols-1 md:grid-cols-2 3xl:grid-cols-3 gap-4
```

Replace the className grid classes with just:
```
grid gap-4
```

And add an inline style:
```jsx
style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(var(--card-min-width), 100%), 1fr))' }}
```

This uses CSS `min()` to handle the mobile case where `--card-min-width` is `100%` — prevents overflow.

- [ ] **Step 3: Update card progressive disclosure**

In the RepoCard component (grid mode), find the description paragraph and make it responsive:

- Add `line-clamp-1 sm:line-clamp-2 xl:line-clamp-3` to the description
- Change card wrapper padding from `p-5` to `p-3 sm:p-4 xl:p-5`
- After the stats row (language, stars, forks), add a desktop-only last-updated line:

```jsx
{repo.pushed_at && (
  <p className="hidden xl:block text-xs text-slate-500 dark:text-slate-400 mt-2">
    Updated {new Date(repo.pushed_at).toLocaleDateString()}
  </p>
)}
```

Note: `pushed_at` is a standard GitHub API field included in repo objects. The `&&` guard handles repos where it may be null.

- [ ] **Step 4: Fix toolbar sticky positioning**

Find the toolbar sticky div (line ~175) with `sticky top-[108px] lg:top-16 z-10`.

Replace `top-[108px] lg:top-16` with an inline style:
```jsx
style={{ top: 'calc(var(--header-height) + 0.5rem)' }}
```

Keep `sticky z-10` in the className.

- [ ] **Step 5: Update toolbar flex breakpoint**

Find the toolbar inner flex with `flex flex-col lg:flex-row`. Change to `flex flex-col md:flex-row`.

- [ ] **Step 6: Verify grid behavior**

Run: `npm run dev`

Expected:
- Desktop: 2-4 columns depending on viewport width
- Tablet: 1-2 columns, auto-calculated
- Mobile: 1 column, full width
- Cards show progressive detail at different sizes
- Toolbar sticks correctly below header

- [ ] **Step 7: Commit**

```bash
git add src/components/RepoList.jsx
git commit -m "feat(repolist): auto-fill grid, adaptive cards, fixed toolbar sticky"
```

---

## Task 9: App.jsx Layout Integration

**Files:**

- Modify: `src/App.jsx`

This is the largest task — it integrates all previous work into the main layout.

- [ ] **Step 1: Read the current App.jsx**

Read `src/App.jsx` fully. Key sections:
- Lines 1-19: imports
- Lines 329-339: `sidebarProps` object
- Lines 465-511: repos view 3-panel layout
- Lines 403-419: session banner and main container
- Lines 680-698: FAB button and MobileDrawer

- [ ] **Step 2: Add imports**

At the top of App.jsx (after line 18), add:

```jsx
import { useResponsiveLayout } from './hooks/useResponsiveLayout'
import CollapsiblePanel from './components/ui/CollapsiblePanel'
import { SlimSidebar } from './components/Sidebar'
import { Building2, ChevronRight } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
```

Note: import paths use `./hooks/` and `./components/` (not `../hooks/`) because App.jsx is in `src/`. Check if `Building2`, `ChevronRight`, `motion`, or `AnimatePresence` are already imported — if so, merge into existing imports.

- [ ] **Step 3: Add state and hook**

Inside `AppContent` (line ~51), near the other hook calls, add:

```jsx
const { leftMode, rightMode, toggleLeft, toggleRight } = useResponsiveLayout()
const [orgDrawerOpen, setOrgDrawerOpen] = useState(false)
const [orgOverlayOpen, setOrgOverlayOpen] = useState(false)
```

- [ ] **Step 4: Add OrgPanel slim content with expand overlay**

Before the return statement in `AppContent`, add:

```jsx
const slimOrgContent = (
  <>
    {/* Expand overlay button */}
    <button
      onClick={() => setOrgOverlayOpen(true)}
      className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
      aria-label="Expand organization panel"
      aria-expanded={orgOverlayOpen}
    >
      <ChevronRight className="w-4 h-4" />
    </button>

    <div className="w-6 border-t border-slate-200 dark:border-slate-700/50" />

    {/* All Orgs icon */}
    <button
      onClick={() => handleOrgSelect(null)}
      className={`relative w-10 h-10 rounded-xl flex items-center justify-center transition-all group ${
        !selectedOrg
          ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 ring-2 ring-indigo-500/30'
          : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
      }`}
      aria-label="All Organizations"
    >
      <Building2 className="w-5 h-5" />
      <span className="absolute left-full ml-3 px-2 py-1 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
        All Orgs
      </span>
    </button>

    {/* Org avatars */}
    {(orgs || []).slice(0, 8).map(org => (
      <button
        key={org.login}
        onClick={() => handleOrgSelect(org.login)}
        className={`relative w-10 h-10 rounded-xl flex items-center justify-center transition-all group ${
          selectedOrg === org.login
            ? 'ring-2 ring-indigo-500/30'
            : 'hover:bg-slate-100 dark:hover:bg-slate-800'
        }`}
        aria-label={org.login}
      >
        {org.avatar_url ? (
          <img src={org.avatar_url} alt={org.login} className="w-8 h-8 rounded-lg" />
        ) : (
          <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">
            {org.login.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="absolute left-full ml-3 px-2 py-1 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
          {org.login}
        </span>
        {selectedOrg === org.login && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-1 h-5 rounded-full bg-indigo-500" />
        )}
      </button>
    ))}

    <div className="flex-1" />

    {/* User avatar */}
    {user && (
      <button
        className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group"
        aria-label={user.login}
      >
        <img src={user.avatar_url} alt={user.login} className="w-8 h-8 rounded-lg" />
        <span className="absolute left-full ml-3 px-2 py-1 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
          {user.login}
        </span>
      </button>
    )}
  </>
)
```

Note: uses `orgs` (not `organizations`) — this is the variable name from `useGitHub` as used in the current App.jsx.

- [ ] **Step 5: Replace the 3-panel layout**

Find the repos view (lines 465-511). Replace the entire block from `<div className="flex flex-col lg:flex-row gap-8 min-h-0">` through its closing `</div>` (line 510) with:

```jsx
<div className="flex gap-4 lg:gap-6 min-h-0">
  {/* Left Panel - OrgPanel */}
  {user && (
    <CollapsiblePanel
      side="left"
      mode={leftMode}
      expandedWidth={280}
      slimContent={slimOrgContent}
      className="rounded-3xl border border-slate-200/60 dark:border-slate-700/50 shadow-xl bg-white/70 dark:bg-slate-950/70 backdrop-blur-xl"
    >
      <OrgPanel
        orgs={orgs}
        selectedOrg={selectedOrg}
        onSelectOrg={handleOrgSelect}
        user={user}
        stats={stats}
        onCreateOrg={handleOpenOrgManager}
      />
    </CollapsiblePanel>
  )}

  {/* Center - RepoList */}
  <div className="flex-1 min-w-0">
    <ErrorBoundary>
      <RepoList
        repos={displayRepos}
        loading={loading || isSwitchingOrg}
        error={error}
        errorInfo={errorInfo}
        page={page}
        setPage={setPage}
        perPage={perPage}
        totalPages={totalPages}
        onRefresh={refresh}
        onQuickAction={handleQuickAction}
        onRepoClick={(repo) => {
          setSelectedRepoDetail(repo)
          setActiveView('repo-detail')
        }}
      />
    </ErrorBoundary>
  </div>

  {/* Right Panel - Sidebar */}
  {user && (
    <CollapsiblePanel
      side="right"
      mode={rightMode}
      expandedWidth={280}
      slimContent={
        <SlimSidebar
          selectedRepos={selectedRepos}
          onOpenImport={() => openModal('showImportWizard')}
        />
      }
    >
      <Sidebar {...sidebarProps} />
    </CollapsiblePanel>
  )}
</div>

{/* OrgPanel expand overlay (slim mode → full panel as floating overlay) */}
<AnimatePresence>
{orgOverlayOpen && leftMode === 'slim' && (
  <>
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/20 z-20"
      onClick={() => setOrgOverlayOpen(false)}
    />
    <motion.div
      initial={{ x: -280 }}
      animate={{ x: 0 }}
      exit={{ x: -280 }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className="fixed left-[60px] z-30 w-[280px] rounded-3xl border border-slate-200/60 dark:border-slate-700/50 shadow-2xl bg-white dark:bg-slate-950 backdrop-blur-xl overflow-y-auto"
      style={{
        top: 'var(--header-height)',
        maxHeight: 'calc(100vh - var(--header-height) - 1rem)',
      }}
    >
      <OrgPanel
        orgs={orgs}
        selectedOrg={selectedOrg}
        onSelectOrg={(org) => {
          handleOrgSelect(org)
          setOrgOverlayOpen(false)
        }}
        user={user}
        stats={stats}
        onCreateOrg={handleOpenOrgManager}
      />
    </motion.div>
  </>
)}
</AnimatePresence>
```

The `AnimatePresence` wrapper enables the `exit` animations on both the backdrop and panel. The overlay closes on org select, click-outside, and needs an Escape handler. Add this `useEffect` near the other effects:

```jsx
useEffect(() => {
  if (!orgOverlayOpen) return
  const handleEscape = (e) => {
    if (e.key === 'Escape') setOrgOverlayOpen(false)
  }
  // Close overlay if viewport resizes to desktop (expanded mode)
  const handleResize = () => {
    if (window.innerWidth >= 1280) setOrgOverlayOpen(false)
  }
  document.addEventListener('keydown', handleEscape)
  window.addEventListener('resize', handleResize)
  return () => {
    document.removeEventListener('keydown', handleEscape)
    window.removeEventListener('resize', handleResize)
  }
}, [orgOverlayOpen])
```

- [ ] **Step 6: Update the max-w containers**

Find `max-w-[1920px]` on the main container (line ~419) and session banner (line ~405). Replace both with `max-w-screen-2xl`.

- [ ] **Step 7: Update FAB button and add OrgPanel mobile drawer**

Find the existing FAB + MobileDrawer section (lines 680-698). Update the FAB visibility from `xl:hidden` to `md:hidden` (only show on mobile, since tablet has slim sidebars):

```jsx
className="md:hidden fixed z-30 p-4 bg-indigo-600 ..."
```

After the existing MobileDrawer, add the OrgPanel drawer:

```jsx
<MobileDrawer isOpen={orgDrawerOpen} onClose={() => setOrgDrawerOpen(false)} side="left">
  <OrgPanel
    orgs={orgs}
    selectedOrg={selectedOrg}
    onSelectOrg={(org) => {
      handleOrgSelect(org)
      setOrgDrawerOpen(false)
    }}
    user={user}
    stats={stats}
    onCreateOrg={handleOpenOrgManager}
  />
</MobileDrawer>
```

- [ ] **Step 8: Pass `onToggleOrgDrawer` to Header**

Find the `<Header` component (line ~382) and add the new prop:

```jsx
onToggleOrgDrawer={() => setOrgDrawerOpen(true)}
```

- [ ] **Step 9: Add bottom nav spacing**

On the main container (line ~419), change `py-8` to `py-8 pb-20 md:pb-8`.

- [ ] **Step 10: Verify full integration**

Run: `npm run dev`

Test at each breakpoint:
- **Mobile (<768px):** No sidebars visible. Hamburger opens OrgPanel drawer (slides from left). FAB opens Sidebar drawer (slides from right). Bottom nav bar for navigation. Content is full-width single column.
- **Tablet (768-1023px):** Slim sidebars (60px) on both sides with icons. Chevron button on left slim bar opens OrgPanel overlay. Grid auto-fills 1-2 columns. Full header with nav tabs.
- **Laptop (1024-1279px):** Same as tablet but grid fits 2-3 columns.
- **Desktop (1280px+):** Expanded sidebars (280px). Grid auto-fills 2-4 columns. OrgPanel overlay auto-closes if open.
- **Resize smoothly** between breakpoints — sidebars transition width with 300ms animation.

- [ ] **Step 11: Commit**

```bash
git add src/App.jsx
git commit -m "feat(layout): integrate collapsible sidebars and responsive 3-panel layout"
```

---

## Task 10: Polish & Verification

**Files:**

- Modify: Multiple files for final adjustments

- [ ] **Step 1: Test accessibility**

Tab through the slim sidebar icons:
- Each icon button should be focusable with visible focus ring
- Enter/Space toggles popovers
- Escape closes popovers and returns focus to trigger button
- Tab navigates within open popovers

Verify in browser DevTools: all `aria-label`, `aria-expanded`, `aria-haspopup` attributes present.

- [ ] **Step 2: Test dark mode**

Toggle dark mode at each breakpoint:
- Bottom nav bar: `bg-white/80` in light, `dark:bg-slate-900/80` in dark
- Slim sidebar icons: correct hover states
- Tooltips: inverted colors
- Cards: "Updated" text uses `dark:text-slate-400`
- OrgPanel overlay: correct background and border colors

- [ ] **Step 3: Test localStorage persistence**

1. On desktop (1280px+), app loads with expanded sidebars
2. Reload — layout preserved
3. Resize to tablet — slim mode takes over (breakpoint overrides preference)
4. Resize back to desktop — expanded mode restores

- [ ] **Step 4: Test OrgPanel overlay**

1. At tablet width, click the chevron expand button on slim org panel
2. Overlay should slide in from left at `z-30`, positioned next to slim bar
3. Click backdrop (semi-transparent) — overlay closes
4. Open overlay, press Escape — overlay closes
5. Open overlay, resize to desktop (1280px+) — overlay auto-closes
6. Open overlay, select an org — overlay closes and repos filter

- [ ] **Step 5: Fix any issues found during testing**

If any visual bugs or interaction issues are found, fix them now.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "fix(layout): polish responsive layout edge cases and accessibility"
```

---

## Verification Checklist

After all tasks are complete, verify end-to-end:

- [ ] **360px (small mobile):** Single column, bottom nav, hamburger + FAB for drawers
- [ ] **768px (tablet):** Slim sidebars (60px), auto-fill grid 1-2 cols, full header
- [ ] **1024px (laptop):** Slim sidebars, grid 2-3 cols
- [ ] **1280px (desktop):** Expanded sidebars (280px), grid 2-3 cols
- [ ] **1920px (wide):** Expanded sidebars, grid 3-4 cols, content contained
- [ ] **2560px (ultrawide):** Content doesn't stretch beyond `max-w-screen-2xl`
- [ ] **No horizontal scroll** at any viewport width
- [ ] **Smooth 300ms transitions** when sidebars change state
- [ ] **Dark mode** correct at all breakpoints
- [ ] **Sticky toolbar** aligned below header at all sizes
- [ ] **OrgPanel overlay** opens/closes correctly in slim mode
- [ ] **Bottom nav bar** active state matches current view
- [ ] **Popovers** dismiss on click-outside and Escape, focus returns to trigger
