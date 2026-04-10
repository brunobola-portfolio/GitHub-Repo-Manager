# Health Dashboard Premium Visual Upgrade

**Date:** 2026-04-10
**Scope:** UI/UX improvements to CommunityHealthDashboard modal + package-lock.json cleanup
**Approach:** Refactor in-place (single file modification)
**File:** `src/components/CommunityHealthDashboard.jsx` (~245 lines -> ~350-400 lines)

## 1. package-lock.json Cleanup

Commit the existing 24-line diff (adds `"peer": true` flags to OpenTelemetry/Babel dependencies). These are harmless npm resolution changes caused by different npm versions across development machines. Committing stabilizes the lockfile as a shared baseline.

**No design work needed — direct commit.**

## 2. Loading State: Skeleton + Rotating Messages

### Problem

Current loading state is a generic spinner (lines 50-56) with no context. The health check makes ~10+ serial API calls to GitHub and can take several seconds, leaving users without feedback.

### Solution

Replace the spinner with a skeleton that anticipates the modal structure, overlaid with rotating status messages.

### Behavior

1. Modal opens immediately with the **real header** (repo name, Refresh/Close buttons) — these need no data.
2. Body shows **skeleton structure**:
   - Top: pulsing circle placeholder (score ring) + text block placeholder
   - Middle: 2x2 grid of 4 skeleton metric cards
   - Bottom: 3-4 pulsing horizontal bars (files/recommendations placeholder)
3. A **rotating message** centered over the skeleton, cycling every 1.5s via `AnimatePresence`:
   - "Checking community files..."
   - "Analyzing repository activity..."
   - "Calculating health score..."
   - "Generating recommendations..."
   - **Transition timing:** exit + enter animation must total ≤ 0.6s (e.g., exit 0.25s, enter 0.35s), leaving ~0.9s of stable read time per message.
4. When data arrives: skeleton **fades out**, real content enters with **stagger animation** (each section with 100ms delay).

### Implementation

Single conditional block `{loading ? <SkeletonState /> : <ContentState />}` wrapped in `AnimatePresence` for the transition. Both are internal sub-components (not separate files).

## 3. Animated Score Ring (HealthScoreRing)

### Problem

Current score display (lines 104-115) is a static gradient banner with a bordered circle showing "85%". Flat and uninspiring compared to the rest of the app.

### Solution

SVG donut ring with animated fill and counter.

### Component: `HealthScoreRing` (internal sub-component)

- SVG with two `<circle>` elements: background track (low opacity) + progress stroke
- Animation driven exclusively by Framer Motion `pathLength` prop on `motion.circle` — animates from `pathLength: 0` to `pathLength: score/100` in ~1.2s with `easeOut`. Do NOT manually set `stroke-dasharray`; `pathLength` manages it internally.
- Counter animation: number animates from 0 to actual score, synchronized with ring fill
- Sizing: `w-28 h-28` on mobile, `w-36 h-36` on desktop (`md:` breakpoint)
- Score number inside the ring: `text-3xl` on mobile, `text-5xl` on desktop (`md:text-5xl`) to prevent clipping

### Color by Score Range

| Score   | Ring Color     | Label              |
|---------|----------------|--------------------|
| 80-100  | `emerald-500`  | Excellent          |
| 60-79   | `blue-500`     | Good               |
| 40-59   | `amber-500`    | Fair               |
| 0-39    | `red-500`      | Needs Improvement  |

### Score Section Layout

- **Background:** glassmorphism with gradient tint — `bg-gradient-to-br from-indigo-500/10 to-purple-500/10 dark:from-indigo-500/20 dark:to-purple-500/20 backdrop-blur-xl border border-indigo-200/30 dark:border-indigo-500/20` (replaces opaque gradient, keeps the indigo/purple identity but as a subtle glass tint)
- **Layout:** `flex-col sm:flex-row` — stacks vertically on mobile (ring centered above text), side-by-side on desktop
- **Left (or top on mobile):** Ring SVG with score number and label centered inside
- **Right (or bottom on mobile):** Repo name + colored badge with label ("Excellent", "Good"...) + "Community Health Score" text
- **Badge** also appears in the sticky header next to the repo name, visible while scrolling

## 4. Premium Visual Treatment for Content Sections

### Container & Header

- Modal container: `bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl` (replaces opaque `bg-white dark:bg-slate-800`). This is the **only** `backdrop-blur` layer — inner cards do NOT add their own blur to avoid GPU composite layer stacking.
- Sticky header: inherits modal glass, adds `border-b border-white/10`. Padding `py-3 sm:py-4` (reduced on mobile to save vertical space).
- Refresh/Close buttons: minimum `py-2.5` (40px height) for touch target compliance

### Community Files (FileCheckItem)

- Card background: `bg-white/60 dark:bg-slate-900/60 border border-slate-200/40 dark:border-slate-800/40` (replaces `bg-slate-50`). No `backdrop-blur` on inner cards — the modal shell's `backdrop-blur-2xl` provides the glass effect.
- Check icon: scale-in animation when file exists (`initial={{ scale: 0 }} animate={{ scale: 1 }}`)
- Missing files: subtle red glow on border (`border-red-300/40`) to draw attention
- Hover: `ds-card-shimmer` + slight lift (`whileHover={{ y: -1 }}`)
- Touch target: `min-h-[44px]` on each file row for WCAG 2.5.5 compliance

### Activity Metrics (MetricCard)

- Background: `bg-white/60 dark:bg-slate-900/60` (no `backdrop-blur` on inner cards — modal shell provides the glass effect)
- Icon: gradient background instead of solid color (e.g., `bg-gradient-to-br from-blue-500/10 to-cyan-500/10`)
- Number: counter animation from 0 to actual value in ~0.8s
- Stagger: each card appears with 80ms delay

### Recommendations (RecommendationItem)

- Card: `bg-white/60 dark:bg-slate-900/60` (no inner `backdrop-blur`)
- Priority badge: `high` gets subtle pulse animation, `medium` static, `low` more muted
- Icon: gradient instead of flat `text-amber-500`

### Global Stagger Animations

When data loads, sections appear in sequence:
- Score ring: 0ms
- Files: 200ms
- Metrics: 400ms
- Recommendations: 600ms

Each section uses `initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}`.

## 5. Out of Scope

- No backend changes
- No changes to the Health & Quality section in DashboardPremium
- No trend graphs or cross-repo comparisons
- No major mobile layout restructuring (grids are adequate; only the score section gets `flex-col sm:flex-row` for stacking)

## 6. Technical Notes

- All changes in a single file: `src/components/CommunityHealthDashboard.jsx`
- Sub-components remain internal (not extracted to separate files)
- Uses existing project dependencies: Framer Motion, Lucide React, Tailwind CSS v4
- No new dependencies required
- SVG ring uses `motion.circle` with `pathLength` prop only (no manual `stroke-dasharray`; Framer Motion manages it internally)
- Reduced motion: use `useReducedMotion()` from Framer Motion — when active, set `pathLength` directly to final value (no transition), skip counter animation, and show final numbers immediately
