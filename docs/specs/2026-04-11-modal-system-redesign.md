# Modal System Redesign — AI Insights & Cross-Modal Consistency

**Date:** 2026-04-11
**Status:** Draft
**Scope:** Reinforce shared `Modal.jsx` primitive, migrate 3 hand-rolled modals, introduce `InsightCard` + `StatBar` shared components, eliminate desktop scrollbar on AI Insights, add animations, bottom-sheet on mobile.

---

## Problem

The AI Insights modal ([src/components/AI/RepoInsightsModal.jsx](../../src/components/AI/RepoInsightsModal.jsx)) has three concrete UX problems:

1. **Scrollbar always visible on desktop.** The body uses `max-h-[60vh] overflow-y-auto` — fixed 60vh of viewport — and the container is `max-w-2xl`. On a 1080p desktop the Quality tab (breakdown bars + 12 detected features + 4 recommendations) always overflows.
2. **Zero card-level animation.** Only the outer modal fades/scales. Individual cards, bars, tabs, and icons are static. No stagger, no hover polish, no progress animation.
3. **Inconsistent with other modals.** It hand-rolls its own structure (309 lines) instead of using the shared [src/components/ui/Modal.jsx](../../src/components/ui/Modal.jsx) primitive. Same goes for `OrgManagerModal` (417 lines) and `TransferModal` (389 lines) — each with its own header, scroll, footer, and close patterns.

Across the app there are **10 registered modals** in [src/contexts/ModalContext.jsx](../../src/contexts/ModalContext.jsx) but three distinct modal "architectures":

| Architecture | Modals |
|---|---|
| Uses shared `<Modal />` primitive | `ConfirmModal`, `SettingsModal` |
| Hand-rolled motion.div wrapper | `RepoInsightsModal`, `OrgManagerModal`, `TransferModal` |
| Wrapped in `<WizardPanel />` | `CreateRepoModal`, `CommitGeneratorModal` |

The design system in [src/design-system.css](../../src/design-system.css) already ships rich primitives (`ds-stagger`, `ds-animate-fade-in-up`, `ds-card-shimmer`, `ds-hover-lift`, `ds-scrollbar`, `ds-skeleton`, full `prefers-reduced-motion` support) — they are simply not used by the hand-rolled modals.

## Goals

1. **AI Insights shows no scrollbar on desktop (≥1280px width, ≥900px height)** for any tab, with realistic data.
2. **All modals share the same visual language**: header, backdrop, entrance animation, close behavior, footer, scrollbar, card styles.
3. **Animations on cards and elements**: stagger-in on reveal, hover-lift + shimmer on hover, progress bars animate from zero, tab transitions, header icon float.
4. **Bottom-sheet on mobile** (portrait), centered on desktop, centered fallback on mobile landscape.
5. **Edge cases handled explicitly** — long text, empty data, rapid open/close, reduced motion, safe-area insets.
6. **Architecture consolidation** — eliminate ~400-500 lines of duplicated modal boilerplate.

## Non-goals

- No changes to backend APIs, `aiApi`, `azure-service`, or any server code.
- No changes to data shape returned by AI analysis.
- No structural refactor of `WizardPanel` (only visual alignment — same header/footer classes).
- No changes to `MobileDrawer` (it's a drawer, not a modal).
- No changes to `ConfirmModal` (already consistent).
- No changes to `Dashboard/*`, `RepoDetail/*`, `HeaderNew`, or non-modal components.
- No new icons, new fonts, or new external assets.
- No new dependencies.

## Solution overview

### Strategy: Enhanced Hybrid

- **Reinforce** the shared `<Modal />` primitive with new capabilities (tabs, subtitle, sizes, staggerChildren, mobileVariant).
- **Migrate** 3 hand-rolled modals (`RepoInsightsModal`, `OrgManagerModal`, `TransferModal`) to the primitive.
- **Introduce** 2 shared UI components: `<InsightCard>` and `<StatBar>`.
- **Visually align** `WizardPanel` so wizard modals (`CreateRepoModal`, `CommitGeneratorModal`) match non-wizard modals without structural changes.
- **Leverage** existing `ds-*` classes — no new CSS keyframes, no new tokens.

### Why not full migration to `Modal.jsx`?

`WizardPanel` encodes multi-step wizard semantics (step state, validation, back/next). Forcing `CreateRepoModal` and `CommitGeneratorModal` into `Modal.jsx` would lose that abstraction. The correct move is visual alignment, not structural merging.

---

## Architecture

### A. `Modal.jsx` — new capabilities

File: [src/components/ui/Modal.jsx](../../src/components/ui/Modal.jsx)

**New props:**

```jsx
<Modal
  // existing: isOpen, onClose, title, children, footer, size, variant, icon,
  //           closeOnBackdrop, showCloseButton, className
  subtitle={string | ReactNode}   // NEW — second line under title (truncates)
  tabs={Array}                    // NEW — [{ id, label, icon? }]
  activeTab={string}              // NEW — required when tabs present
  onTabChange={(id) => void}      // NEW — required when tabs present
  tabsLayoutId={string}           // NEW — passed to <TabBar layoutId>
  staggerChildren={boolean}       // NEW — wraps body in motion.div with stagger
  mobileVariant={"sheet"|"centered"|"fullscreen"}  // NEW — default "sheet"
  bodyClassName={string}          // NEW — additional classes on body scroll container
  iconGradient={"primary"|"premium"|"success"|"none"}  // NEW — overrides variant for icon tile only
/>
```

**Size additions:**

```js
const sizeClasses = {
  sm:   'max-w-md',     // 448px (existing)
  md:   'max-w-lg',     // 512px (existing)
  lg:   'max-w-2xl',    // 672px (existing)
  xl:   'max-w-4xl',    // 896px (existing, was `full`-ish)
  '2xl':'max-w-5xl',    // NEW 1024px
  '3xl':'max-w-6xl',    // NEW 1152px — for AI Insights Quality tab grid
  full: 'max-w-7xl'     // 1280px (existing)
}
```

**Max-height policy:**

- Desktop (`md:`): `md:max-h-[88vh]`
- Mobile portrait: `max-h-[92vh]` (bottom-sheet)
- Mobile landscape (`max-h-[500px]` media query): `max-h-[90vh]` + centered override

**Header layout when `tabs` present:**

```
┌─────────────────────────────────────────────┐
│  [icon]  Title                      [X]     │  ← row 1: icon + title/subtitle + close
│          subtitle (truncate)                │
├─────────────────────────────────────────────┤
│  Tab 1    Tab 2    Tab 3                    │  ← row 2: <TabBar variant="underline">
└─────────────────────────────────────────────┘
```

Icon tile uses `iconGradient` prop mapped to `--ds-gradient-*` CSS variables. Default `"primary"` (indigo→purple).

**Body wrapper (when `staggerChildren={true}`):**

```jsx
<motion.div
  variants={{
    hidden: {},
    visible: { transition: { staggerChildren: 0.04, delayChildren: 0.08 } }
  }}
  initial="hidden"
  animate="visible"
  key={activeTab}  // re-stagger on tab change
>
  {children}
</motion.div>
```

Children are expected to be `<InsightCard>` (which consumes the stagger variant). If reduced motion is active (via Framer's `useReducedMotion()`), variants are replaced with `{ hidden: {}, visible: {} }` — no stagger, no delay.

**Mobile variant `"sheet"`:**

- `< md`: backdrop uses `items-end`, modal uses `rounded-t-3xl rounded-b-none max-h-[92vh]`, enters with `initial={{ y: '100%' }}`, exits reverse.
- `≥ md`: centered as today.
- `@media (max-height: 500px)`: force centered even on `< md` (landscape fallback).
- Bottom-sheet footer adds `pb-[calc(1rem+env(safe-area-inset-bottom))]`.

**Body scroll lock:**

Use a new hook [src/hooks/useBodyScrollLock.js](../../src/hooks/useBodyScrollLock.js):

```js
export function useBodyScrollLock(isLocked) {
  useEffect(() => {
    if (!isLocked) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [isLocked])
}
```

Called inside `Modal.jsx` with `useBodyScrollLock(isOpen)`.

**Scrollbar:**

Body container always uses `ds-scrollbar` class. No more default browser scrollbar.

---

### B. `InsightCard.jsx` — shared card component

File: [src/components/ui/InsightCard.jsx](../../src/components/ui/InsightCard.jsx) (NEW)

```jsx
<InsightCard
  tone="default"         // "default" | "info" | "success" | "warning" | "danger" | "ai"
  hover={true}           // enables ds-hover-lift + ds-card-shimmer
  className=""           // extra classes (e.g. "lg:col-span-2")
  as={motion.div}        // polymorphic wrapper
>
  {children}
</InsightCard>
```

**Behavior:**

- Base classes: `rounded-xl p-4 ring-1 ring-slate-200/60 dark:ring-slate-800/50 bg-white dark:bg-slate-900/60`
- When `hover`: adds `ds-card-shimmer ds-hover-lift cursor-default`
- `tone` adds a colored ring + subtle gradient background:
  - `info`: `ring-blue-500/20 bg-gradient-to-br from-blue-500/5 to-transparent`
  - `success`: `ring-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-transparent`
  - `warning`: `ring-amber-500/20 bg-gradient-to-br from-amber-500/5 to-transparent`
  - `danger`: `ring-red-500/20 bg-gradient-to-br from-red-500/5 to-transparent`
  - `ai`: `ring-purple-500/25 bg-gradient-to-br from-purple-500/8 via-indigo-500/5 to-transparent`
- `motion.div` consumes parent stagger variants:
  ```js
  variants: {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } }
  }
  ```
- Respects `useReducedMotion()` — no y translation, only opacity fade 150ms.

---

### C. `StatBar.jsx` — animated progress bar

File: [src/components/ui/StatBar.jsx](../../src/components/ui/StatBar.jsx) (NEW)

```jsx
<StatBar
  label="Documentation"
  value={18}
  max={30}
  gradient="primary"     // "primary" | "secondary" | "success" | "accent"
  animated={true}        // default true; false for real-time updates
  showValue={true}       // default true
  size="md"              // "sm" | "md"
/>
```

**Behavior:**

- Label left, `value/max` right, bar full-width underneath.
- Bar animates width from 0 to `(value/max)*100`% using Framer Motion spring `{ damping: 22, stiffness: 90, delay: 0.1 }`.
- When `animated={false}`: uses CSS `transition: width 150ms ease-out` (for rapid updates like TransferModal progress).
- Respects `useReducedMotion()` — snaps directly to final value.
- Gradient mapped to `--ds-gradient-*`.
- Empty state (value=0): renders a 2px pulsing dot at position 0 instead of empty bar.
- `size="sm"`: `h-1.5`; `size="md"`: `h-2`.

---

### D. `RepoInsightsModal.jsx` — reorganized layout

File: [src/components/AI/RepoInsightsModal.jsx](../../src/components/AI/RepoInsightsModal.jsx)

**Removed:**

- Hand-rolled `motion.div` backdrop + container (~80 lines).
- Hand-rolled header (~30 lines).
- Hand-rolled footer (~20 lines).
- Manual TabBar wrapper div (Modal now handles it).

**Kept:**

- `fetchAnalysis` + `reanalyze` logic (updated with `AbortController`).
- Tab state management.

**New structure:**

```jsx
<Modal
  isOpen={isOpen}
  onClose={onClose}
  title="AI Insights"
  subtitle={repo?.full_name}
  icon={Sparkles}
  iconGradient="primary"
  size="3xl"
  tabs={tabs}
  activeTab={activeTab}
  onTabChange={setActiveTab}
  tabsLayoutId="repo-insights-tabs"
  staggerChildren
  mobileVariant="sheet"
  footer={
    <ModalFooter align="right">
      <button onClick={reanalyze} disabled={loading}>
        {loading && <Loader2 className="animate-spin" />} Re-analyze
      </button>
      <button onClick={onClose}>Done</button>
    </ModalFooter>
  }
>
  {loading && !analysis && <InsightsSkeletonGrid />}
  {error && <InsightsErrorCard onRetry={fetchAnalysis} />}
  {analysis && activeTab === 'overview' && <OverviewGrid data={analysis} />}
  {analysis && activeTab === 'quality' && <QualityGrid data={analysis} />}
  {analysis && activeTab === 'readme' && <ReadmeGrid data={analysis} />}
</Modal>
```

**`OverviewGrid` layout (grid, 3 columns on lg+):**

```
┌──────────────────┬──────────────────────────────┐
│ Health Score     │ TL;DR Summary                │
│ (CircularScore)  │ (line-clamp-4 + Show more)   │
│ col-span-1       │ col-span-2                   │
├──────────────────┴──────────────────────────────┤
│ Highlights (grid-cols-2 gap-2)                  │
│ col-span-3                                      │
├─────────────────────────────────────────────────┤
│ Suggested Topics (flex-wrap pills)              │
│ col-span-3                                      │
└─────────────────────────────────────────────────┘
```

**`QualityGrid` layout (grid, 2 columns on lg+):**

```
┌──────────────────────┬──────────────────────────┐
│ Quality Breakdown    │ Detected Features        │
│ (4x StatBar)         │ (grid-cols-2 internal,   │
│ col-span-1           │  max-h with ds-scrollbar)│
│                      │ col-span-1               │
├──────────────────────┴──────────────────────────┤
│ Recommendations (grid md:grid-cols-2)           │
│ col-span-2                                      │
└─────────────────────────────────────────────────┘
```

**`ReadmeGrid` layout:**

Single column. Existing structure preserved, wrapped in `<InsightCard>`s.

**Circular score (new inline component inside RepoInsightsModal):**

```jsx
<CircularScore value={analysis.health_score} max={100} />
```

- SVG `<circle>` with `stroke-dasharray` animated via Framer Motion.
- Color based on value: ≥80 green, ≥50 amber, <50 red.
- Value text in center, "/100" below.
- Size ~120px. On lg+ centers inside its card.
- Respects reduced motion.

**Loading state change:**

- Initial load: `<InsightsSkeletonGrid>` — same grid shape as real content, cards use `.ds-skeleton`. Zero layout shift on reveal.
- Re-analyze (analysis already exists): spinner inline in footer button + `opacity-60 pointer-events-none` on body. Content preserved.

**AbortController:**

```js
useEffect(() => {
  if (!isOpen || !repo) return
  const ctrl = new AbortController()
  fetchAnalysis(ctrl.signal)
  return () => ctrl.abort()
}, [isOpen, repo?.id])
```

`fetchAnalysis` awaits and checks `signal.aborted` before `setState`. Aborted errors are swallowed silently.

**Long summary handling:**

```jsx
<div className="relative">
  <p className={expanded ? "" : "line-clamp-4"}>{analysis.summary}</p>
  {!expanded && needsClamp && (
    <button onClick={() => setExpanded(true)}>Show more</button>
  )}
</div>
```

`needsClamp` computed once on mount using `scrollHeight > clientHeight` ref check.

**Empty / partial data handling:**

Each section checks its source (`highlights?.length`, `suggested_topics?.length`, etc.) and hides the card entirely if empty. If Overview tab has only Health Score + empty sections, show a friendly "Analysis in progress — some sections may appear later" message. If Quality tab is empty, same.

---

### E. Other modal migrations

**`OrgManagerModal.jsx`**

- Migrate to `<Modal size="2xl" tabs>`.
- Tabs: Overview, Members, Settings (unchanged).
- Edit mode toggle stays inside Overview tab.
- Cards become `<InsightCard>`.
- Stagger re-triggers **only on tab change**, not on edit mode toggle.
- Estimated line reduction: ~180 lines.

**`TransferModal.jsx`**

- Migrate to `<Modal size="2xl">`.
- Progress bar uses `<StatBar animated={false}>` during active transfer, `animated={true}` on reveal.
- Conflict list becomes vertical stack of `<InsightCard tone="warning">`.
- Action toggle stays as-is but restyled with shared classes.
- Estimated line reduction: ~120 lines.

**`SettingsModal.jsx`**

- Already uses `<Modal />`. Add `staggerChildren` prop. Wrap tab content in `<InsightCard>`s where appropriate.
- No architectural changes.

**`CreateRepoModal.jsx` + `CommitGeneratorModal.jsx`**

- Stay in `WizardPanel` (wizard semantics preserved).
- `WizardPanel` gets visual alignment pass:
  - Same backdrop (`bg-black/60 dark:bg-black/75 backdrop-blur-md z-50`)
  - Same entrance animation (spring scale + y)
  - Same header gradient classes
  - Same footer glass classes
  - Same `ds-scrollbar` on body
- Internal cards → `<InsightCard>`.

---

## Animations (exhaustive list)

All animations respect `prefers-reduced-motion` via Framer's `useReducedMotion()` hook and the existing `@media (prefers-reduced-motion)` CSS rules.

| Location | Animation | Timing |
|---|---|---|
| Modal container enter | `opacity + scale + y` (desktop) / `opacity + y:100%→0` (mobile sheet) | spring, duration 0.4, bounce 0.12 |
| Modal container exit | Reverse | 0.2s ease-out |
| Backdrop | `opacity 0→1` | 0.2s |
| Header icon tile | `ds-animate-float` subtle 3s loop | infinite |
| Tab content switch | `AnimatePresence mode="wait"` fade + y=8 | 0.2s |
| Body stagger | `staggerChildren: 0.04, delayChildren: 0.08` | — |
| InsightCard enter | `opacity 0→1, y 12→0` | 0.35s, ease-out-expo |
| InsightCard hover | `ds-hover-lift` (translateY -4px) + `ds-card-shimmer` | 0.25s / 0.8s |
| StatBar fill | `width 0→value%` spring | damping 22, stiffness 90, delay 0.1 |
| CircularScore sweep | `stroke-dashoffset` from full to target | 0.8s, ease-out-expo |
| Primary button hover | `ds-btn-shimmer` overlay | 0.6s |
| Tab underline | TabBar `layoutId` motion slide | spring default |
| Loading skeleton | `ds-skeleton` shimmer | 1.8s loop |

---

## Edge cases — explicit handling

Every edge case below has a documented mitigation. These are test criteria, not suggestions.

| # | Edge case | Mitigation |
|---|---|---|
| 1 | TL;DR summary > 4 lines | `line-clamp-4` + "Show more" toggle; `needsClamp` detected via ref on mount |
| 2 | Variable number of quality breakdown items (4, 5, 6…) | `StatBar` container uses flex column, no fixed slot count |
| 3 | Many detected features (>12) | `grid-cols-2 lg:grid-cols-3` + internal `max-h-[240px] ds-scrollbar` on the card only |
| 4 | Re-analyze during view | Inline loading (spinner in footer button + body `opacity-60 pointer-events-none`); content preserved |
| 5 | State update after unmount | `AbortController` in `fetchAnalysis`, aborted on modal close or `repo.id` change |
| 6 | Rapid open/close/open double-fetch | Same AbortController + ref cache of last `analysis` by `repo.id` — skip fetch if fresh (<60s) |
| 7 | Mobile landscape (height ≤500px) | Media query forces `centered` variant instead of `sheet` |
| 8 | iOS safe-area inset | Footer adds `pb-[calc(1rem+env(safe-area-inset-bottom))]` in sheet variant |
| 9 | Body scroll leakage behind modal | `useBodyScrollLock(isOpen)` hook on body `overflow: hidden` |
| 10 | Focus return on close | **Already handled** by [src/hooks/useFocusTrap.js](../../src/hooks/useFocusTrap.js):8,13,59-61 — stores `previouslyFocusedRef` on open, restores on cleanup. Verify no regression during migration. |
| 11 | OrgManager edit mode re-triggers stagger | Stagger keyed on `activeTab`, not on internal state |
| 12 | TransferModal progress vibrates on rapid updates | `<StatBar animated={false}>` during active transfer (CSS 150ms), `animated={true}` on initial reveal |
| 13 | Framer Motion ignores `prefers-reduced-motion` | Use `useReducedMotion()` hook in `Modal.jsx`, `StatBar`, `InsightCard`, `CircularScore` — branch variants |
| 14 | Tab keyboard navigation (ArrowLeft/Right) | **Already handled** by [src/components/ui/TabBar.jsx](../../src/components/ui/TabBar.jsx):36-60 — ArrowLeft, ArrowRight, Home, End all implemented. `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, `tabIndex` management all present. Verify no regression when Modal wraps TabBar. |
| 15 | Modal stacking (z-index collision) | Base modal `z-[60]`; stacked (ConfirmModal on top) `z-[70]`; toast layer already `z-[80]` |
| 16 | Empty / missing data per section | Each card short-circuits if its source array/object is empty; fallback message if whole tab is empty |
| 17 | Very long `repo.full_name` in subtitle | `truncate` + `max-w-[60%]` on subtitle element |
| 18 | Empty `StatBar` value=0 | 2px pulsing dot at position 0 (not empty bar) |
| 19 | `StatBar` value at max | Full bar, no overshoot in spring (clamped) |
| 20 | Color contrast over gradient backgrounds | Manual WCAG AA check per card tone; solid background fallback if fail |

---

## Validation plan

### Unit tests

- `tests/components/ui/Modal.test.jsx`
  - Renders with no tabs
  - Renders with tabs, active tab visible
  - Calls `onTabChange` on tab click
  - Focus trap active when open, removed when closed
  - Body scroll locked when open
  - Bottom-sheet variant applies correct classes on mobile width
  - `staggerChildren` wraps body in motion.div
  - Respects `prefers-reduced-motion` (mock `useReducedMotion → true`)

- `tests/components/ui/InsightCard.test.jsx`
  - Renders children
  - Applies tone classes
  - Consumes parent stagger variants
  - Hover classes present when `hover={true}`

- `tests/components/ui/StatBar.test.jsx`
  - Renders label and value
  - Animates to correct width (check final inline width style)
  - `animated={false}` skips spring
  - Empty value renders dot indicator
  - Reduced motion snaps to final value

### E2E tests (Playwright)

`e2e/modal-redesign.spec.js`:

- Open AI Insights modal → assert no vertical scrollbar on Overview tab at 1920×1080
- Open AI Insights modal → switch to Quality tab → assert no vertical scrollbar
- Open AI Insights modal → switch to README tab → assert no vertical scrollbar
- Resize to 390×844 → open modal → assert bottom-sheet classes present
- Resize to 844×390 (landscape) → open modal → assert centered classes present (not sheet)
- Close modal → assert body `overflow` restored

### Visual regression (Playwright MCP screenshots)

Saved to `docs/images/2026-04-11_modal-redesign_*_hd.png`:

| Viewport | Theme | Motion | Modals (each is 1 screenshot) | Count |
| --- | --- | --- | --- | --- |
| 1920×1080 | light | normal | AIInsights Overview, AIInsights Quality, AIInsights README, OrgManager, Transfer, Settings | 6 |
| 1920×1080 | dark | normal | AIInsights Overview, AIInsights Quality, AIInsights README, OrgManager, Transfer, Settings | 6 |
| 390×844 | dark | normal | AIInsights (sheet), OrgManager (sheet) | 2 |
| 844×390 | dark | normal | AIInsights (landscape fallback, centered) | 1 |
| 1920×1080 | dark | reduced | AIInsights Quality (verifies no animation) | 1 |

**Total: 16 screenshots.**

### Lint + build

- `npm run lint` — zero new warnings
- `npm run build` — zero errors
- `npx vitest run` — all unit tests pass
- `npx playwright test` — all E2E tests pass

### Manual checklist

- [ ] Desktop 1920×1080: no scrollbar on any AI Insights tab
- [ ] Desktop 1440×900: no scrollbar on any AI Insights tab
- [ ] Laptop 1366×768: scrollbar acceptable on Quality if needed, styled `ds-scrollbar`
- [ ] Mobile portrait: bottom-sheet enters from bottom, footer above safe area
- [ ] Mobile landscape: centered, not sheet
- [ ] Dark mode: all borders/text readable, no bleed
- [ ] Reduced motion: no stagger, no shimmer, no hover-lift, bars snap
- [ ] Tab arrow keys work
- [ ] Escape closes modal
- [ ] Backdrop click closes modal
- [ ] Focus returns to trigger on close
- [ ] Rapid open/close no console errors
- [ ] Re-analyze during view doesn't flash empty state

---

## Out of scope (explicit)

- Do not modify `MobileDrawer`, `ConfirmModal`, `Dashboard/*`, `RepoDetail/*`, `HeaderNew`, `Sidebar`, `RepoList`, `AIAssistant`, or any non-modal component.
- Do not touch backend code (`server/`, `aiApi`, `azure-service`, `import-service`).
- Do not add new dependencies.
- Do not add new CSS keyframes (all animations use existing `ds-*` classes + Framer Motion variants).
- Do not change data shapes, API contracts, or the `ModalContext` API.
- Do not introduce TypeScript.

## Success criteria

1. AI Insights modal shows **no vertical scrollbar** on Overview, Quality, or README tab at 1920×1080 and 1440×900, with any realistic data returned by the current backend.
2. AI Insights, OrgManager, Transfer, and Settings modals share visually identical headers, footers, backdrops, entrance animations, and card styles — visible in side-by-side screenshots.
3. Every card in every migrated modal has a stagger-in animation, hover-lift, and shimmer (unless reduced-motion).
4. Mobile portrait shows bottom-sheet; mobile landscape shows centered; desktop shows centered — all verified in screenshots.
5. Reduced-motion users see zero spring/stagger/shimmer — only opacity fades — verified in screenshots.
6. Line count for modal-related files drops by ≥400 lines net.
7. All 20 edge cases in the edge-case table have passing tests or manual-check entries.
8. `npm run lint`, `npm run build`, `npx vitest run`, `npx playwright test` all pass clean.

---

## Open questions

None — all decisions resolved during brainstorming:

- **Scope**: enhanced hybrid (migrate 3, visual-align WizardPanel, keep ConfirmModal/MobileDrawer).
- **Mobile layout**: bottom-sheet in portrait, centered in landscape, centered on desktop.
- **Visual tone**: premium-coherent (existing slate/purple palette, ds-gradient-primary accents only).
- **Circular score**: SVG inline component inside `RepoInsightsModal`, not promoted to shared UI until a second consumer exists.
