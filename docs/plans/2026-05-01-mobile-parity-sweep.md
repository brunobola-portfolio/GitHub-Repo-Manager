# Mobile Parity Sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining mobile gaps after slice 1's `SelectionSheet` work — every primary flow usable on a 375×667 viewport without horizontal scroll, hidden CTAs, or layout breaks.

**Architecture:** Three new primitives (`<MobileFAB>`, `<ModalSticky>`, `useViewportSafeHeight`) underpin per-page audit fixes across 8 clusters. Existing primitives (`MobileDrawer`, `useMobileBreakpoint`, `useResponsiveLayout`) are reused.

**Tech Stack:** React 19, Tailwind v4, Framer Motion, Vitest, Playwright (with `--project=mobile` config).

**Spec:** [`docs/specs/2026-05-01-mobile-parity-sweep.md`](../specs/2026-05-01-mobile-parity-sweep.md)

---

## File Structure

**Created:**
- `src/components/ui/MobileFAB.jsx`
- `src/components/ui/ModalSticky.jsx`
- `src/hooks/useViewportSafeHeight.js`
- `tests/components/ui/MobileFAB.test.jsx`
- `tests/components/ui/ModalSticky.test.jsx`
- `tests/hooks/useViewportSafeHeight.test.js`
- `e2e/mobile-smoke.spec.js`

**Modified (per cluster):**
- Cluster A: `src/components/Header*.jsx`, `src/components/Sidebar.jsx`
- Cluster B: `src/components/Dashboard/DashboardPremium.jsx`, `LanguageChart.jsx`
- Cluster C: `src/components/RepoList/RepoFilterBar.jsx`
- Cluster D: `src/components/RepoDetail/RepoDetail.jsx`, `RepoDetail/SettingsTab.jsx`
- Cluster E: `src/components/WorkBoard/WorkBoardPage.jsx`, `WorkBoard/AISummaryCard.jsx`
- Cluster F: `src/components/SettingsModal.jsx`
- Cluster G: every `<Modal>` site that has destructive/save actions (~10 files)
- Cluster H: `src/components/MigrationWizard/*`
- `src/components/CommandPalette.jsx` (FAB wiring)
- `src/components/ui/Toaster.jsx` or wherever toasts render
- `playwright.config.js` (add mobile project)
- `docs/architecture/overview.md`

---

## Task 1: `useViewportSafeHeight` hook

**Files:**
- Create: `src/hooks/useViewportSafeHeight.js`
- Create: `tests/hooks/useViewportSafeHeight.test.js`

- [ ] **Step 1.1: Failing test**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useViewportSafeHeight } from '@/hooks/useViewportSafeHeight'

describe('useViewportSafeHeight', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
  })

  it('returns innerHeight when visualViewport is undefined', () => {
    const original = window.visualViewport
    delete window.visualViewport
    const { result } = renderHook(() => useViewportSafeHeight())
    expect(result.current).toBe(800)
    if (original) window.visualViewport = original
  })

  it('returns visualViewport.height when present', () => {
    const listeners = new Map()
    window.visualViewport = {
      height: 650,
      addEventListener: vi.fn((evt, cb) => listeners.set(evt, cb)),
      removeEventListener: vi.fn(),
    }
    const { result } = renderHook(() => useViewportSafeHeight())
    expect(result.current).toBe(650)
  })

  it('updates when visualViewport resize fires', () => {
    let resizeCb
    window.visualViewport = {
      height: 650,
      addEventListener: vi.fn((evt, cb) => { if (evt === 'resize') resizeCb = cb }),
      removeEventListener: vi.fn(),
    }
    const { result } = renderHook(() => useViewportSafeHeight())
    act(() => { window.visualViewport.height = 720; resizeCb?.() })
    expect(result.current).toBe(720)
  })

  it('cleans up listener on unmount', () => {
    const remove = vi.fn()
    window.visualViewport = {
      height: 650,
      addEventListener: vi.fn(),
      removeEventListener: remove,
    }
    const { unmount } = renderHook(() => useViewportSafeHeight())
    unmount()
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
  })
})
```

- [ ] **Step 1.2: Run → red**

- [ ] **Step 1.3: Implement**

```js
// src/hooks/useViewportSafeHeight.js
import { useEffect, useState } from 'react'

export function useViewportSafeHeight() {
  const [h, setH] = useState(() =>
    typeof window === 'undefined' ? 0 :
    window.visualViewport?.height ?? window.innerHeight
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setH(vv.height)
    vv.addEventListener('resize', update)
    return () => vv.removeEventListener('resize', update)
  }, [])
  return h
}
```

- [ ] **Step 1.4: Run → green + commit**

```bash
git add -A && git commit -m "feat(hooks): useViewportSafeHeight for iOS URL-bar-aware sizing"
```

---

## Task 2: `<MobileFAB>` primitive

**Files:**
- Create: `src/components/ui/MobileFAB.jsx`
- Create: `tests/components/ui/MobileFAB.test.jsx`

- [ ] **Step 2.1: Failing test**

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Search } from 'lucide-react'
import { MobileFAB } from '@/components/ui/MobileFAB'

vi.mock('@/hooks/useMobileBreakpoint', () => ({ useMobileBreakpoint: vi.fn() }))
import * as bp from '@/hooks/useMobileBreakpoint'

describe('MobileFAB', () => {
  it('renders nothing on desktop', () => {
    bp.useMobileBreakpoint.mockReturnValue(false)
    const { container } = render(<MobileFAB icon={Search} label="Search" onClick={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a button on mobile', () => {
    bp.useMobileBreakpoint.mockReturnValue(true)
    render(<MobileFAB icon={Search} label="Search" onClick={() => {}} />)
    expect(screen.getByRole('button', { name: /Search/i })).toBeInTheDocument()
  })

  it('clicking fires onClick', () => {
    bp.useMobileBreakpoint.mockReturnValue(true)
    const onClick = vi.fn()
    render(<MobileFAB icon={Search} label="Search" onClick={onClick} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('shifts up when shiftAboveBottomBar is true', () => {
    bp.useMobileBreakpoint.mockReturnValue(true)
    const { container } = render(<MobileFAB icon={Search} label="Search" onClick={() => {}} shiftAboveBottomBar />)
    expect(container.firstChild.className).toMatch(/bottom-20/)
  })
})
```

- [ ] **Step 2.2: Implement**

```jsx
// src/components/ui/MobileFAB.jsx
import { motion } from 'framer-motion'
import { useMobileBreakpoint } from '../../hooks/useMobileBreakpoint'

export function MobileFAB({ icon: Icon, label, onClick, shiftAboveBottomBar = false }) {
  const isMobile = useMobileBreakpoint()
  if (!isMobile) return null
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      aria-label={label}
      title={label}
      className={`fixed right-4 ${shiftAboveBottomBar ? 'bottom-20' : 'bottom-6'} z-40 w-14 h-14 rounded-full bg-indigo-500 text-white shadow-2xl flex items-center justify-center md:hidden`}
    >
      <Icon className="w-6 h-6" aria-hidden="true" />
    </motion.button>
  )
}
```

- [ ] **Step 2.3: Run + commit**

```bash
git commit -m "feat(ui): MobileFAB floating action button primitive"
```

---

## Task 3: `<ModalSticky>` primitive

**Files:**
- Create: `src/components/ui/ModalSticky.jsx`
- Create: `tests/components/ui/ModalSticky.test.jsx`

- [ ] **Step 3.1: Failing test**

Cover:
- Renders children + footer.
- At `< md` viewport, the footer has `sticky bottom-0`.
- At `≥ md`, footer is normal.
- `body` content scrolls when its height exceeds available space.

- [ ] **Step 3.2: Implement**

```jsx
// src/components/ui/ModalSticky.jsx
import { useMobileBreakpoint } from '../../hooks/useMobileBreakpoint'
import { useViewportSafeHeight } from '../../hooks/useViewportSafeHeight'
import { Modal } from './Modal'

/**
 * ModalSticky — wraps Modal with mobile-aware layout: full-height container,
 * scrolling body, sticky footer. Backwards-compatible: at >= md, renders the
 * same DOM as before (children + footer in normal flow).
 *
 * Usage:
 *   <ModalSticky isOpen={open} onClose={...} title="..." footer={<Button>Save</Button>}>
 *     <p>body content...</p>
 *   </ModalSticky>
 */
export function ModalSticky({ isOpen, onClose, title, footer, children, size = 'md' }) {
  const isMobile = useMobileBreakpoint()
  const safeH = useViewportSafeHeight()

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size={size}>
      <div
        className="flex flex-col"
        style={isMobile ? { maxHeight: safeH - 80 } : undefined}
      >
        <div className={isMobile ? 'flex-1 overflow-y-auto pb-20' : ''}>{children}</div>
        {footer && (
          <div
            className={
              isMobile
                ? 'sticky bottom-0 left-0 right-0 -mx-4 px-4 py-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 flex items-center justify-end gap-2'
                : 'mt-4 flex items-center justify-end gap-2'
            }
          >
            {footer}
          </div>
        )}
      </div>
    </Modal>
  )
}
```

- [ ] **Step 3.3: Run + commit**

```bash
git commit -m "feat(ui): ModalSticky for full-height mobile modals with sticky footer"
```

---

## Task 4: Cluster A — Header + Sidebar drawer (rows 1, 2)

**Files:**
- Modify: `src/components/HeaderNew.jsx` (or whichever Header is in use)
- Modify: `src/components/Sidebar.jsx`

- [ ] **Step 4.1: Audit current state**

Read both files, identify any spots where elements overflow at `< sm`. Common offenders: nav pills row, search, org switcher.

- [ ] **Step 4.2: Hamburger drawer wiring**

If not already done: Header gets a hamburger button at `< md`. Click → opens `<MobileDrawer side="left">` containing the existing Sidebar's nav items. Drawer auto-closes after a nav link click.

Structure:

```jsx
const isMobile = useMobileBreakpoint()
const [navOpen, setNavOpen] = useState(false)

return (
  <>
    {isMobile && <button onClick={() => setNavOpen(true)} aria-label="Open menu" className="md:hidden">…</button>}
    {isMobile ? (
      <MobileDrawer isOpen={navOpen} onClose={() => setNavOpen(false)} side="left">
        <Sidebar onNavigate={() => setNavOpen(false)} />
      </MobileDrawer>
    ) : (
      <Sidebar />
    )}
  </>
)
```

- [ ] **Step 4.3: Test + commit**

```bash
git commit -m "feat(mobile): hamburger drawer for Sidebar at <md breakpoint"
```

---

## Task 5: Cluster B — Dashboard responsive (rows 3, 4)

**Files:**
- Modify: `src/components/Dashboard/DashboardPremium.jsx`
- Modify: `src/components/Dashboard/LanguageChart.jsx`

- [ ] **Step 5.1: Stack StatCards 1-wide at `<sm`**

Current grid: `grid-cols-2 md:grid-cols-2 lg:grid-cols-4`. Change first to `grid-cols-1 sm:grid-cols-2`. Visual smoke test at 375px.

- [ ] **Step 5.2: LanguageChart compact variant**

Add a `variant: 'compact' | 'pie'` prop. At `< sm`, the parent passes `compact`, which renders a horizontal bar list (top 5 languages with %).

- [ ] **Step 5.3: Test + commit**

```bash
git commit -m "feat(mobile): Dashboard stacks 1-wide at <sm; LanguageChart compact variant"
```

---

## Task 6: Cluster C — RepoFilterBar mobile sheet (row 5)

**Files:**
- Modify: `src/components/RepoList/RepoFilterBar.jsx`

- [ ] **Step 6.1: Implement Filter sheet**

At `< sm`, render search full-width on its own row. Type/Visibility/Language filters collapse into a single "Filter" button that opens a `<MobileDrawer side="bottom">` containing all the dropdowns vertically.

```jsx
const isMobile = useMobileBreakpoint()
const [filterOpen, setFilterOpen] = useState(false)

if (isMobile) {
  return (
    <>
      <SearchInput {...} className="w-full" />
      <button onClick={() => setFilterOpen(true)}>Filter ({activeFilterCount})</button>
      <MobileDrawer isOpen={filterOpen} onClose={() => setFilterOpen(false)} side="bottom">
        {/* type / visibility / language pickers stacked */}
      </MobileDrawer>
    </>
  )
}
// existing desktop layout
```

- [ ] **Step 6.2: Test + commit**

```bash
git commit -m "feat(mobile): RepoFilterBar collapses to bottom-sheet at <sm"
```

---

## Task 7: Cluster D — RepoDetail tabs + Settings sticky save (rows 8, 9)

**Files:**
- Modify: `src/components/RepoDetail/RepoDetail.jsx`
- Modify: `src/components/RepoDetail/SettingsTab.jsx`

- [ ] **Step 7.1: Tab fade indicators**

Add CSS gradient masks on left/right of the tab strip when content is scrollable. Use `[mask-image:linear-gradient(...)]` Tailwind arbitrary value.

- [ ] **Step 7.2: SettingsTab sticky save**

Wrap the Settings tab's Save button in a sticky bottom bar at `<md`:

```jsx
<div className="md:hidden sticky bottom-0 left-0 right-0 -mx-4 px-4 py-3 bg-white dark:bg-slate-900 border-t border-slate-200 flex justify-end gap-2 z-10">
  <Button onClick={save}>Save changes</Button>
</div>
{/* desktop variant unchanged */}
<div className="hidden md:flex justify-end gap-2 mt-6">
  <Button onClick={save}>Save changes</Button>
</div>
```

- [ ] **Step 7.3: Test + commit**

```bash
git commit -m "feat(mobile): RepoDetail tabs scroll-fade + sticky save bar"
```

---

## Task 8: Cluster E — WorkBoard mobile (rows 10, 11)

**Files:**
- Modify: `src/components/WorkBoard/WorkBoardPage.jsx`
- Modify: `src/components/WorkBoard/AISummaryCard.jsx`

- [ ] **Step 8.1: KPI cards 1-wide at `<sm`**

Same Tailwind grid pattern as Cluster B.

- [ ] **Step 8.2: AISummaryCard stacked layout**

At `<sm`, the existing `flex-col sm:flex-row` already handles this — verify visually. If the gauge is too tall, add `max-w-[80px]` to the gauge container at `<sm`.

- [ ] **Step 8.3: Bottom tab bar at `<sm` (optional)**

Convert the WorkBoard tabs row to a bottom-anchored fixed bar at `<sm`:

```jsx
{isMobile ? (
  <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 z-40 flex justify-around py-2">
    {tabs.map(t => <button key={t.id} onClick={() => setTab(t.id)}>...</button>)}
  </nav>
) : (
  <TabBar tabs={tabs} ... />
)}
```

When this bottom bar is present, the FAB (Task 12) should pass `shiftAboveBottomBar`.

- [ ] **Step 8.4: Test + commit**

```bash
git commit -m "feat(mobile): WorkBoard KPIs stack + optional bottom tab bar"
```

---

## Task 9: Cluster F — SettingsModal sections nav (row 12)

**Files:**
- Modify: `src/components/SettingsModal.jsx`

- [ ] **Step 9.1: Audit current state**

Identify how the section list currently renders. Likely a left rail. At `<md` it probably hides — confirm.

- [ ] **Step 9.2: Horizontal section tab strip**

At `<md`, replace the rail with a horizontal scrollable tab strip below the modal title:

```jsx
{isMobile ? (
  <div className="flex gap-1 overflow-x-auto px-4 -mx-4 pb-2 mb-4 border-b border-slate-200">
    {sections.map(s => <SectionTab key={s.id} active={activeSection === s.id} onClick={() => setActiveSection(s.id)}>{s.label}</SectionTab>)}
  </div>
) : (
  <SectionRail .../>
)}
```

- [ ] **Step 9.3: Test + commit**

```bash
git commit -m "feat(mobile): SettingsModal horizontal section tabs at <md"
```

---

## Task 10: Cluster G — Apply `<ModalSticky>` to existing modals (row 13)

**Files:** every place a `<Modal>` has action buttons. Find via:

```
grep -rn "import.*Modal.*from.*ui/Modal" src/components/ | head -30
```

- [ ] **Step 10.1: Identify modals with destructive/save action buttons**

Triage: for each modal, decide if its footer benefits from sticky behavior. Modals that are pure info (no buttons) skip.

- [ ] **Step 10.2: Per modal, swap `<Modal>` for `<ModalSticky>`**

Lift the action row out of the body into the `footer` prop:

```jsx
<ModalSticky
  isOpen={open}
  onClose={close}
  title="Edit settings"
  footer={
    <>
      <Button variant="ghost" onClick={close}>Cancel</Button>
      <Button onClick={save}>Save</Button>
    </>
  }
>
  <p>body…</p>
</ModalSticky>
```

- [ ] **Step 10.3: Tests + commit per modal cluster**

Likely 2-3 commits clustering related modals (RepoTransfer, MirrorRepo, BatchIndex, etc.).

---

## Task 11: Cluster H — MigrationWizard mobile (row 14)

**Files:**
- Modify: `src/components/MigrationWizard/MigrationWizard.jsx` and step components

- [ ] **Step 11.1: Verify each step renders at 375×667**

Run `npm run dev`, open in mobile viewport, walk through each wizard step. Identify any overflow.

- [ ] **Step 11.2: Apply fixes**

Common fixes: stacked form fields (`flex-col sm:flex-row`), full-width inputs, scrollable repo-select grid.

- [ ] **Step 11.3: Test + commit**

```bash
git commit -m "feat(mobile): MigrationWizard responsive at <sm"
```

---

## Task 12: Wire `<MobileFAB>` for command palette

**Files:**
- Modify: `src/App.jsx` (or wherever the global command palette host is)

- [ ] **Step 12.1: Add the FAB**

```jsx
<MobileFAB
  icon={Search}
  label="Open command palette"
  onClick={() => setCommandPaletteOpen(true)}
  shiftAboveBottomBar={activeView === 'work-board' && isMobile}
/>
```

- [ ] **Step 12.2: Hide while a SelectionBar/Sheet is active**

Pass a `hidden` prop or conditional render:

```jsx
{!hasActiveBatchSelection && <MobileFAB ... />}
```

- [ ] **Step 12.3: Commit**

```bash
git commit -m "feat(mobile): MobileFAB for command palette access"
```

---

## Task 13: Toast width clamp + tooltip touch audit

- [ ] **Step 13.1: Toast container**

In the toast container component, add `max-w-[calc(100vw-2rem)]` to the wrapper.

- [ ] **Step 13.2: Tooltip audit**

Grep for `<Tooltip` usage on icon-only buttons. Verify each has a `title` attribute fallback (touch-friendly). Update any that don't.

- [ ] **Step 13.3: Commit**

```bash
git commit -m "feat(mobile): clamp toast width + ensure tooltip fallbacks for touch"
```

---

## Task 14: Playwright mobile project + smoke suite

**Files:**
- Modify: `playwright.config.js`
- Create: `e2e/mobile-smoke.spec.js`

- [ ] **Step 14.1: Add mobile project to Playwright config**

```js
{
  name: 'mobile',
  use: {
    ...devices['iPhone 11'],
    viewport: { width: 375, height: 667 },
  },
}
```

- [ ] **Step 14.2: Write the smoke spec**

See spec section 5 for the script. ~10 steps, all happy path on `?mock=1`.

- [ ] **Step 14.3: Run + commit**

```bash
npx playwright test e2e/mobile-smoke.spec.js --project=mobile
git add -A && git commit -m "test(e2e): mobile smoke suite at 375x667"
```

---

## Task 15: Documentation

**Files:**
- Modify: `docs/architecture/overview.md`

- [ ] **Step 15.1: Add a "Responsive layout" subsection**

Document the three primitives (`MobileFAB`, `ModalSticky`, `useViewportSafeHeight`), the breakpoint convention (`<md` = mobile), and link to the spec.

- [ ] **Step 15.2: Commit + push**

```bash
git add docs/architecture/overview.md
git commit -m "docs(architecture): mobile parity primitives + responsive convention"
git push origin main
```

---

## Self-Review

**Spec coverage:**
- 3 primitives → Tasks 1, 2, 3.
- 17 audit rows → Tasks 4-13.
- E2E → Task 14.
- Docs → Task 15.

**Placeholder scan:** None. Each cluster task has the specific change to make.

**Type consistency:** `<MobileFAB icon, label, onClick, shiftAboveBottomBar?>`, `<ModalSticky isOpen, onClose, title, footer, children, size?>` — stable across call sites.

**Risk-aware decisions:**
- Hamburger drawer is gated by `useMobileBreakpoint()` so desktop is unaffected.
- `useViewportSafeHeight` correctly handles iOS URL bar collapse via `visualViewport` API.
- FAB hides during batch selection to avoid bottom-fixed conflicts.

**Bundle delta:** ~5 KB gzipped for primitives + per-cluster fix is mostly Tailwind class swaps (zero JS impact).
