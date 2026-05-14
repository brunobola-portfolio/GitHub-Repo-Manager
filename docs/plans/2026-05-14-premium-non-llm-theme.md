# Premium Non-LLM Theme — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current "AI-template" aesthetic (rainbow gradients, glows, shimmer, glassmorphism) with a GitHub-utilitarian visual language (H + V3 hybrid accent) and introduce the missing premium primitives (command palette, keyboard hints, optimistic undo, animated checkmark, sticky table shadow, view transitions, delayed tooltips).

**Architecture:** Token-level rewrite of `src/design-system.css` and `src/index.css` first, then mechanical callsite sweeps batched by component family, then lint guards to lock the result, then net-new premium primitives as feature additions.

**Tech Stack:** React 19, Vite 7, Tailwind CSS v4, Framer Motion (already in the repo), `lucide-react`, `cmdk` (new dependency for command palette), Vitest, Playwright.

**Spec:** [docs/specs/2026-05-14-premium-non-llm-theme-design.md](../specs/2026-05-14-premium-non-llm-theme-design.md)

---

## File map

### Created
- `docs/reports/2026-05-14-theme-audit.md` — Phase 0 deliverable, lists every file touching a killed class/token.
- `tests/styles/design-system.tokens.test.js` — Vitest smoke test that the new tokens resolve to expected values.
- `tests/styles/design-system.kill-list.test.js` — Regression test that killed classes no longer exist in `design-system.css`.
- `src/components/ui/CommandPalette.jsx` — new ⌘K palette.
- `tests/components/ui/CommandPalette.test.jsx`
- `src/components/ui/Kbd.jsx` — keyboard hint pill primitive.
- `tests/components/ui/Kbd.test.jsx`
- `src/hooks/useOptimisticMutation.js` — hook for optimistic UI + undo toast.
- `tests/hooks/useOptimisticMutation.test.js`
- `src/components/ui/AnimatedCheck.jsx` — SVG stroke-draw checkmark.
- `tests/components/ui/AnimatedCheck.test.jsx`
- `src/hooks/useStickyHeaderShadow.js` — sticky table header scroll-shadow.
- `tests/hooks/useStickyHeaderShadow.test.js`
- `src/utils/viewTransitions.js` — `startViewTransition` wrapper.
- `tests/utils/viewTransitions.test.js`
- `src/components/ui/Tooltip.jsx` — delayed tooltip with arrow.
- `tests/components/ui/Tooltip.test.jsx`
- `scripts/check-killed-classes.mjs` — CI grep gate.

### Modified
- `src/design-system.css` — full rewrite (Phase 1).
- `src/index.css` — body background + utility cleanup (Phase 1).
- `src/components/Header.jsx` — Phase 2.
- `src/components/Dashboard/*.jsx` — Phase 2 (16 files).
- `src/components/RepoList.jsx` — Phase 2.
- `src/components/RepoDetail/**/*.jsx` — Phase 2 (6 tabs).
- `src/components/ui/Modal.jsx`, `ConfirmModal.jsx`, `Toast.jsx`, `EmptyState.jsx`, `Spinner.jsx`, `PageHeader.jsx` — Phase 2.
- `src/components/Sidebar.jsx` — Phase 2.
- `src/components/AIAssistant*.jsx` — Phase 2.
- `src/components/WorkBoard/*.jsx` — Phase 2.
- `src/components/Onboarding*.jsx` — Phase 2.
- `eslint.config.js` — Phase 3, add `no-restricted-syntax` rules for forbidden Tailwind utility patterns.
- `package.json` — add `cmdk` dependency (Phase 4), add `lint:css` and `prebuild` scripts (Phase 3).
- `.github/workflows/*.yml` — Phase 3, wire `lint:css` into CI.

---

## Phase 0 — Audit

### Task 1: Produce the kill-list audit report

**Files:**
- Create: `docs/reports/2026-05-14-theme-audit.md`

- [ ] **Step 1: Run the kill-list grep**

Run from repo root:

```bash
node -e "
const killList = [
  'ds-gradient-text-premium','ds-gradient-text',
  'ds-shadow-glow','ds-card-shimmer','ds-btn-shimmer',
  'ds-border-glow','ds-hover-glow','ds-animate-float',
  'ds-pulse-glow','ds-glass-strong','ds-glass',
  'from-indigo-500','from-purple-500','from-pink-500','to-cyan',
  'backdrop-blur-xl','backdrop-blur-2xl',
  'shadow-glow','animate-float'
];
console.log(killList.join('|'));
"
```

Then for each pattern, run:

```bash
npx grep -rIn --include='*.{js,jsx,css}' --exclude-dir=node_modules \
  --exclude-dir=dist --exclude-dir=.claude \
  -E '<PATTERN>' src/ > /tmp/audit-<pattern>.txt
```

- [ ] **Step 2: Write the report**

Write `docs/reports/2026-05-14-theme-audit.md` with the structure below. Replace the bracket counts with the real numbers from your grep output.

```markdown
# Theme Audit — Kill List Callsites
Date: 2026-05-14

## Summary
- Total files touching at least one killed pattern: [N]
- Total individual callsites: [M]

## By family

### Header & shell
- src/components/Header.jsx — uses: ds-gradient-text, backdrop-blur-xl (3 occurrences)

### Dashboard
- src/components/Dashboard/DashboardHero.jsx — uses: ds-gradient-text (line 72)
- src/components/Dashboard/StatCard.jsx — uses: ds-card-shimmer (line 63), from-indigo-500 (line 66)
- [...continue with one bullet per file]

### RepoList, RepoDetail (per tab), Modals, Toasts, Sidebar, AIAssistant, Work Board, Onboarding
- [...]

## By pattern
| Pattern | File count | Occurrence count |
|---|---|---|
| ds-gradient-text | … | … |
| ds-card-shimmer | … | … |
| backdrop-blur-xl | … | … |
| [...] | | |
```

- [ ] **Step 3: Commit the report**

```bash
git add docs/reports/2026-05-14-theme-audit.md
git commit -m "docs(reports): theme kill-list audit (premium non-LLM)"
```

---

## Phase 1 — Foundations

### Task 2: Write failing token tests

**Files:**
- Create: `tests/styles/design-system.tokens.test.js`
- Create: `tests/styles/design-system.kill-list.test.js`

- [ ] **Step 1: Create the kill-list regression test**

Create `tests/styles/design-system.kill-list.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(__dirname, '../../src/design-system.css'), 'utf8')

const KILL_LIST = [
  'ds-gradient-text-premium',
  'ds-gradient-text',
  'ds-shadow-glow',
  'ds-card-shimmer',
  'ds-btn-shimmer',
  'ds-border-glow',
  'ds-hover-glow',
  'ds-animate-float',
  'ds-pulse-glow',
  'ds-glass-strong',
  'ds-glass',
  '--ds-gradient-primary',
  '--ds-gradient-secondary',
  '--ds-gradient-accent',
  '--ds-gradient-success',
  '--ds-gradient-premium',
]

describe('design-system.css — killed tokens/classes are gone', () => {
  KILL_LIST.forEach((name) => {
    it(`does not contain "${name}"`, () => {
      expect(css).not.toContain(name)
    })
  })
})
```

- [ ] **Step 2: Create the token-resolution test**

Create `tests/styles/design-system.tokens.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(__dirname, '../../src/design-system.css'), 'utf8')

const EXPECTED_TOKENS = {
  '--ds-surface': '#ffffff',
  '--ds-surface-subtle': '#f6f8fa',
  '--ds-surface-muted': '#eaeef2',
  '--ds-border': '#d1d9e0',
  '--ds-fg': '#1f2328',
  '--ds-fg-muted': '#59636e',
  '--ds-surface-dark': '#0d1117',
  '--ds-fg-dark': '#f0f6fc',
  '--ds-accent-link': '#0969da',
  '--ds-accent-link-dark': '#4493f8',
  '--ds-accent-brand': '#4f46e5',
  '--ds-accent-brand-dark': '#818cf8',
  '--ds-success': '#1a7f37',
  '--ds-danger': '#cf222e',
  '--ds-cta': '#1f883d',
  '--ds-radius-sm': '4px',
  '--ds-radius': '6px',
  '--ds-radius-lg': '8px',
  '--ds-radius-xl': '12px',
}

describe('design-system.css — new tokens resolve to expected values', () => {
  Object.entries(EXPECTED_TOKENS).forEach(([token, value]) => {
    it(`${token} = ${value}`, () => {
      const re = new RegExp(`${token.replace(/--/g, '--')}\\s*:\\s*${value.replace(/[#()]/g, '\\$&')}`)
      expect(css).toMatch(re)
    })
  })
})
```

- [ ] **Step 3: Run tests, confirm they fail**

```bash
npx vitest run tests/styles/
```

Expected: most assertions fail because current `design-system.css` still contains the killed tokens and lacks the new ones.

- [ ] **Step 4: Commit the failing tests**

```bash
git add tests/styles/
git commit -m "test(styles): add token-resolution + kill-list regression tests (failing)"
```

---

### Task 3: Rewrite `design-system.css` end-to-end

**Files:**
- Modify: `src/design-system.css`

- [ ] **Step 1: Replace file contents with the new token set**

Overwrite `src/design-system.css` with:

```css
/**
 * GitHub Repo Manager — Premium Design System
 * GitHub-utilitarian (H direction) + V3 hybrid accent.
 * Only opt-in `.ds-*` classes, CSS variables, and keyframe animations.
 * Spec: docs/specs/2026-05-14-premium-non-llm-theme-design.md
 */

:root {
  /* ===== TYPOGRAPHY ===== */
  --ds-font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans",
                  Helvetica, Arial, sans-serif, "Apple Color Emoji",
                  "Segoe UI Emoji";
  --ds-font-mono: ui-monospace, "JetBrains Mono", "Cascadia Code",
                  "Source Code Pro", Menlo, Consolas, "DejaVu Sans Mono",
                  monospace;

  --ds-text-xs: 0.75rem;
  --ds-text-sm: 0.8125rem;
  --ds-text-base: 0.875rem;
  --ds-text-md: 1rem;
  --ds-text-lg: 1.25rem;
  --ds-text-xl: 1.5rem;
  --ds-text-2xl: 2rem;

  /* ===== PALETTE (light) ===== */
  --ds-surface: #ffffff;
  --ds-surface-subtle: #f6f8fa;
  --ds-surface-muted: #eaeef2;
  --ds-border: #d1d9e0;
  --ds-border-strong: #59636e;
  --ds-fg: #1f2328;
  --ds-fg-muted: #59636e;
  --ds-fg-subtle: #6e7781;

  /* ===== PALETTE (dark, Primer-aligned) ===== */
  --ds-surface-dark: #0d1117;
  --ds-surface-subtle-dark: #151b23;
  --ds-surface-muted-dark: #21262d;
  --ds-border-dark: #3d444d;
  --ds-border-strong-dark: #9198a1;
  --ds-fg-dark: #f0f6fc;
  --ds-fg-muted-dark: #9198a1;
  --ds-fg-subtle-dark: #6e7681;

  /* ===== ACCENTS (V3 hybrid) ===== */
  --ds-accent-link: #0969da;
  --ds-accent-link-dark: #4493f8;
  --ds-accent-brand: #4f46e5;
  --ds-accent-brand-dark: #818cf8;

  /* ===== STATUS ===== */
  --ds-success: #1a7f37;     --ds-success-dark: #3fb950;
  --ds-attention: #9a6700;   --ds-attention-dark: #d29922;
  --ds-danger: #cf222e;      --ds-danger-dark: #f85149;
  --ds-cta: #1f883d;         --ds-cta-dark: #238636;
  --ds-cta-hover: #1a7f37;   --ds-cta-hover-dark: #29903b;

  /* ===== RADIUS ===== */
  --ds-radius-sm: 4px;
  --ds-radius: 6px;
  --ds-radius-lg: 8px;
  --ds-radius-xl: 12px;

  /* ===== ELEVATION ===== */
  --ds-shadow-sm: 0 1px 0 rgba(31,35,40,.04);
  --ds-shadow:    0 3px 6px rgba(140,149,159,.15);
  --ds-shadow-lg: 0 8px 24px rgba(140,149,159,.2);
  --ds-shadow-overlay: 0 0 0 1px rgba(31,35,40,.06), 0 8px 24px rgba(31,35,40,.12);

  /* ===== MOTION ===== */
  --ds-ease:        cubic-bezier(0.2, 0, 0, 1);
  --ds-ease-out:    cubic-bezier(0.3, 0, 0.8, 0.15);
  --ds-ease-spring: cubic-bezier(0.5, 1.25, 0.75, 1.25);

  --ds-duration-instant: 80ms;
  --ds-duration-fast: 120ms;
  --ds-duration: 200ms;
  --ds-duration-slow: 320ms;

  /* Back-compat aliases (existing call sites) — repointed to new tokens */
  --ds-transition-fast: var(--ds-duration-fast) var(--ds-ease);
  --ds-transition-standard: var(--ds-duration) var(--ds-ease);
  --ds-transition-slow: var(--ds-duration-slow) var(--ds-ease);

  /* ===== Z-INDEX (unchanged contract) ===== */
  --ds-z-surface: 10;
  --ds-z-floating: 30;
  --ds-z-composer: 40;
  --ds-z-popover: 50;
  --ds-z-overlay: 50;
  --ds-z-modal: 60;
  --ds-z-toast: 70;
  --ds-z-ceiling: 80;

  /* Brand identity (logo only — NOT theme-aware) */
  --ds-logo-bg-start: #312e81;
  --ds-logo-bg-mid: #4c1d95;
  --ds-logo-bg-end: #1e1b4b;
  --ds-logo-accent-light: #a5b4fc;
  --ds-logo-accent: #818cf8;
  --ds-logo-accent-bold: #6366f1;
  --ds-logo-secondary: #22d3ee;
  --ds-logo-secondary-deep: #06b6d4;
  --ds-logo-tertiary: #a78bfa;
  --ds-logo-tertiary-soft: #c084fc;

  /* Chart chrome — repointed to surface tokens */
  --ds-chart-axis: var(--ds-fg-muted);
  --ds-chart-grid: var(--ds-border);
  --ds-chart-tooltip-bg: var(--ds-surface-dark);
  --ds-chart-tooltip-border: rgba(148, 163, 184, 0.2);
  --ds-chart-tooltip-text: var(--ds-fg-dark);
  --ds-chart-tooltip-label: var(--ds-fg-muted-dark);
  --ds-chart-tooltip-shadow: var(--ds-shadow-overlay);
  --ds-chart-series-1: var(--ds-accent-brand);
  --ds-chart-series-2: var(--ds-success);
  --ds-chart-series-3: var(--ds-attention);

  /* Premium dashboard tokens (kept for Phase 1 inbox compat) */
  --ds-status-success: var(--ds-success);
  --ds-status-warning: var(--ds-attention);
  --ds-status-danger: var(--ds-danger);
  --ds-status-neutral: var(--ds-fg-muted);

  --ds-ease-row-expand: var(--ds-ease);
  --ds-duration-row-expand: var(--ds-duration);
}

/* ===== KEYFRAMES (premium set only) ===== */
@keyframes ds-fade-in-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes ds-fade-in   { from { opacity: 0; } to { opacity: 1; } }
@keyframes ds-scale-in  { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
@keyframes ds-pulse     { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
@keyframes ds-stroke-draw { from { stroke-dashoffset: var(--ds-stroke-length, 28); } to { stroke-dashoffset: 0; } }

/* ===== ANIMATION CLASSES ===== */
.ds-animate-fade-in-up { animation: ds-fade-in-up var(--ds-duration) var(--ds-ease) both; }
.ds-animate-fade-in    { animation: ds-fade-in var(--ds-duration) var(--ds-ease) both; }
.ds-animate-scale-in   { animation: ds-scale-in var(--ds-duration) var(--ds-ease) both; }

/* Stagger children (preserved API) */
.ds-stagger > *:nth-child(1) { animation-delay: 0.04s; }
.ds-stagger > *:nth-child(2) { animation-delay: 0.08s; }
.ds-stagger > *:nth-child(3) { animation-delay: 0.12s; }
.ds-stagger > *:nth-child(4) { animation-delay: 0.16s; }
.ds-stagger > *:nth-child(5) { animation-delay: 0.20s; }
.ds-stagger > *:nth-child(6) { animation-delay: 0.24s; }
.ds-stagger > *:nth-child(7) { animation-delay: 0.28s; }
.ds-stagger > *:nth-child(8) { animation-delay: 0.32s; }

/* ===== HOVER (premium contract) ===== */
.ds-hover-lift {
  transition: border-color var(--ds-duration-fast) var(--ds-ease),
              background-color var(--ds-duration-fast) var(--ds-ease);
}
/* No translate, no scale — premium contract enforces idle→hover via bg/border only. */

/* ===== FONT UTILITIES ===== */
.ds-font-display { font-family: var(--ds-font-sans); }
.ds-font-mono    { font-family: var(--ds-font-mono); }

/* ===== FOCUS RING (premium) ===== */
.ds-focus-ring { outline: none; transition: box-shadow var(--ds-duration-fast) var(--ds-ease); }
.ds-focus-ring:focus-visible {
  outline: 2px solid var(--ds-accent-brand);
  outline-offset: 2px;
  box-shadow: 0 0 0 5px color-mix(in srgb, var(--ds-accent-brand) 25%, transparent);
}
:where(.dark) .ds-focus-ring:focus-visible {
  outline-color: var(--ds-accent-brand-dark);
  box-shadow: 0 0 0 5px color-mix(in srgb, var(--ds-accent-brand-dark) 25%, transparent);
}

/* ===== MODAL BODY (unchanged) ===== */
.ds-modal-body { padding: 1rem; }
@media (min-width: 768px) { .ds-modal-body { padding: 1.25rem; } }

/* ===== SESSION BANNER (desaturated) ===== */
.ds-session-banner {
  background: var(--ds-surface-subtle);
  border-bottom: 1px solid var(--ds-border);
}
:where(.dark) .ds-session-banner {
  background: var(--ds-surface-subtle-dark);
  border-bottom: 1px solid var(--ds-border-dark);
}

/* ===== SCROLLBAR (unchanged subtle treatment) ===== */
.ds-scrollbar { scrollbar-width: thin; scrollbar-color: rgba(148,163,184,.25) transparent; }
.ds-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
.ds-scrollbar::-webkit-scrollbar-track { background: transparent; }
.ds-scrollbar::-webkit-scrollbar-thumb { background: rgba(148,163,184,.25); border-radius: 3px; }
.ds-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(148,163,184,.4); }
:where(.dark) .ds-scrollbar { scrollbar-color: rgba(148,163,184,.2) transparent; }
:where(.dark) .ds-scrollbar::-webkit-scrollbar-thumb { background: rgba(148,163,184,.2); }
:where(.dark) .ds-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(148,163,184,.35); }

/* ===== SKELETON (opacity pulse only — no rainbow shimmer) ===== */
.ds-skeleton {
  background: var(--ds-surface-muted);
  border-radius: var(--ds-radius);
  animation: ds-pulse 1.8s ease-in-out infinite;
}
:where(.dark) .ds-skeleton { background: var(--ds-surface-muted-dark); }

/* ===== SELECTION ===== */
::selection { background: color-mix(in srgb, var(--ds-accent-brand) 25%, transparent); }

/* ===== REDUCED MOTION ===== */
@media (prefers-reduced-motion: reduce) {
  :root {
    --ds-duration-instant: 0.01ms;
    --ds-duration-fast: 0.01ms;
    --ds-duration: 0.01ms;
    --ds-duration-slow: 0.01ms;
    --ds-transition-standard: 0.01ms linear;
    --ds-transition-fast: 0.01ms linear;
    --ds-transition-slow: 0.01ms linear;
  }
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* ===== DIFFRENDERER (perf, unchanged) ===== */
.diff-wrap-on .diff-tailwindcss-wrapper .whitespace-nowrap,
.diff-wrap-on .diff-line-old-content,
.diff-wrap-on .diff-line-new-content,
.diff-wrap-on pre,
.diff-wrap-on code {
  white-space: pre-wrap !important;
  word-break: break-all;
}
@supports (content-visibility: auto) {
  .diff-renderer {
    content-visibility: auto;
    contain-intrinsic-size: auto 600px;
  }
}
```

- [ ] **Step 2: Run the token tests**

```bash
npx vitest run tests/styles/
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/design-system.css tests/styles/
git commit -m "feat(design-system): rewrite tokens for GitHub-utilitarian theme"
```

---

### Task 4: Rewrite `src/index.css` body block

**Files:**
- Modify: `src/index.css:69-85`

- [ ] **Step 1: Replace the body block**

Replace the existing `@layer base { body { ... } .dark body { ... } }` block in `src/index.css` with:

```css
@layer base {
  body {
    @apply antialiased;
    background-color: var(--ds-surface-subtle);
    color: var(--ds-fg);
    font-family: var(--ds-font-sans);
  }
  .dark body {
    background-color: var(--ds-surface-dark);
    color: var(--ds-fg-dark);
  }
}
```

Note: the previous `background-image` radial gradients are **deleted** (anti-pattern in the new design).

- [ ] **Step 2: Smoke test**

```bash
npx vite build
```

Expected: build succeeds. No new warnings about missing CSS variables.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat(theme): plain body bg (no radial gradients), use ds tokens"
```

---

### Task 5: Baseline visual smoke test

**Files:**
- Create or run: existing Playwright suite under `e2e/`

- [ ] **Step 1: Capture baseline screenshots** (only if a screenshot test already exists)

Run the existing visual regression suite if present:

```bash
npx playwright test --update-snapshots --grep '@visual'
```

If no `@visual` tag exists, skip this step. The visual smoke is informal during this plan — the spec's `success criteria` is the formal gate.

- [ ] **Step 2: Run full unit suite to confirm nothing regressed**

```bash
npx vitest run
```

Expected: green. Any failures are real regressions from Task 3/4.

- [ ] **Step 3: Commit screenshots if generated**

```bash
git add e2e/
git commit -m "test(e2e): refresh visual baselines for new theme tokens"
```

---

## Phase 2 — Callsite sweep

Each task in this phase follows the same shape:

1. Open every file in the family listed in the audit report (Task 1).
2. Apply the **mechanical substitutions** below.
3. Re-run unit tests for the family.
4. Commit.

**Mechanical substitutions** (apply everywhere):

| Find | Replace with |
|---|---|
| `ds-gradient-text-premium`, `ds-gradient-text` | (delete the class; if used on a heading, replace gradient with `text-slate-900 dark:text-white font-semibold`) |
| `ds-card-shimmer` | (delete the class) |
| `ds-btn-shimmer` | (delete the class) |
| `ds-border-glow` | (delete the class) |
| `ds-hover-glow` | (delete the class) |
| `ds-animate-float` | (delete the class) |
| `ds-pulse-glow` | (delete the class) |
| `ds-glass-strong`, `ds-glass` | replace with `bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700` (popovers may use `shadow-[var(--ds-shadow-overlay)]`) |
| `backdrop-blur-xl`, `backdrop-blur-2xl` | replace with `backdrop-blur-md` (or remove entirely for inline panels) |
| `bg-gradient-to-*` with multi-stop colors | replace with the matching solid: `bg-indigo-600 dark:bg-indigo-500` for accent buttons; `bg-emerald-600 dark:bg-emerald-500` for CTAs |
| `whileHover={{ scale: ... }}` on non-card-as-button surfaces | remove the prop |
| `whileHover={{ rotate: ... }}` | remove the prop |
| `whileHover={{ y: -4 }}` on cards | remove (the new `.ds-hover-lift` handles it via bg shift) |
| `shadow-glow-*` arbitrary classes | replace with `shadow-sm` or `shadow-md` |
| `font-extrabold` on UI text | replace with `font-semibold` |

### Task 6: Header & shell

**Files:**
- Modify: `src/components/Header.jsx` (+ any sibling Header-related files surfaced by audit)

- [ ] **Step 1: Apply the mechanical substitutions to every callsite in the file**

For each match in `src/components/Header.jsx`, apply the table above. Example transformation:

```jsx
// before
<h1 className="text-2xl font-extrabold ds-gradient-text">Repo Manager</h1>

// after
<h1 className="text-xl font-semibold text-slate-900 dark:text-white">Repo Manager</h1>
```

- [ ] **Step 2: Run the Header tests**

```bash
npx vitest run tests/components/Header
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add src/components/Header.jsx tests/components/Header
git commit -m "refactor(header): remove gradient/glow/shimmer per theme spec"
```

### Task 7: Dashboard family

**Files:**
- Modify: every file under `src/components/Dashboard/` listed in the audit (DashboardHero, StatCard, ActivityChart, HeroOrgChip, HeroSyncChip, HeroTimeRangeChip, HeroChip, OrganizationCard, OrganizationSelector, MigrationActivity, LanguageChart, AIPromoStrip, WhatNeedsYouGrid, CategorySection, AttentionFeed, DashboardPremium).

- [ ] **Step 1: Apply the mechanical substitutions to every file in the family**

Reference example (StatCard.jsx callsite at `src/components/Dashboard/StatCard.jsx:63`):

```jsx
// before
<Card className="p-4 sm:p-6 hover:shadow-2xl ... bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl ... ds-card-shimmer">

// after
<Card className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
```

For DashboardHero (`src/components/Dashboard/DashboardHero.jsx:72`):

```jsx
// before
<motion.h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight ds-font-display ds-gradient-text">

// after
<motion.h1 className="text-xl sm:text-2xl font-semibold tracking-tight ds-font-display text-slate-900 dark:text-white">
```

Remove `whileHover` props with `scale`, `rotate`, or `y` from icon containers in StatCard.jsx.

- [ ] **Step 2: Run Dashboard tests**

```bash
npx vitest run tests/components/Dashboard
```

Expected: green. Snapshot tests that capture className strings will need updating with `--update`.

- [ ] **Step 3: Commit**

```bash
git add src/components/Dashboard tests/components/Dashboard
git commit -m "refactor(dashboard): adopt GitHub-utilitarian visual tokens"
```

### Task 8: RepoList

**Files:**
- Modify: `src/components/RepoList.jsx` (+ supporting files in audit)

- [ ] **Step 1: Apply substitutions**

Repo cards in RepoList today use the lift+glow combo. Replace with subtle hover:

```jsx
// before
<motion.div whileHover={{ y: -4, scale: 1.02 }} className="... ds-card-shimmer ds-hover-glow backdrop-blur-xl">

// after
<motion.div className="... ds-hover-lift">
```

Repo title links should use the accent-link token:

```jsx
// before
<h3 className="text-lg font-bold ds-gradient-text">{repo.name}</h3>

// after
<h3 className="text-base font-semibold text-[color:var(--ds-accent-link)] dark:text-[color:var(--ds-accent-link-dark)]">{repo.name}</h3>
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run tests/components/RepoList
```

- [ ] **Step 3: Commit**

```bash
git add src/components/RepoList.jsx tests/components/RepoList
git commit -m "refactor(repo-list): adopt subtle hover + accent-link tokens"
```

### Task 9: RepoDetail tabs (Overview, Branches, Releases, Issues, PRs, Settings)

**Files:**
- Modify: every file under `src/components/RepoDetail/` listed in the audit.

- [ ] **Step 1: Apply the mechanical substitutions across all 6 tabs**

Focus areas:
- Tab nav: existing tab underline → repaint to `--ds-accent-brand` underline (2px).
- Card chrome: remove `glass`/`backdrop-blur-xl`/`card-shimmer`.
- PR/Issue status badges: stick to Primer-aligned colors (`--ds-success`, `--ds-attention`, `--ds-danger`).

Tab nav transformation example:

```jsx
// before
<button className={`px-3 py-2 ${active ? 'border-b-2 border-indigo-500 text-indigo-600' : 'text-slate-500'}`}>

// after
<button className={`px-3 py-2 text-sm ${active
  ? 'border-b-2 border-[color:var(--ds-accent-brand)] text-slate-900 dark:text-white font-medium -mb-px'
  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
```

- [ ] **Step 2: Run tests per tab**

```bash
npx vitest run tests/components/RepoDetail
```

- [ ] **Step 3: Commit**

```bash
git add src/components/RepoDetail tests/components/RepoDetail
git commit -m "refactor(repo-detail): retheme 6 tabs to GitHub-utilitarian"
```

### Task 10: UI primitives (Modal, ConfirmModal, Toast, EmptyState, Spinner, PageHeader)

**Files:**
- Modify: `src/components/ui/Modal.jsx`, `ConfirmModal.jsx`, `Toast.jsx`, `EmptyState.jsx`, `Spinner.jsx`, `PageHeader.jsx`, `Card.jsx`, `Skeleton.jsx`.

- [ ] **Step 1: Apply substitutions, plus targeted updates**

`Card.jsx`: default to `border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-[var(--ds-radius-lg)]`. Remove `ds-card-shimmer` and `backdrop-blur-xl` defaults.

`Modal.jsx`: replace the overlay's `backdrop-blur-xl` with `backdrop-blur-md`. Modal panel uses `shadow-[var(--ds-shadow-overlay)]`.

`Toast.jsx`: remove the accent gradient backgrounds. Use solid:
- success → `bg-[color:var(--ds-success)] text-white`
- danger → `bg-[color:var(--ds-danger)] text-white`
- info → `bg-slate-900 text-white`

`Spinner.jsx`: ensure it uses `text-[color:var(--ds-fg-muted)]` not indigo.

`PageHeader.jsx`: title uses `text-xl font-semibold` instead of any gradient text.

`EmptyState.jsx`: title `text-md font-semibold`, body `text-sm text-[color:var(--ds-fg-muted)]`.

`Skeleton.jsx`: just renders a `<div class="ds-skeleton">` — the keyframe is in design-system.css.

- [ ] **Step 2: Run UI tests**

```bash
npx vitest run tests/components/ui
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ui tests/components/ui
git commit -m "refactor(ui-primitives): retheme Modal/Toast/Card/Skeleton/etc"
```

### Task 11: Sidebar

**Files:**
- Modify: `src/components/Sidebar.jsx` (+ children if any).

- [ ] **Step 1: Apply substitutions**

Active nav item: `bg-[color:var(--ds-surface-muted)] dark:bg-[color:var(--ds-surface-muted-dark)] text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] font-medium`.

Idle item: `text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/40`.

- [ ] **Step 2: Run Sidebar tests**

```bash
npx vitest run tests/components/Sidebar
```

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar.jsx tests/components/Sidebar
git commit -m "refactor(sidebar): adopt subtle active state, no glow"
```

### Task 12: AI Assistant

**Files:**
- Modify: every `src/components/AIAssistant*.jsx` listed in the audit.

- [ ] **Step 1: Apply substitutions**

The AI assistant panel is the most likely place to have lingering rainbow gradients ("AI" badges, premium-feel chrome). Aggressively repaint:

```jsx
// before
<div className="bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 ...">AI</div>

// after
<div className="bg-[color:var(--ds-accent-brand)] text-white text-xs px-2 py-0.5 rounded-[var(--ds-radius-sm)] font-medium">AI</div>
```

Streaming-message shimmer (if any) → replace with `ds-skeleton` for the actively-generating part.

- [ ] **Step 2: Run AI assistant tests**

```bash
npx vitest run tests/components/AIAssistant
```

- [ ] **Step 3: Commit**

```bash
git add src/components/AIAssistant* tests/components/AIAssistant
git commit -m "refactor(ai-assistant): kill rainbow gradients, solid brand accent"
```

### Task 13: Work Board

**Files:**
- Modify: every `src/components/WorkBoard/*.jsx` listed in the audit.

- [ ] **Step 1: Apply substitutions**

Work Board column headers: drop glow shadows. Replace with `border-b border-slate-200 dark:border-slate-700`. Cards in columns inherit the new `Card` defaults from Task 10.

- [ ] **Step 2: Run Work Board tests**

```bash
npx vitest run tests/components/WorkBoard
```

- [ ] **Step 3: Commit**

```bash
git add src/components/WorkBoard tests/components/WorkBoard
git commit -m "refactor(work-board): adopt GitHub-utilitarian tokens"
```

### Task 14: Onboarding tour

**Files:**
- Modify: every `src/components/Onboarding*.jsx` listed in the audit.

- [ ] **Step 1: Apply substitutions**

Spotlight halo currently uses `box-shadow: 0 0 0 9999px rgba(0,0,0,.5), 0 0 30px rgba(99,102,241,.5)`. Strip the indigo glow, keep only the dim-everything layer:

```jsx
// before
boxShadow: '0 0 0 9999px rgba(0,0,0,0.5), 0 0 60px rgba(99,102,241,0.6)'

// after
boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)'
```

Tour tooltip: use `bg-slate-900 text-white shadow-[var(--ds-shadow-overlay)]`.

- [ ] **Step 2: Run onboarding tests**

```bash
npx vitest run tests/components/Onboarding
```

- [ ] **Step 3: Commit**

```bash
git add src/components/Onboarding* tests/components/Onboarding
git commit -m "refactor(onboarding): plain spotlight overlay, no indigo halo"
```

### Task 15: Final sweep + dead-token cleanup

**Files:**
- Modify: any files surfaced by re-running the audit grep after Tasks 6–14.

- [ ] **Step 1: Re-run the kill-list grep**

```bash
node scripts/check-killed-classes.mjs
```

(If this script doesn't exist yet, run the grep from Task 1.)

- [ ] **Step 2: Fix every remaining hit**

Mechanical: open file, apply substitutions, save.

- [ ] **Step 3: Re-run the kill-list regression test**

```bash
npx vitest run tests/styles/design-system.kill-list.test.js
```

Expected: green. The CSS file is clean.

- [ ] **Step 4: Re-run full unit suite**

```bash
npx vitest run
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(theme): final sweep — kill-list grep returns zero"
```

---

## Phase 3 — Lint guards

### Task 16: Add CSS kill-list CI gate

**Files:**
- Create: `scripts/check-killed-classes.mjs`
- Modify: `package.json` (add `lint:css` script, wire to `prebuild`)

- [ ] **Step 1: Write the failing-by-design CI script**

Create `scripts/check-killed-classes.mjs`:

```javascript
#!/usr/bin/env node
import { execSync } from 'node:child_process'
import process from 'node:process'

const KILL_LIST = [
  'ds-gradient-text-premium',
  'ds-gradient-text',
  'ds-shadow-glow',
  'ds-card-shimmer',
  'ds-btn-shimmer',
  'ds-border-glow',
  'ds-hover-glow',
  'ds-animate-float',
  'ds-pulse-glow',
  'ds-glass-strong',
  'ds-glass(?!ed)',
  '--ds-gradient-(primary|secondary|accent|success|premium)',
  '--ds-shadow-glow',
]

// Grep src/ for any pattern. Excludes design-system.css itself
// (the regression test in tests/styles/ enforces that file).
const pattern = KILL_LIST.join('|')

let output = ''
try {
  output = execSync(
    `git grep -InE "${pattern}" -- "src/" ":(exclude)src/design-system.css"`,
    { encoding: 'utf8' }
  )
} catch (err) {
  // git grep exits 1 when there are no matches — that's the success case.
  if (err.status === 1) process.exit(0)
  throw err
}

if (output.trim()) {
  console.error('❌ Found references to killed theme classes/tokens:\n')
  console.error(output)
  console.error(
    '\nSee docs/specs/2026-05-14-premium-non-llm-theme-design.md for the kill list.'
  )
  process.exit(1)
}
```

- [ ] **Step 2: Wire to package.json**

Add to `package.json` scripts (keep existing scripts intact):

```json
{
  "scripts": {
    "lint:css": "node scripts/check-killed-classes.mjs",
    "prebuild": "npm run lint:css"
  }
}
```

- [ ] **Step 3: Run it**

```bash
npm run lint:css
```

Expected: passes (exit 0). If it fails, there's a missed callsite — go back to Task 15.

- [ ] **Step 4: Commit**

```bash
git add scripts/check-killed-classes.mjs package.json
git commit -m "ci: gate builds on theme kill-list grep"
```

### Task 17: Add ESLint rules for forbidden JSX patterns

**Files:**
- Modify: `eslint.config.js`

- [ ] **Step 1: Add the rules block**

Append to the second config block (the `src/components/**/*.{js,jsx}` block) in `eslint.config.js`:

```javascript
// In the rules object for src/components/**/*.{js,jsx}
'no-restricted-syntax': ['error',
  {
    selector: "MemberExpression[property.name='stack']",
    message: 'Do not surface .stack in UI. Use formatUserError(err) from src/utils/errors.js instead.',
  },
  {
    selector: "JSXAttribute[name.name='whileHover'] ObjectExpression > Property[key.name='rotate']",
    message: 'Theme spec: no rotate on hover. See docs/specs/2026-05-14-premium-non-llm-theme-design.md anti-patterns.',
  },
  {
    selector: "JSXAttribute[name.name='whileHover'] ObjectExpression > Property[key.name='scale']",
    message: 'Theme spec: no scale on hover (cards-as-button exception is rare — discuss in review).',
  },
  {
    selector: "Literal[value=/\\bfont-extrabold\\b/]",
    message: 'Theme spec: max font weight on UI text is font-semibold (600).',
  },
  {
    selector: "Literal[value=/\\bbackdrop-blur-(xl|2xl|3xl)\\b/]",
    message: 'Theme spec: max blur is backdrop-blur-md.',
  },
  {
    selector: "Literal[value=/\\bds-(gradient-text|card-shimmer|btn-shimmer|border-glow|hover-glow|animate-float|pulse-glow|glass(-strong)?)\\b/]",
    message: 'Theme spec: this ds-* class is in the kill list.',
  },
],
```

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: passes. If any error fires, fix the callsite the rule found.

- [ ] **Step 3: Commit**

```bash
git add eslint.config.js
git commit -m "lint: enforce theme anti-patterns at the AST level"
```

---

## Phase 4 — Premium primitives

### Task 18: Keyboard hint primitive (`<Kbd>`)

**Files:**
- Create: `src/components/ui/Kbd.jsx`
- Create: `tests/components/ui/Kbd.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/ui/Kbd.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Kbd } from '../../../src/components/ui/Kbd'

describe('Kbd', () => {
  it('renders provided key text', () => {
    render(<Kbd>⌘K</Kbd>)
    expect(screen.getByText('⌘K')).toBeInTheDocument()
  })

  it('applies platform-aware mod key when modifier="mod"', () => {
    // Force mac
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
    render(<Kbd modifier="mod">K</Kbd>)
    expect(screen.getByText('⌘K')).toBeInTheDocument()
  })

  it('uses Ctrl prefix on non-mac when modifier="mod"', () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true })
    render(<Kbd modifier="mod">K</Kbd>)
    expect(screen.getByText('Ctrl+K')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run, confirm failure**

```bash
npx vitest run tests/components/ui/Kbd.test.jsx
```

Expected: FAIL — `Kbd` not found.

- [ ] **Step 3: Implement**

Create `src/components/ui/Kbd.jsx`:

```jsx
function isMac() {
  if (typeof navigator === 'undefined') return false
  return /Mac/i.test(navigator.platform)
}

export function Kbd({ children, modifier }) {
  const prefix = modifier === 'mod' ? (isMac() ? '⌘' : 'Ctrl+') : ''
  return (
    <kbd className="inline-flex items-center px-1.5 py-0.5 text-[11px] font-medium text-[color:var(--ds-fg-muted)] dark:text-[color:var(--ds-fg-muted-dark)] bg-[color:var(--ds-surface-muted)] dark:bg-[color:var(--ds-surface-muted-dark)] border border-[color:var(--ds-border)] dark:border-[color:var(--ds-border-dark)] rounded-[var(--ds-radius-sm)] font-mono leading-none">
      {prefix}{children}
    </kbd>
  )
}
```

- [ ] **Step 4: Run, confirm pass**

```bash
npx vitest run tests/components/ui/Kbd.test.jsx
```

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Kbd.jsx tests/components/ui/Kbd.test.jsx
git commit -m "feat(ui): add <Kbd> keyboard-hint primitive"
```

### Task 19: Command palette (⌘K)

**Files:**
- Modify: `package.json` (add `cmdk` dep)
- Create: `src/components/ui/CommandPalette.jsx`
- Create: `tests/components/ui/CommandPalette.test.jsx`
- Modify: `src/App.jsx` (mount the palette + keybind)

- [ ] **Step 1: Install `cmdk`**

```bash
npm install cmdk@^1.0.0
```

- [ ] **Step 2: Write the failing test**

Create `tests/components/ui/CommandPalette.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CommandPalette } from '../../../src/components/ui/CommandPalette'

describe('CommandPalette', () => {
  it('opens on ⌘K and closes on Escape', () => {
    render(<CommandPalette commands={[{ id: 'sync', label: 'Sync now', run: () => {} }]} />)
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByPlaceholderText(/search/i)).not.toBeInTheDocument()
  })

  it('filters commands by the typed query', () => {
    render(<CommandPalette commands={[
      { id: 'sync', label: 'Sync now', run: () => {} },
      { id: 'toggle', label: 'Toggle theme', run: () => {} },
    ]} />)
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'sync' } })
    expect(screen.getByText('Sync now')).toBeInTheDocument()
    expect(screen.queryByText('Toggle theme')).not.toBeInTheDocument()
  })

  it('invokes run() on ↵', () => {
    const run = vi.fn()
    render(<CommandPalette commands={[{ id: 'sync', label: 'Sync now', run }]} />)
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(run).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run, confirm failure**

```bash
npx vitest run tests/components/ui/CommandPalette.test.jsx
```

- [ ] **Step 4: Implement**

Create `src/components/ui/CommandPalette.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { Command } from 'cmdk'

export function CommandPalette({ commands = [] }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((v) => !v)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-start justify-center pt-[15vh] z-[var(--ds-z-modal)]"
      role="dialog"
      aria-modal="true"
      onClick={() => setOpen(false)}
    >
      <Command
        className="w-[480px] max-w-[calc(100vw-32px)] bg-[color:var(--ds-surface)] dark:bg-[color:var(--ds-surface-dark)] border border-[color:var(--ds-border)] dark:border-[color:var(--ds-border-dark)] rounded-[var(--ds-radius-lg)] shadow-[var(--ds-shadow-overlay)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <Command.Input
          placeholder="Search commands, repos, PRs…"
          className="w-full px-4 py-3 text-[14px] bg-transparent outline-none border-b border-[color:var(--ds-border)] dark:border-[color:var(--ds-border-dark)] text-[color:var(--ds-fg)] dark:text-[color:var(--ds-fg-dark)]"
        />
        <Command.List className="max-h-[320px] overflow-y-auto ds-scrollbar p-1">
          <Command.Empty className="px-4 py-6 text-center text-sm text-[color:var(--ds-fg-muted)]">
            No matches.
          </Command.Empty>
          {commands.map((cmd) => (
            <Command.Item
              key={cmd.id}
              onSelect={() => { cmd.run(); setOpen(false) }}
              className="px-3 py-2 rounded-[var(--ds-radius)] cursor-pointer text-[14px] text-[color:var(--ds-fg)] dark:text-[color:var(--ds-fg-dark)] data-[selected=true]:bg-[color:var(--ds-surface-muted)] dark:data-[selected=true]:bg-[color:var(--ds-surface-muted-dark)]"
            >
              {cmd.label}
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </div>
  )
}
```

- [ ] **Step 5: Mount in App.jsx**

In `src/App.jsx`, near the top of the JSX tree:

```jsx
import { CommandPalette } from './components/ui/CommandPalette'

// In the rendered tree (alongside Toaster, etc.):
<CommandPalette commands={[
  { id: 'sync', label: 'Sync now', run: () => window.dispatchEvent(new CustomEvent('app:sync')) },
  { id: 'toggle-theme', label: 'Toggle theme', run: () => document.documentElement.classList.toggle('dark') },
]} />
```

(Detailed command set is wired in a follow-up; this lands the primitive plus 2 starter commands.)

- [ ] **Step 6: Run tests**

```bash
npx vitest run tests/components/ui/CommandPalette.test.jsx
```

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/CommandPalette.jsx tests/components/ui/CommandPalette.test.jsx src/App.jsx package.json package-lock.json
git commit -m "feat(ui): add ⌘K command palette (cmdk)"
```

### Task 20: Optimistic mutation hook + undo toast

**Files:**
- Create: `src/hooks/useOptimisticMutation.js`
- Create: `tests/hooks/useOptimisticMutation.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/useOptimisticMutation.test.js`:

```javascript
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useOptimisticMutation } from '../../src/hooks/useOptimisticMutation'

describe('useOptimisticMutation', () => {
  it('applies optimistic update immediately and commits on success', async () => {
    const apply = vi.fn()
    const revert = vi.fn()
    const fn = vi.fn().mockResolvedValue('ok')
    const onToast = vi.fn()

    const { result } = renderHook(() => useOptimisticMutation({ apply, revert, fn, onToast }))
    await act(async () => { await result.current.run() })

    expect(apply).toHaveBeenCalledOnce()
    expect(fn).toHaveBeenCalledOnce()
    expect(revert).not.toHaveBeenCalled()
    expect(onToast).toHaveBeenCalledWith(expect.objectContaining({ undo: expect.any(Function) }))
  })

  it('rolls back when fn rejects', async () => {
    const apply = vi.fn()
    const revert = vi.fn()
    const fn = vi.fn().mockRejectedValue(new Error('boom'))
    const onToast = vi.fn()

    const { result } = renderHook(() => useOptimisticMutation({ apply, revert, fn, onToast }))
    await act(async () => { await result.current.run() })

    expect(revert).toHaveBeenCalledOnce()
    expect(onToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
  })

  it('undo() calls the inverse mutation', async () => {
    const apply = vi.fn()
    const revert = vi.fn()
    const fn = vi.fn().mockResolvedValue('ok')
    const inverse = vi.fn().mockResolvedValue('ok')
    let toastArg
    const onToast = (t) => { toastArg = t }

    const { result } = renderHook(() => useOptimisticMutation({ apply, revert, fn, inverse, onToast }))
    await act(async () => { await result.current.run() })
    await act(async () => { await toastArg.undo() })

    expect(inverse).toHaveBeenCalledOnce()
    expect(revert).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run, confirm failure**

```bash
npx vitest run tests/hooks/useOptimisticMutation.test.js
```

- [ ] **Step 3: Implement**

Create `src/hooks/useOptimisticMutation.js`:

```javascript
import { useCallback } from 'react'

export function useOptimisticMutation({ apply, revert, fn, inverse, onToast }) {
  const run = useCallback(async () => {
    apply()
    try {
      await fn()
      onToast?.({
        type: 'success',
        message: 'Done',
        undo: inverse
          ? async () => {
              revert()
              await inverse()
            }
          : undefined,
      })
    } catch (err) {
      revert()
      onToast?.({ type: 'error', message: err.message ?? 'Action failed' })
    }
  }, [apply, revert, fn, inverse, onToast])

  return { run }
}
```

- [ ] **Step 4: Run, confirm pass**

```bash
npx vitest run tests/hooks/useOptimisticMutation.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useOptimisticMutation.js tests/hooks/useOptimisticMutation.test.js
git commit -m "feat(hooks): add useOptimisticMutation with undo support"
```

### Task 21: Animated checkmark

**Files:**
- Create: `src/components/ui/AnimatedCheck.jsx`
- Create: `tests/components/ui/AnimatedCheck.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/ui/AnimatedCheck.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { AnimatedCheck } from '../../../src/components/ui/AnimatedCheck'

describe('AnimatedCheck', () => {
  it('renders an svg path with stroke-dasharray animation hooks', () => {
    const { container } = render(<AnimatedCheck />)
    const path = container.querySelector('path')
    expect(path).toBeTruthy()
    expect(path.getAttribute('stroke-dasharray')).toBeTruthy()
    expect(container.querySelector('svg')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run, confirm failure**

```bash
npx vitest run tests/components/ui/AnimatedCheck.test.jsx
```

- [ ] **Step 3: Implement**

Create `src/components/ui/AnimatedCheck.jsx`:

```jsx
export function AnimatedCheck({ size = 16, color = 'currentColor', durationMs = 240 }) {
  // path d = "M4 9 l4 4 l8-8" — total length ~21px when stroked at 2px
  const length = 21
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      role="img"
      aria-label="completed"
    >
      <path
        d="M4 9 l4 4 l8 -8"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={length}
        strokeDashoffset={length}
        style={{
          animation: `ds-stroke-draw ${durationMs}ms cubic-bezier(0.2,0,0,1) forwards`,
          '--ds-stroke-length': length,
        }}
      />
    </svg>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/components/ui/AnimatedCheck.test.jsx
```

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/AnimatedCheck.jsx tests/components/ui/AnimatedCheck.test.jsx
git commit -m "feat(ui): animated stroke-draw checkmark"
```

### Task 22: Sticky table header shadow hook

**Files:**
- Create: `src/hooks/useStickyHeaderShadow.js`
- Create: `tests/hooks/useStickyHeaderShadow.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/useStickyHeaderShadow.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStickyHeaderShadow } from '../../src/hooks/useStickyHeaderShadow'

describe('useStickyHeaderShadow', () => {
  it('returns elevated=false when scrollTop is 0', () => {
    const ref = { current: { scrollTop: 0, addEventListener() {}, removeEventListener() {} } }
    const { result } = renderHook(() => useStickyHeaderShadow(ref))
    expect(result.current).toBe(false)
  })

  it('returns elevated=true once a scroll event fires with scrollTop > 0', () => {
    const handlers = {}
    const el = {
      scrollTop: 0,
      addEventListener: (ev, fn) => { handlers[ev] = fn },
      removeEventListener: () => {},
    }
    const ref = { current: el }
    const { result } = renderHook(() => useStickyHeaderShadow(ref))
    act(() => {
      el.scrollTop = 12
      handlers.scroll()
    })
    expect(result.current).toBe(true)
  })
})
```

- [ ] **Step 2: Run, confirm failure**

```bash
npx vitest run tests/hooks/useStickyHeaderShadow.test.js
```

- [ ] **Step 3: Implement**

Create `src/hooks/useStickyHeaderShadow.js`:

```javascript
import { useEffect, useState } from 'react'

export function useStickyHeaderShadow(scrollRef) {
  const [elevated, setElevated] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => setElevated(el.scrollTop > 0)
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [scrollRef])

  return elevated
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/hooks/useStickyHeaderShadow.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useStickyHeaderShadow.js tests/hooks/useStickyHeaderShadow.test.js
git commit -m "feat(hooks): sticky table header scroll-shadow"
```

### Task 23: View Transitions wrapper

**Files:**
- Create: `src/utils/viewTransitions.js`
- Create: `tests/utils/viewTransitions.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/utils/viewTransitions.test.js`:

```javascript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { startTransition } from '../../src/utils/viewTransitions'

afterEach(() => {
  delete globalThis.document.startViewTransition
})

describe('startTransition', () => {
  it('uses document.startViewTransition when supported', async () => {
    const cb = vi.fn()
    const finished = Promise.resolve()
    globalThis.document.startViewTransition = vi.fn(() => ({ finished, ready: finished, updateCallbackDone: finished }))
    await startTransition(cb)
    expect(globalThis.document.startViewTransition).toHaveBeenCalledOnce()
  })

  it('falls back to running the callback synchronously when unsupported', async () => {
    const cb = vi.fn()
    await startTransition(cb)
    expect(cb).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run, confirm failure**

```bash
npx vitest run tests/utils/viewTransitions.test.js
```

- [ ] **Step 3: Implement**

Create `src/utils/viewTransitions.js`:

```javascript
export async function startTransition(cb) {
  if (typeof document === 'undefined') return cb()
  if (typeof document.startViewTransition === 'function') {
    const t = document.startViewTransition(() => cb())
    await t.finished
    return
  }
  return cb()
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/utils/viewTransitions.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/utils/viewTransitions.js tests/utils/viewTransitions.test.js
git commit -m "feat(utils): view-transitions wrapper with graceful fallback"
```

### Task 24: Delayed tooltip primitive

**Files:**
- Create: `src/components/ui/Tooltip.jsx`
- Create: `tests/components/ui/Tooltip.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/ui/Tooltip.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { Tooltip } from '../../../src/components/ui/Tooltip'

describe('Tooltip', () => {
  it('appears after 300ms hover', async () => {
    vi.useFakeTimers()
    render(<Tooltip label="Sync repos"><button>Sync</button></Tooltip>)
    fireEvent.mouseEnter(screen.getByText('Sync'))
    expect(screen.queryByText('Sync repos')).not.toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.getByText('Sync repos')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('hides immediately on mouseleave', async () => {
    vi.useFakeTimers()
    render(<Tooltip label="Sync repos"><button>Sync</button></Tooltip>)
    fireEvent.mouseEnter(screen.getByText('Sync'))
    act(() => { vi.advanceTimersByTime(300) })
    fireEvent.mouseLeave(screen.getByText('Sync'))
    expect(screen.queryByText('Sync repos')).not.toBeInTheDocument()
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Run, confirm failure**

```bash
npx vitest run tests/components/ui/Tooltip.test.jsx
```

- [ ] **Step 3: Implement**

Create `src/components/ui/Tooltip.jsx`:

```jsx
import { cloneElement, useRef, useState } from 'react'

export function Tooltip({ label, children, delay = 300 }) {
  const [visible, setVisible] = useState(false)
  const timer = useRef(null)

  const show = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setVisible(true), delay)
  }
  const hide = () => {
    clearTimeout(timer.current)
    setVisible(false)
  }

  return (
    <span className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {visible && (
        <span
          role="tooltip"
          className="absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-0.5 text-[12px] text-white bg-[color:var(--ds-surface-dark)] rounded-[var(--ds-radius-sm)] whitespace-nowrap pointer-events-none"
        >
          {label}
        </span>
      )}
    </span>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/components/ui/Tooltip.test.jsx
```

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Tooltip.jsx tests/components/ui/Tooltip.test.jsx
git commit -m "feat(ui): delayed tooltip primitive (300ms, mac-style)"
```

---

## Phase 5 — Final verification

### Task 25: Run full verification suite

**Files:** (read-only)

- [ ] **Step 1: Run unit tests**

```bash
npx vitest run
```

Expected: green across the whole suite.

- [ ] **Step 2: Run lint**

```bash
npm run lint
npm run lint:css
```

Expected: green.

- [ ] **Step 3: Run build**

```bash
npx vite build
```

Expected: green. Bundle size should be smaller than before (less CSS).

- [ ] **Step 4: Confirm spec success criteria**

Re-read [docs/specs/2026-05-14-premium-non-llm-theme-design.md](../specs/2026-05-14-premium-non-llm-theme-design.md) "Success criteria" section. Verify each of the 6 items.

- [ ] **Step 5: Push for CI smoke**

Per the project's `feedback_avoid_long_local_tests` memory, don't run the full Playwright suite locally — push and let CI validate.

```bash
git push origin HEAD
```

---

## Notes for the executing engineer

- **Sequence matters.** Phase 0 (audit) feeds Phase 2 (callsite sweep). Don't skip the audit — re-grepping on each file is the same work spread out.
- **Phases 4 tasks are independent of each other** (Tasks 18–24). They can be parallelized across multiple engineers/sessions.
- **Phase 2 tasks are independent of each other** once Phase 1 ships. They can land as separate PRs.
- **Watch the dark surface.** Many existing components hard-code `slate-950` for dark backgrounds; the new dark surface is `#0d1117`. Don't mass-replace — use `bg-[color:var(--ds-surface-dark)]` going forward, but you may leave existing `dark:bg-slate-950` for now (it's close enough — only repaint when you're touching the file anyway).
- **Logo stays as-is.** The `--ds-logo-*` tokens at the top of the new design-system.css are intentionally unchanged — the brand mark uses its own gradient.
- **Reduced motion is mandatory.** Every animation in the new design-system.css is short-circuited by the `prefers-reduced-motion` block. If you add motion in Phase 4, make sure it respects it (use `var(--ds-duration-*)` tokens, never hardcoded ms).
