# Mobile Parity Sweep

**Date:** 2026-05-01
**Status:** Spec — pending review
**Owner:** Bruno
**Decomposition note:** Slice **(5) of (5)** in the broader UX uniformity initiative. Slice 1 partially covered mobile (`SelectionSheet` mobile bottom-sheet for batch actions). This slice closes the remaining mobile gaps.

---

## 1. Goals & non-goals

### Goal

Every primary user flow that works on desktop has a usable, equivalent path on mobile (≤ `md` breakpoint, 768px). Specifically:
1. Right-click context menu → tappable equivalent (long-press OR explicit "more" button — slice 1 already chose explicit More button).
2. Modals fit the viewport (no horizontal scroll, scrollable bodies, sticky CTAs).
3. Settings page is navigable in one column with tab-like switching.
4. Command palette opens via floating action button (FAB) when keyboard shortcut isn't available.
5. Dashboard + RepoList + WorkBoard render without overflow on 375×667 (iPhone SE) and 414×896 (iPhone 11).

### Non-goals

1. Native iOS/Android apps. Web only.
2. Touch-specific gestures beyond what the OS provides (no custom swipe-to-archive). Long-press for context menu is OUT (decided in slice 1 — kept the More button).
3. Tablet-specific layouts (`md`-`lg` range gets desktop). Phones only.
4. PWA offline. Out of scope.
5. Performance optimization for low-end devices. Functional only.

### Success criteria

- Manual smoke test on 375×667 viewport: every primary action (open repo, archive repo, batch select + delete, open Work Board, generate AI summary, run Community Health, configure AI in Settings) completes without horizontal scroll, layout breaks, or hidden CTAs.
- E2E test runs the same smoke suite at 375×667 and produces no axe-core a11y violations beyond the existing baseline.
- Sidebar / left-rail panels collapse below `md` to a hamburger drawer (already partly true via `MobileDrawer` — verify completeness).
- Modals are full-height on mobile with sticky footers when they have action buttons.

---

## 2. Architecture

### Existing primitives (reuse, don't rebuild)

- `MobileDrawer` — `{ isOpen, onClose, children, side: 'left'|'right'|'bottom' }` (slice 1 added 'bottom').
- `useMobileBreakpoint()` — returns `boolean` for `< md` (768px).
- `useResponsiveLayout()` — returns `{ leftMode, rightMode, breakpointMode, toggleLeft, toggleRight }`.
- `<Modal>` from `src/components/ui/Modal.jsx`.
- `<TabBar>` from `src/components/ui/TabBar.jsx`.
- `<SelectionSheet>` from slice 1.

### New primitives (small)

1. **`<MobileFAB>`** — floating action button. Bottom-right of the viewport, `z-40`, hidden ≥ md. Children are typically a single icon + tap handler. Primarily used for the command palette trigger.

2. **`<ModalSticky>`** — composable that wraps `<Modal>` and pushes the action row to a sticky footer on mobile. Backwards-compatible: when `useMobileBreakpoint()` is false, renders the same DOM as today.

3. **`useViewportSafeHeight()`** — returns the visual viewport height accounting for browser chrome (URL bar collapse). Used by `<ModalSticky>` to size full-height modals correctly. Implementation: `window.visualViewport.height` with resize listener; falls back to `window.innerHeight`.

### Per-page changes

| Page | Change |
|---|---|
| Header | Hamburger replaces sidebar nav at `<md`. Already partly done — audit completeness. |
| Sidebar | Collapsed into `MobileDrawer side="left"` at `<md`. Drawer auto-closes after navigation. |
| Dashboard | StatCards stack 2-wide → 1-wide at `<sm` (375px). LanguageChart shifts to bar instead of pie. ActivityChart compact. |
| RepoList | Already responsive via slice 1 `SelectionSheet` for batch + `RepoCard` quick-actions visible on mobile. Remaining: `RepoFilterBar` collapses search expansion / filter dropdowns into a single "Filter" sheet. |
| RepoDetail | Tabs scroll horizontally with edge fade indicators. Already exists for some tabs — verify. |
| WorkBoard | KPI snapshot cards stack 1-wide. AI summary card collapses gauge below content. Tabs become bottom tab bar on mobile. |
| Settings | Long form scroll. Section nav (left rail today) becomes a horizontal tab strip below the header on mobile. |
| Modals | Full-height on mobile. Action footer becomes sticky. |
| Command palette | Currently keyboard-only. Mobile gets a `<MobileFAB>` with a magnifier icon to open it. |

---

## 3. Audit catalogue

| # | Page / component | Issue | Target |
|---|---|---|---|
| 1 | Header (`HeaderNew.jsx` or similar) | Nav links overflow at `< sm` | Hamburger drawer; current `Sidebar.jsx` already candidate for drawer |
| 2 | Sidebar | Static at left at all breakpoints | `MobileDrawer side="left"`; auto-close on nav |
| 3 | DashboardHero / DashboardPremium | StatCards 4-wide on `lg`, 2-wide on `md`; check at `< sm` | Force 1-wide at `< sm` |
| 4 | LanguageChart | Pie chart cramped at `<sm` | Compact bar variant or hide on `<sm` |
| 5 | RepoFilterBar | Search + filter dropdowns side-by-side overflow at `<sm` | Search full-width; "Filter" sheet button opens a full-width drawer with all filter dropdowns |
| 6 | RepoCard | Verified working in slice 1 | n/a |
| 7 | SelectionBar / SelectionSheet | Verified working in slice 1 | n/a |
| 8 | RepoDetail tabs | Tabs may overflow horizontally without indicator | Add fade gradient at edges + scroll-snap |
| 9 | RepoDetail Settings tab | Long form may push CTA off-screen | Sticky save bar at bottom |
| 10 | WorkBoardPage | KPI cards 4-wide; tabs row | Cards stack; tabs become a bottom-anchored row at `<sm` |
| 11 | AISummaryCard | Side-by-side gauge + text overflows at `<sm` | Stack vertically (gauge on top) |
| 12 | SettingsModal | Side-rail navigation hides at `<md`? | Verify; if hidden, add a horizontal section tab strip |
| 13 | All `<ConfirmModal>` instances | Action row may scroll off | Use `<ModalSticky>` wrapper at all destructive call sites |
| 14 | MigrationWizard | Multi-step flow with progress indicator | Verify each step renders without overflow at `375px` |
| 15 | Command palette | Keyboard-only access | Add `<MobileFAB>` trigger |
| 16 | Toast container | Toasts may extend beyond viewport at `<sm` | `max-w-[calc(100vw-2rem)]` |
| 17 | Tooltips on icon-only buttons | Tooltips don't fire on touch | Touch users get the long-press OS tooltip via `title` (already in slice 1); verify no buttons rely solely on `<Tooltip>` for affordance |

---

## 4. Migration plan

### Steps

Each step is a separate commit. Mostly independent.

1. **Build `<MobileFAB>` + tests.**
2. **Build `<ModalSticky>` + tests.** Decide whether to extend `<Modal>` directly or wrap.
3. **Build `useViewportSafeHeight` hook + tests.**
4. **Audit & fix Cluster A — Header + Sidebar (rows 1, 2).**
5. **Audit & fix Cluster B — Dashboard (rows 3, 4).**
6. **Audit & fix Cluster C — RepoFilterBar (row 5).**
7. **Audit & fix Cluster D — RepoDetail tabs + Settings (rows 8, 9).**
8. **Audit & fix Cluster E — WorkBoard (rows 10, 11).**
9. **Audit & fix Cluster F — SettingsModal (row 12).**
10. **Audit & fix Cluster G — Modals (row 13). Apply `<ModalSticky>` to existing modals.**
11. **Audit & fix Cluster H — MigrationWizard (row 14).**
12. **Wire `<MobileFAB>` for command palette (row 15).**
13. **Toast clamp (row 16).**
14. **Tooltip touch audit (row 17).**
15. **E2E mobile smoke suite + axe-core baseline.**
16. **Documentation update.**

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| Sidebar drawer breaks existing desktop layout | Use `useMobileBreakpoint()` to gate the drawer-vs-static decision; desktop unaffected. Tests verify both states. |
| Sticky footer on iOS Safari clips behind URL bar | `useViewportSafeHeight` reads `visualViewport.height`. Tests cover the resize listener. |
| Pie → bar chart change loses data fidelity | The bar variant displays the same top 5 languages with percentages; data is identical, only visualization differs. |
| Bottom tab bar in Work Board collides with `MobileFAB` | FAB shifts up by `bottom-20` when a bottom tab bar is present (use a layout context or tailwind class swap). |
| Command palette FAB overlaps SelectionBar/Sheet | Both are bottom-fixed. Choose ordering: SelectionBar/Sheet has priority (z higher); FAB hides while batch selection is active. |

### Out-of-spec follow-ups

1. PWA installation prompt.
2. Native gesture support (swipe-to-archive).
3. Tablet split layouts.
4. iOS / Android share-sheet integration.

---

## 5. Testing & acceptance

### Unit / component

- `tests/components/ui/MobileFAB.test.jsx` — renders nothing at `≥ md`, renders at `< md`, click fires handler.
- `tests/components/ui/ModalSticky.test.jsx` — sticky footer at `< md`, normal footer at `≥ md`.
- `tests/hooks/useViewportSafeHeight.test.js` — returns visualViewport.height when present, falls back to innerHeight.
- One component test per cluster verifying the responsive class swap (e.g. `RepoFilterBar` shows the "Filter" sheet button at `< sm`).

### E2E (Playwright at 375×667)

- `e2e/mobile-smoke.spec.js`
  - Login → Dashboard renders without horizontal scroll.
  - Open Repos view → RepoList scrolls vertically only.
  - Long-press / tap More on a card → context menu opens, Archive works.
  - Select 3 repos → "{N} selected" pill → tap → SelectionSheet opens with full-width labels.
  - Open Work Board → KPI cards stack, tab navigation works.
  - Open Settings → horizontal section tab strip works.
  - Open Migration Wizard → stepper renders, each step completes.
  - Tap MobileFAB → command palette opens, search works.

### Acceptance

| # | Criterion | Verification |
|---|---|---|
| 1 | All 17 audit rows resolved | Manual checklist tick in PR |
| 2 | E2E mobile smoke green | `npx playwright test e2e/mobile-smoke.spec.js --project=mobile` |
| 3 | No horizontal scroll on any audited page at 375px | Browser dev tools manual check |
| 4 | axe-core a11y score on mobile = baseline | `npx axe-core` on the smoke pages |
| 5 | `useViewportSafeHeight` correctly handles iOS URL bar | Manual test on iOS Safari (or simulator) |
| 6 | Bundle delta ≤ +10 KB gzipped | `npm run build` before/after |

---

## 6. Definition of done

After all tasks merge:
- 3 new primitives (`<MobileFAB>`, `<ModalSticky>`, `useViewportSafeHeight`).
- 17 audit rows resolved.
- E2E mobile smoke suite added to CI.
- Documentation updated.
- No regression in desktop tests.
- A user can run the full app from a phone without resorting to the desktop interface.
