# Premium Non-LLM Theme — Design

**Date:** 2026-05-14
**Status:** Draft, pending user review
**Author:** Bruno + Claude
**Related:** supersedes the "premium gradients" aesthetic shipped in earlier iterations.

---

## Why

The current visual language reads as "AI-generated SaaS template": rainbow
gradients (indigo → purple → cyan → pink), animated gradient text on every
hero heading, glow shadows everywhere, shimmer on every card hover, heavy
glassmorphism with `backdrop-blur-xl` on flat cards, and stacked hover
effects (lift + scale + rotate + glow + shimmer at once). This is the look
that screams "ChatGPT-built landing page" — exactly the aesthetic Bruno
asked to escape.

The product is a **Repo Manager** — a tool that users open *next to* the
GitHub.com website. Aesthetic dissonance between the two surfaces creates
constant friction. The new direction is **premium through restraint**:
adopt GitHub's own visual language (density, structure, type) so the app
feels like a thoughtful extension of the GitHub experience, not a competing
identity.

Crucially, "premium ≠ flat". This spec also introduces the *tasteful*
premium primitives that the current design lacks (command palette,
keyboard hints, optimistic UI with undo, animated checkmarks, sticky table
headers with scroll shadow, view transitions).

## Locked decisions (from brainstorm)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Design direction | **H — GitHub utilitarian** (familiar to users who use GitHub.com daily) |
| 2 | Accent strategy | **V3 hybrid** — GitHub blue (`#0969da` / `#4493f8`) for links/PRs/issues; brand indigo (`#4f46e5` / `#818cf8`) restricted to logo + active tab underline + focus rings |
| 3 | Approach | **Tone-down at token level** (kill LLM tokens, keep premium tokens) + **add premium primitives that are missing** |
| 4 | Typography | System font stack (GitHub-native) for UI; JetBrains Mono for code/data |
| 5 | Border radius | 6px (controls), 8px (cards/modals). Normalize away current 8/12/16/2xl mix |
| 6 | Dark surface | `#0d1117` (Primer-aligned) instead of slate-950 (`#020617`) |

## Foundations

### Palette

```css
/* Light surface */
--ds-surface:          #ffffff;
--ds-surface-subtle:   #f6f8fa;   /* page bg, hover row bg */
--ds-surface-muted:    #eaeef2;   /* dividers, soft borders */
--ds-border:           #d1d9e0;
--ds-border-strong:    #59636e;
--ds-fg:               #1f2328;
--ds-fg-muted:         #59636e;
--ds-fg-subtle:        #6e7781;

/* Dark surface (Primer-aligned) */
--ds-surface-dark:           #0d1117;
--ds-surface-subtle-dark:    #151b23;
--ds-surface-muted-dark:     #21262d;
--ds-border-dark:            #3d444d;
--ds-border-strong-dark:     #9198a1;
--ds-fg-dark:                #f0f6fc;
--ds-fg-muted-dark:          #9198a1;

/* Accents (V3 hybrid) */
--ds-accent-link:         #0969da;   /* repo / PR / issue links */
--ds-accent-link-dark:    #4493f8;
--ds-accent-brand:        #4f46e5;   /* logo, active tab, focus ring */
--ds-accent-brand-dark:   #818cf8;

/* Status (Primer-aligned) */
--ds-success:    #1a7f37;  --ds-success-dark:  #3fb950;
--ds-attention:  #9a6700;  --ds-attention-dark:#d29922;
--ds-danger:     #cf222e;  --ds-danger-dark:   #f85149;

/* CTA (verb-bearing buttons) */
--ds-cta:        #1f883d;  --ds-cta-dark:      #238636;
--ds-cta-hover:  #1a7f37;  --ds-cta-hover-dark:#29903b;
```

### Typography

```css
--ds-font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans",
                Helvetica, Arial, sans-serif, "Apple Color Emoji",
                "Segoe UI Emoji";
--ds-font-mono: ui-monospace, "JetBrains Mono", "Cascadia Code",
                "Source Code Pro", Menlo, Consolas, "DejaVu Sans Mono",
                monospace;
```

Scale (rem-based, GitHub Primer-aligned):

| Token | Size | Use |
|---|---|---|
| `--ds-text-xs` | 12px | metadata, labels |
| `--ds-text-sm` | 13px | secondary body, table cells |
| `--ds-text-base` | 14px | body |
| `--ds-text-md` | 16px | emphasized body, dialog body |
| `--ds-text-lg` | 20px | section heading |
| `--ds-text-xl` | 24px | hero heading (was 32-40px) |
| `--ds-text-2xl` | 32px | reserved for empty-state titles only |

Numerics always render with `font-variant-numeric: tabular-nums` so columns
align.

### Radius

```css
--ds-radius-sm: 4px;   /* badges, pills */
--ds-radius:    6px;   /* buttons, inputs, dropdowns */
--ds-radius-lg: 8px;   /* cards, modals, popovers */
--ds-radius-xl: 12px;  /* reserved for the few hero containers */
```

Kill the existing 16px/24px/2xl usage everywhere except the hero halo.

### Elevation

Single subtle elevation scale — no glows, no colored shadows.

```css
--ds-shadow-sm: 0 1px 0 rgba(31,35,40,.04);
--ds-shadow:    0 3px 6px rgba(140,149,159,.15);
--ds-shadow-lg: 0 8px 24px rgba(140,149,159,.2);
--ds-shadow-overlay: 0 0 0 1px rgba(31,35,40,.06), 0 8px 24px rgba(31,35,40,.12);
```

In dark mode, shadows fall back to a single 1px border (`--ds-border-dark`)
because shadows are invisible against `#0d1117`.

### Motion

```css
--ds-ease:           cubic-bezier(0.2, 0, 0, 1);          /* default — entrance */
--ds-ease-out:       cubic-bezier(0.3, 0, 0.8, 0.15);     /* exit */
--ds-ease-spring:    cubic-bezier(0.5, 1.25, 0.75, 1.25); /* RESERVED — modal/drawer only */

--ds-duration-instant: 80ms;
--ds-duration-fast:    120ms;   /* default for hover/focus */
--ds-duration:         200ms;
--ds-duration-slow:    320ms;   /* route transitions, modal open */
```

Spring physics live ONLY in modals and drawers (where a physical "weight"
makes UX sense). Buttons, hovers, focus, list rows use the linear-ish
`--ds-ease` at 120ms.

### Density

Default vertical rhythm tightens. Reference paddings:

| Surface | Was | Now |
|---|---|---|
| Card | 24px | 16px |
| List row | 14–16px | 8–10px |
| Modal body | 20px | 16px |
| Stat card | 24px | 12–16px (compact) |
| Hero | 64-96px vertical | 32-48px |

## Component contract

Every interactive component follows this contract:

| State | Visual change | Duration |
|---|---|---|
| Idle | Default tokens | — |
| Hover | Border or bg shift by 1 step (e.g. `--ds-surface` → `--ds-surface-subtle`); icon color goes from `--ds-fg-muted` → `--ds-fg`. **No transform.** | 120ms |
| Focus-visible | 2px `--ds-accent-brand` outline + 3px outline at .3 alpha (skip transform, skip scale) | 120ms |
| Active (pressed) | Bg shifts 1 more step | instant |
| Disabled | 50% opacity, `cursor: not-allowed` | — |
| Loading | Skeleton with opacity pulse (1.8s ease-in-out) or inline 14px spinner | — |

**Forbidden state changes**: `transform: scale()`, `transform: translateY()`,
`transform: rotate()`, colored box-shadow, animated gradient backgrounds,
filter blur.

## Net-new premium primitives

The pieces below are introduced as **part of this spec**, because "premium"
without them just means "less". Their inclusion is what differentiates the
new theme from "boring corporate" while staying GitHub-tasteful.

### 1. Command palette (`⌘K` / `Ctrl+K`)

Linear / Raycast / VS Code pattern. Fuzzy search across:
- repos (already loaded)
- recent PRs
- recent issues
- app navigation (Dashboard, Work Board, Settings)
- actions (Sync now, Toggle theme, Sign out)

Single dialog (uses existing `Modal` primitive), 480px wide, anchored top.
No backdrop blur — solid overlay at .6 opacity. Keyboard-first, results
update on each keystroke, `↑ ↓` to navigate, `↵` to execute, `Esc` to close.

### 2. Keyboard hints on all primary buttons & dialog actions

Every primary button shows the keystroke in a muted pill:
```
[ Sync now    ⌘S ]
[ Cancel  Esc ] [ Save  ⌘↵ ]
```

Uses the platform-aware modifier symbol (`⌘` on Mac, `Ctrl` on Win/Linux).

### 3. Optimistic UI + Undo toast

For mutations that are safely reversible (close PR, archive issue, unstar
repo, dismiss notification): apply the change in the UI immediately, fire
the API call in the background, surface a toast with `Undo` (8s timeout).
On `Undo`, re-fire the inverse mutation. On network failure, roll back and
show the failure toast.

### 4. Animated checkmark on action complete

When a destructive or terminal action completes (delete, archive, sync
finished), render a 16px checkmark that animates the stroke draw over
240ms. Pure SVG + `stroke-dasharray` animation — no scale, no bounce.

### 5. Sticky table headers with scroll shadow

When a table scrolls vertically, the `thead` becomes sticky and gains a
subtle drop-shadow (`--ds-shadow-sm`) that fades in as soon as `scrollTop > 0`.
Single line of JS via `IntersectionObserver`.

### 6. View Transitions API on route navigation

Where supported (Chromium 111+), wrap `setLocation` calls in
`document.startViewTransition()` for a 320ms cross-fade between routes.
Graceful no-op on Firefox/Safari.

### 7. Delayed tooltips

Tooltips fire after 300ms hover (consistency with macOS/Linear/Raycast).
Single subtle arrow, `--ds-surface-dark` background even in light mode
(GitHub does the same), 12px font.

## Tokens to KILL

These existing `--ds-*` tokens and classes are deleted or repointed:

| Token / class | Action |
|---|---|
| `--ds-gradient-primary`, `-secondary`, `-accent`, `-success`, `-premium` | DELETE |
| `--ds-shadow-glow-indigo/cyan/purple` | DELETE |
| `.ds-gradient-text`, `.ds-gradient-text-premium` | DELETE |
| `.ds-card-shimmer` | DELETE (kept in 1 place: skeletons via `.ds-skeleton`) |
| `.ds-btn-shimmer` | DELETE |
| `.ds-border-glow` | DELETE |
| `.ds-hover-glow` | DELETE |
| `.ds-animate-float` + `@keyframes ds-float` | DELETE |
| `@keyframes ds-pulse-glow` | DELETE |
| `@keyframes ds-gradient-shift` | DELETE |
| `.ds-glass`, `.ds-glass-strong` | DELETE (replaced by `--ds-shadow-overlay` for popovers) |
| Body `background-image` radial gradients in `index.css` | DELETE |
| `.ds-hover-lift` translate(-4px) | REPOINT to a no-op (kept as class for compat, animation becomes border-color shift) |
| `.ds-pulse-glow` references in components | REMOVE callsite-by-callsite |

## Tokens / utilities to KEEP

| Token / class | Reason |
|---|---|
| `--ds-z-*` (z-index scale) | Layout contract, no aesthetic |
| `.ds-modal-body` (padding tokens) | Spacing consistency |
| `.ds-scrollbar` | Subtle by design |
| `.ds-skeleton` + opacity-pulse keyframe | Reworked to plain opacity pulse, no rainbow shimmer |
| `.ds-font-display`, `.ds-font-mono` | Now resolve to system stack + JetBrains Mono |
| `.ds-focus-ring` | Reworked to 2px + 3px outline (no scale) |
| `prefers-reduced-motion` block | Accessibility, mandatory |
| `.diff-renderer` `content-visibility` | Perf optimization |
| `.ds-session-banner` | Repainted in lower-saturation amber |

## Anti-patterns

Catalogue of "things you must not do" (lint or code-review checks):

1. **No `bg-gradient-to-*` on persistent UI** (allowed in logo only).
2. **No `backdrop-blur-*` greater than `backdrop-blur-md`** (used only for modal overlays).
3. **No `shadow-*` with colored hex** — only token-driven shadows.
4. **No `whileHover={{ scale: ... }}`** unless the surface is a true card-as-button. Most components: `whileHover` removed entirely.
5. **No multi-stop gradients** (only 2-stop gradient allowed: the logo).
6. **No `animate-pulse` on data text** — only on skeleton bars.
7. **No `rotate: N` on icon hover.**
8. **No `font-extrabold` on body text** — `font-semibold` (600) is the heaviest weight allowed on UI text.

## Rollout / blast radius

This is a token-level + callsite cleanup spec. The blast radius is large by
count (many files touch `--ds-*` or use a forbidden class), but each file's
change is mechanical. Spec deliberately does NOT redesign layouts — that's
deferred to a follow-up spec.

Suggested phases (writing-plans will sequence these):

1. **Phase 0 — Audit.** `grep` for each killed token/class, produce a list
   of callsites grouped by component family. Single output report file.
2. **Phase 1 — Foundations.** Rewrite `design-system.css` end-to-end with
   the new token set. Rewrite `index.css` body block. Bump app shell
   (`App.jsx` colors-on-html). All existing components break visually but
   are functional. Unit tests should still pass.
3. **Phase 2 — Callsite sweep, batched by family.** Header → Dashboard →
   RepoList → RepoDetail tabs (6) → Modals → Toasts → Settings → AI
   Assistant → Work Board → onboarding. Each batch is one PR. After each
   batch, run the unit suite + Playwright smoke tests.
4. **Phase 3 — Net-new primitives.** Command palette → Keyboard hints →
   Optimistic Undo toast → Animated checkmark → Sticky table shadow →
   View Transitions wrapper → Delayed tooltips. One PR per primitive.
5. **Phase 4 — Lint guards.** ESLint custom rules (or stylelint) for the
   anti-patterns above so regressions don't sneak back. CI gate.

Estimated effort:

- Phase 1: 1 day
- Phase 2: 3-5 days (paralellisable by family)
- Phase 3: 2-3 days
- Phase 4: 0.5 day

## Out of scope

- Layout redesigns (the new theme works with current layouts; redesigning
  the Dashboard hero, e.g., is a separate spec).
- Marketing site, README screenshots — content of `docs/images/` is left
  for a documentation pass.
- New iconography. Keeps `lucide-react`.
- Mobile-specific overhaul. Mobile primitives carry over.

## Success criteria

1. `grep -RIn "ds-gradient-text\|ds-gradient-text-premium\|ds-shadow-glow\|ds-card-shimmer\|ds-btn-shimmer\|ds-border-glow\|ds-hover-glow\|ds-animate-float\|ds-pulse-glow" src/` returns **zero matches** outside `design-system.css` and the deletion-marker comments themselves.
2. Visual A/B (Playwright screenshots from `docs/images/`) of Dashboard, Header, RepoDetail tabs shows the new look — verified by Bruno before merge.
3. Build size: no regression (the kill list is net-negative on CSS).
4. Lighthouse motion score: improves (less animation surface).
5. Unit + Playwright suites: all green.
6. New primitives demoable in isolation (each lands with its own happy-path
   test).

## Open questions deferred to implementation plan

- Exact ESLint rule mechanism (custom rule vs `no-restricted-syntax` vs
  stylelint) — writing-plans will pick.
- Whether `ds-card-shimmer` removal can be done in Phase 1 vs Phase 2
  (depends on how many callsites — Phase 0 audit answers it).
- Whether the Anthropic-warm color path is worth preserving as a
  user-selectable "theme variant". Default answer: no, single theme.
