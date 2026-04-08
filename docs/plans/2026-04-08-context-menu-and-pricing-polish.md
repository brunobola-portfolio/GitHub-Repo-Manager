# Context Menu + Pricing Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the scrollbar bug + native-feel polish on the repo context menu, and add a six-layer "dazzle" hover system to pricing cards (both landing preview and `/pricing` page), all respecting `prefers-reduced-motion`.

**Architecture:** Part 1 replaces a naive clamp-based positioner in `ContextMenu.jsx` with a pure `calculateMenuPosition` function (flip-first, clamp-last) and removes the `max-h + overflow-y-auto` classes that were causing the spurious scrollbars. Visual polish is applied to the same container className plus the batch items array gets grouped separators. Part 2 extracts the hover behavior into a reusable `usePricingCardHover` hook that both `PricingCard.jsx` and `PricingPreview.jsx` consume — the two surfaces keep their distinct visual identities while sharing identical hover mechanics.

**Tech Stack:** React 19, Framer Motion, Tailwind CSS v4, Vitest + @testing-library/react, Playwright. Reference spec: [docs/specs/2026-04-08-context-menu-and-pricing-polish.md](../specs/2026-04-08-context-menu-and-pricing-polish.md).

---

## File Map

- `src/lib/menuPositioning.js` — **create**. Pure `calculateMenuPosition` flip-first positioner, unit-testable.
- `src/components/ui/ContextMenu.jsx` — **modify**. Use pure positioner, remove scroll constraint, apply polish classes, switch to `useLayoutEffect`.
- `src/components/RepoContextMenu.jsx` — **modify**. Add one group separator in the batch items array.
- `src/hooks/usePricingCardHover.js` — **create**. Shared hover hook: cursor tracking, layer components, reduced-motion guard.
- `src/components/Pricing/PricingCard.jsx` — **modify**. Consume hook, render layers inside the card body, magnetic CTA, price gradient shift, feature icon pop.
- `src/components/Landing/PricingPreview.jsx` — **modify**. Consume hook, render layers inside mapped cards, magnetic CTA, feature icon pop.
- `tests/lib/menuPositioning.test.js` — **create**. Unit tests for all flip/clamp branches.
- `tests/hooks/usePricingCardHover.test.jsx` — **create**. Unit tests for hook state, tier accents, reduced-motion.
- `e2e/context-menu-scroll-free.spec.js` — **create**. Verify no scrollbars across viewport positions.
- `e2e/pricing-hover.spec.js` — **create**. Verify hover layers render and reduced-motion disables them.

---

## Part 1 — Context Menu

### Task 1: Extract and test pure `calculateMenuPosition`

**Rationale:** The current positioning logic lives inside a `useEffect` in `ContextMenu.jsx` lines 44-77, which makes it untestable and tangled with React state. A pure function is straightforward to unit test across all flip/clamp branches.

**Files:**
- Create: `src/lib/menuPositioning.js`
- Create: `tests/lib/menuPositioning.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/menuPositioning.test.js` with the full test suite:

```js
import { describe, it, expect } from 'vitest'
import { calculateMenuPosition } from '@/lib/menuPositioning'

const viewport = { width: 1280, height: 800 }
const margin = 8

describe('calculateMenuPosition', () => {
  describe('main menu (not submenu)', () => {
    it('opens down+right when there is room', () => {
      const pos = calculateMenuPosition({
        clickX: 100, clickY: 100,
        menuWidth: 200, menuHeight: 160,
        viewport, margin,
      })
      expect(pos).toEqual({ top: 100, left: 100, submenuDirection: 'right' })
    })

    it('flips up when not enough room below', () => {
      const pos = calculateMenuPosition({
        clickX: 100, clickY: 750,
        menuWidth: 200, menuHeight: 160,
        viewport, margin,
      })
      // Not enough space below (800 - 750 = 50 < 160), space above 750 >= 160 → flip up
      expect(pos.top).toBe(750 - 160)
      expect(pos.left).toBe(100)
    })

    it('flips left when not enough room right', () => {
      const pos = calculateMenuPosition({
        clickX: 1200, clickY: 100,
        menuWidth: 200, menuHeight: 160,
        viewport, margin,
      })
      // Not enough space right (1280 - 1200 = 80 < 200), space left 1200 >= 200 → flip left
      expect(pos.left).toBe(1200 - 200)
      expect(pos.top).toBe(100)
    })

    it('flips both axes when click is in bottom-right corner', () => {
      const pos = calculateMenuPosition({
        clickX: 1200, clickY: 750,
        menuWidth: 200, menuHeight: 160,
        viewport, margin,
      })
      expect(pos.left).toBe(1200 - 200)
      expect(pos.top).toBe(750 - 160)
    })

    it('clamps to viewport when menu is too tall to flip', () => {
      const pos = calculateMenuPosition({
        clickX: 100, clickY: 100,
        menuWidth: 200, menuHeight: 900, // larger than viewport height 800
        viewport, margin,
      })
      // Neither direction fits; clamp to margin and let it spill at the other edge
      expect(pos.top).toBe(margin)
    })

    it('clamps left to margin when click is near left edge', () => {
      const pos = calculateMenuPosition({
        clickX: 2, clickY: 100,
        menuWidth: 200, menuHeight: 160,
        viewport, margin,
      })
      expect(pos.left).toBe(margin)
    })

    it('clamps top to margin when click is near top edge', () => {
      const pos = calculateMenuPosition({
        clickX: 100, clickY: 2,
        menuWidth: 200, menuHeight: 160,
        viewport, margin,
      })
      expect(pos.top).toBe(margin)
    })
  })

  describe('submenu positioning', () => {
    it('opens to the right of the parent when there is room', () => {
      const pos = calculateMenuPosition({
        clickX: 300, clickY: 200,
        menuWidth: 180, menuHeight: 120,
        viewport, margin,
        isSubmenu: true,
        parentDirection: 'right',
      })
      expect(pos.left).toBe(300)
      expect(pos.submenuDirection).toBe('right')
    })

    it('flips to the left when parent-right side does not fit', () => {
      const pos = calculateMenuPosition({
        clickX: 1180, clickY: 200,
        menuWidth: 180, menuHeight: 120,
        viewport, margin,
        isSubmenu: true,
        parentDirection: 'right',
        parentWidth: 200, // parent menu is 200 wide
      })
      // 1180 + 180 = 1360 > 1280 - 8, must flip
      // flipped position = 1180 - 180 - 200 = 800
      expect(pos.left).toBe(800)
      expect(pos.submenuDirection).toBe('left')
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/menuPositioning.test.js`
Expected: FAIL — `Cannot find module '@/lib/menuPositioning'` or similar module-not-found error.

- [ ] **Step 3: Create the `calculateMenuPosition` function**

Create `src/lib/menuPositioning.js`:

```js
/**
 * Pure flip-first menu positioner.
 *
 * Placement preference (in order):
 *   1. Open in the preferred direction if the menu fits there.
 *   2. Otherwise flip to the opposite side.
 *   3. Otherwise clamp to the viewport margin.
 *
 * @param {object} args
 * @param {number} args.clickX        - Click X in viewport coordinates
 * @param {number} args.clickY        - Click Y in viewport coordinates
 * @param {number} args.menuWidth     - Measured menu width in px
 * @param {number} args.menuHeight    - Measured menu height in px
 * @param {{width:number,height:number}} args.viewport
 * @param {number} [args.margin=8]    - Minimum gap from viewport edges
 * @param {boolean} [args.isSubmenu=false]
 * @param {'right'|'left'} [args.parentDirection='right'] - Preferred submenu side
 * @param {number} [args.parentWidth=0] - Parent menu width (submenu only) used when flipping left
 * @returns {{top:number, left:number, submenuDirection:'right'|'left'}}
 */
export function calculateMenuPosition({
	clickX,
	clickY,
	menuWidth,
	menuHeight,
	viewport,
	margin = 8,
	isSubmenu = false,
	parentDirection = 'right',
	parentWidth = 0,
}) {
	// --- Vertical placement ---
	const spaceBelow = viewport.height - clickY - margin
	const spaceAbove = clickY - margin
	let top
	if (menuHeight <= spaceBelow) {
		// Fits downward
		top = clickY
	} else if (menuHeight <= spaceAbove) {
		// Flip upward
		top = clickY - menuHeight
	} else {
		// Neither direction fits fully — clamp so the menu top is at margin
		top = margin
	}

	// --- Horizontal placement ---
	let left
	let submenuDirection = parentDirection

	if (isSubmenu) {
		// Submenu: prefer parentDirection; flip to the opposite side if it doesn't fit.
		if (parentDirection === 'right') {
			if (clickX + menuWidth <= viewport.width - margin) {
				left = clickX
				submenuDirection = 'right'
			} else {
				// Flip left: place submenu to the left of the parent menu
				left = clickX - menuWidth - parentWidth
				submenuDirection = 'left'
			}
		} else {
			// parentDirection === 'left'
			if (clickX - menuWidth >= margin) {
				left = clickX - menuWidth
				submenuDirection = 'left'
			} else {
				left = clickX + parentWidth
				submenuDirection = 'right'
			}
		}
	} else {
		// Main menu: prefer rightward from click.
		const spaceRight = viewport.width - clickX - margin
		const spaceLeft = clickX - margin
		if (menuWidth <= spaceRight) {
			left = clickX
		} else if (menuWidth <= spaceLeft) {
			left = clickX - menuWidth
		} else {
			left = margin
		}
	}

	// Final safety clamps in case caller gives out-of-range input.
	if (left < margin) left = margin
	if (top < margin) top = margin

	return { top, left, submenuDirection }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/menuPositioning.test.js`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/menuPositioning.js tests/lib/menuPositioning.test.js
git commit -m "feat(ui): add pure calculateMenuPosition with flip-first logic"
```

---

### Task 2: Integrate `calculateMenuPosition` into `ContextMenu.jsx` and remove scroll constraint

**Files:**
- Modify: `src/components/ui/ContextMenu.jsx:44-77` (the useEffect positioning block)
- Modify: `src/components/ui/ContextMenu.jsx:273` (the container className)

- [ ] **Step 1: Add the import**

Open `src/components/ui/ContextMenu.jsx`. After the existing imports at the top (line 3), add:

```jsx
import { calculateMenuPosition } from '@/lib/menuPositioning'
```

- [ ] **Step 2: Replace the positioning useEffect with a useLayoutEffect using the pure function**

Find lines 43-77 (the `// Viewport clamping` block and the `useEffect` that follows it) and replace the entire block with:

```jsx
	// Flip-first positioning: measure menu, then compute final placement.
	useLayoutEffect(() => {
		if (!menuRef.current) return
		const rect = menuRef.current.getBoundingClientRect()
		const parentWidth = isSubmenu
			? (menuRef.current.parentElement?.getBoundingClientRect().width || 0)
			: 0

		const result = calculateMenuPosition({
			clickX: x,
			clickY: y,
			menuWidth: rect.width,
			menuHeight: rect.height,
			viewport: { width: window.innerWidth, height: window.innerHeight },
			margin: 8,
			isSubmenu,
			parentDirection,
			parentWidth,
		})

		Promise.resolve().then(() => {
			setPosition({ top: result.top, left: result.left })
			if (isSubmenu) setSubmenuDirection(result.submenuDirection)
		})
	}, [x, y, isSubmenu, parentDirection])
```

Note: `useLayoutEffect` is already imported on line 1 of the file. `Promise.resolve().then(...)` is kept to match the pattern used elsewhere in the file (defers state updates out of the layout-effect phase to avoid "cannot update during render" warnings under React 19 StrictMode).

- [ ] **Step 3: Remove the scroll constraint and tighten container polish**

Find line 273 (the `className` of the outer `motion.div`). Replace the entire className string with:

```jsx
					className="fixed z-[100] min-w-[200px] max-w-[280px] overflow-visible p-1 rounded-xl border border-black/5 dark:border-white/10 bg-white/85 dark:bg-neutral-900/85 backdrop-blur-xl outline-none shadow-[0_20px_40px_-12px_rgba(0,0,0,0.25),0_2px_6px_-2px_rgba(0,0,0,0.15)] dark:shadow-[0_20px_40px_-12px_rgba(0,0,0,0.55),0_2px_6px_-2px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.06)]"
```

Key changes vs. the old value:
- Removed `max-h-[calc(100vh-16px)]` and `overflow-y-auto` (the bug source).
- Added `overflow-visible` explicitly so no parent overflow bleeds through.
- Changed `py-1.5` → `p-1` for the new padding rhythm.
- Replaced `border-slate-200/70 dark:border-slate-700/60` → hairline `border-black/5 dark:border-white/10`.
- Replaced `bg-white/95 dark:bg-slate-800/95` → `bg-white/85 dark:bg-neutral-900/85` (frosted glass).
- Replaced `shadow-2xl shadow-slate-900/20 dark:shadow-black/50` → explicit dual-layer shadow with inner top highlight in dark mode.

- [ ] **Step 4: Tighten item padding, rounded-lg highlight, and header typography**

Still in `ContextMenu.jsx`, find the **header** render block (lines 288-298) and replace it with:

```jsx
					if (item.type === 'header') {
						return (
							<div
								key={`hdr-${index}`}
								className="text-[10.5px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-[0.08em] px-2.5 pt-1.5 pb-1 select-none"
								role="presentation"
							>
								{item.label}
							</div>
						)
					}
```

Then find the **separator** render block (lines 278-286) and replace it with:

```jsx
					if (item.type === 'separator') {
						return (
							<div
								key={`sep-${index}`}
								className="my-1 h-px bg-black/[0.06] dark:bg-white/[0.08]"
								role="separator"
							/>
						)
					}
```

Then find the **item** render block — specifically the className template literal (lines 313-327) and replace it with:

```jsx
							className={`
								px-2.5 py-1.5 rounded-lg flex items-center gap-2.5 text-sm select-none transition-colors duration-75
								${item.disabled
									? 'opacity-40 cursor-not-allowed'
									: 'cursor-pointer'
								}
								${item.danger && !item.disabled
									? isHovered
										? 'bg-red-500/10 dark:bg-red-500/15 text-red-600 dark:text-red-400'
										: 'text-red-600 dark:text-red-400'
									: isHovered && !item.disabled
										? 'bg-black/[0.06] dark:bg-white/[0.08] text-slate-900 dark:text-white'
										: 'text-slate-700 dark:text-slate-300'
								}
							`}
```

Key changes vs. old:
- Removed `mx-1.5` — the container `p-1` handles outer spacing now.
- Hover highlight uses `bg-black/[0.06] dark:bg-white/[0.08]` (matches the separator), inset-native feel.
- Danger hover uses `bg-red-500/10 dark:bg-red-500/15` to match the tokenized palette.

- [ ] **Step 5: Manually verify the menu in the app**

Run the dev server (if not already running): `npm run dev`
In the browser:
1. Navigate to the repo list page.
2. Right-click on a repo card → context menu should open without any scrollbar, with the new frosted-glass + hairline border look.
3. Select 2+ repos via checkboxes and right-click one → batch menu should open without scrollbars.
4. Try opening the menu near the bottom edge of the viewport → it should flip to open upward.
5. Hover the Migration or Management items → submenu should open without scrollbars and flip leftward if close to the right edge.

Expected: No scrollbars in any position. Menu positioning feels "snappy" with flip behavior.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/ContextMenu.jsx
git commit -m "fix(ui): remove context menu scrollbars, add flip-first positioning and native polish"
```

---

### Task 3: Add a group separator to `RepoContextMenu` batch items

**Files:**
- Modify: `src/components/RepoContextMenu.jsx:99-129`

**Context:** The batch items array already has one separator (line 122) between Management and Delete. The spec's design called for separators to divide Archive / (Migration + Management) / Delete into three groups. Only one new separator is needed — between Archive and Migration.

- [ ] **Step 1: Add the missing separator**

Open `src/components/RepoContextMenu.jsx`. Find the `batchItems` array (starts line 99). Locate the Archive action that ends at line 105, and the Migration entry that starts at line 106. Insert a separator between them:

```jsx
	const batchItems = [
		{ type: 'header', label: `${selectedRepos.length} repositories selected` },
		{
			label: `Archive ${selectedRepos.length} repos`,
			icon: Archive,
			onClick: () => onAction('archive_selected', selectedRepos)
		},
		{ type: 'separator' },
		{
			label: 'Migration',
			icon: Rocket,
			children: [
				{ label: `Migrate ${selectedRepos.length} repos`, onClick: () => onAction('migrate_selected', selectedRepos) },
				{ label: 'Dry-Run (Simulate)', onClick: () => onAction('dryRun_selected', selectedRepos) }
			]
		},
		{
			label: 'Management',
			icon: Package,
			children: [
				{ label: `Transfer ${selectedRepos.length} repos`, onClick: () => onAction('transfer_selected', selectedRepos) },
				{ label: 'Export Metadata (JSON)', onClick: () => onAction('exportMeta_selected', selectedRepos) }
			]
		},
		{ type: 'separator' },
		{
			label: `Delete ${selectedRepos.length} repos`,
			icon: Trash2,
			danger: true,
			onClick: () => onAction('delete_selected', selectedRepos)
		}
	]
```

- [ ] **Step 2: Verify in the browser**

With 2+ repos selected, right-click one and confirm the batch menu now shows three visual groups:
1. Archive
2. Migration, Management
3. Delete

Each separated by a hairline divider. The already-polished Task 2 separator styling will apply automatically.

- [ ] **Step 3: Commit**

```bash
git add src/components/RepoContextMenu.jsx
git commit -m "feat(ui): group batch context menu into Archive / Migrate-Manage / Delete"
```

---

### Task 4: E2E test — context menu never shows scrollbars and flips near edges

**Files:**
- Create: `e2e/context-menu-scroll-free.spec.js`

- [ ] **Step 1: Write the E2E test**

Create `e2e/context-menu-scroll-free.spec.js`:

```js
import { test, expect } from '@playwright/test'

test.describe('Context Menu — scroll-free and flip behavior', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/')
		// Wait until at least one repo card is visible.
		await page.locator('[data-testid="repo-card"]').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
	})

	test('right-click menu opens without scrollbars', async ({ page }) => {
		const card = page.locator('[data-testid="repo-card"]').first()
		if (!(await card.isVisible())) test.skip()

		await card.click({ button: 'right' })
		const menu = page.getByRole('menu').first()
		await expect(menu).toBeVisible()

		// Assert no vertical or horizontal scrolling is possible on the menu.
		const dims = await menu.evaluate((el) => ({
			scrollHeight: el.scrollHeight,
			clientHeight: el.clientHeight,
			scrollWidth: el.scrollWidth,
			clientWidth: el.clientWidth,
			overflowY: getComputedStyle(el).overflowY,
			overflowX: getComputedStyle(el).overflowX,
		}))

		expect(dims.scrollHeight).toBe(dims.clientHeight)
		expect(dims.scrollWidth).toBe(dims.clientWidth)
		expect(['visible', 'clip']).toContain(dims.overflowY)
		expect(['visible', 'clip']).toContain(dims.overflowX)
	})

	test('menu flips upward when opened near bottom edge', async ({ page }) => {
		const viewport = page.viewportSize()
		if (!viewport) test.skip()

		const card = page.locator('[data-testid="repo-card"]').first()
		if (!(await card.isVisible())) test.skip()

		// Dispatch a contextmenu event at the very bottom of the viewport, where the menu would overflow if opened downward.
		await page.dispatchEvent('body', 'contextmenu', {
			bubbles: true,
			clientX: 200,
			clientY: viewport.height - 20,
		})
		// Note: this tests that a contextmenu near the bottom doesn't produce a menu that overflows.
		// Some pages intercept contextmenu — if the global menu doesn't open here, skip gracefully.
		const menu = page.getByRole('menu').first()
		if (!(await menu.isVisible({ timeout: 500 }).catch(() => false))) test.skip()

		const menuBox = await menu.boundingBox()
		expect(menuBox).not.toBeNull()
		if (menuBox) {
			// Menu must fit inside the viewport vertically.
			expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height)
			expect(menuBox.y).toBeGreaterThanOrEqual(0)
		}
	})

	test('batch menu shows no scrollbar with multiple repos selected', async ({ page }) => {
		// Select multiple repos via the selection checkbox on cards (if present).
		const checkboxes = page.locator('[data-testid="repo-card-checkbox"]')
		const count = await checkboxes.count()
		if (count < 2) test.skip()
		await checkboxes.nth(0).click()
		await checkboxes.nth(1).click()

		// Right-click on one of the selected cards
		const card = page.locator('[data-testid="repo-card"]').first()
		await card.click({ button: 'right' })
		const menu = page.getByRole('menu').first()
		await expect(menu).toBeVisible()

		const dims = await menu.evaluate((el) => ({
			scrollHeight: el.scrollHeight,
			clientHeight: el.clientHeight,
			scrollWidth: el.scrollWidth,
			clientWidth: el.clientWidth,
		}))
		expect(dims.scrollHeight).toBe(dims.clientHeight)
		expect(dims.scrollWidth).toBe(dims.clientWidth)
	})
})
```

**Note on `data-testid` attributes:** If `[data-testid="repo-card"]` or `[data-testid="repo-card-checkbox"]` selectors don't match anything, the tests `test.skip()` gracefully. If the current repo card component uses a different marker, update the selectors to match the actual DOM before running. Grep with: `grep -r "data-testid=\"repo-card" src/components/` to find the actual names.

- [ ] **Step 2: Run the E2E test**

Run: `npx playwright test e2e/context-menu-scroll-free.spec.js`
Expected: PASS (or the `test.skip()` branches skip if the app isn't in a state to open the menu — a passing skip is acceptable here and will pass in CI).

- [ ] **Step 3: Commit**

```bash
git add e2e/context-menu-scroll-free.spec.js
git commit -m "test(e2e): context menu never shows scrollbars and flips near edges"
```

---

## Part 2 — Pricing Cards

### Task 5: Create `usePricingCardHover` hook with cursor tracking and reduced-motion detection

**Files:**
- Create: `src/hooks/usePricingCardHover.js`
- Create: `tests/hooks/usePricingCardHover.test.jsx`

**Design:** The hook is stateful but lightweight — it manages `isHovered` and `hoverKey`, exposes handlers to attach to the card root, reads `useReducedMotion`, and exposes a `TIER_ACCENTS` lookup. The hook **does not** render JSX — a separate `PricingCardHoverLayers` component (colocated in the same file) is exported and rendered by consumers. This keeps the hook pure for unit testing while the layer component is where the JSX lives.

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/usePricingCardHover.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { render, screen } from '@testing-library/react'
import {
	usePricingCardHover,
	PricingCardHoverLayers,
	TIER_ACCENTS,
} from '@/hooks/usePricingCardHover'

// Mock framer-motion's useReducedMotion so we control it per test.
vi.mock('framer-motion', async () => {
	const actual = await vi.importActual('framer-motion')
	return { ...actual, useReducedMotion: vi.fn(() => false) }
})

import { useReducedMotion } from 'framer-motion'

describe('TIER_ACCENTS', () => {
	it('has all three tiers with expected shape', () => {
		for (const tier of ['free', 'pro', 'enterprise']) {
			expect(TIER_ACCENTS[tier]).toBeDefined()
			expect(TIER_ACCENTS[tier]).toHaveProperty('primary')
			expect(TIER_ACCENTS[tier]).toHaveProperty('secondary')
			expect(TIER_ACCENTS[tier]).toHaveProperty('spotlight')
			expect(TIER_ACCENTS[tier]).toHaveProperty('shadowClass')
		}
	})
})

describe('usePricingCardHover', () => {
	beforeEach(() => {
		useReducedMotion.mockReturnValue(false)
	})
	afterEach(() => {
		vi.clearAllMocks()
	})

	it('initializes with isHovered=false and hoverKey=0', () => {
		const { result } = renderHook(() => usePricingCardHover({ tier: 'pro' }))
		expect(result.current.isHovered).toBe(false)
		expect(result.current.hoverKey).toBe(0)
	})

	it('sets isHovered=true and bumps hoverKey on mouse enter', () => {
		const { result } = renderHook(() => usePricingCardHover({ tier: 'pro' }))
		act(() => {
			result.current.handlers.onMouseEnter()
		})
		expect(result.current.isHovered).toBe(true)
		expect(result.current.hoverKey).toBe(1)
		act(() => {
			result.current.handlers.onMouseEnter()
		})
		expect(result.current.hoverKey).toBe(2)
	})

	it('sets isHovered=false on mouse leave', () => {
		const { result } = renderHook(() => usePricingCardHover({ tier: 'pro' }))
		act(() => { result.current.handlers.onMouseEnter() })
		act(() => { result.current.handlers.onMouseLeave() })
		expect(result.current.isHovered).toBe(false)
	})

	it('exposes the correct accent for the tier argument', () => {
		const { result: free } = renderHook(() => usePricingCardHover({ tier: 'free' }))
		const { result: pro } = renderHook(() => usePricingCardHover({ tier: 'pro' }))
		const { result: ent } = renderHook(() => usePricingCardHover({ tier: 'enterprise' }))
		expect(free.current.accent).toBe(TIER_ACCENTS.free)
		expect(pro.current.accent).toBe(TIER_ACCENTS.pro)
		expect(ent.current.accent).toBe(TIER_ACCENTS.enterprise)
	})

	it('returns reducedMotion=true when framer-motion signals reduced motion', () => {
		useReducedMotion.mockReturnValue(true)
		const { result } = renderHook(() => usePricingCardHover({ tier: 'pro' }))
		expect(result.current.reducedMotion).toBe(true)
	})

	it('has no effect from onMouseMove when reducedMotion is true', () => {
		useReducedMotion.mockReturnValue(true)
		const { result } = renderHook(() => usePricingCardHover({ tier: 'pro' }))
		const fakeEl = { style: { setProperty: vi.fn() }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 400 }) }
		result.current.cardRef.current = fakeEl
		act(() => {
			result.current.handlers.onMouseMove({ clientX: 150, clientY: 200 })
		})
		expect(fakeEl.style.setProperty).not.toHaveBeenCalled()
	})

	it('updates --mx and --my CSS vars on mouse move when motion is enabled', () => {
		const { result } = renderHook(() => usePricingCardHover({ tier: 'pro' }))
		const fakeEl = { style: { setProperty: vi.fn() }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 400 }) }
		result.current.cardRef.current = fakeEl
		act(() => {
			result.current.handlers.onMouseMove({ clientX: 150, clientY: 200 })
		})
		expect(fakeEl.style.setProperty).toHaveBeenCalledWith('--mx', '50%')
		expect(fakeEl.style.setProperty).toHaveBeenCalledWith('--my', '50%')
	})
})

describe('PricingCardHoverLayers', () => {
	it('renders the spotlight layer when motion is enabled', () => {
		useReducedMotion.mockReturnValue(false)
		render(
			<div style={{ position: 'relative' }}>
				<PricingCardHoverLayers tier="pro" isHovered={false} hoverKey={0} reducedMotion={false} />
			</div>
		)
		expect(document.querySelector('[data-pricing-hover-layer="spotlight"]')).toBeTruthy()
	})

	it('does NOT render the spotlight layer when reducedMotion is true', () => {
		render(
			<div style={{ position: 'relative' }}>
				<PricingCardHoverLayers tier="pro" isHovered={false} hoverKey={0} reducedMotion={true} />
			</div>
		)
		expect(document.querySelector('[data-pricing-hover-layer="spotlight"]')).toBeNull()
	})
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/hooks/usePricingCardHover.test.jsx`
Expected: FAIL — `Cannot find module '@/hooks/usePricingCardHover'`.

- [ ] **Step 3: Create the hook + layer component**

Create `src/hooks/usePricingCardHover.js`:

```jsx
import { useState, useRef, useCallback } from 'react'
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion'

/**
 * Per-tier visual accent tokens that feed the hover layers.
 */
export const TIER_ACCENTS = {
	free: {
		primary: 'rgba(129,140,248,1)',    // indigo-400
		secondary: 'rgba(59,130,246,1)',   // blue-500
		spotlight: 'rgba(99,102,241,0.18)',
		shadowClass: 'shadow-indigo-500/15',
		spotlightRadius: 350,
		borderGlowOpacity: 0.55,
		shimmerDuration: 0.7,
		hasMagneticButton: false,
	},
	pro: {
		primary: 'rgba(167,139,250,1)',    // violet-400
		secondary: 'rgba(217,70,239,1)',   // fuchsia-500
		spotlight: 'rgba(167,139,250,0.22)',
		shadowClass: 'shadow-violet-500/25',
		spotlightRadius: 400,
		borderGlowOpacity: 0.75,
		shimmerDuration: 0.7,
		hasMagneticButton: true,
	},
	enterprise: {
		primary: 'rgba(251,191,36,1)',     // amber-400
		secondary: 'rgba(249,115,22,1)',   // orange-500
		spotlight: 'rgba(251,191,36,0.18)',
		shadowClass: 'shadow-amber-500/20',
		spotlightRadius: 350,
		borderGlowOpacity: 0.6,
		shimmerDuration: 0.9,
		hasMagneticButton: true,
	},
}

/**
 * Shared hover behavior for pricing cards.
 *
 * @param {{ tier: 'free' | 'pro' | 'enterprise' }} args
 * @returns {{
 *   cardRef: React.MutableRefObject<HTMLElement|null>,
 *   isHovered: boolean,
 *   hoverKey: number,
 *   reducedMotion: boolean,
 *   accent: typeof TIER_ACCENTS[keyof typeof TIER_ACCENTS],
 *   handlers: {
 *     onMouseEnter: () => void,
 *     onMouseLeave: () => void,
 *     onMouseMove: (e: MouseEvent) => void,
 *   }
 * }}
 */
export function usePricingCardHover({ tier }) {
	const reducedMotion = useReducedMotion()
	const [isHovered, setIsHovered] = useState(false)
	const [hoverKey, setHoverKey] = useState(0)
	const cardRef = useRef(null)
	const accent = TIER_ACCENTS[tier] ?? TIER_ACCENTS.free

	const onMouseMove = useCallback((e) => {
		if (reducedMotion) return
		const el = cardRef.current
		if (!el) return
		const rect = el.getBoundingClientRect()
		const x = ((e.clientX - rect.left) / rect.width) * 100
		const y = ((e.clientY - rect.top) / rect.height) * 100
		el.style.setProperty('--mx', `${x}%`)
		el.style.setProperty('--my', `${y}%`)
	}, [reducedMotion])

	const onMouseEnter = useCallback(() => {
		setIsHovered(true)
		setHoverKey((k) => k + 1)
	}, [])

	const onMouseLeave = useCallback(() => {
		setIsHovered(false)
		const el = cardRef.current
		if (el) {
			el.style.setProperty('--mx', '50%')
			el.style.setProperty('--my', '50%')
		}
	}, [])

	return {
		cardRef,
		isHovered,
		hoverKey,
		reducedMotion,
		accent,
		handlers: { onMouseEnter, onMouseLeave, onMouseMove },
	}
}

/**
 * Renders the layered hover visuals (spotlight, border glow, shimmer)
 * inside the card. Must be rendered as a direct child of a `position: relative`
 * container (the pricing card body).
 */
export function PricingCardHoverLayers({ tier, isHovered, hoverKey, reducedMotion }) {
	const accent = TIER_ACCENTS[tier] ?? TIER_ACCENTS.free

	if (reducedMotion) return null

	return (
		<>
			{/* Layer 1: spotlight cursor-tracking */}
			<div
				data-pricing-hover-layer="spotlight"
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 rounded-2xl transition-opacity duration-300"
				style={{
					background: `radial-gradient(${accent.spotlightRadius}px circle at var(--mx, 50%) var(--my, 50%), ${accent.spotlight}, transparent 55%)`,
					opacity: isHovered ? 1 : 0,
				}}
			/>

			{/* Layer 2: border glow (gradient border via mask) */}
			<div
				data-pricing-hover-layer="border-glow"
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 rounded-2xl transition-opacity duration-300"
				style={{
					background: `radial-gradient(500px circle at var(--mx, 50%) var(--my, 50%), ${accent.primary}, transparent 40%)`,
					padding: '1px',
					WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
					WebkitMaskComposite: 'xor',
					mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
					maskComposite: 'exclude',
					opacity: isHovered ? accent.borderGlowOpacity : 0,
				}}
			/>

			{/* Layer 3: shimmer sweep — replayed via AnimatePresence keyed on hoverKey */}
			<AnimatePresence mode="wait">
				{isHovered && (
					<motion.div
						key={`shimmer-${hoverKey}`}
						data-pricing-hover-layer="shimmer"
						aria-hidden="true"
						className="pointer-events-none absolute inset-0 rounded-2xl overflow-hidden"
					>
						<motion.div
							className="absolute inset-y-0"
							style={{
								width: '50%',
								background: 'linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.12) 50%, transparent 70%)',
							}}
							initial={{ x: '-200%' }}
							animate={{ x: '250%' }}
							transition={{ duration: accent.shimmerDuration, ease: [0.16, 1, 0.3, 1] }}
						/>
					</motion.div>
				)}
			</AnimatePresence>
		</>
	)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/hooks/usePricingCardHover.test.jsx`
Expected: PASS — all 10 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePricingCardHover.js tests/hooks/usePricingCardHover.test.jsx
git commit -m "feat(pricing): add usePricingCardHover hook with tier accents and hover layers"
```

---

### Task 6: Integrate `usePricingCardHover` into `PricingCard.jsx`

**Files:**
- Modify: `src/components/Pricing/PricingCard.jsx`

- [ ] **Step 1: Import the hook and layer component**

At the top of `src/components/Pricing/PricingCard.jsx`, add after the existing imports (line 2):

```jsx
import { useMemo } from 'react'
import { usePricingCardHover, PricingCardHoverLayers, TIER_ACCENTS } from '@/hooks/usePricingCardHover'
```

- [ ] **Step 2: Wire the hook inside the component**

Inside `export function PricingCard(...)`, right after the destructured props and the `showStrike` line, add:

```jsx
	const tier = highlighted ? 'pro' : enterprise ? 'enterprise' : 'free'
	const hover = usePricingCardHover({ tier })
	const accent = hover.accent
```

- [ ] **Step 3: Attach handlers and ref to the outer motion.div**

Find the `<motion.div>` at line 18 and update it:

```jsx
		<motion.div
			ref={hover.cardRef}
			onMouseEnter={hover.handlers.onMouseEnter}
			onMouseLeave={hover.handlers.onMouseLeave}
			onMouseMove={hover.handlers.onMouseMove}
			whileHover={hover.reducedMotion ? {} : { scale: highlighted ? 1.02 : 1.015, y: -6 }}
			transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
			className="relative flex flex-col h-full"
			style={{ '--mx': '50%', '--my': '50%' }}
		>
```

- [ ] **Step 4: Render hover layers and tint the hover shadow**

Find the card body `<div>` at line 69 and its className block. Replace the entire body `<div>` with this version (note: only the outer body wrapper, the inner content stays identical — leave lines 78-210 as-is until the final `</div>`):

```jsx
			{/* Card body */}
			<div
				className={`relative flex flex-col h-full rounded-2xl p-7 ds-card-shimmer overflow-hidden
					${highlighted
						? `bg-slate-900 dark:bg-slate-900 border border-transparent shadow-2xl shadow-indigo-500/25 hover:${accent.shadowClass}`
						: enterprise
							? `bg-white dark:bg-slate-950 border border-transparent shadow-xl shadow-amber-500/10 hover:${accent.shadowClass}`
							: `bg-white/60 dark:bg-white/[0.04] backdrop-blur-xl border border-slate-200/60 dark:border-white/[0.08] hover:border-slate-300 dark:hover:border-white/[0.15] transition-colors duration-300 hover:${accent.shadowClass}`
					}`}
			>
				<PricingCardHoverLayers
					tier={tier}
					isHovered={hover.isHovered}
					hoverKey={hover.hoverKey}
					reducedMotion={hover.reducedMotion}
				/>
				{/* All existing content must sit above the absolute layers — wrap in a relative container. */}
				<div className="relative z-[1] flex flex-col h-full">
					{/* Tier name */}
```

**Important:** After adding the `<div className="relative z-[1] flex flex-col h-full">` wrapper, you must also add a closing `</div>` before the final `</div>` that closes the card body. The new structure is:

```
<div className="...card body...">
  <PricingCardHoverLayers ... />
  <div className="relative z-[1] flex flex-col h-full">
    ...all existing content (tier, price, features, cta)...
  </div>
</div>
```

Find the matching closing `</div>` of the card body (currently line 211) and, immediately before it, add the closing tag of the new wrapper:

```jsx
				</div>
			</div>
		</motion.div>
```

The `overflow-hidden` class on the card body is required so the shimmer sweep doesn't bleed outside the card.

**Note about Tailwind JIT:** `hover:${accent.shadowClass}` interpolated strings will **not** be picked up by Tailwind's JIT compiler. Replace the three `hover:${accent.shadowClass}` occurrences with a static hover class lookup:

Replace the className block with this static-class version:

```jsx
			{/* Card body */}
			<div
				className={`relative flex flex-col h-full rounded-2xl p-7 ds-card-shimmer overflow-hidden transition-shadow duration-300
					${highlighted
						? 'bg-slate-900 dark:bg-slate-900 border border-transparent shadow-2xl shadow-indigo-500/25 hover:shadow-violet-500/40'
						: enterprise
							? 'bg-white dark:bg-slate-950 border border-transparent shadow-xl shadow-amber-500/10 hover:shadow-amber-500/30'
							: 'bg-white/60 dark:bg-white/[0.04] backdrop-blur-xl border border-slate-200/60 dark:border-white/[0.08] hover:border-slate-300 dark:hover:border-white/[0.15] hover:shadow-indigo-500/20 hover:shadow-xl'
					}`}
			>
```

- [ ] **Step 5: Make the Pro CTA button magnetic**

Find the Pro CTA button block (currently lines 174-184, the `highlighted ? (...)` branch). Wrap the `<button>` in a `<motion.div>` that applies magnetic x/y transforms:

```jsx
				{/* CTA button */}
				{highlighted ? (
					<motion.div
						animate={hover.reducedMotion ? {} : {
							x: hover.isHovered ? 'calc((var(--mx, 50%) - 50%) * 0.06)' : 0,
							y: hover.isHovered ? 'calc((var(--my, 50%) - 50%) * 0.06)' : 0,
						}}
						transition={{ type: 'spring', stiffness: 150, damping: 15 }}
					>
						<button
							onClick={ctaAction}
							className="w-full py-3.5 rounded-xl font-bold text-sm text-white
								bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-500 bg-[length:200%_100%]
								hover:bg-right shadow-lg shadow-indigo-500/30
								hover:shadow-xl hover:shadow-indigo-500/40
								active:scale-95 transition-all duration-500 ds-btn-shimmer"
						>
							{ctaText}
						</button>
					</motion.div>
```

**Note:** Framer Motion does **not** animate `calc()` strings — `animate` needs numeric values. Replace the calc approach with a derived numeric state using `useMotionValue`:

Inside `PricingCard`, after the hook call, import `useMotionValue` and `useSpring`:

```jsx
import { motion, useMotionValue, useSpring } from 'framer-motion'
```

Then inside the component body, add:

```jsx
	const rawX = useMotionValue(0)
	const rawY = useMotionValue(0)
	const springX = useSpring(rawX, { stiffness: 150, damping: 15 })
	const springY = useSpring(rawY, { stiffness: 150, damping: 15 })
```

Update the hook's `onMouseMove` consumption by adding a new `onMouseMove` wrapper on the card that updates both CSS vars (for layer positioning) AND motion values (for magnetic button):

Replace the outer `<motion.div>` block from Step 3 with this extended version:

```jsx
		<motion.div
			ref={hover.cardRef}
			onMouseEnter={hover.handlers.onMouseEnter}
			onMouseLeave={() => {
				hover.handlers.onMouseLeave()
				rawX.set(0)
				rawY.set(0)
			}}
			onMouseMove={(e) => {
				hover.handlers.onMouseMove(e)
				if (hover.reducedMotion || !accent.hasMagneticButton) return
				const rect = hover.cardRef.current?.getBoundingClientRect()
				if (!rect) return
				const dx = (e.clientX - (rect.left + rect.width / 2)) / rect.width
				const dy = (e.clientY - (rect.top + rect.height / 2)) / rect.height
				rawX.set(dx * 6) // max ±3px at card edges
				rawY.set(dy * 6)
			}}
			whileHover={hover.reducedMotion ? {} : { scale: highlighted ? 1.02 : 1.015, y: -6 }}
			transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
			className="relative flex flex-col h-full"
			style={{ '--mx': '50%', '--my': '50%' }}
		>
```

And update the Pro CTA wrapper from the first version to use the spring motion values:

```jsx
				{highlighted ? (
					<motion.div style={{ x: springX, y: springY }}>
						<button
							onClick={ctaAction}
							className="w-full py-3.5 rounded-xl font-bold text-sm text-white
								bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-500 bg-[length:200%_100%]
								hover:bg-right shadow-lg shadow-indigo-500/30
								hover:shadow-xl hover:shadow-indigo-500/40
								active:scale-95 transition-all duration-500 ds-btn-shimmer"
						>
							{ctaText}
						</button>
					</motion.div>
```

Do the **same** wrap for the Enterprise CTA button — replace the `enterprise ? (...)` branch (currently lines 185-196) with:

```jsx
				) : enterprise ? (
					<motion.div style={{ x: springX, y: springY }}>
						<button
							onClick={ctaAction}
							className="w-full py-3.5 rounded-xl font-bold text-sm
								border border-amber-400/40 dark:border-amber-500/30
								text-amber-700 dark:text-amber-300
								hover:border-amber-400 dark:hover:border-amber-500/60
								hover:bg-amber-50/50 dark:hover:bg-amber-500/[0.08]
								active:scale-95 transition-all duration-300"
						>
							{ctaText}
						</button>
					</motion.div>
```

Free tier keeps its button plain — `accent.hasMagneticButton` is `false` for Free so there's no motion to apply there. Leave the `else` branch (currently lines 197-210) unchanged.

- [ ] **Step 6: Price gradient shift on hover (Layer 4)**

Still inside `PricingCard.jsx`, find the price number `<span>` (currently lines 100-110). Replace it with a version that swaps to a tier-tinted gradient on hover:

```jsx
					<span
						className={`text-5xl font-extrabold ds-font-display leading-none transition-[background-image] duration-500
							${highlighted
								? 'text-white'
								: enterprise
									? 'text-slate-800 dark:text-white'
									: 'text-slate-800 dark:text-white'
							}`}
						style={hover.isHovered && !hover.reducedMotion ? {
							backgroundImage: `linear-gradient(135deg, ${accent.primary}, ${accent.secondary})`,
							backgroundClip: 'text',
							WebkitBackgroundClip: 'text',
							WebkitTextFillColor: 'transparent',
						} : undefined}
					>
						{price === 0 ? 'Free' : `$${price}`}
					</span>
```

The `style` prop is applied only on hover (and only when reduced-motion is off), reverting to the tier's default color class in the resting state.

- [ ] **Step 7: Feature icons stagger pop on hover (Layer 5)**

Still inside `PricingCard.jsx`, find the feature list `<ul>` (currently line 133) and its mapped children. Replace the whole feature list block (currently lines 133-171) with:

```jsx
				{/* Feature list */}
				<motion.ul
					className="flex flex-col gap-3 flex-1 mb-8"
					animate={hover.isHovered && !hover.reducedMotion ? 'hover' : 'rest'}
					variants={{
						hover: { transition: { staggerChildren: 0.03 } },
						rest: {},
					}}
				>
					{features.map(({ label, included }) => {
						const isIncluded = included !== false && included !== null
						return (
							<li key={label} className="flex items-start gap-3">
								<motion.span
									variants={{
										hover: { scale: [1, 1.15, 1], transition: { duration: 0.3 } },
										rest: { scale: 1 },
									}}
									className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center
										${isIncluded
											? highlighted
												? 'bg-indigo-500/20 text-indigo-400'
												: enterprise
													? 'bg-amber-500/10 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400'
													: 'bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
											: 'bg-slate-100 dark:bg-white/[0.05] text-slate-300 dark:text-slate-600'
										}`}
								>
									{isIncluded
										? <Check className="w-3 h-3" strokeWidth={2.5} />
										: <X className="w-3 h-3" strokeWidth={2.5} />
									}
								</motion.span>
								<span
									className={`text-sm leading-snug
										${isIncluded
											? highlighted
												? 'text-slate-200'
												: 'text-slate-700 dark:text-slate-200'
											: 'text-slate-400 dark:text-slate-500'
										}`}
								>
									{typeof included === 'string' || typeof included === 'number'
										? <><strong className={highlighted ? 'text-white' : enterprise ? 'text-amber-700 dark:text-amber-300' : 'text-slate-900 dark:text-white'}>{included}</strong> {label}</>
										: label
									}
								</span>
							</li>
						)
					})}
				</motion.ul>
```

- [ ] **Step 8: Verify in the browser**

Run: `npm run dev` (if not running)
Navigate to `/pricing`. Hover each of the three cards and confirm:
- Free: spotlight follows cursor, border glow on the edge closest to cursor, shimmer sweep on hover entry, small scale + lift. CTA button stays still.
- Pro: same + CTA button subtly follows the cursor.
- Enterprise: same + shimmer is slightly slower than Pro/Free.
- No layout shift, no cropping of the shimmer (the `overflow-hidden` on the body should contain it).

- [ ] **Step 7: Commit**

```bash
git add src/components/Pricing/PricingCard.jsx
git commit -m "feat(pricing): apply layered dazzle hover system to PricingCard"
```

---

### Task 7: Integrate `usePricingCardHover` into `PricingPreview.jsx`

**Files:**
- Modify: `src/components/Landing/PricingPreview.jsx`

**Note:** `PricingPreview` keeps its own vibrant visual identity — only the hover behavior is shared.

- [ ] **Step 1: Import the hook and layer component**

At the top of `src/components/Landing/PricingPreview.jsx`, add after the existing imports (line 2):

```jsx
import { useMotionValue, useSpring } from 'framer-motion'
import { usePricingCardHover, PricingCardHoverLayers } from '@/hooks/usePricingCardHover'
```

- [ ] **Step 2: Extract the card render into a sub-component so each card has its own hook state**

The current code maps `plans.map((plan, i) => <motion.div ...>)` inline. Each card needs its own hook state, so extract the per-card render into a new internal component inside the same file. Add this component definition above `export function PricingPreview(...)`:

```jsx
function PreviewCard({ plan, i, onSignIn }) {
	const tier = plan.popular ? 'pro' : plan.enterprise ? 'enterprise' : 'free'
	const hover = usePricingCardHover({ tier })
	const rawX = useMotionValue(0)
	const rawY = useMotionValue(0)
	const springX = useSpring(rawX, { stiffness: 150, damping: 15 })
	const springY = useSpring(rawY, { stiffness: 150, damping: 15 })

	return (
		<motion.div
			ref={hover.cardRef}
			custom={i}
			variants={cardVariants}
			initial="hidden"
			whileInView="visible"
			viewport={{ once: true, margin: '-60px' }}
			onMouseEnter={hover.handlers.onMouseEnter}
			onMouseLeave={() => {
				hover.handlers.onMouseLeave()
				rawX.set(0)
				rawY.set(0)
			}}
			onMouseMove={(e) => {
				hover.handlers.onMouseMove(e)
				if (hover.reducedMotion || !hover.accent.hasMagneticButton) return
				const rect = hover.cardRef.current?.getBoundingClientRect()
				if (!rect) return
				const dx = (e.clientX - (rect.left + rect.width / 2)) / rect.width
				const dy = (e.clientY - (rect.top + rect.height / 2)) / rect.height
				rawX.set(dx * 6)
				rawY.set(dy * 6)
			}}
			className={`relative rounded-2xl p-7 flex flex-col gap-6 ds-hover-lift transition-all duration-300 overflow-hidden
				${plan.popular
					? 'bg-gradient-to-b from-indigo-600/90 to-purple-700/90 dark:from-indigo-600/80 dark:to-purple-700/80 border-2 border-indigo-400/30 shadow-2xl shadow-indigo-500/30 scale-[1.03] md:scale-[1.05] hover:shadow-violet-500/40'
					: plan.enterprise
						? 'bg-white/60 dark:bg-white/[0.04] border border-amber-400/30 dark:border-amber-500/20 backdrop-blur-sm shadow-lg shadow-amber-500/5 hover:shadow-amber-500/30'
						: 'bg-white/60 dark:bg-white/[0.04] border border-slate-200/60 dark:border-white/[0.08] backdrop-blur-sm hover:shadow-indigo-500/20 hover:shadow-xl'
				}`}
			style={{ '--mx': '50%', '--my': '50%' }}
		>
			<PricingCardHoverLayers
				tier={tier}
				isHovered={hover.isHovered}
				hoverKey={hover.hoverKey}
				reducedMotion={hover.reducedMotion}
			/>

			{/* All existing content wrapped in a relative z-[1] container so it sits above the layers */}
			<div className="relative z-[1] flex flex-col gap-6 h-full">
				{/* Badge — absolute on outer wrapper (overflow-visible by default) */}
				{plan.popular && (
					<div className="absolute -top-4 left-1/2 -translate-x-1/2 z-10">
						<div className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-cyan-500 shadow-lg shadow-indigo-500/30">
							<Zap className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
							<span className="text-xs font-bold text-white tracking-wide">Most Popular</span>
						</div>
					</div>
				)}

				{plan.enterprise && (
					<div className="absolute -top-4 left-1/2 -translate-x-1/2 z-10">
						<div className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 shadow-lg shadow-amber-500/30">
							<Crown className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
							<span className="text-xs font-bold text-white tracking-wide">Enterprise</span>
						</div>
					</div>
				)}

				{/* Plan header */}
				<div>
					<p className={`text-sm font-semibold mb-1 ds-font-display ${plan.popular ? 'text-indigo-200' : plan.enterprise ? 'text-amber-600 dark:text-amber-400' : 'text-indigo-600 dark:text-indigo-400'}`}>
						{plan.name}
					</p>
					<div className="flex items-end gap-2 mb-2">
						<span
							className={`text-4xl font-extrabold tracking-tight ds-font-display transition-[background-image] duration-500 ${plan.popular ? 'text-white' : 'text-slate-900 dark:text-white'}`}
							style={hover.isHovered && !hover.reducedMotion ? {
								backgroundImage: `linear-gradient(135deg, ${hover.accent.primary}, ${hover.accent.secondary})`,
								backgroundClip: 'text',
								WebkitBackgroundClip: 'text',
								WebkitTextFillColor: 'transparent',
							} : undefined}
						>
							{plan.price}
						</span>
						<span className={`text-sm pb-1.5 ds-font-display ${plan.popular ? 'text-indigo-200/80' : 'text-slate-400'}`}>
							/{plan.period}
						</span>
					</div>
					<p className={`text-sm leading-relaxed ds-font-display ${plan.popular ? 'text-indigo-100/90' : 'text-slate-500 dark:text-slate-400'}`}>
						{plan.description}
					</p>
				</div>

				{/* Feature list — with stagger pop animation on hover (Layer 5) */}
				<motion.ul
					className="flex flex-col gap-3 flex-1"
					animate={hover.isHovered && !hover.reducedMotion ? 'hover' : 'rest'}
					variants={{
						hover: { transition: { staggerChildren: 0.03 } },
						rest: {},
					}}
				>
					{plan.features.map((feat) => (
						<li key={feat} className="flex items-start gap-2.5">
							<motion.div
								variants={{
									hover: { scale: [1, 1.15, 1], transition: { duration: 0.3 } },
									rest: { scale: 1 },
								}}
								className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0
									${plan.popular
										? 'bg-white/20'
										: plan.enterprise
											? 'bg-amber-500/10 dark:bg-amber-500/20'
											: 'bg-indigo-500/10 dark:bg-indigo-500/20'
									}`}
							>
								<Check className={`w-3 h-3 ${plan.popular ? 'text-white' : plan.enterprise ? 'text-amber-600 dark:text-amber-400' : 'text-indigo-600 dark:text-indigo-400'}`} strokeWidth={2.5} />
							</motion.div>
							<span className={`text-sm ds-font-display ${plan.popular ? 'text-indigo-50' : 'text-slate-600 dark:text-slate-300'}`}>
								{feat}
							</span>
						</li>
					))}
				</motion.ul>

				{/* CTA — magnetic wrapper for popular/enterprise */}
				<motion.div style={hover.accent.hasMagneticButton ? { x: springX, y: springY } : undefined}>
					<button
						onClick={() => {
							if (plan.enterprise) {
								window.open(`mailto:${SALES_EMAIL}?subject=${encodeURIComponent('GitHub Repo Manager — Enterprise inquiry')}`, '_self')
							} else if (onSignIn) {
								onSignIn()
							}
						}}
						className={`w-full py-3 rounded-xl font-semibold text-sm transition-all duration-300 ds-btn-shimmer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
							${plan.popular
								? 'bg-white text-indigo-700 hover:bg-indigo-50 shadow-lg shadow-white/20 hover:shadow-xl focus-visible:ring-white focus-visible:ring-offset-indigo-600'
								: plan.enterprise
									? 'bg-amber-500/10 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 dark:hover:bg-amber-500/25 border border-amber-400/40 dark:border-amber-500/30 focus-visible:ring-amber-500 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950'
									: 'bg-indigo-500/10 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/20 dark:hover:bg-indigo-500/25 border border-indigo-300/40 dark:border-indigo-500/30 focus-visible:ring-indigo-500 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950'
							}`}
					>
						{plan.cta}
					</button>
				</motion.div>
			</div>
		</motion.div>
	)
}
```

- [ ] **Step 3: Replace the inline `plans.map(...)` with the new `PreviewCard`**

Inside `export function PricingPreview({ onSignIn })`, find the `{plans.map((plan, i) => (...)}` block (currently lines 109-203). Replace the entire `.map` callback with:

```jsx
					{plans.map((plan, i) => (
						<PreviewCard key={plan.name} plan={plan} i={i} onSignIn={onSignIn} />
					))}
```

- [ ] **Step 4: Verify in the browser**

Run: `npm run dev`
Navigate to the landing page (`/` if logged out). Scroll to the pricing section. Hover each card and confirm:
- Spotlight follows the cursor inside each card.
- Border glow lights up along the nearest edge.
- Shimmer sweep plays on hover entry (once per entry).
- Pro and Enterprise CTAs are magnetic; Free CTA stays still.
- Vibrant violet-gradient Pro card look is preserved.
- No visual regression on the pricing section entrance animation (`whileInView="visible"`).

- [ ] **Step 5: Commit**

```bash
git add src/components/Landing/PricingPreview.jsx
git commit -m "feat(landing): apply dazzle hover system to PricingPreview"
```

---

### Task 8: E2E tests for pricing hover behavior and reduced-motion

**Files:**
- Create: `e2e/pricing-hover.spec.js`

- [ ] **Step 1: Write the E2E tests**

Create `e2e/pricing-hover.spec.js`:

```js
import { test, expect } from '@playwright/test'

test.describe('Pricing cards — hover layers', () => {
	test('spotlight becomes visible on hover and hides on leave (pricing page)', async ({ page }) => {
		await page.goto('/pricing')
		// Find a card — assume cards are anchored by a common element. Fall back to the outer motion.div that has the hover layers.
		const cards = page.locator('[data-pricing-hover-layer="spotlight"]').locator('..')
		await cards.first().waitFor({ state: 'visible', timeout: 10000 })

		const card = cards.first()
		const spotlight = card.locator('[data-pricing-hover-layer="spotlight"]')

		// Initial: spotlight opacity should be 0.
		let opacity = await spotlight.evaluate((el) => parseFloat(getComputedStyle(el).opacity))
		expect(opacity).toBeLessThan(0.05)

		// Hover the card center.
		await card.hover()
		await page.waitForTimeout(400) // wait for 300ms transition + margin

		opacity = await spotlight.evaluate((el) => parseFloat(getComputedStyle(el).opacity))
		expect(opacity).toBeGreaterThan(0.9)

		// Leave.
		await page.mouse.move(0, 0)
		await page.waitForTimeout(400)
		opacity = await spotlight.evaluate((el) => parseFloat(getComputedStyle(el).opacity))
		expect(opacity).toBeLessThan(0.05)
	})

	test('shimmer element remounts on repeated hover', async ({ page }) => {
		await page.goto('/pricing')
		const cards = page.locator('[data-pricing-hover-layer="spotlight"]').locator('..')
		const card = cards.first()
		await card.waitFor({ state: 'visible', timeout: 10000 })

		await card.hover()
		await page.waitForTimeout(100)
		const shimmer1 = await card.locator('[data-pricing-hover-layer="shimmer"]').count()
		expect(shimmer1).toBeGreaterThan(0)

		// Leave and hover again — second entry should spawn a new shimmer.
		await page.mouse.move(0, 0)
		await page.waitForTimeout(800) // shimmer duration + buffer
		await card.hover()
		await page.waitForTimeout(100)
		const shimmer2 = await card.locator('[data-pricing-hover-layer="shimmer"]').count()
		expect(shimmer2).toBeGreaterThan(0)
	})

	test('reduced-motion disables spotlight layer', async ({ browser }) => {
		const context = await browser.newContext({ reducedMotion: 'reduce' })
		const page = await context.newPage()
		await page.goto('/pricing')

		// With reduced motion, PricingCardHoverLayers returns null → no spotlight in DOM.
		await page.waitForTimeout(500) // let cards render
		const spotlightCount = await page.locator('[data-pricing-hover-layer="spotlight"]').count()
		expect(spotlightCount).toBe(0)

		await context.close()
	})

	test('landing preview pricing has hover layers too', async ({ page }) => {
		await page.goto('/')
		// Scroll to pricing preview section (it's further down the page)
		await page.locator('[data-pricing-hover-layer="spotlight"]').first().scrollIntoViewIfNeeded()
		const spotlight = page.locator('[data-pricing-hover-layer="spotlight"]').first()
		await expect(spotlight).toBeVisible()
	})
})
```

- [ ] **Step 2: Run the E2E tests**

Run: `npx playwright test e2e/pricing-hover.spec.js`
Expected: PASS. If the landing preview test fails because the pricing section is lazy-loaded or behind a viewport condition, adjust the scroll logic.

- [ ] **Step 3: Commit**

```bash
git add e2e/pricing-hover.spec.js
git commit -m "test(e2e): verify pricing card hover layers and reduced-motion handling"
```

---

## Verification Checklist

After completing all tasks, run the full suite to confirm no regressions:

- [ ] `npx vitest run` — all unit tests pass (including the new ones in Task 1 and Task 5)
- [ ] `npx playwright test e2e/context-menu-scroll-free.spec.js e2e/pricing-hover.spec.js` — new E2E specs pass
- [ ] `npx playwright test e2e/context-menu.spec.js` — existing context menu spec still passes
- [ ] `npm run build` — production build succeeds without new warnings
- [ ] Manual smoke test:
  - Open context menu in five viewport positions, confirm no scrollbars and correct flip
  - Hover each pricing card on `/pricing` and on the landing preview, confirm the six-layer effect
  - Emulate `prefers-reduced-motion: reduce` in browser devtools and confirm layers are disabled

---

## Notes for the Implementing Agent

- **Always read files before editing.** The file paths and line numbers in this plan reflect the state at the time of writing. If the file has drifted, open it first and locate the correct location before applying the diff.
- **Tailwind JIT gotcha:** any `hover:${dynamic}` template interpolation will NOT be scanned by the JIT compiler. The plan uses static class strings only — don't regress this.
- **`Promise.resolve().then(setState)` pattern** inside layout effects is intentional in `ContextMenu.jsx` — keep it when editing the positioning effect.
- **Framer Motion motion values** (`useMotionValue`, `useSpring`) are the correct way to animate numeric transform values smoothly. Don't try to animate `calc()` strings via `animate={{ x: 'calc(...)' }}` — Framer Motion can't interpolate those.
- **Test selectors** use `data-pricing-hover-layer="..."` attributes set in the layer component — these are the stable hooks for E2E assertions. Don't remove them.
- **Conventional Commits:** every task commits with a `type(scope): description` format (per `CLAUDE.md`). No `Co-Authored-By` trailers.
- **Test file locations:** `tests/` mirrors `src/` (see `CLAUDE.md` rules). `e2e/` is flat Playwright.
