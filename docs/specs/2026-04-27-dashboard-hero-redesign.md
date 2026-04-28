# Dashboard Hero Redesign

**Date:** 2026-04-27
**Status:** Draft (awaiting user review)
**Scope:** Dashboard hero zone (PageHeader + YourWorkCard + AI banner) + targeted mobile fixes to `Header.jsx`. Top-bar desktop layout untouched.

---

## 1. Why

The current Dashboard hero is three stacked blocks (PageHeader with org-filter dropdown, YourWorkCard, gradient AI banner) that:

- Compete visually — three premium-feel surfaces in a row, no hierarchy.
- Communicate poorly — *"Comprehensive overview of your GitHub ecosystem"* is generic.
- Break in mobile — `OrganizationSelector` has `min-w-[260px]`, `YourWorkCard` is `grid-cols-3` at all viewports, and the bottom mobile-nav drops the **Work Board** entry plus all quick-actions.
- Mislead — `YourWorkCard` claims "Live counts" but only fetches once on mount.
- Don't surface deltas — when everything is at 0, the user sees three zeros side-by-side with no celebration and no "what changed" framing.

The redesign fuses the hero into a single coherent zone (greeting → context chips → "What needs you" grid), demotes the AI banner to a subtle promo strip that auto-disappears after discovery, fixes the mobile-nav to include Work Board, and adds a FAB for mobile quick-actions.

## 2. Non-goals

- ❌ Not redesigning `StatCard`, `ActivityChart`, `LanguageChart`, `OrganizationCard`, `CategorySection`.
- ❌ Not redesigning `MigrationActivity` or `AttentionFeed` (only repositioning `AttentionFeed` below the new hero).
- ❌ Not redesigning the desktop top-bar of `Header.jsx`.
- ❌ Not changing the routing model (`onViewChange(viewId, params)` stays).
- ❌ Not adding new dependencies (Framer Motion, Radix, lucide-react are sufficient).
- ❌ Not introducing new design tokens; everything composes from existing `ds-*` classes and Tailwind tokens.
- ❌ Backend untouched on the first iteration. Deltas are client-side via `sessionStorage`. A backend-side delta endpoint can be a follow-up.

## 3. Architecture

### 3.1 New components

| File | Role |
|---|---|
| `src/components/Dashboard/DashboardHero.jsx` | Orchestrates eyebrow + greeting + context chips + WhatNeedsYouGrid. Replaces the current PageHeader + YourWorkCard combination on the Dashboard. |
| `src/components/Dashboard/WhatNeedsYouGrid.jsx` | 4-col (desktop) / 2×2 (mobile) grid of clickable category cards with delta indicators. |
| `src/components/Dashboard/HeroChip.jsx` | Shared chip primitive used by org-filter, time-range, and sync (mobile-only) controls. |
| `src/components/Dashboard/AIPromoStrip.jsx` | Slim promo strip; auto-dismisses based on user discovery heuristics. |
| `src/components/MobileQuickActionsFab.jsx` | Mobile-only floating action button that expands to Create / Import / Dev Toolkit. |
| `src/components/ui/Sheet.jsx` | Radix Dialog wrapper with bottom-sheet styling for mobile. Reused by mobile org-filter popover and Header "More" menu. |
| `src/hooks/useYourWork.js` | Encapsulates fetch + visibilitychange refresh + delta tracking via `sessionStorage`. |
| `src/hooks/useAIPromoVisibility.js` | Returns `true` if AI promo strip should be visible based on localStorage flags + repos count. |

### 3.2 Modified files

| File | Change |
|---|---|
| `src/components/Dashboard/DashboardPremium.jsx` | Replaces hero block (PageHeader + YourWorkCard + AI gradient banner) with `<DashboardHero />` + `<AIPromoStrip />`. Moves `<AttentionFeed />` below the new hero. Lifts `timeRange` state into the hero. |
| `src/components/Dashboard/ActivityChart.jsx` | Removes its internal time-range selector (now in hero); receives `timeRange` as prop only. |
| `src/components/Header.jsx` | Bottom-nav grows from 4 to 5 items (adds Work Board with badge, demotes Pricing into "More" sheet). Mounts `<MobileQuickActionsFab />` as sibling to bottom-nav. Top-bar desktop unchanged. |
| `src/components/AIAssistant.jsx` | Increments `localStorage('ai-assistant-opened-count')` on open (1 line). |
| `src/components/AI/RepoInsightsModal.jsx` | Sets `localStorage('ai-insights-viewed')` on first open (1 line). |
| `src/hooks/useGitHub.js` | Exposes `lastSyncedAt` timestamp set on successful `refreshOrgs` resolution. |
| `src/components/WorkBoard/*` | Reads `initialTab` from navigation params and pre-selects the matching tab on mount. |

### 3.3 Removed files

| File | Reason |
|---|---|
| `src/components/Dashboard/YourWorkCard.jsx` | Logic migrates to `useYourWork` hook + `WhatNeedsYouGrid`. |

---

## 4. `<DashboardHero />`

### 4.1 Anatomy

```text
┌─────────────────────────────────────────────────────────────────────┐
│ QUARTA · 27 ABR · sincronizado há 2 min                             │
│ Bom dia, Bruno                                          (gradient)  │
│ Aqui está o que precisa de ti hoje.                                 │
│                                                                     │
│ [🏢 All organizations ▾]  [📅 Últimos 7 dias ▾]  [↻ Sync]          │
│                                                                     │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐                                 │
│ │Reviews  │ │Stale PRs│ │Issues   │   ← WhatNeedsYouGrid            │
│ │   3 +2↑ │ │   1     │ │   0     │                                 │
│ └─────────┘ └─────────┘ └─────────┘                                 │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 Eyebrow

- Format: `{DIA_SEMANA} · {DD MMM} · sincronizado há {Xm}`. Locale: `pt-PT` if browser preference matches, else `en-GB`.
- Class: `text-[10px] font-semibold uppercase tracking-[0.22em] text-indigo-600 dark:text-indigo-300`. Identical to `PageHeader` (line 35 of current implementation).
- `lastSyncedAt` source: `useGitHub` hook exposes the timestamp; relative formatting via existing `useRelativeTime`.

### 4.3 Greeting (H1)

- Copy: `Bom dia, {user.name || user.login}` based on `new Date().getHours()` (≤ 11 morning, 12–17 afternoon, ≥ 18 evening).
- Class: `mt-1 text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight ds-font-display ds-gradient-text`.
- Loading state: `Olá ✨` (no skeleton bar).
- Mock-mode: `Bom dia, demo user`.

### 4.4 Sub-title

- When work-pending > 0: *"Aqui está o que precisa de ti hoje."*
- When work-pending = 0 AND user has repos: *"Estás em dia. Hora de café."*
- When `repos.length === 0`: *"A explorar os teus repositórios pela primeira vez…"*
- Class: `mt-1.5 text-sm text-slate-500 dark:text-slate-400`.

### 4.5 Context chips

Three `<HeroChip />` instances, wrap on mobile:

1. **`org-filter`** — uses the existing Radix Popover from `OrganizationSelector` (popover content is reused; only the trigger gets the chip skeleton). On viewports `< sm`, the popover swaps to `<Sheet />` (bottom-sheet) for legibility.
2. **`time-range`** — controls `7d / 30d / 90d`. The state lifts from `DashboardPremium`'s `useState('7d')` (line 38) into the hero, and is passed down to `ActivityChart` and `calculateActivityMetrics`. `ActivityChart` loses its internal selector.
3. **`sync`** — duplicates the header `↻` button. Visible only on `< md` (where the header pill is visually busy and the action is far from the hero). Class: `md:hidden`.

### 4.6 `<HeroChip />` shared anatomy

```jsx
<button
  className="
    inline-flex items-center gap-2 h-9 px-3 rounded-xl
    bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl
    border border-slate-200/60 dark:border-slate-700/50
    hover:border-indigo-300 dark:hover:border-indigo-500/40
    hover:bg-white/80 dark:hover:bg-slate-900/80
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
    transition-colors
  "
>
  <Icon className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{label}</span>
  {hasMenu && <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
</button>
```

Variants: `org-filter`, `time-range`, `sync` (no menu). All share the same height, padding, and rings.

### 4.7 Animation

- Container `motion.div` with `staggerChildren: 0.06` (matches `DashboardPremium` line 101).
- Each child `initial={{ opacity: 0, y: 12 }}` → `animate={{ opacity: 1, y: 0 }}`, easing `[0.16, 1, 0.3, 1]`, duration `0.4` (matches AI banner line 152).
- Sync chip: icon spins via `animate-spin` while sync is in-flight.

### 4.8 Accessibility

- Single `<h1>` per page (already a constraint).
- Each chip is `<button>` with descriptive `aria-label` (e.g., `Filter by organization, currently All organizations`).
- Sync chip: `aria-label="Sync now, last synced 2 minutes ago"`.
- Eyebrow + greeting are siblings, not headings, so they don't compete with the H1.

---

## 5. `<WhatNeedsYouGrid />`

### 5.1 Categories (3, not 4)

| # | Title | Endpoint | Tone |
|---|---|---|---|
| 1 | Reviews waiting | `/api/v1/work-board/my-reviews?limit=50` | indigo |
| 2 | Stale PRs | `/api/v1/work-board/stale-prs?limit=50` | amber |
| 3 | Issues for you | `/api/v1/work-board/my-issues?limit=50` | emerald |

`failed_migrations` is intentionally excluded from the grid. It already surfaces in two visible places (notification bell + Migration Activity section). Adding a fourth grid card would require a new dedicated endpoint; out of scope.

### 5.2 Layout

```text
mobile  (< sm):    grid-cols-2  gap-3   → 2 + 1 (third spans both cols)
tablet  (sm–lg):   grid-cols-2  gap-4
desktop (≥ lg):    grid-cols-3  gap-5
```

Note: with 3 categories on mobile in a 2-col grid, the third card spans both columns (`col-span-2`) for visual balance.

### 5.3 Card anatomy

```text
┌──────────────────────────────────────┐
│ ┌──┐                                 │
│ │🔍│   REVIEWS WAITING               │  ← label (uppercase, text-[10px])
│ └──┘                                 │
│                                      │
│   3                       +2 ↑       │  ← count + delta
│                                      │
│   desde ontem                        │  ← delta context
│                                      │
│   Open ↗                             │  ← micro CTA (hover only)
└──────────────────────────────────────┘
```

- Container: `bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border border-slate-200/40 dark:border-slate-800/40 rounded-2xl p-5`.
- Hover: `whileHover={{ y: -3 }}`, border swap to category tone.
- Icon container: `w-10 h-10 rounded-xl bg-{tone}-500/10 text-{tone}-500`.
- Count: `text-3xl ds-font-display font-bold`, color is `text-{tone}-600 dark:text-{tone}-400` when count > 0, else `text-slate-400 dark:text-slate-600`.
- Whole card is `<button>`. Click → `onViewChange('work-board', { initialTab: 'reviews' | 'stale' | 'issues' })`.

### 5.4 Delta tracking

Hook `useYourWork` keeps `{count, timestamp}` snapshots in `sessionStorage` per category, keyed by user login. On each fetch:

1. Compare current count with previous snapshot from the same session.
2. Compute delta (`current - previous`).
3. Choose context label based on time gap: `< 1h` → "desde há pouco", `< 24h` → "desde manhã", `≥ 24h` → "desde ontem".
4. First session ever (no baseline in `sessionStorage`): show only the count. No delta indicator and no context line — the card is just `{label}` + `{count}` until a second snapshot exists.

Delta UI:

- `+2 ↑` → `text-emerald-500`
- `-1 ↓` → `text-rose-500`
- `=` → hidden (don't clutter when nothing changed).

### 5.5 Refresh strategy

- Initial fetch on mount (parallel for the 3 endpoints, same pattern as current `YourWorkCard`).
- `document.visibilitychange` listener: when tab returns to focus and last fetch is > 30s old, silently refetch.
- No fixed-interval polling.

### 5.6 Empty state (all-zero)

When `reviews + stale + issues === 0`, replace the grid with a centered celebratory block:

```text
       ✨
   Estás em dia.
   Nada precisa de ti agora.
   [Open Work Board ↗]
```

- Animation: `ds-animate-scale-in` on first appearance.
- CTA is a low-emphasis link button.
- Renders inside the same container the grid would occupy.

### 5.7 Hidden state (no auth)

When all 3 endpoints return 401/403/404, hook returns `{hidden: true}`; hero renders only the eyebrow + greeting + chips (no grid, no empty state). Same logic as current `YourWorkCard`.

### 5.8 Loading state

Skeleton: 3 cards with `animate-pulse`, ghost icon + grey count bar. `bg-slate-200/40 dark:bg-slate-800/40`. No randomized placeholders.

### 5.9 Accessibility

- Each card: `<button>` with `aria-label` like `3 reviews waiting, opens Work Board reviews tab`.
- Empty state: `role="status"`.
- Deltas: `aria-label="2 more than yesterday"`.

---

## 6. `<AIPromoStrip />`

### 6.1 Position

Below `<DashboardHero />`, above the first `CategorySection ("Overview")`. Visible only when `useAIPromoVisibility()` returns `true`.

### 6.2 Anatomy

```text
┌──────────────────────────────────────────────────────────────────────┐
│ ✨  Try AI insights — free  ·  Run a risk report on any repo         │ → [Open Assistant] [Get Insights] [×]
└──────────────────────────────────────────────────────────────────────┘
```

- Height: `py-3 px-5` (≈ 50px), roughly half the current banner.
- Background: `bg-gradient-to-r from-indigo-50/60 via-white/40 to-purple-50/60 dark:from-indigo-500/5 dark:via-slate-900/30 dark:to-purple-500/5`.
- Border: `border border-indigo-200/30 dark:border-indigo-500/10`.
- `rounded-2xl`.
- No radial gradients (current banner has them; the slim strip doesn't need them).

### 6.3 Tier-aware copy

Reuses existing `aiBannerCopy` lookup (free / pro / enterprise). Same tier detection logic.

### 6.4 Buttons

- `Open Assistant` (secondary) — dispatches `ai-assistant:open` CustomEvent.
- `Get Insights` (primary, gradient indigo→purple, `ds-btn-shimmer`) — opens `showRepoInsights` modal with `repos[0]`.
- `×` (icon-only) — sets `localStorage('ai-promo-dismissed', 'true')`. Aria-label: `Dismiss AI promotion`.

### 6.5 Visibility heuristics

`useAIPromoVisibility()` returns `false` when any is true:

1. `localStorage('ai-promo-dismissed') === 'true'`
2. `parseInt(localStorage('ai-assistant-opened-count'), 10) >= 3`
3. `localStorage('ai-insights-viewed') === 'true'`
4. `repos.length === 0`

### 6.6 Animation

`motion.div` with `initial={{ opacity: 0, height: 0 }}` → `animate={{ opacity: 1, height: 'auto' }}` for entrance. Reverse on dismiss (collapse, not snap).

### 6.7 Layout responsive

- `< sm`: `flex-col`, title row on top, button row below.
- `≥ sm`: `flex-row`, title left, buttons right.

### 6.8 Accessibility

- `<aside aria-label="AI features promotion">`.
- Buttons retain existing labels and shimmer.
- Dismiss button has visible focus ring (indigo).

---

## 7. Mobile fixes to `Header.jsx`

### 7.1 Bottom-nav: 4 → 5 items

Replace the array at line 295:

```js
[
  { id: 'dashboard',  icon: LayoutDashboard, label: 'Home' },
  { id: 'repos',      icon: FolderGit2,     label: 'Repos' },
  { id: 'work-board', icon: Kanban,         label: 'Work',   badge: workBoardCount },
  { id: 'teams',      icon: Users,          label: 'Teams' },
  { id: 'more',       icon: Menu,           label: 'More',   variant: 'sheet' },
]
```

- Fits 320px viewport with `min-w-[44px]` per item, `justify-around`.
- Labels use the shorter form on mobile (`Home` instead of `Dashboard`).
- `Work` shows a red dot (`w-2 h-2 rounded-full bg-rose-500`) over the icon when `workBoardCount > 0` (not a numeric badge — saves space).
- `More` opens the new `<Sheet />` containing: Pricing, Migration History, Settings, Re-authorize Permissions, Logout. (Same items as the desktop user-dropdown.)

### 7.2 `<MobileQuickActionsFab />`

- Position: `fixed bottom-[calc(56px+1rem+var(--safe-area-inset-bottom,0px))] right-4 z-50`. Floats above the bottom-nav.
- Visibility: `md:hidden`. Hidden when `!user`.
- Main button: `w-14 h-14 rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 shadow-xl shadow-indigo-500/40 ds-btn-shimmer`. Icon: white `<Plus />`, rotates to `<X />` (`rotate: 45`) when expanded.
- Secondary buttons (expanded): three `w-12 h-12 rounded-full bg-white dark:bg-slate-800 shadow-lg border` buttons stacked above the main button. Order top→bottom: Dev Toolkit, Import, Create.
- Backdrop: `fixed inset-0 bg-black/30 backdrop-blur-sm z-40` when expanded; tap to close.
- Open/close animation: stagger via Framer Motion (`y: 20 → 0`, opacity, 50ms between secondaries). Main button `rotate` is a spring transition.
- Accessibility: `aria-expanded`, `role="menu"`, `role="menuitem"` on each. ESC closes.

### 7.3 `<Sheet />` primitive

`src/components/ui/Sheet.jsx`:

```jsx
<Dialog.Root>
  <Dialog.Portal>
    <Dialog.Overlay asChild>
      <motion.div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
    </Dialog.Overlay>
    <Dialog.Content asChild>
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="
          fixed bottom-0 left-0 right-0 z-50
          max-h-[85vh] overflow-y-auto
          bg-white dark:bg-slate-900
          border-t border-slate-200/60 dark:border-slate-700/50
          rounded-t-2xl shadow-2xl
          p-5
          pb-[calc(1.25rem+var(--safe-area-inset-bottom,0px))]
        "
      >
        <div className="w-12 h-1 rounded-full bg-slate-300 dark:bg-slate-600 mx-auto mb-4" />
        {children}
      </motion.div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
```

Animation uses Framer Motion (already a dependency) instead of CSS keyframes; matches the easing curve used elsewhere in the app. Used by: mobile org-filter popover (Section 4.5), Header "More" menu (Section 7.1).

### 7.4 Top-bar desktop

**Unchanged.** Pills (logo / ⌘K / nav / quick actions / utility) keep their current layout. Only the mobile path (bottom-nav + new FAB) gets the work.

---

## 8. Visual language

### 8.1 Tokens reused (no new tokens)

| Use | Token / Class |
|---|---|
| Premium card | `bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border border-slate-200/40 dark:border-slate-800/40 rounded-2xl` |
| Display font | `ds-font-display` |
| Gradient text | `ds-gradient-text` |
| Button shimmer | `ds-btn-shimmer` |
| Hover lift | `whileHover={{ y: -3 }}` (Framer) |
| Scale-in | `ds-animate-scale-in` |
| Eyebrow | `text-[10px] font-semibold uppercase tracking-[0.22em] text-indigo-600 dark:text-indigo-300` |
| Focus ring | `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500` |
| Border radius | `rounded-2xl` (cards), `rounded-xl` (buttons), `rounded-full` (FAB) |

### 8.2 Category tones

Each `WhatNeedsYou` card uses one of the existing `YourWorkCard` tones:

- **indigo** — Reviews waiting
- **amber** — Stale PRs
- **emerald** — Issues for you

### 8.3 Mobile rules

- All interactive areas ≥ 44×44px.
- Body text ≥ 12px (`text-xs`); only badges/eyebrows allow 10px.
- No `min-w-[Xpx]` exceeds 90vw on mobile.
- Horizontal scroll is explicit (`overflow-x-auto snap-x`) with a fade-out hint when used.

### 8.4 Honesty (per project memory `vaporware_audit_2026_04_26`)

- `YourWorkCard`'s misleading "Live counts" copy is replaced with `Updated {Xm} ago` driven by real `lastFetchedAt` state.
- All-zero empty state is celebratory, not three-zeros lined up as if they were data.
- AI promo strip remains tier-aware; never claims "AI included" on free.

---

## 9. Testing

### 9.1 Unit tests (Vitest)

- `tests/hooks/useYourWork.test.js` — fetch, deltas via sessionStorage, hidden state on 401, visibilitychange refresh.
- `tests/hooks/useAIPromoVisibility.test.js` — each of the 4 dismissal conditions.
- `tests/components/Dashboard/HeroChip.test.jsx` — keyboard navigation, focus ring, popover trigger.
- `tests/components/Dashboard/WhatNeedsYouGrid.test.jsx` — empty state, loading state, click-through fires `onViewChange` with correct `initialTab`.
- `tests/components/Dashboard/AIPromoStrip.test.jsx` — visibility logic, dismiss button, copy per tier.
- `tests/components/MobileQuickActionsFab.test.jsx` — open/close, ESC, backdrop click, action handlers.

### 9.2 E2E tests (Playwright)

- `e2e/dashboard-hero.spec.js` — greeting renders correct period (mock time), chips open popovers, time-range chip propagates to ActivityChart.
- `e2e/dashboard-empty-state.spec.js` — when work-board endpoints return empty, celebratory state shows; CTA navigates to Work Board.
- `e2e/mobile-nav-quick-actions.spec.js` (viewport 375×667) — bottom-nav has 5 items including Work Board, FAB opens with stagger, all 3 actions wired.

### 9.3 Visual regression

Capture before/after at:

- Desktop 1920×1080 (Playwright MCP)
- Mobile 375×667
- Mobile dark-mode 375×667

Save as `docs/images/dashboard-hero-{before,after}_{viewport}_hd.png`.

---

## 10. Open questions / follow-ups (out of scope)

1. **Backend-side delta endpoint** — current design uses `sessionStorage` for deltas. A backend endpoint like `/api/v1/work-board/deltas?since=24h` would allow cross-device deltas. Defer.
2. **AttentionFeed integration** — keeping it below the hero. A future iteration could merge it into the hero as a 4th signal column. Decided against now to keep scope tight.
3. **Time-range affecting other categories** — currently only `ActivityChart` and `calculateActivityMetrics` consume `timeRange`. The hero chip implies system-wide effect. Either (a) clarify "this only affects activity charts" via tooltip, or (b) extend more components to honor it. Defer.
4. **i18n** — greetings are hard-coded PT. The rest of the app is mostly EN. A follow-up should pick a single locale strategy. For now, hero greeting is PT; rest stays EN to minimize churn.

---

## 11. Definition of done

- [ ] All new components built and styled with existing `ds-*` tokens, no new CSS.
- [ ] `DashboardPremium.jsx` no longer renders `PageHeader` for the dashboard — replaced by `DashboardHero`.
- [ ] `YourWorkCard.jsx` deleted.
- [ ] AI gradient banner removed; `AIPromoStrip` replaces it.
- [ ] Mobile bottom-nav has 5 items including Work Board with badge.
- [ ] Mobile FAB renders, expands, and wires Create / Import / Dev Toolkit handlers.
- [ ] All unit tests pass.
- [ ] All E2E tests pass.
- [ ] Visual diffs captured before/after at desktop + mobile, light + dark.
- [ ] No `min-w-[Xpx]` violations on 320px viewport.
- [ ] Build is clean (`npm run build`); type-check / lint clean.
- [ ] Bundle size delta documented (Framer Motion + Radix Dialog already imported elsewhere; expected ≤ 5 KB gz net).
