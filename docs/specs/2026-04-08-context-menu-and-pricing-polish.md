# Context Menu Scroll-Free Polish + Pricing Cards Dazzle Hover

**Date:** 2026-04-08
**Status:** Draft
**Scope:** Two UI polish tasks bundled into a single spec because they share the same "native-feel + premium polish" intent.

---

## 1. Overview

Two user-visible UI issues are addressed:

1. **Context menu renders with spurious scrollbars** (vertical and horizontal) even when its content is short. The menu should feel native and elegant, never show a scrollbar, and always fit within the viewport through smart repositioning.
2. **Pricing cards have weak hover feedback.** Current state is a simple `scale + y` transform. The cards should "dazzle" visitors through orchestrated, layered hover effects while remaining elegant and consistent with the project's design system.

Both changes are purely presentational / motion. No data flow, API, or routing changes.

---

## 2. Part 1 — Context Menu: Scroll-Free + Native Polish

### 2.1 Problem

The bulk-action context menu (visible when ≥2 repositories are selected) renders with both a vertical scrollbar and a horizontal scrollbar, even when only 4-5 items are present. Root cause is in [src/components/ui/ContextMenu.jsx:273](../../src/components/ui/ContextMenu.jsx#L273):

```jsx
className="fixed z-[100] min-w-[200px] max-w-[280px] max-h-[calc(100vh-16px)] overflow-y-auto py-1.5 rounded-xl..."
```

`max-h-[calc(100vh-16px)] overflow-y-auto` forces scroll reservation even when content fits comfortably. On Windows, reserved scrollbar width (~17px) combined with subpixel rounding surfaces both scrollbars as visible artifacts.

### 2.2 Goal

The context menu must:

- Never show a scrollbar in normal use. The menu is short (4–6 items for batch mode, comparable for single-repo mode). Scrolling is an anti-pattern for menus of this size.
- Always fit inside the viewport through smart repositioning (flip up/down and left/right as needed).
- Feel like a native OS menu (macOS Sonoma / Windows 11 Mica) in its shadow, blur, border, padding, and grouping.

### 2.3 Scope

The fix applies to the shared base component [src/components/ui/ContextMenu.jsx](../../src/components/ui/ContextMenu.jsx). Both the single-repo context menu and the batch multi-selection menu in [src/components/RepoContextMenu.jsx](../../src/components/RepoContextMenu.jsx) benefit automatically — no changes needed in call sites.

### 2.4 Behavioral changes

**Remove the scroll constraint**: delete `max-h-[calc(100vh-16px)]` and `overflow-y-auto` from the container className. Replace with `overflow-visible`.

**Expand `calculatePosition` (currently lines 44–77)** to use measure-then-position:

1. On open, render the menu off-screen or with `opacity: 0` first so the browser can measure it.
2. In a `useLayoutEffect`, read `menuRef.current.getBoundingClientRect()` to get real dimensions.
3. Compute final position:
   - **Vertical**: preferred direction is downward from click point. If `clickY + menuHeight > viewportHeight - 8`, flip upward (`top = clickY - menuHeight`). If even flipped it overflows, clamp to `top = Math.max(8, viewportHeight - menuHeight - 8)`.
   - **Horizontal**: preferred direction is rightward. Same flip + clamp logic.
4. Apply final `top`/`left` and set `opacity: 1`.
5. Existing submenu flip logic (lines 59–67, `submenuDirection`) is preserved and extended with the same measure-then-position pattern for consistency.

**Edge case**: on extremely small viewports where even flipped the menu doesn't fit, the clamp still shows the whole menu — possibly overlapping the click point, which is acceptable because the alternative (scroll) is worse.

### 2.5 Visual polish (level B from brainstorm)

Applied to the menu container className (currently line 273):

- **Dual-layer shadow** replacing current shadow:
  - Ambient: `0 20px 40px -12px rgba(0,0,0,0.25)`
  - Key: `0 2px 6px -2px rgba(0,0,0,0.15)`
  - Inner top highlight (dark mode only): `inset 0 1px 0 rgba(255,255,255,0.06)`
  - Expressed via `shadow-[...]` arbitrary value or a dedicated utility.
- **Border hairline**: `border border-black/5 dark:border-white/10` replacing current border.
- **Backdrop**: `backdrop-blur-xl bg-white/85 dark:bg-neutral-900/85` — frosted-glass native feel (replace any existing background/blur classes).
- **Padding rhythm**: container `p-1` (instead of `py-1.5`); each item `px-2.5 py-1.5` with `rounded-lg` hover highlight for the inset native look.
- **Group separators** (batch menu only): hairline `div` between Archive / (Migration + Management) / Delete — `<div className="my-1 h-px bg-black/6 dark:bg-white/8" />`.
- **Header typography** ("N REPOSITORIES SELECTED"): `text-[10.5px] font-semibold uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400 px-2.5 pt-1.5 pb-1`.
- **Destructive item (Delete)**: keeps the red treatment but gains the same `rounded-lg` inset hover highlight for consistency.

### 2.6 What does NOT change

- JSX structure of items (Archive / Migration / Management / Delete).
- Keyboard navigation.
- Entry/exit animation (already subtle and correct).
- Submenu trigger logic for Migration / Management.
- Public API of `ContextMenu` component — every existing call site works unchanged.

### 2.7 Testing

- **Unit test** (`tests/components/ui/ContextMenu.test.jsx`): mock `getBoundingClientRect` to return a menu larger than viewport; assert `calculatePosition` returns a clamped + flipped position that keeps the menu inside the viewport.
- **E2E test** (`e2e/context-menu-no-scroll.spec.js`): open batch menu in five positions (top-left, top-right, bottom-left, bottom-right, center of viewport); assert `getComputedStyle(menu).overflow === 'visible'` and `menu.scrollHeight === menu.clientHeight`. Take screenshots to confirm no scrollbars.

---

## 3. Part 2 — Pricing Cards: Hybrid Dazzle Hover

### 3.1 Problem

The pricing cards at [src/components/Pricing/PricingCard.jsx](../../src/components/Pricing/PricingCard.jsx) (used by `PricingPage.jsx`) and the landing preview at [src/components/Landing/PricingPreview.jsx](../../src/components/Landing/PricingPreview.jsx) currently have only a weak `whileHover={{ scale, y }}` transform. They don't feel premium on a pricing surface that is critical for conversion.

### 3.2 Goal

Every pricing card, across both landing preview and `/pricing` page, should respond to hover with an orchestrated system of layered effects that combine to feel premium, elegant, and "alive" — while never crossing into gimmicky territory. The effect must respect `prefers-reduced-motion`.

### 3.3 Scope

The two pricing surfaces have deliberately different visual designs — `PricingPage.jsx` uses a subtle slate/gradient-border look, while `PricingPreview.jsx` uses a vibrant full-color gradient Pro card for marketing impact. Rather than unifying the visuals (which would erase that intentional difference), the hover *system* is extracted into a reusable hook and applied to both surfaces independently.

- Create a new shared hook `src/hooks/usePricingCardHover.js` that returns:
  - `cardRef` — ref to attach to the card root.
  - Event handlers (`onMouseMove`, `onMouseEnter`, `onMouseLeave`).
  - State flags (`isHovered`, `hoverKey`).
  - A helper `renderHoverLayers(config)` or set of layer components that both pages can drop into their cards.
  - Tier awareness through a `tier: 'free' | 'pro' | 'enterprise'` argument.
  - Reduced-motion detection built-in (returns a `reducedMotion` flag so layers can be conditionally rendered).
- Extend [PricingCard.jsx](../../src/components/Pricing/PricingCard.jsx) to consume the hook and render the layers inside its card body, keeping its existing visual identity.
- Extend [PricingPreview.jsx](../../src/components/Landing/PricingPreview.jsx) to consume the **same** hook and render the **same** layers in each card, keeping its existing vibrant identity.
- The hook is the single source of truth for the hover behavior — both surfaces stay in sync behaviorally while diverging visually.

### 3.4 Tier accent tokens

A single `TIER_ACCENTS` object at the top of `PricingCard.jsx` defines the color system per tier. All six hover layers read from this object.

| Tier       | Primary       | Secondary       | Spotlight RGBA              |
| ---------- | ------------- | --------------- | --------------------------- |
| Free       | `indigo-400`  | `blue-500`      | `rgba(99,102,241,0.18)`     |
| Pro        | `violet-400`  | `fuchsia-500`   | `rgba(167,139,250,0.22)`    |
| Enterprise | `amber-400`   | `orange-500`    | `rgba(251,191,36,0.18)`     |

The tier is determined by the existing props (`highlighted` → Pro, `enterprise` → Enterprise, else Free).

### 3.5 Hover layers

Six coordinated layers, all anchored to the same `isHovered` state and the CSS variables `--mx` / `--my` (cursor position inside the card, updated via `onMouseMove`).

**Layer 1 — Spotlight cursor-tracking**
An absolutely positioned `div` (`inset-0 pointer-events-none rounded-2xl`) with:

```css
background: radial-gradient(350px circle at var(--mx) var(--my), var(--spotlight-color), transparent 55%);
opacity: 0;
transition: opacity 300ms;
```

Opacity transitions to 1 on hover. `--mx`, `--my` are updated directly via `element.style.setProperty()` in `onMouseMove` — no React re-render.

**Layer 2 — Border glow (dynamic gradient border)**
Second absolute `div` with the same border-radius as the card, implementing a masked gradient border:

```css
background: radial-gradient(500px circle at var(--mx) var(--my), var(--accent-primary), transparent 40%);
padding: 1px;
mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
mask-composite: exclude;
opacity: 0; /* → 0.6 on hover */
transition: opacity 300ms;
```

Only the border area lights up, following the cursor.

**Layer 3 — Shimmer sweep (one-shot per hover entry)**
A linear gradient overlay animated left-to-right once per `onHoverStart`, 700ms (Pro/Free) or 900ms (Enterprise). Replayed by incrementing a `hoverKey` state and keying the Framer Motion element on it.

```css
background: linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.12) 50%, transparent 70%);
/* dark mode: opacity 0.06 instead of 0.12 */
transform: translateX(-100% → 100%);
```

**Layer 4 — Price gradient shift**
The price number element gets a Framer Motion `animate` that, on hover, applies a `background: linear-gradient(--accent-primary → --accent-secondary); background-clip: text; color: transparent` — reusing the existing `ds-gradient-text` pattern. 400ms transition.

**Layer 5 — Feature icons stagger pop**
The feature list container receives `variants` with `staggerChildren: 0.03`. Each icon (check / cross) has a `hover` variant of `scale: [1, 1.15, 1]` over 300ms. Text stays still. Applied only when entering hover, not on every re-render.

**Layer 6 — Magnetic CTA button**
The CTA button's `x` / `y` are bound to `(--mx - 0.5) * 6px` and `(--my - 0.5) * 6px` (max ±3px translation in each axis), via a Framer Motion spring (`stiffness: 150, damping: 15`). On hover exit, springs back to center. The button follows the cursor ever so slightly — "magnetic" feel.

**Card envelope — refined scale + lift**
Existing `whileHover={{ scale: 1.03, y: -4 }}` becomes `whileHover={{ scale: 1.015, y: -6 }}`. The hover shadow is intensified by ~40% and tinted with the tier accent: e.g. `shadow-violet-500/20` for Pro, `shadow-amber-500/20` for Enterprise, `shadow-indigo-500/15` for Free.

### 3.6 Per-tier intensity

Not every tier gets the same dose.

| Tier       | Layers active                                                         | Intensity                                                                                  | Notes                                                        |
| ---------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Free       | Spotlight, border glow, shimmer, price shift, feature pop, card lift  | Baseline                                                                                   | No magnetic button. Understated so Pro can shine.            |
| Pro        | All 6 layers                                                          | +20% (larger spotlight radius 400px, border glow opacity 0.75, shimmer brighter)           | The star of the show.                                        |
| Enterprise | All 6 layers                                                          | Baseline with slower shimmer (900ms)                                                       | Gold/amber palette for a "luxury" feel vs Pro's "tech" feel. |

### 3.7 Orchestration

```jsx
const [isHovered, setIsHovered] = useState(false);
const [hoverKey, setHoverKey] = useState(0);
const cardRef = useRef(null);
const reducedMotion = useReducedMotion();

const handleMouseMove = (e) => {
  if (reducedMotion || !cardRef.current) return;
  const rect = cardRef.current.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  cardRef.current.style.setProperty('--mx', `${x}%`);
  cardRef.current.style.setProperty('--my', `${y}%`);
};

const handleMouseEnter = () => {
  setIsHovered(true);
  setHoverKey(k => k + 1); // replay shimmer
};

const handleMouseLeave = () => {
  setIsHovered(false);
  cardRef.current?.style.setProperty('--mx', '50%');
  cardRef.current?.style.setProperty('--my', '50%');
};
```

CSS vars are initialized to `50%` / `50%` so the spotlight/border glow are centered on first render.

### 3.8 `prefers-reduced-motion`

Detected with `useReducedMotion()` from `framer-motion`. When active:

- **Disabled**: spotlight tracking, border glow gradient, shimmer sweep, feature icon stagger pop, magnetic button, card scale + lift motion.
- **Preserved**: a simple border color change on hover, price gradient shift (instantaneous, no animation), shadow change (static transition).

The layers are conditionally rendered (or simply given `display: none` via a class bound to the reduced-motion state).

### 3.9 What does NOT change

- Tier names, prices, features lists, CTA labels, and CTA link destinations.
- Routing (`/pricing` stays the same).
- Strikethrough / badge logic for Pro.
- Existing `ds-card-shimmer` in the resting state — it's kept as a subtle idle effect complementing the hover layers.

### 3.10 Testing

- **Unit test** (`tests/components/Pricing/PricingCard.test.jsx`): assert `TIER_ACCENTS` has the three expected keys; assert that `variant="preview"` renders fewer features than `variant="full"`; assert that when `useReducedMotion` returns `true`, the spotlight and border-glow layers are not in the DOM (or are `display: none`).
- **E2E test** (`e2e/pricing-hover.spec.js`):
  - Navigate to `/pricing`. Hover each card. Assert that the spotlight element has `opacity > 0` during hover, back to `0` on leave.
  - Assert that the shimmer element re-mounts (or changes `key`) when hovering a second time.
  - Emulate `prefers-reduced-motion: reduce` (Playwright `emulateMedia({ reducedMotion: 'reduce' })`) and assert spotlight is hidden.
  - Repeat on landing preview (`/`) to confirm the same behaviors.
- **Visual regression** (if present in project): screenshot each card in rest and hover states across Free / Pro / Enterprise.

---

## 4. Files Touched (expected)

- [src/components/ui/ContextMenu.jsx](../../src/components/ui/ContextMenu.jsx) — remove scroll constraint, add measure-then-position logic, apply polish classes.
- [src/components/RepoContextMenu.jsx](../../src/components/RepoContextMenu.jsx) — add group separator elements between Archive / (Migration + Management) / Delete in batch mode.
- `src/hooks/usePricingCardHover.js` — new, shared hook exporting state, handlers, and layer components.
- [src/components/Pricing/PricingCard.jsx](../../src/components/Pricing/PricingCard.jsx) — consume `usePricingCardHover`, render hover layers, tint hover shadow per tier, make CTA button magnetic.
- [src/components/Landing/PricingPreview.jsx](../../src/components/Landing/PricingPreview.jsx) — consume `usePricingCardHover`, render hover layers inside each mapped card, magnetic CTA, keep existing vibrant visual identity.
- `tests/components/ui/ContextMenu.test.jsx` — new, unit tests for position calculation.
- `tests/components/Pricing/PricingCard.test.jsx` — new, unit tests for accents, variant, reduced motion.
- `e2e/context-menu-no-scroll.spec.js` — new, E2E scroll-free assertion.
- `e2e/pricing-hover.spec.js` — new, E2E hover layers assertion.

No backend, no database, no API changes.

---

## 5. Non-Goals

- Not changing pricing copy, tier names, prices, or features content.
- Not adding new pricing tiers.
- Not refactoring `ContextMenu.jsx` beyond what's needed (no switch to Radix or Floating UI).
- Not changing context menu item structure or submenu logic.
- Not adding keyboard-driven hover simulation.
- Not touching the `ds-card-shimmer` utility itself — only using it.

---

## 6. Success Criteria

1. Context menu never shows a scrollbar in any viewport position from 320×568 upwards.
2. Context menu always opens fully visible within the viewport, flipping direction when near edges.
3. Context menu visually matches native OS menu conventions (shadow, blur, border, separators, padding).
4. Pricing cards respond to hover with the six-layer system as specified, with per-tier intensity differences.
5. All hover effects gracefully degrade under `prefers-reduced-motion: reduce`.
6. `PricingPreview` and `/pricing` page share the **same** hover behavior via `usePricingCardHover`, while keeping their distinct visual identities intact.
7. All new unit and E2E tests pass.
8. No regression in existing context menu call sites or pricing routes.
