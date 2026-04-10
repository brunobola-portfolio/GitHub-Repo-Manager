# Modal System Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate desktop scrollbar on AI Insights modal, consolidate three hand-rolled modals onto the shared `Modal.jsx` primitive, introduce shared `InsightCard` + `StatBar` components, and add coherent animations across all modals while respecting `prefers-reduced-motion`.

**Architecture:** Enhance `src/components/ui/Modal.jsx` with new props (tabs, subtitle, sizes 2xl/3xl, staggerChildren, mobileVariant). Migrate `RepoInsightsModal`, `OrgManagerModal`, `TransferModal` to use it. Visually align `WizardPanel` (used by `CreateRepoModal`, `CommitGeneratorModal`). All animations use existing `ds-*` classes + Framer Motion variants — no new CSS keyframes.

**Tech Stack:** React 19, Vite 7, Tailwind CSS v4, Framer Motion 12, Vitest 4 + @testing-library/react 16, Playwright 1.58, lucide-react icons.

**Spec:** [docs/specs/2026-04-11-modal-system-redesign.md](../specs/2026-04-11-modal-system-redesign.md)

---

## Phase 0 — Prerequisites

### Task 0.1: Baseline verification

Verify the repo is clean, tests pass, and the dev server starts. This catches pre-existing breakage so nothing gets blamed on later tasks.

**Files:** none

- [ ] **Step 1: Check git status clean**

Run: `git status`
Expected: `nothing to commit, working tree clean` on branch `main`.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: zero errors. Record any pre-existing warnings so we don't re-introduce them.

- [ ] **Step 3: Run unit tests**

Run: `npm run test:run`
Expected: all tests pass. If any fail, STOP and report — do not start implementation against a broken baseline.

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: `vite build` finishes without errors, produces `dist/`.

- [ ] **Step 5: No commit (baseline only)**

---

## Phase 1 — Foundation: hook + shared components

### Task 1.1: Create `useBodyScrollLock` hook

Adds a reusable hook that locks `document.body.style.overflow` while a modal is open. `WizardPanel` already does this inline — we'll centralize it here so `Modal.jsx` and `WizardPanel` share one implementation.

**Files:**
- Create: `src/hooks/useBodyScrollLock.js`
- Test: `tests/hooks/useBodyScrollLock.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/useBodyScrollLock.test.jsx`:

```jsx
import { describe, it, expect, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'

describe('useBodyScrollLock', () => {
  afterEach(() => {
    document.body.style.overflow = ''
  })

  it('does nothing when isLocked=false', () => {
    document.body.style.overflow = 'scroll'
    renderHook(() => useBodyScrollLock(false))
    expect(document.body.style.overflow).toBe('scroll')
  })

  it('locks body overflow when isLocked=true', () => {
    renderHook(() => useBodyScrollLock(true))
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('restores previous overflow on unmount', () => {
    document.body.style.overflow = 'scroll'
    const { unmount } = renderHook(() => useBodyScrollLock(true))
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('scroll')
  })

  it('restores when isLocked flips to false', () => {
    document.body.style.overflow = 'auto'
    const { rerender } = renderHook(
      ({ locked }) => useBodyScrollLock(locked),
      { initialProps: { locked: true } }
    )
    expect(document.body.style.overflow).toBe('hidden')
    rerender({ locked: false })
    expect(document.body.style.overflow).toBe('auto')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hooks/useBodyScrollLock.test.jsx`
Expected: FAIL with `Failed to resolve import "@/hooks/useBodyScrollLock"` or similar.

- [ ] **Step 3: Create the hook**

Create `src/hooks/useBodyScrollLock.js`:

```js
import { useEffect } from 'react'

/**
 * Lock document.body scroll while isLocked is true.
 * Restores the previous overflow value on cleanup.
 *
 * Used by Modal.jsx and WizardPanel.jsx to prevent background page
 * scrolling when a modal or wizard is open.
 */
export function useBodyScrollLock(isLocked) {
  useEffect(() => {
    if (!isLocked) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [isLocked])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hooks/useBodyScrollLock.test.jsx`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useBodyScrollLock.js tests/hooks/useBodyScrollLock.test.jsx
git commit -m "feat(hooks): add useBodyScrollLock for modal body-scroll management"
```

---

### Task 1.2: Create `InsightCard` component

Shared card component with 6 tones, optional hover-lift + shimmer, and Framer Motion variants that consume parent stagger.

**Files:**
- Create: `src/components/ui/InsightCard.jsx`
- Test: `tests/components/ui/InsightCard.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/ui/InsightCard.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InsightCard } from '@/components/ui/InsightCard'

describe('InsightCard', () => {
  it('renders children', () => {
    render(<InsightCard>Hello</InsightCard>)
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('applies default tone classes', () => {
    render(<InsightCard data-testid="card">x</InsightCard>)
    const card = screen.getByTestId('card')
    expect(card.className).toMatch(/ring-slate-200\/60/)
  })

  it('applies info tone classes', () => {
    render(<InsightCard tone="info" data-testid="card">x</InsightCard>)
    const card = screen.getByTestId('card')
    expect(card.className).toMatch(/ring-blue-500\/20/)
  })

  it('applies success tone classes', () => {
    render(<InsightCard tone="success" data-testid="card">x</InsightCard>)
    expect(screen.getByTestId('card').className).toMatch(/ring-emerald-500\/20/)
  })

  it('applies warning tone classes', () => {
    render(<InsightCard tone="warning" data-testid="card">x</InsightCard>)
    expect(screen.getByTestId('card').className).toMatch(/ring-amber-500\/20/)
  })

  it('applies danger tone classes', () => {
    render(<InsightCard tone="danger" data-testid="card">x</InsightCard>)
    expect(screen.getByTestId('card').className).toMatch(/ring-red-500\/20/)
  })

  it('applies ai tone classes', () => {
    render(<InsightCard tone="ai" data-testid="card">x</InsightCard>)
    expect(screen.getByTestId('card').className).toMatch(/ring-purple-500\/25/)
  })

  it('adds hover classes by default', () => {
    render(<InsightCard data-testid="card">x</InsightCard>)
    expect(screen.getByTestId('card').className).toMatch(/ds-hover-lift/)
    expect(screen.getByTestId('card').className).toMatch(/ds-card-shimmer/)
  })

  it('omits hover classes when hover=false', () => {
    render(<InsightCard hover={false} data-testid="card">x</InsightCard>)
    expect(screen.getByTestId('card').className).not.toMatch(/ds-hover-lift/)
  })

  it('merges custom className', () => {
    render(<InsightCard className="lg:col-span-2" data-testid="card">x</InsightCard>)
    expect(screen.getByTestId('card').className).toMatch(/lg:col-span-2/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/ui/InsightCard.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the component**

Create `src/components/ui/InsightCard.jsx`:

```jsx
import { motion, useReducedMotion } from 'framer-motion'

const TONE_CLASSES = {
  default: 'ring-slate-200/60 dark:ring-slate-800/50 bg-white dark:bg-slate-900/60',
  info:    'ring-blue-500/20 bg-gradient-to-br from-blue-500/5 to-transparent dark:from-blue-500/10',
  success: 'ring-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-transparent dark:from-emerald-500/10',
  warning: 'ring-amber-500/20 bg-gradient-to-br from-amber-500/5 to-transparent dark:from-amber-500/10',
  danger:  'ring-red-500/20 bg-gradient-to-br from-red-500/5 to-transparent dark:from-red-500/10',
  ai:      'ring-purple-500/25 bg-gradient-to-br from-purple-500/[0.08] via-indigo-500/5 to-transparent dark:from-purple-500/[0.12] dark:via-indigo-500/[0.08]',
}

const VARIANTS = {
  hidden:  { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } },
}

const VARIANTS_REDUCED = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
}

/**
 * InsightCard — shared card used inside modals for a consistent look.
 *
 * - Tones: default, info, success, warning, danger, ai
 * - Hover: ds-card-shimmer + ds-hover-lift (opt-out with hover={false})
 * - Consumes parent Framer Motion stagger variants when wrapped in a
 *   motion.div with `initial="hidden" animate="visible" variants={{...}}`
 * - Respects prefers-reduced-motion via useReducedMotion()
 */
export function InsightCard({
  children,
  tone = 'default',
  hover = true,
  className = '',
  ...rest
}) {
  const reduced = useReducedMotion()
  const toneClass = TONE_CLASSES[tone] ?? TONE_CLASSES.default
  const hoverClass = hover ? 'ds-card-shimmer ds-hover-lift' : ''

  return (
    <motion.div
      variants={reduced ? VARIANTS_REDUCED : VARIANTS}
      className={`rounded-xl p-4 ring-1 ${toneClass} ${hoverClass} ${className}`}
      {...rest}
    >
      {children}
    </motion.div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/ui/InsightCard.test.jsx`
Expected: 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/InsightCard.jsx tests/components/ui/InsightCard.test.jsx
git commit -m "feat(ui): add InsightCard shared component with tones and stagger"
```

---

### Task 1.3: Create `StatBar` component

Animated progress bar with spring fill, `animated={false}` for real-time updates, and reduced-motion fallback.

**Files:**
- Create: `src/components/ui/StatBar.jsx`
- Test: `tests/components/ui/StatBar.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/ui/StatBar.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatBar } from '@/components/ui/StatBar'

describe('StatBar', () => {
  it('renders label and value/max', () => {
    render(<StatBar label="Documentation" value={18} max={30} />)
    expect(screen.getByText('Documentation')).toBeInTheDocument()
    expect(screen.getByText('18/30')).toBeInTheDocument()
  })

  it('hides value when showValue=false', () => {
    render(<StatBar label="Docs" value={18} max={30} showValue={false} />)
    expect(screen.queryByText('18/30')).not.toBeInTheDocument()
  })

  it('exposes percentage via aria-valuenow', () => {
    render(<StatBar label="Docs" value={15} max={30} />)
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('15')
    expect(bar.getAttribute('aria-valuemax')).toBe('30')
    expect(bar.getAttribute('aria-valuemin')).toBe('0')
  })

  it('clamps value to [0, max]', () => {
    render(<StatBar label="Over" value={50} max={30} />)
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('30')
  })

  it('clamps negative value to 0', () => {
    render(<StatBar label="Neg" value={-5} max={30} />)
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('0')
  })

  it('renders with animated=false (no spring wrapper)', () => {
    render(<StatBar label="Live" value={42} max={100} animated={false} />)
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    // When animated=false the fill uses a plain div with inline width style
    const fill = screen.getByTestId('statbar-fill')
    expect(fill.style.width).toBe('42%')
  })

  it('size sm applies h-1.5 class', () => {
    render(<StatBar label="S" value={5} max={10} size="sm" />)
    expect(screen.getByRole('progressbar').className).toMatch(/h-1\.5/)
  })

  it('size md applies h-2 class', () => {
    render(<StatBar label="M" value={5} max={10} size="md" />)
    expect(screen.getByRole('progressbar').className).toMatch(/h-2/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/ui/StatBar.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the component**

Create `src/components/ui/StatBar.jsx`:

```jsx
import { motion, useReducedMotion } from 'framer-motion'

const GRADIENT_CLASSES = {
  primary:   'bg-gradient-to-r from-indigo-500 to-purple-500',
  secondary: 'bg-gradient-to-r from-cyan-500 to-blue-500',
  success:   'bg-gradient-to-r from-emerald-500 to-cyan-500',
  accent:    'bg-gradient-to-r from-amber-500 to-pink-500',
}

const SIZE_CLASSES = {
  sm: 'h-1.5',
  md: 'h-2',
}

/**
 * StatBar — labeled progress bar with spring fill animation.
 *
 * - animated=true (default): Framer Motion spring from 0% → value%
 * - animated=false: inline CSS width (for rapid updates, e.g. TransferModal)
 * - Respects prefers-reduced-motion — snaps to final width
 * - Clamps value to [0, max]
 */
export function StatBar({
  label,
  value,
  max,
  gradient = 'primary',
  animated = true,
  showValue = true,
  size = 'md',
}) {
  const reduced = useReducedMotion()
  const safeMax = max > 0 ? max : 1
  const clamped = Math.max(0, Math.min(value, safeMax))
  const pct = (clamped / safeMax) * 100

  const gradientClass = GRADIENT_CLASSES[gradient] ?? GRADIENT_CLASSES.primary
  const sizeClass = SIZE_CLASSES[size] ?? SIZE_CLASSES.md

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-slate-600 dark:text-slate-300 capitalize">{label}</span>
        {showValue && (
          <span className="text-slate-500 dark:text-slate-400 tabular-nums">
            {clamped}/{safeMax}
          </span>
        )}
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        className={`${sizeClass} bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden`}
      >
        {animated && !reduced ? (
          <motion.div
            className={`h-full ${gradientClass} rounded-full`}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ type: 'spring', damping: 22, stiffness: 90, delay: 0.1 }}
            data-testid="statbar-fill"
          />
        ) : (
          <div
            className={`h-full ${gradientClass} rounded-full transition-[width] duration-150 ease-out`}
            style={{ width: `${pct}%` }}
            data-testid="statbar-fill"
          />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/ui/StatBar.test.jsx`
Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/StatBar.jsx tests/components/ui/StatBar.test.jsx
git commit -m "feat(ui): add StatBar animated progress bar component"
```

---

## Phase 2 — Enhance `Modal.jsx` primitive

Phase 2 is split into 4 sub-tasks so each change is independently reviewable.

### Task 2.1: Add new sizes + subtitle prop + body scroll lock

**Files:**
- Modify: `src/components/ui/Modal.jsx`
- Test: `tests/components/ui/Modal.test.jsx` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/components/ui/Modal.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Modal } from '@/components/ui/Modal'

vi.mock('@/hooks/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null })
}))

describe('Modal — base', () => {
  afterEach(() => { cleanup(); document.body.style.overflow = '' })

  it('does not render when closed', () => {
    render(<Modal isOpen={false} onClose={() => {}} title="Hi">body</Modal>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders title and body', () => {
    render(<Modal isOpen={true} onClose={() => {}} title="My title">body</Modal>)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('My title')).toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
  })

  it('renders subtitle below title', () => {
    render(
      <Modal isOpen={true} onClose={() => {}} title="Hi" subtitle="owner/repo">x</Modal>
    )
    expect(screen.getByText('owner/repo')).toBeInTheDocument()
  })

  it('applies size="2xl" max-width class', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Hi" size="2xl">x</Modal>
    )
    expect(container.querySelector('[role="dialog"]').className).toMatch(/max-w-5xl/)
  })

  it('applies size="3xl" max-width class', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Hi" size="3xl">x</Modal>
    )
    expect(container.querySelector('[role="dialog"]').className).toMatch(/max-w-6xl/)
  })

  it('locks body scroll when open', () => {
    render(<Modal isOpen={true} onClose={() => {}} title="Hi">x</Modal>)
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('restores body scroll when closed', () => {
    const { rerender } = render(<Modal isOpen={true} onClose={() => {}} title="Hi">x</Modal>)
    expect(document.body.style.overflow).toBe('hidden')
    rerender(<Modal isOpen={false} onClose={() => {}} title="Hi">x</Modal>)
    expect(document.body.style.overflow).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/ui/Modal.test.jsx`
Expected: FAIL — at least `size="2xl" max-w-5xl` and `subtitle` and body scroll lock tests fail.

- [ ] **Step 3: Update `Modal.jsx` — add size/subtitle/scroll lock**

Modify `src/components/ui/Modal.jsx`. Replace the `sizeClasses` object, add `subtitle` prop, and import the new hook. Open the file and apply these exact edits:

Replace the import block:

```jsx
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
```

Replace the function signature to add `subtitle`:

```jsx
export function Modal({
    isOpen,
    onClose,
    title,
    subtitle,
    children,
    footer,
    size = 'md',
    variant = 'default',
    icon: Icon,
    closeOnBackdrop = true,
    showCloseButton = true,
    className = ''
}) {
```

Replace the `sizeClasses` object:

```jsx
    const sizeClasses = {
        sm:    'max-w-md',
        md:    'max-w-lg',
        lg:    'max-w-2xl',
        xl:    'max-w-4xl',
        '2xl': 'max-w-5xl',
        '3xl': 'max-w-6xl',
        full:  'max-w-7xl'
    }
```

Add the scroll-lock hook call right after `const modalRef = useFocusTrap(isOpen, onClose)`:

```jsx
    const modalRef = useFocusTrap(isOpen, onClose)
    useBodyScrollLock(isOpen)
```

In the header JSX block, replace the title rendering with one that supports subtitle. Find:

```jsx
                                <div className="flex-1 min-w-0">
                                    {typeof title === 'string' ? (
                                        <h2 id="modal-title" className="text-sm font-semibold tracking-tight truncate">
                                            {title}
                                        </h2>
                                    ) : (
                                        title
                                    )}
                                </div>
```

Replace with:

```jsx
                                <div className="flex-1 min-w-0">
                                    {typeof title === 'string' ? (
                                        <h2 id="modal-title" className="text-sm font-semibold tracking-tight truncate">
                                            {title}
                                        </h2>
                                    ) : (
                                        title
                                    )}
                                    {subtitle && (
                                        <p className="text-[11px] text-white/70 truncate mt-0.5">
                                            {subtitle}
                                        </p>
                                    )}
                                </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/ui/Modal.test.jsx`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Modal.jsx tests/components/ui/Modal.test.jsx
git commit -m "feat(ui): add subtitle, 2xl/3xl sizes, body scroll lock to Modal"
```

---

### Task 2.2: Add `tabs` integration to `Modal.jsx`

When `tabs` prop is provided, Modal renders a second header row with `<TabBar variant="underline">`. This eliminates the need for each tabbed modal to build its own header.

**Files:**
- Modify: `src/components/ui/Modal.jsx`
- Test: `tests/components/ui/Modal.test.jsx` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/components/ui/Modal.test.jsx`:

```jsx
import { fireEvent } from '@testing-library/react'
import { Sparkles, FileText } from 'lucide-react'

describe('Modal — tabs', () => {
  afterEach(() => { cleanup(); document.body.style.overflow = '' })

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Sparkles },
    { id: 'readme',   label: 'README',   icon: FileText },
  ]

  it('renders tabs when tabs prop is provided', () => {
    render(
      <Modal
        isOpen={true} onClose={() => {}} title="AI"
        tabs={tabs} activeTab="overview" onTabChange={() => {}}
        tabsLayoutId="test-tabs"
      >body</Modal>
    )
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Overview/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /README/ })).toBeInTheDocument()
  })

  it('calls onTabChange when a tab is clicked', () => {
    const onTabChange = vi.fn()
    render(
      <Modal
        isOpen={true} onClose={() => {}} title="AI"
        tabs={tabs} activeTab="overview" onTabChange={onTabChange}
        tabsLayoutId="test-tabs"
      >body</Modal>
    )
    fireEvent.click(screen.getByRole('tab', { name: /README/ }))
    expect(onTabChange).toHaveBeenCalledWith('readme')
  })

  it('does not render tabs when tabs prop is absent', () => {
    render(<Modal isOpen={true} onClose={() => {}} title="AI">body</Modal>)
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/ui/Modal.test.jsx -t "tabs"`
Expected: 3 tests fail — tablist not found.

- [ ] **Step 3: Update `Modal.jsx` — add tabs support**

Add import for TabBar at top:

```jsx
import { TabBar } from './TabBar'
```

Add new props to function signature (alongside existing ones):

```jsx
    tabs,
    activeTab,
    onTabChange,
    tabsLayoutId,
```

In the JSX, locate the header div block. Right after the closing `</div>` of the header row (the one containing icon + title + close button), insert a tab row:

Find the end of the header (the line `</div>` that closes the `<div className={`${styles.headerBg} ...`}>` block) and add right after it:

```jsx
                            {tabs && tabs.length > 0 && (
                                <div className="flex-shrink-0 px-4 md:px-5 bg-slate-50/80 dark:bg-slate-900/70 border-b border-slate-200/50 dark:border-slate-800/40">
                                    <TabBar
                                        tabs={tabs}
                                        activeTab={activeTab}
                                        onTabChange={onTabChange}
                                        variant="underline"
                                        layoutId={tabsLayoutId || 'modal-tabs'}
                                        size="md"
                                    />
                                </div>
                            )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/ui/Modal.test.jsx`
Expected: all 10 tests pass (7 prior + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Modal.jsx tests/components/ui/Modal.test.jsx
git commit -m "feat(ui): embed TabBar in Modal header via tabs prop"
```

---

### Task 2.3: Add `staggerChildren` and `iconGradient` to Modal

**Files:**
- Modify: `src/components/ui/Modal.jsx`
- Test: `tests/components/ui/Modal.test.jsx` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/components/ui/Modal.test.jsx`:

```jsx
describe('Modal — staggerChildren and iconGradient', () => {
  afterEach(() => { cleanup(); document.body.style.overflow = '' })

  it('wraps body in stagger container when staggerChildren=true', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Hi" staggerChildren>
        <div data-testid="child">x</div>
      </Modal>
    )
    // Stagger wrapper has data-stagger-root="true"
    expect(container.querySelector('[data-stagger-root="true"]')).not.toBeNull()
  })

  it('does not add stagger wrapper by default', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Hi">x</Modal>
    )
    expect(container.querySelector('[data-stagger-root="true"]')).toBeNull()
  })

  it('renders icon with primary gradient class when iconGradient=primary', () => {
    const Icon = () => <svg data-testid="icon" />
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Hi" icon={Icon} iconGradient="primary">x</Modal>
    )
    const iconTile = container.querySelector('[data-icon-tile="true"]')
    expect(iconTile).not.toBeNull()
    expect(iconTile.className).toMatch(/from-indigo-500/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/ui/Modal.test.jsx -t "staggerChildren"`
Expected: 3 tests fail.

- [ ] **Step 3: Update `Modal.jsx`**

Add the two new props to the function signature:

```jsx
    staggerChildren = false,
    iconGradient = 'none',
    bodyClassName = '',
```

Add these constants near the top of the file (outside the function):

```jsx
const ICON_GRADIENT_CLASSES = {
    none:    'bg-white/15',
    primary: 'bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/25',
    premium: 'bg-gradient-to-br from-indigo-500 via-cyan-500 to-pink-500 shadow-lg shadow-purple-500/25',
    success: 'bg-gradient-to-br from-emerald-500 to-cyan-500 shadow-lg shadow-emerald-500/25',
}

const STAGGER_VARIANTS = {
    hidden:  {},
    visible: { transition: { staggerChildren: 0.04, delayChildren: 0.08 } },
}
```

In the JSX, locate the icon tile block:

```jsx
                                {Icon && (
                                    <div className="bg-white/15 p-1.5 rounded-lg">
                                        <Icon className="w-6 h-6" strokeWidth={2.5} />
                                    </div>
                                )}
```

Replace with:

```jsx
                                {Icon && (
                                    <div
                                        data-icon-tile="true"
                                        className={`${ICON_GRADIENT_CLASSES[iconGradient] || ICON_GRADIENT_CLASSES.none} p-1.5 rounded-lg`}
                                    >
                                        <Icon className="w-6 h-6" strokeWidth={2.5} />
                                    </div>
                                )}
```

Locate the body div:

```jsx
                            {/* Body */}
                            <div id="modal-body" className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-slate-50/30 dark:bg-slate-950">
                                {children}
                            </div>
```

Replace with:

```jsx
                            {/* Body */}
                            <div id="modal-body" className={`flex-1 overflow-y-auto p-6 custom-scrollbar bg-slate-50/30 dark:bg-slate-950 ${bodyClassName}`}>
                                {staggerChildren ? (
                                    <motion.div
                                        data-stagger-root="true"
                                        variants={STAGGER_VARIANTS}
                                        initial="hidden"
                                        animate="visible"
                                        key={activeTab || 'default'}
                                    >
                                        {children}
                                    </motion.div>
                                ) : (
                                    children
                                )}
                            </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/ui/Modal.test.jsx`
Expected: all 13 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Modal.jsx tests/components/ui/Modal.test.jsx
git commit -m "feat(ui): add staggerChildren and iconGradient props to Modal"
```

---

### Task 2.4: Add `mobileVariant` sheet behavior to Modal

**Files:**
- Modify: `src/components/ui/Modal.jsx`
- Test: `tests/components/ui/Modal.test.jsx` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/components/ui/Modal.test.jsx`:

```jsx
describe('Modal — mobileVariant', () => {
  afterEach(() => { cleanup(); document.body.style.overflow = '' })

  it('applies sheet classes when mobileVariant=sheet', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Hi" mobileVariant="sheet">x</Modal>
    )
    const backdrop = container.querySelector('[data-modal-backdrop="true"]')
    expect(backdrop.className).toMatch(/md:items-center/)
    expect(backdrop.className).toMatch(/items-end/)

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog.className).toMatch(/max-md:rounded-t-3xl/)
    expect(dialog.className).toMatch(/max-md:rounded-b-none/)
  })

  it('applies centered classes when mobileVariant=centered', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Hi" mobileVariant="centered">x</Modal>
    )
    const backdrop = container.querySelector('[data-modal-backdrop="true"]')
    expect(backdrop.className).toMatch(/items-center/)
    expect(backdrop.className).not.toMatch(/items-end/)
  })

  it('defaults to sheet on mobile', () => {
    const { container } = render(
      <Modal isOpen={true} onClose={() => {}} title="Hi">x</Modal>
    )
    const backdrop = container.querySelector('[data-modal-backdrop="true"]')
    expect(backdrop.className).toMatch(/items-end/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/ui/Modal.test.jsx -t "mobileVariant"`
Expected: 3 tests fail.

- [ ] **Step 3: Update `Modal.jsx`**

Add the new prop default:

```jsx
    mobileVariant = 'sheet',
```

Locate the backdrop `motion.div` and add the `data-modal-backdrop` marker + conditional classes. Replace:

```jsx
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        onClick={handleBackdropClick}
                        className="fixed inset-0 bg-black/60 dark:bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-4"
                    >
```

With:

```jsx
                    <motion.div
                        data-modal-backdrop="true"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        onClick={handleBackdropClick}
                        className={`fixed inset-0 bg-black/60 dark:bg-black/75 backdrop-blur-md z-[60] flex justify-center md:items-center md:p-4 ${mobileVariant === 'sheet' ? 'items-end p-0 md:p-4' : 'items-center p-4'}`}
                    >
```

Locate the modal dialog `motion.div` and update its className + initial/animate. Replace:

```jsx
                        <motion.div
                            ref={modalRef}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="modal-title"
                            aria-describedby="modal-body"
                            initial={{ opacity: 0, scale: 0.98, y: 24 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.98, y: 24 }}
                            transition={{ type: 'spring', duration: 0.4, bounce: 0.12 }}
                            onClick={(e) => e.stopPropagation()}
                            className={`
                                ${sizeClasses[size]}
                                w-full min-w-[320px]
                                bg-white dark:bg-slate-950
                                rounded-2xl
                                shadow-[0_25px_60px_-12px_rgba(0,0,0,0.35)] dark:shadow-[0_25px_60px_-12px_rgba(0,0,0,0.7)]
                                ring-1 ring-slate-200/50 dark:ring-slate-700/50
                                overflow-hidden
                                flex flex-col
                                max-h-[85vh] md:max-h-[90vh]
                                ${className}
                            `}
                        >
```

With:

```jsx
                        <motion.div
                            ref={modalRef}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="modal-title"
                            aria-describedby="modal-body"
                            initial={mobileVariant === 'sheet' ? { opacity: 0, y: '4%' } : { opacity: 0, scale: 0.98, y: 24 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={mobileVariant === 'sheet' ? { opacity: 0, y: '4%' } : { opacity: 0, scale: 0.98, y: 24 }}
                            transition={{ type: 'spring', duration: 0.4, bounce: 0.12 }}
                            onClick={(e) => e.stopPropagation()}
                            className={`
                                ${sizeClasses[size]}
                                w-full min-w-[320px]
                                bg-white dark:bg-slate-950
                                rounded-2xl
                                ${mobileVariant === 'sheet' ? 'max-md:rounded-t-3xl max-md:rounded-b-none max-md:max-w-full' : ''}
                                shadow-[0_25px_60px_-12px_rgba(0,0,0,0.35)] dark:shadow-[0_25px_60px_-12px_rgba(0,0,0,0.7)]
                                ring-1 ring-slate-200/50 dark:ring-slate-700/50
                                overflow-hidden
                                flex flex-col
                                max-h-[92vh] md:max-h-[88vh]
                                ${className}
                            `}
                        >
```

Also update the footer to add safe-area padding when in sheet mode. Locate:

```jsx
                            {footer && (
                                <div className="flex-shrink-0 flex items-center min-h-[72px] px-6 md:px-8 bg-white/80 dark:bg-slate-900/70 ds-glass border-t border-slate-200/50 dark:border-slate-800/40">
                                    <div className="w-full">
                                        {footer}
                                    </div>
                                </div>
                            )}
```

Replace with:

```jsx
                            {footer && (
                                <div
                                    className={`flex-shrink-0 flex items-center min-h-[72px] px-6 md:px-8 bg-white/80 dark:bg-slate-900/70 ds-glass border-t border-slate-200/50 dark:border-slate-800/40 ${mobileVariant === 'sheet' ? 'pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-0' : ''}`}
                                >
                                    <div className="w-full">
                                        {footer}
                                    </div>
                                </div>
                            )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/ui/Modal.test.jsx`
Expected: all 16 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Modal.jsx tests/components/ui/Modal.test.jsx
git commit -m "feat(ui): add mobileVariant sheet/centered to Modal with safe-area"
```

---

### Task 2.5: Verify `ConfirmModal` still works after `Modal.jsx` changes

`ConfirmModal` uses the base `Modal`. Make sure none of our changes broke it.

**Files:** none (verification only)

- [ ] **Step 1: Run ConfirmModal tests**

Run: `npx vitest run tests/components/ui/ConfirmModal.test.jsx`
Expected: all existing tests pass.

- [ ] **Step 2: Run full unit test suite**

Run: `npm run test:run`
Expected: all tests pass.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: zero new warnings.

- [ ] **Step 4: No commit (verification only)**

---

## Phase 3 — Migrate `RepoInsightsModal`

### Task 3.1: Migrate the shell of `RepoInsightsModal` to `<Modal />`

Replace the hand-rolled backdrop + container + header + footer with `<Modal />`. Keep the existing tab content logic untouched in this task — migrate the wrapper first, then reorganize the content in Task 3.2.

**Files:**
- Modify: `src/components/AI/RepoInsightsModal.jsx`

- [ ] **Step 1: Open the file for reference**

Read: `src/components/AI/RepoInsightsModal.jsx` (all 309 lines). Memorize the `fetchAnalysis`, `reanalyze`, `tabs` definitions, and the three tab content blocks.

- [ ] **Step 2: Rewrite the file**

Overwrite `src/components/AI/RepoInsightsModal.jsx` with:

```jsx
import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, Brain, Lightbulb, Loader2, FileText, CheckCircle2, AlertCircle, BarChart3 } from 'lucide-react'
import { aiApi } from '../../api/ai'
import { Modal, ModalFooter } from '../ui/Modal'
import { InsightCard } from '../ui/InsightCard'
import { StatBar } from '../ui/StatBar'

const TABS = [
    { id: 'overview', label: 'Overview', icon: Sparkles },
    { id: 'quality',  label: 'Quality',  icon: BarChart3 },
    { id: 'readme',   label: 'README',   icon: FileText },
]

const getScoreColor = (score) => {
    if (score >= 80) return 'bg-emerald-500'
    if (score >= 50) return 'bg-amber-500'
    return 'bg-red-500'
}

export default function RepoInsightsModal({ repo, isOpen, onClose }) {
    const [analysis, setAnalysis] = useState(null)
    const [loading, setLoading]   = useState(false)
    const [error, setError]       = useState(null)
    const [activeTab, setActiveTab] = useState('overview')
    const abortRef = useRef(null)

    useEffect(() => {
        if (!isOpen || !repo) {
            setAnalysis(null)
            setError(null)
            return
        }

        const ctrl = new AbortController()
        abortRef.current = ctrl
        setActiveTab('overview')
        fetchAnalysis(ctrl.signal)

        return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, repo?.id])

    const fetchAnalysis = async (signal) => {
        setLoading(true)
        setError(null)
        try {
            let data = await aiApi.getMetadata(repo.id)
            if (signal?.aborted) return
            if (!data) {
                const indexResult = await aiApi.indexRepo(repo)
                if (signal?.aborted) return
                data = indexResult.analysis
            } else {
                if (typeof data.topics === 'string') data.suggested_topics = JSON.parse(data.topics)
                if (data.topics && !data.suggested_topics) data.suggested_topics = JSON.parse(data.topics)
            }
            if (!signal?.aborted) setAnalysis(data)
        } catch (err) {
            if (!signal?.aborted) setError('Failed to generate insights. Please try again.')
        } finally {
            if (!signal?.aborted) setLoading(false)
        }
    }

    const reanalyze = async () => {
        const ctrl = new AbortController()
        abortRef.current = ctrl
        setLoading(true)
        try {
            const indexResult = await aiApi.indexRepo(repo)
            if (!ctrl.signal.aborted) setAnalysis(indexResult.analysis)
        } catch {
            if (!ctrl.signal.aborted) setError('Re-analysis failed')
        } finally {
            if (!ctrl.signal.aborted) setLoading(false)
        }
    }

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="AI Insights"
            subtitle={repo?.full_name}
            icon={Sparkles}
            iconGradient="primary"
            size="3xl"
            tabs={analysis && !loading ? TABS : undefined}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            tabsLayoutId="repo-insights-tabs"
            staggerChildren={Boolean(analysis && !loading)}
            mobileVariant="sheet"
            footer={
                <ModalFooter align="right">
                    <button
                        onClick={reanalyze}
                        disabled={loading}
                        className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors inline-flex items-center gap-2 disabled:opacity-50"
                    >
                        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                        Re-analyze
                    </button>
                    <button
                        onClick={onClose}
                        className="ds-btn-shimmer px-6 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium rounded-lg hover:from-indigo-400 hover:to-purple-500 transition-all shadow-lg shadow-indigo-500/25"
                    >
                        Done
                    </button>
                </ModalFooter>
            }
        >
            {loading && !analysis && <InsightsSkeletonGrid />}
            {error && <InsightsErrorCard message={error} onRetry={() => fetchAnalysis()} />}
            {analysis && !loading && activeTab === 'overview' && <OverviewGrid data={analysis} />}
            {analysis && !loading && activeTab === 'quality'  && <QualityGrid  data={analysis} />}
            {analysis && !loading && activeTab === 'readme'   && <ReadmeGrid   data={analysis} />}
        </Modal>
    )
}

// Subcomponents defined in next tasks (3.2 – 3.5)
function InsightsSkeletonGrid() { return <div className="h-64" /> }
function InsightsErrorCard({ message, onRetry }) {
    return (
        <InsightCard tone="danger" hover={false}>
            <p className="text-red-500 mb-4">{message}</p>
            <button onClick={onRetry} className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-500 rounded-lg transition-colors">
                Retry
            </button>
        </InsightCard>
    )
}
function OverviewGrid({ data }) { return <div>overview placeholder</div> }
function QualityGrid({ data })  { return <div>quality placeholder</div> }
function ReadmeGrid({ data })   { return <div>readme placeholder</div> }
```

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: zero new warnings (unused imports for `motion`, `Brain`, `Lightbulb`, `CheckCircle2`, `AlertCircle` are OK — will be used in next tasks).

- [ ] **Step 4: Run unit tests**

Run: `npm run test:run`
Expected: all existing tests still pass. No new tests yet — Tasks 3.2 – 3.5 fill in the content.

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev` (in a separate terminal if possible)
Navigate to the app, open AI Insights on any repo. Expected:
- Modal opens with new header (indigo/purple icon tile, title "AI Insights", subtitle with repo name)
- Tabs row is visible below the header with underline variant
- Clicking tabs changes active tab
- Close button works
- Placeholder "overview placeholder" shows on Overview tab

If broken, fix before commit.

- [ ] **Step 6: Commit**

```bash
git add src/components/AI/RepoInsightsModal.jsx
git commit -m "refactor(ai): migrate RepoInsightsModal shell to shared Modal primitive"
```

---

### Task 3.2: Implement `OverviewGrid` with `CircularScore`

**Files:**
- Modify: `src/components/AI/RepoInsightsModal.jsx`

- [ ] **Step 1: Add CircularScore inline component**

In `src/components/AI/RepoInsightsModal.jsx`, add this component definition near the top (below `getScoreColor`):

```jsx
function CircularScore({ value, max = 100 }) {
    const size = 120
    const stroke = 10
    const radius = (size - stroke) / 2
    const circumference = 2 * Math.PI * radius
    const clamped = Math.max(0, Math.min(value ?? 0, max))
    const offset = circumference - (clamped / max) * circumference

    const colorClass =
        clamped >= 80 ? 'stroke-emerald-500' :
        clamped >= 50 ? 'stroke-amber-500'  :
                        'stroke-red-500'

    return (
        <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="-rotate-90">
                <circle
                    cx={size / 2} cy={size / 2} r={radius}
                    strokeWidth={stroke}
                    fill="none"
                    className="stroke-slate-200 dark:stroke-slate-800"
                />
                <motion.circle
                    cx={size / 2} cy={size / 2} r={radius}
                    strokeWidth={stroke}
                    fill="none"
                    strokeLinecap="round"
                    className={colorClass}
                    strokeDasharray={circumference}
                    initial={{ strokeDashoffset: circumference }}
                    animate={{ strokeDashoffset: offset }}
                    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold text-slate-900 dark:text-white tabular-nums">
                    {clamped}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">/{max}</span>
            </div>
        </div>
    )
}
```

- [ ] **Step 2: Replace the `OverviewGrid` placeholder**

Replace the placeholder function with:

```jsx
function OverviewGrid({ data }) {
    const summaryRef = useRef(null)
    const [expanded, setExpanded] = useState(false)
    const [needsClamp, setNeedsClamp] = useState(false)

    useEffect(() => {
        const el = summaryRef.current
        if (!el) return
        setNeedsClamp(el.scrollHeight > el.clientHeight + 2)
    }, [data?.summary])

    const hasHighlights = data.highlights?.length > 0
    const hasTopics = data.suggested_topics?.length > 0

    return (
        <div className="grid gap-4 lg:grid-cols-3">
            {/* Health Score */}
            <InsightCard tone="ai" className="lg:col-span-1 flex flex-col items-center justify-center text-center">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">
                    <Brain className="w-4 h-4" />
                    Health Score
                </div>
                <CircularScore value={data.health_score ?? 0} />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-4">
                    Based on docs, structure &amp; metadata
                </p>
            </InsightCard>

            {/* TL;DR */}
            <InsightCard className="lg:col-span-2">
                <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                    TL;DR Summary
                </h3>
                <div className="relative">
                    <p
                        ref={summaryRef}
                        className={`text-slate-700 dark:text-slate-200 leading-relaxed ${expanded ? '' : 'line-clamp-5'}`}
                    >
                        {data.summary || 'No summary available yet.'}
                    </p>
                    {needsClamp && !expanded && (
                        <button
                            onClick={() => setExpanded(true)}
                            className="mt-2 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                            Show more
                        </button>
                    )}
                </div>
            </InsightCard>

            {/* Highlights */}
            {hasHighlights && (
                <InsightCard tone="success" className="lg:col-span-3">
                    <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                        Highlights
                    </h3>
                    <div className="grid sm:grid-cols-2 gap-2">
                        {data.highlights.map((h, i) => (
                            <div key={i} className="flex items-start gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                                <span className="break-words">{h}</span>
                            </div>
                        ))}
                    </div>
                </InsightCard>
            )}

            {/* Topics */}
            {hasTopics && (
                <InsightCard tone="info" className="lg:col-span-3">
                    <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                        Suggested Topics
                    </h3>
                    <div className="flex flex-wrap gap-2">
                        {data.suggested_topics.map((topic, i) => (
                            <span
                                key={i}
                                className="px-3 py-1 bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 rounded-full text-sm"
                            >
                                #{topic}
                            </span>
                        ))}
                    </div>
                </InsightCard>
            )}

            {!hasHighlights && !hasTopics && !data.summary && (
                <InsightCard className="lg:col-span-3" hover={false}>
                    <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">
                        Analysis in progress — some sections may appear later.
                    </p>
                </InsightCard>
            )}
        </div>
    )
}
```

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: zero new warnings.

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`
Open AI Insights on a repo. Overview tab should show:
- Circular score with animated sweep
- TL;DR summary in its own card
- Highlights card (if data present)
- Topics card (if data present)
- All cards stagger-in on open / tab switch

- [ ] **Step 5: Commit**

```bash
git add src/components/AI/RepoInsightsModal.jsx
git commit -m "feat(ai): implement OverviewGrid with CircularScore and stagger cards"
```

---

### Task 3.3: Implement `QualityGrid` with `StatBar`

**Files:**
- Modify: `src/components/AI/RepoInsightsModal.jsx`

- [ ] **Step 1: Replace the `QualityGrid` placeholder**

```jsx
function QualityGrid({ data }) {
    const breakdown = data.quality_breakdown || {}
    const breakdownEntries = Object.entries(breakdown)
    const patterns = data.patterns || {}
    const featureEntries = Object.entries(patterns).filter(([k]) => k.startsWith('has'))
    const improvements = data.improvements || []

    const hasBreakdown = breakdownEntries.length > 0
    const hasFeatures = featureEntries.length > 0
    const hasImprovements = improvements.length > 0

    if (!hasBreakdown && !hasFeatures && !hasImprovements) {
        return (
            <InsightCard hover={false}>
                <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">
                    Quality data not available yet.
                </p>
            </InsightCard>
        )
    }

    return (
        <div className="grid gap-4 lg:grid-cols-2">
            {/* Quality Breakdown */}
            {hasBreakdown && (
                <InsightCard className="lg:col-span-1">
                    <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">
                        Quality Breakdown
                    </h3>
                    <div className="space-y-3">
                        {breakdownEntries.map(([key, value]) => (
                            <StatBar
                                key={key}
                                label={key.replace(/_/g, ' ')}
                                value={Number(value) || 0}
                                max={30}
                                gradient="primary"
                            />
                        ))}
                    </div>
                </InsightCard>
            )}

            {/* Detected Features */}
            {hasFeatures && (
                <InsightCard className="lg:col-span-1">
                    <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">
                        Detected Features
                    </h3>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2 max-h-[240px] overflow-y-auto custom-scrollbar pr-1">
                        {featureEntries.map(([key, value]) => (
                            <div
                                key={key}
                                className={`flex items-center gap-2 text-sm ${value ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`}
                            >
                                {value ? (
                                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                                ) : (
                                    <AlertCircle className="w-4 h-4 shrink-0" />
                                )}
                                <span className="truncate">
                                    {key.replace('has', '').replace(/([A-Z])/g, ' $1').trim()}
                                </span>
                            </div>
                        ))}
                    </div>
                </InsightCard>
            )}

            {/* Recommendations */}
            {hasImprovements && (
                <InsightCard tone="warning" className="lg:col-span-2">
                    <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                        Recommendations
                    </h3>
                    <div className="grid md:grid-cols-2 gap-2">
                        {improvements.map((imp, i) => (
                            <div
                                key={i}
                                className="flex items-start gap-3 p-3 bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 rounded-lg"
                            >
                                <Lightbulb className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
                                <p className="text-slate-700 dark:text-slate-200 text-sm break-words">{imp}</p>
                            </div>
                        ))}
                    </div>
                </InsightCard>
            )}
        </div>
    )
}
```

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: zero new warnings.

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`
Open AI Insights → Quality tab. Should show:
- Quality Breakdown card with animated StatBars
- Detected Features card in 2-column grid
- Recommendations card spanning full width with 2-column grid of items
- **No vertical scrollbar** on a 1920×1080 viewport

- [ ] **Step 4: Commit**

```bash
git add src/components/AI/RepoInsightsModal.jsx
git commit -m "feat(ai): implement QualityGrid with StatBars and 2-col layout"
```

---

### Task 3.4: Implement `ReadmeGrid`

**Files:**
- Modify: `src/components/AI/RepoInsightsModal.jsx`

- [ ] **Step 1: Replace the `ReadmeGrid` placeholder**

```jsx
function ReadmeGrid({ data }) {
    const suggestions = data.readme_suggestions || []

    if (suggestions.length === 0) {
        return (
            <InsightCard tone="success" hover={false} className="text-center py-8">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
                <p className="text-emerald-600 dark:text-emerald-400 font-medium">README looks complete!</p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    All recommended sections are present.
                </p>
            </InsightCard>
        )
    }

    return (
        <div className="grid gap-4">
            <InsightCard tone="info">
                <h3 className="text-blue-600 dark:text-blue-400 font-medium mb-1">
                    README Enhancement Suggestions
                </h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm">
                    These sections could improve your documentation:
                </p>
            </InsightCard>
            <InsightCard className="lg:col-span-1">
                <div className="grid sm:grid-cols-2 gap-2">
                    {suggestions.map((section, i) => (
                        <div
                            key={i}
                            className="flex items-center gap-3 p-3 bg-slate-100/60 dark:bg-white/5 border border-slate-200/50 dark:border-slate-800/40 rounded-lg"
                        >
                            <FileText className="w-5 h-5 text-indigo-500 dark:text-indigo-400 shrink-0" />
                            <span className="text-slate-700 dark:text-slate-200 text-sm break-words">{section}</span>
                        </div>
                    ))}
                </div>
            </InsightCard>
        </div>
    )
}
```

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: zero new warnings.

- [ ] **Step 3: Manual smoke test**

Open AI Insights → README tab. Either shows "README looks complete!" card or the suggestions cards.

- [ ] **Step 4: Commit**

```bash
git add src/components/AI/RepoInsightsModal.jsx
git commit -m "feat(ai): implement ReadmeGrid with empty and suggestion states"
```

---

### Task 3.5: Implement `InsightsSkeletonGrid`

**Files:**
- Modify: `src/components/AI/RepoInsightsModal.jsx`

- [ ] **Step 1: Replace the `InsightsSkeletonGrid` placeholder**

```jsx
function InsightsSkeletonGrid() {
    return (
        <div className="grid gap-4 lg:grid-cols-3">
            <div className="ds-skeleton h-[200px] lg:col-span-1 rounded-xl" />
            <div className="ds-skeleton h-[200px] lg:col-span-2 rounded-xl" />
            <div className="ds-skeleton h-[120px] lg:col-span-3 rounded-xl" />
            <div className="ds-skeleton h-[60px]  lg:col-span-3 rounded-xl" />
        </div>
    )
}
```

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: zero new warnings.

- [ ] **Step 3: Manual smoke test**

Open AI Insights on a repo that hasn't been analyzed yet — should see skeleton grid instead of spinner while loading.

- [ ] **Step 4: Run all unit tests**

Run: `npm run test:run`
Expected: all pass.

- [ ] **Step 5: Run build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add src/components/AI/RepoInsightsModal.jsx
git commit -m "feat(ai): implement skeleton grid loading state for RepoInsightsModal"
```

---

## Phase 4 — Migrate `OrgManagerModal` and `TransferModal`

### Task 4.1: Migrate `OrgManagerModal` to `<Modal />`

**Files:**
- Modify: `src/components/OrgManagerModal.jsx`

- [ ] **Step 1: Read the file**

Read `src/components/OrgManagerModal.jsx` (all 417 lines). Identify: imports, state, tabs definition, header JSX, the three tab content blocks, footer.

- [ ] **Step 2: Replace the wrapper JSX**

In the file, locate the outer `<AnimatePresence>` + `<motion.div>` backdrop + hand-rolled modal container (starts roughly where `<AnimatePresence>` appears). Replace the entire wrapper JSX with:

```jsx
import { Modal, ModalFooter } from './ui/Modal'
import { InsightCard } from './ui/InsightCard'
import { Building2 } from 'lucide-react'

// ... existing imports kept ...

return (
    <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Organization Manager"
        subtitle={org?.login}
        icon={Building2}
        iconGradient="primary"
        size="2xl"
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabsLayoutId="org-manager-tabs"
        staggerChildren
        mobileVariant="sheet"
        footer={
            <ModalFooter align="right">
                <button
                    onClick={onClose}
                    className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors"
                >
                    Close
                </button>
            </ModalFooter>
        }
    >
        {activeTab === 'overview' && <OrgOverviewTab org={org} /* pass existing props */ />}
        {activeTab === 'members' && <OrgMembersTab   org={org} /* pass existing props */ />}
        {activeTab === 'settings' && <OrgSettingsTab org={org} /* pass existing props */ />}
    </Modal>
)
```

**Important:** Preserve the existing logic and state variables. The three tab content blocks should be extracted into local functions (`OrgOverviewTab`, `OrgMembersTab`, `OrgSettingsTab`) containing the JSX that previously lived inline. Wrap each top-level "block" inside the tab content with `<InsightCard>` instead of the existing hand-rolled card divs.

**Rules for InsightCard replacement:**
- A div like `<div className="...bg-slate-50/50 dark:bg-white/5 rounded-xl p-4 border border-slate-200/50 dark:border-slate-800/40">` becomes `<InsightCard>`.
- Cards that show status (red/yellow/green tints) get corresponding `tone` prop (`danger`, `warning`, `success`).
- Leave buttons, forms, and inner layouts untouched.

- [ ] **Step 3: Remove the `useFocusTrap` call and `AnimatePresence` import**

Since `<Modal />` now handles the focus trap and AnimatePresence, delete these lines from the file:
- `import { useFocusTrap } from '../hooks/useFocusTrap'` (if present)
- `import { AnimatePresence, motion } from 'framer-motion'` — keep `motion` only if used elsewhere in the file; otherwise remove.
- Any `const modalRef = useFocusTrap(isOpen, onClose)` line.
- The outer `<AnimatePresence>{isOpen && ...}</AnimatePresence>` wrapper (replaced by `<Modal isOpen={isOpen} ...>`).

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: zero new warnings. If there are unused imports, clean them up.

- [ ] **Step 5: Run unit tests**

Run: `npm run test:run`
Expected: all tests pass (OrgManagerModal has no dedicated test file to break).

- [ ] **Step 6: Manual smoke test**

Run: `npm run dev`. Open Organization Manager from the app. Verify:
- New header with icon tile, title, subtitle (org login)
- Three tabs work
- Edit mode toggle in Overview still works
- Close button works
- Stagger animation on card reveal

- [ ] **Step 7: Commit**

```bash
git add src/components/OrgManagerModal.jsx
git commit -m "refactor(orgs): migrate OrgManagerModal to shared Modal primitive"
```

---

### Task 4.2: Migrate `TransferModal` to `<Modal />`

**Files:**
- Modify: `src/components/TransferModal.jsx`

- [ ] **Step 1: Read the file**

Read `src/components/TransferModal.jsx` (all 389 lines). Identify state, props, and the three key sections: action toggle, target org selection, conflict list with progress bar.

- [ ] **Step 2: Replace wrapper JSX**

Apply the same pattern as Task 4.1: wrap the content in `<Modal>` with:

```jsx
import { Modal, ModalFooter } from './ui/Modal'
import { InsightCard } from './ui/InsightCard'
import { StatBar } from './ui/StatBar'
import { ArrowRightLeft } from 'lucide-react'

// ... existing imports kept ...

return (
    <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={action === 'mirror' ? 'Mirror Repositories' : 'Transfer Repositories'}
        subtitle={selectedRepos?.length ? `${selectedRepos.length} repositories selected` : undefined}
        icon={ArrowRightLeft}
        iconGradient="primary"
        size="2xl"
        staggerChildren={!isRunning}
        mobileVariant="sheet"
        closeOnBackdrop={!isRunning}
        footer={
            <ModalFooter align="between">
                <button
                    onClick={onClose}
                    disabled={isRunning}
                    className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors disabled:opacity-50"
                >
                    Cancel
                </button>
                <button
                    onClick={handleStart}
                    disabled={!canStart || isRunning}
                    className="ds-btn-shimmer px-6 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium rounded-lg disabled:opacity-50 transition-all"
                >
                    {isRunning ? 'Running...' : (action === 'mirror' ? 'Start Mirror' : 'Start Transfer')}
                </button>
            </ModalFooter>
        }
    >
        {/* Existing content, each major block wrapped in <InsightCard> */}
        {/* Progress bar, while running, uses: */}
        {/* <StatBar value={progress} max={100} animated={false} label="Progress" gradient="primary" /> */}
    </Modal>
)
```

Inside the body:
- Wrap the action toggle section in `<InsightCard>`.
- Wrap the target-org selector in `<InsightCard>`.
- Wrap the conflicts list in `<InsightCard tone="warning">`.
- Replace the hand-rolled progress bar with `<StatBar value={progress} max={100} animated={false} label="Progress" gradient="primary" showValue />`.

Remove `useFocusTrap`, `AnimatePresence`, and the outer hand-rolled backdrop + container — same cleanup as Task 4.1.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: zero new warnings.

- [ ] **Step 4: Run unit tests**

Run: `npm run test:run`
Expected: all pass.

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`. Trigger Transfer Modal from the app (select repos → bulk action → Transfer). Verify:
- New header with ArrowRightLeft icon
- Action toggle works
- Org selection works
- Conflict list renders (create a conflicting repo if needed to test)
- Dry-run and progress bar animate during execution

- [ ] **Step 6: Commit**

```bash
git add src/components/TransferModal.jsx
git commit -m "refactor(transfer): migrate TransferModal to shared Modal primitive"
```

---

### Task 4.3: Enhance `SettingsModal` with `staggerChildren` + `InsightCard`

**Files:**
- Modify: `src/components/SettingsModal.jsx`

- [ ] **Step 1: Read the file**

Read `src/components/SettingsModal.jsx` (all 344 lines).

- [ ] **Step 2: Add `staggerChildren` and wrap blocks in `InsightCard`**

Locate the `<Modal ...>` usage. Add these props:

```jsx
staggerChildren
mobileVariant="sheet"
size="2xl"
```

Inside each tab's content (Appearance, Performance, Migration, API Keys, Usage, Billing, Audit), replace the top-level `<div>` wrappers that already look like cards (rounded corners, background, border) with `<InsightCard>`. Import:

```jsx
import { InsightCard } from './ui/InsightCard'
```

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: zero new warnings.

- [ ] **Step 4: Run unit tests**

Run: `npm run test:run`
Expected: all pass.

- [ ] **Step 5: Manual smoke test**

Open Settings modal. Verify stagger animation and unchanged functionality.

- [ ] **Step 6: Commit**

```bash
git add src/components/SettingsModal.jsx
git commit -m "refactor(settings): use staggerChildren and InsightCard in SettingsModal"
```

---

## Phase 5 — Visually align `WizardPanel`

### Task 5.1: Replace inline scroll-lock with `useBodyScrollLock` in `WizardPanel`

**Files:**
- Modify: `src/components/ui/WizardPanel.jsx`

- [ ] **Step 1: Open and edit**

In `src/components/ui/WizardPanel.jsx`:

Add import:

```jsx
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
```

Replace this block:

```jsx
  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [isOpen])
```

With:

```jsx
  useBodyScrollLock(isOpen)
```

- [ ] **Step 2: Run unit tests**

Run: `npm run test:run`
Expected: all pass (MigrationWizard tests should still work).

- [ ] **Step 3: Manual smoke test**

Open MigrationWizard. Verify body scroll lock works and wizard still opens/closes normally.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/WizardPanel.jsx
git commit -m "refactor(ui): use shared useBodyScrollLock hook in WizardPanel"
```

---

### Task 5.2: Swap internal cards in `CreateRepoModal` and `CommitGeneratorModal`

**Files:**
- Modify: `src/components/CreateRepoModal.jsx`
- Modify: `src/components/CommitGeneratorModal.jsx`

- [ ] **Step 1: Read both files**

Read `src/components/CreateRepoModal.jsx` (all 248 lines) and `src/components/CommitGeneratorModal.jsx` (all 144 lines). Identify any `<div className="...rounded-xl...bg-...">` blocks that are visually card-like.

- [ ] **Step 2: Replace in `CreateRepoModal`**

Add import:

```jsx
import { InsightCard } from './ui/InsightCard'
```

For each card-like wrapper div (owner selector panel, name validation panel, description/visibility panel, etc.), replace:

```jsx
<div className="...rounded-xl p-4 bg-slate-50/60 dark:bg-white/5 ring-1 ring-slate-200/50 dark:ring-slate-800/40">
    {/* content */}
</div>
```

With:

```jsx
<InsightCard hover={false}>
    {/* content */}
</InsightCard>
```

Set `hover={false}` because these are form sections (no hover lift desired on active forms).

- [ ] **Step 3: Replace in `CommitGeneratorModal`**

Same pattern: import `InsightCard`, wrap the diff-input panel and the output-preview panel in `<InsightCard hover={false}>`.

- [ ] **Step 4: Run lint + tests**

Run: `npm run lint && npm run test:run`
Expected: zero new warnings, all tests pass.

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`. Trigger both modals:
- CreateRepoModal: click "New Repository" → verify form layout unchanged visually, just cards now consistent.
- CommitGeneratorModal: verify the same.

- [ ] **Step 6: Commit**

```bash
git add src/components/CreateRepoModal.jsx src/components/CommitGeneratorModal.jsx
git commit -m "refactor(ui): use InsightCard in CreateRepoModal and CommitGeneratorModal"
```

---

### Task 5.3: Align `WizardPanel` scrollbar + icon tile with `Modal`

**Files:**
- Modify: `src/components/ui/WizardPanel.jsx`

- [ ] **Step 1: Verify current state**

Read `src/components/ui/WizardPanel.jsx`. Confirm it currently uses `custom-scrollbar` (matches Modal — good, no change needed). Confirm the icon tile uses `bg-white/15`.

- [ ] **Step 2: Align icon tile with new `iconGradient` pattern**

Find:

```jsx
                {Icon && (
                  <div className="bg-white/15 p-1.5 rounded-lg flex-shrink-0">
                    <Icon className="w-4 h-4" strokeWidth={2.5} />
                  </div>
                )}
```

Replace with:

```jsx
                {Icon && (
                  <div className="bg-white/15 ds-hover-glow p-1.5 rounded-lg flex-shrink-0 transition-all">
                    <Icon className="w-4 h-4" strokeWidth={2.5} />
                  </div>
                )}
```

(We keep `bg-white/15` because the WizardPanel header is already a full gradient — adding an inner gradient would be noisy. Just add `ds-hover-glow` for interaction polish.)

- [ ] **Step 3: Run lint + tests**

Run: `npm run lint && npm run test:run`
Expected: zero new warnings, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/WizardPanel.jsx
git commit -m "refactor(ui): add hover-glow to WizardPanel icon tile for consistency"
```

---

## Phase 6 — E2E + visual validation

### Task 6.1: Write E2E test for AI Insights no-scrollbar

**Files:**
- Create: `e2e/modal-redesign.spec.js`

- [ ] **Step 1: Create the E2E test file**

Create `e2e/modal-redesign.spec.js`:

```js
import { test, expect } from '@playwright/test'

/**
 * E2E: Modal System Redesign
 * Validates:
 * - AI Insights has no vertical scrollbar on desktop for any tab
 * - Bottom-sheet variant applies on mobile portrait
 * - Centered variant applies on mobile landscape
 * - Body scroll restored on close
 */

test.describe('Modal redesign — AI Insights', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Assume the app is authenticated for the test env; otherwise skip
    // This may need to be adjusted based on existing e2e auth setup
  })

  test('desktop 1920x1080: Overview tab has no vertical scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    // Open AI Insights — this selector depends on the app; use a stable test-id
    const trigger = page.getByTestId('open-ai-insights').first()
    if (!(await trigger.isVisible())) test.skip()
    await trigger.click()

    const modalBody = page.locator('#modal-body')
    await expect(modalBody).toBeVisible()

    const scrollable = await modalBody.evaluate((el) => el.scrollHeight > el.clientHeight + 1)
    expect(scrollable, 'Overview tab must not overflow on 1920x1080').toBe(false)
  })

  test('desktop 1920x1080: Quality tab has no vertical scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    const trigger = page.getByTestId('open-ai-insights').first()
    if (!(await trigger.isVisible())) test.skip()
    await trigger.click()
    await page.getByRole('tab', { name: /Quality/ }).click()

    const modalBody = page.locator('#modal-body')
    const scrollable = await modalBody.evaluate((el) => el.scrollHeight > el.clientHeight + 1)
    expect(scrollable, 'Quality tab must not overflow on 1920x1080').toBe(false)
  })

  test('mobile 390x844: bottom-sheet variant applies', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const trigger = page.getByTestId('open-ai-insights').first()
    if (!(await trigger.isVisible())) test.skip()
    await trigger.click()

    const backdrop = page.locator('[data-modal-backdrop="true"]')
    const cls = await backdrop.getAttribute('class')
    expect(cls).toContain('items-end')
  })

  test('body scroll restored on close', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    const trigger = page.getByTestId('open-ai-insights').first()
    if (!(await trigger.isVisible())) test.skip()

    const initialOverflow = await page.evaluate(() => document.body.style.overflow)
    await trigger.click()
    await page.locator('[role="dialog"]').waitFor()
    const lockedOverflow = await page.evaluate(() => document.body.style.overflow)
    expect(lockedOverflow).toBe('hidden')

    await page.getByRole('button', { name: /Done/ }).click()
    await page.locator('[role="dialog"]').waitFor({ state: 'hidden' })
    const restoredOverflow = await page.evaluate(() => document.body.style.overflow)
    expect(restoredOverflow).toBe(initialOverflow)
  })
})
```

**Note:** The trigger selector `getByTestId('open-ai-insights')` assumes a test-id exists. If it doesn't, add a `data-testid="open-ai-insights"` attribute to the button that opens AI Insights in `src/components/RepoList.jsx` or wherever it's triggered. The test uses `test.skip()` as a safety net if the trigger isn't visible — this is acceptable in CI when authentication isn't mocked, but the test should be rerun in manual E2E.

- [ ] **Step 2: Add test-id to trigger button**

Search for the AI Insights trigger with:

Run: `npx grep -rn "RepoInsightsModal\|openModal.*showRepoInsights\|AI Insights" src/components/ --include="*.jsx"` (via the Grep tool, not bash)

Use Grep tool with pattern `showRepoInsights|RepoInsightsModal` across `src/components/**/*.jsx` to locate the trigger. Add `data-testid="open-ai-insights"` to the found button.

- [ ] **Step 3: Run E2E test**

Run: `npx playwright test e2e/modal-redesign.spec.js --project=chromium`
Expected: the 4 tests pass OR skip cleanly if authentication blocks them.

If they fail for scrollbar reasons, the issue is in `RepoInsightsModal` — go back and debug.

- [ ] **Step 4: Commit**

```bash
git add e2e/modal-redesign.spec.js src/components/RepoList.jsx
git commit -m "test(e2e): add modal redesign scrollbar and mobile-sheet checks"
```

---

### Task 6.2: Capture Playwright MCP screenshots

**Files:** outputs to `docs/images/`

- [ ] **Step 1: Start the dev server**

Run: `npm run dev:all` (starts both backend and frontend)
Wait for the app to be accessible at `http://localhost:5173`.

- [ ] **Step 2: Capture 16 screenshots**

Use the Playwright MCP tool (`mcp__plugin_playwright_playwright__browser_*`) to navigate the app and capture:

For each screenshot, navigate → open the modal → capture with `browser_take_screenshot`, save to:

```
docs/images/2026-04-11_modal-redesign_<viewport>_<theme>_<motion>_<modal>_<tab>_hd.png
```

**Matrix (16 screenshots):**

| # | Viewport | Theme | Motion | Modal | Tab |
|---|---|---|---|---|---|
| 1 | 1920×1080 | light | normal | AIInsights | Overview |
| 2 | 1920×1080 | light | normal | AIInsights | Quality |
| 3 | 1920×1080 | light | normal | AIInsights | README |
| 4 | 1920×1080 | light | normal | OrgManager | Overview |
| 5 | 1920×1080 | light | normal | Transfer | — |
| 6 | 1920×1080 | light | normal | Settings | General |
| 7 | 1920×1080 | dark | normal | AIInsights | Overview |
| 8 | 1920×1080 | dark | normal | AIInsights | Quality |
| 9 | 1920×1080 | dark | normal | AIInsights | README |
| 10 | 1920×1080 | dark | normal | OrgManager | Overview |
| 11 | 1920×1080 | dark | normal | Transfer | — |
| 12 | 1920×1080 | dark | normal | Settings | General |
| 13 | 390×844 | dark | normal | AIInsights | Quality |
| 14 | 390×844 | dark | normal | OrgManager | Overview |
| 15 | 844×390 | dark | normal | AIInsights | Quality |
| 16 | 1920×1080 | dark | reduced | AIInsights | Quality |

For the `reduced` motion screenshot, emulate it via Playwright context option `reducedMotion: 'reduce'` or use `page.emulateMedia({ reducedMotion: 'reduce' })`.

For dark mode, toggle via the theme switcher in the app before opening the modal.

- [ ] **Step 3: Verify scrollbars**

Visually inspect screenshots 1-3, 7-9 (AI Insights desktop). **No vertical scrollbar may be visible inside the modal body.** If any shows a scrollbar, the task is not done.

- [ ] **Step 4: Commit screenshots**

```bash
git add docs/images/2026-04-11_modal-redesign_*.png
git commit -m "docs(images): capture modal redesign visual regression screenshots"
```

---

### Task 6.3: Final validation run

**Files:** none (validation only)

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: zero errors, zero new warnings vs baseline from Task 0.1.

- [ ] **Step 2: Unit tests**

Run: `npm run test:run`
Expected: all pass, coverage for new files (InsightCard, StatBar, useBodyScrollLock, Modal new tests) included.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean production build. Check bundle size delta is reasonable (<5KB gzipped increase).

- [ ] **Step 4: E2E**

Run: `npm run test:e2e`
Expected: existing E2E tests still pass, new `modal-redesign.spec.js` tests pass.

- [ ] **Step 5: Line-count delta check**

Run via Bash (inside sh, using wc -l on each of these):

```bash
wc -l src/components/AI/RepoInsightsModal.jsx \
      src/components/OrgManagerModal.jsx \
      src/components/TransferModal.jsx \
      src/components/ui/Modal.jsx \
      src/components/ui/InsightCard.jsx \
      src/components/ui/StatBar.jsx
```

Compare vs baseline. Expected: net reduction ≥ 200 lines on the three migrated modals (offset by additions in Modal.jsx / InsightCard / StatBar is acceptable).

- [ ] **Step 6: Manual edge-case walkthrough**

Go through the edge case table in the spec one by one. For each, verify the mitigation works:

1. Long summary → "Show more" button appears and expands
2. 0 / 4 / 6 breakdown items → layout doesn't break
3. 20+ features → internal scroll inside Detected Features card only
4. Re-analyze → body dims, spinner in footer, no flash
5. Close during loading → no console errors (check devtools)
6. Rapid open/close/open → no double-fetch in network tab
7. Mobile landscape (use devtools 844×390) → centered, not sheet
9. Body scroll locked → can't scroll page behind modal
13. Reduced motion (devtools → rendering → prefers-reduced-motion: reduce) → no spring, no stagger
14. Arrow keys between tabs → focus moves correctly
15. z-index stacking (if a confirm opens on top) → confirm above insights

Mark any failures and fix inline.

- [ ] **Step 7: No commit (validation only)**

---

## Phase 7 — Update docs index

### Task 7.1: Add entry to docs index

**Files:**
- Modify: `docs/index.md`

- [ ] **Step 1: Read `docs/index.md`**

Read the file to find where specs are listed.

- [ ] **Step 2: Add entries for the spec and plan**

Add under the "Specs" section (create it if absent):

```markdown
- [2026-04-11 Modal System Redesign](specs/2026-04-11-modal-system-redesign.md) — AI Insights scrollbar fix, shared Modal primitive consolidation, InsightCard + StatBar shared components. Plan: [plans/2026-04-11-modal-system-redesign.md](plans/2026-04-11-modal-system-redesign.md).
```

- [ ] **Step 3: Commit**

```bash
git add docs/index.md
git commit -m "docs: index modal system redesign spec and plan"
```

---

## Summary

**What this plan delivers:**

- `src/hooks/useBodyScrollLock.js` — new shared hook with tests
- `src/components/ui/InsightCard.jsx` — new shared card with 6 tones and stagger integration
- `src/components/ui/StatBar.jsx` — new animated progress bar with `animated={false}` mode
- `src/components/ui/Modal.jsx` — enhanced with subtitle, 2xl/3xl sizes, tabs, staggerChildren, iconGradient, mobileVariant
- `src/components/AI/RepoInsightsModal.jsx` — migrated, reorganized into 3-col grid on Overview and 2-col grid on Quality, CircularScore + skeleton grid + AbortController
- `src/components/OrgManagerModal.jsx` — migrated
- `src/components/TransferModal.jsx` — migrated, progress bar uses StatBar
- `src/components/SettingsModal.jsx` — enhanced with staggerChildren + InsightCard
- `src/components/ui/WizardPanel.jsx` — uses shared `useBodyScrollLock`
- `e2e/modal-redesign.spec.js` — Playwright E2E scrollbar + mobile-sheet checks
- `docs/images/2026-04-11_modal-redesign_*.png` — 16 visual regression screenshots
- `docs/index.md` — indexed

**Commits:** approximately 22 commits in a clean linear history, one per task.

**Risk mitigation:** Phase 0 baseline check, per-task lint+test, manual smoke test before each commit, full validation in Phase 6.
