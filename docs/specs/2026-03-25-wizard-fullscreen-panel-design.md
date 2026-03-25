# Wizard Full-Screen Panel Redesign

**Date:** 2026-03-25
**Status:** Approved
**Scope:** MigrationWizard container, navigation, state safety, responsive layout

---

## Problem

The current wizard is a centered `max-w-4xl` modal that:
- Closes on backdrop click (accidental dismissal during a multi-step migration)
- Feels cramped for data-heavy steps (RepoConfig, AIReview, WorkItems)
- Has no maximize/restore capability
- Uses a horizontal stepper that becomes unreadable with 10+ steps on narrow viewports
- Offers no confirmation when closing with unsaved progress

## Solution

Replace the `<Modal>` wrapper with a dedicated **WizardPanel** component — a full-screen takeover panel with a restore/maximize toggle, sidebar navigation on desktop, and comprehensive state safety.

---

## 1. Container & Window Chrome

### WizardPanel Component

New component: `src/components/ui/WizardPanel.jsx`

Replaces `<Modal>` as the wizard's container. Two display modes:

#### Full-screen mode (default)

- `fixed inset-0 z-50`
- Background: `bg-white/98 dark:bg-slate-950/98 backdrop-blur-3xl`
- No border radius, no backdrop — feels like a dedicated page
- Content occupies the full viewport

#### Restored mode

- Centered panel: `max-w-5xl max-h-[88vh]`
- `rounded-3xl` with glassmorphism border (`border-2 border-white/20 dark:border-slate-700/50`)
- Shadow: `shadow-2xl`
- Backdrop: `bg-black/40 dark:bg-black/70 backdrop-blur-sm` — **non-clickable** (no dismiss on outside click)

#### Title Bar

- Height: 56px desktop, 48px mobile
- Left: Icon + title (dynamic — "Migration Wizard" for Azure, "Import Repository" for URL/GitHub)
- Center: Current step name + subtitle (fades on step transition)
- Right: Restore/Maximize toggle button + Close (X) button
- Background: `bg-gradient-to-r from-indigo-500 to-purple-600` (existing brand gradient)
- Close and toggle buttons: `hover:bg-white/20 rounded-lg` with smooth transitions

#### Mobile

- Always full-screen — restore/maximize toggle hidden
- Title bar: compact 48px, icon + title + close only

---

## 2. Navigation & Step Indicator

### Desktop Full-Screen: Sidebar Stepper (Left Rail)

- Width: 240px, fixed left side of content area (below title bar)
- Vertical list: numbered circles + step labels
- Active step: indigo highlight with `ring-4 ring-indigo-500/20`, bold label, `scale-110`
- Completed steps: emerald checkmark (`✓`), clickable (navigates back)
- Future steps: muted (`text-slate-400 dark:text-slate-500`), non-clickable
- Vertical connector lines between steps
- Background: `bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur-xl` with right border
- Sticky — stays visible while step content scrolls
- Breadcrumb nav (Azure flow) rendered inside sidebar, above step list

### Desktop Restored Mode: Top Horizontal Stepper

- No sidebar — step indicator is a horizontal row of compact circles with labels underneath
- Same design as current stepper but refined (tighter spacing, smaller circles)
- Fits within the constrained `max-w-5xl` panel width
- Transition: when toggling from full-screen to restored, sidebar slides out and top stepper fades in

### Mobile: Top Progress Bar

- Thin gradient progress bar (`from-indigo-500 to-purple-600`) showing percentage completion
- Below bar: "Step N of M — Step Label" text
- No circles — too cramped on small screens
- Breadcrumb nav renders inline above content

---

## 3. Content Area & Footer

### Content Area

- Fills remaining space: right of sidebar (desktop full-screen) or below stepper (restored/mobile)
- Step title + subtitle from `STEP_META` at top of content area
- `overflow-y-auto` with `custom-scrollbar`, padding: `p-8` desktop, `p-4` mobile
- Content centered for readability: `max-w-3xl mx-auto` within the content zone (full-screen mode)
- Step transitions: existing Framer Motion slide animation (direction-aware, 250ms)

### Footer (Action Bar)

- Pinned to bottom of content area (not full viewport width — does not extend under sidebar)
- Left: Back / Cancel button (ghost style with `ArrowLeft` icon)
- Right: Next button (gradient `from-indigo-500 to-purple-600`, `ArrowRight` icon)
- Next hidden on self-managed steps: `sourceType`, `targetConfig`, `progress`, `summary`
- Background: `bg-slate-50/80 dark:bg-slate-800/50 backdrop-blur-xl` with top border
- Mobile: full-width buttons, `safe-area-bottom` padding

---

## 4. State Safety & Dismissal Protection

### No Accidental Close

- Outside click: does nothing (non-interactive backdrop in restored mode, no backdrop in full-screen)
- Escape key: disabled during `progress` and `summary` steps; on other steps triggers close confirmation

### Dirty State Detection

Track whether user has entered meaningful data via a `useDirtyState` derived check:

- Dirty if: source type selected AND (any credential entered, or repos selected, or target configured)
- Clean if: just opened, still on `sourceType` with no selection

### Close / Cancel Confirmation

- If **dirty**: show `ConfirmModal` with `variant="warning"`:
  - Title: "Cancel Migration?"
  - Message: "You have unsaved progress. All entered data will be lost."
  - Actions: [Continue Editing] (primary) + [Discard & Close] (ghost/danger)
- If **clean**: close immediately, no confirmation
- During **progress** step: stronger warning — "A migration is in progress. Closing won't stop it, but you'll lose visibility. Are you sure?"
- During **summary** step: no confirmation needed (work is complete)

### Back Button Safety

- Back navigation never loses data (state persists in `useMigrationWizard` hook)
- Back disabled on `progress` and `summary` steps
- Re-advancing after going back re-runs validators; previous values preserved

### Cancel vs Back

- On step 0 (`sourceType`): Cancel button closes wizard (with dirty check)
- On any other step: shows "Back" label, navigates to previous step
- X button in title bar always triggers close (with dirty check)

---

## 5. Visual Polish & Animations

### Panel Transitions

- **Open**: panel slides up from bottom (`y: 100vh → 0`) with spring physics (~400ms), content fades in 200ms after panel lands
- **Close**: reverse — content fades out, panel slides down
- **Full-screen ↔ Restored**: Framer Motion `layout` animation — panel smoothly morphs between sizes (border-radius, dimensions, position) over ~400ms with spring
- **Restore/Maximize icon**: 180° rotation on toggle

### Sidebar Animation

- First render: slides in from left (`ds-slide-in-left` timing)
- Step changes: active indicator slides vertically to new position

### Existing Animations Preserved

- Step content slide transitions (direction-aware, 250ms)
- Progress bar width animation
- Task row stagger animations in ProgressStep
- SourceTypeStep card fade-in

### Dark Mode

- Sidebar: `dark:bg-slate-950/90` with `dark:border-slate-800/50`
- Content: `dark:bg-slate-950`
- Title bar gradient unchanged (works on both themes)
- All existing `dark:*` utilities in step components remain unchanged

### Accessibility

- Focus trap within entire panel (reuse `useFocusTrap`)
- `role="dialog"` + `aria-modal="true"` on panel root
- Sidebar: `role="navigation"` + `aria-label="Wizard steps"`
- Toggle button: `aria-label="Maximize wizard"` / `"Restore wizard size"`
- Reduced motion: all transitions respect `prefers-reduced-motion` via existing `MotionConfig`

---

## 6. Files to Create / Modify

### New Files

- `src/components/ui/WizardPanel.jsx` — full-screen panel container with title bar, restore/maximize, layout modes

### Modified Files

- `src/components/MigrationWizard/MigrationWizard.jsx` — replace `<Modal>` with `<WizardPanel>`, extract sidebar stepper, add dirty-state confirmation, restructure layout
- `src/hooks/useMigrationWizard.js` — add `isDirty` derived state
- `src/hooks/useFocusTrap.js` — conditional Escape handling (disable during progress/summary)
- `src/components/ui/Modal.jsx` — no changes (other modals still use it)

### Unchanged

- All 14 step components — internal rendering unchanged, they receive the same props
- `src/contexts/ModalContext.jsx` — wizard still opens/closes via `openModal`/`closeModal`
- `src/hooks/useAzureOAuth.js` — unchanged
- `BreadcrumbNav.jsx` — unchanged (just rendered in different location)

---

## 7. What This Does NOT Change

- Step logic, validation, or state management (all stays in `useMigrationWizard`)
- API calls, SSE connections, or import flow
- Step component internals or props
- Other modals in the app
- Design system tokens or global CSS
- ModalContext API
