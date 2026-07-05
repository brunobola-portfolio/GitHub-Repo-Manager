# Spec — Layout Premium & Responsive (lean)

**Date:** 2026-06-25
**Status:** Draft (pending owner approval)
**Scope:** Incremental, app-wide layout polish. Conservative structure preserved (Header nav + per-view sidebars). No redesign.

## Context

The design infrastructure is already mature, so this is **adoption + a few concrete gaps**, not a build-out:

- **Token system already exists** in `src/design-system.css`: typography (`--ds-text-*`), surfaces/borders/fg (light+dark), radius (`--ds-radius-*`), shadow, **motion** (`--ds-duration-*`, `--ds-ease*`, `--ds-transition-*`), z-index.
- **~49 shared primitives** in `src/components/ui/` (Badge, EmptyState, PageHeader, PanelHeader, Card, CollapsiblePanel, …). `EmptyState` is referenced in ~40 files (already broadly adopted).
- **Vertical layout vars** exist and adapt responsively in `src/index.css`: `--header-height`, `--layout-py`, `--card-min-width` (`index.css:37-71`).

A design panel (6 lenses + judge) plus direct verification on 2026-06-25 confirmed the remaining premium gains are incremental. The genuine gaps:

- **No horizontal `--layout-px`** — `px-4 sm:px-6 lg:px-8 xl:px-10` is hardcoded in 5 shell/banner callsites (App.jsx:669, Header.jsx:89, BYOKUpgradeBanner:66, SessionBanner:19, RateLimitNotice:115 — the last omits `xl:px-10`).
- **No named ultrawide breakpoint** — arbitrary `max-w-[1920px]` (×5), `min-[1700px]` (×3 in RepoFilterBar), `min-[1340px]` (×3 in Header). Only `@custom-variant dark`/`short` exist (`index.css:10,16`).
- **Nothing uses space > 1920px** — fixed cap leaves dead gutters; grid doesn't densify.
- **`SlimSidebar` is placeholder** — collapsed rail popovers show "No recent actions / activity" (Sidebar.jsx:122-172).
- **`duration-300` hardcoded** in 38 sites / 25 files despite motion tokens existing.
- **Targeted a11y debt** — `text-slate-400` on light backgrounds fails AA (audit H7, CommandPalette:483-503); ConfirmModal aria (H6); decorative icons missing `aria-hidden`.

## Goals

1. Use the space on screens > 1920px (gutters + density) without touching navigation.
2. Make the collapsed `SlimSidebar` functional and premium.
3. Close the adoption debt: add `--layout-px` + named breakpoints + migrate `duration-300` to tokens, gated by lint to prevent regression.
4. Fix the targeted a11y contrast/aria issues from the audit.

## Non-goals (roadmap)

- Drag-to-resize panels + persistence (medium-high risk; no proven demand).
- RepoDetail refactor into a resizable context sidebar.
- Consolidating the ~12 badge/chip components into one `Badge`+`tone` (large refactor, medium value).
- Density mode (Cozy/Compact) and `RepoGrid` virtualization.

## Workstream 1 — Ultrawide (> 1920px)

**Current:** `<main>` cap `max-w-[1920px]` (App.jsx:669); Header and banners repeat the same wrapper. `--card-min-width` already steps 300→100%→280→320 across breakpoints (index.css:37-59).

**Design:**

- Add named breakpoints in an `@theme` block in `index.css`: `--breakpoint-ultra: 1920px;` (and `--breakpoint-wide: 1700px;`) → generates `ultra:` / `wide:` variants (Tailwind v4).
- Raise the cap in a controlled way: `max-w-[1920px]` → a larger cap (e.g. `max-w-[2400px]`) **coupled** to an extra `--card-min-width` step at `ultra` so more columns appear without giant cards (legibility preserved by the min-width floor).
- Density: Dashboard/RepoGrid `space-y`/gaps gain one step at `ultra:`.

**Interface:** no new API; only the shell wrapper + tokens in `index.css`.
**Tests:** width is not RTL-testable — verify via Playwright MCP at 1920/2560, light+dark (verify phase). Optional snapshot.
**Risk:** long cards/lines if the cap rises without the min-width floor — mitigated by always coupling the two.

## Workstream 2 — SlimSidebar functional/premium

**Current:** `SlimSidebar` (Sidebar.jsx:89-184) renders Zap/History/Clock icons whose popovers hold placeholder text and receives only `selectedRepos` + handlers. The expanded `Sidebar` already receives `results`, `message`, `activity` via `sidebarProps` (App.jsx).

**Design:**

- Pass the same real data to `SlimSidebar` (results / activity / selection) — reuse what the expanded `Sidebar` already consumes.
- "Quick Actions" popover: reflect selection count + the real quick actions when there's a selection.
- "Action History" popover: last N real entries (reuse `ActionHistory`'s row render).
- "Recent Activity" popover: last N real events (reuse `ActivityListBody`).
- Premium: count badge on the icon when items exist; active states; tooltips (already present); popover a11y already covered (`SlimPopover` is `role=dialog` + Escape + focus).

**Interface:** extend `SlimSidebar` props (additive). Extract the shared row renders from `ActionHistory` / `ActivityListBody` so both expanded and slim reuse them (no duplicated markup).
**Tests (TDD):** RTL — SlimSidebar with results/activity renders real content in popovers; count badge appears; empty shows EmptyState. Failing test first.
**Risk:** low; the discipline is to reuse renders, not duplicate.

## Workstream 3 — Token adoption + anti-drift gate

**Current:** `--layout-px` does not exist; paddings hardcoded in 5+ sites. `duration-300` in 38 sites / 25 files (`--ds-duration`=200ms, `--ds-duration-slow`=320ms exist). Arbitrary `min-[1700px]`×3, `min-[1340px]`×3.

**Design:**

- Add responsive `--layout-px` in `index.css` (alongside `--layout-py`): map `px-4 sm:px-6 lg:px-8 xl:px-10` to one var, with an extra step at `ultra`. Apply it in the shell + banners. **Note:** `RateLimitNotice.jsx:115` currently omits `xl:px-10` — decide deliberately (align to the token, or keep its narrower padding) so the migration doesn't silently change that banner.
- Named breakpoints (`ultra`, `wide`) via `@theme` → replace `min-[1700px]`/`min-[1340px]` with `wide:`/named variants.
- Migrate `duration-300` by rule: width/layout transitions → `--ds-duration-slow` (~320ms); hover/micro → `--ds-duration` (200ms). Case-by-case; preserve perceived timing (note: 200↔300 is not 1:1).
- **Anti-drift gate:** extend the existing `eslint.config.js` (repo root, flat config) with a `no-restricted-syntax` rule blocking *new* arbitrary `duration-[N]`, arbitrary `min-[Npx]`/`max-w-[Npx]` in the shell, and (warn on) loose `border-slate-*`. Migrate the noisiest surfaces now (Dashboard/RepoList/Header); lint blocks new code only — avoids a big-bang across 3000+ dark callsites.

**Tests:** the lint rule gets its own test (new `tests/lint/` — does not exist yet); prod build (lightningcss) green; visual smoke.
**Risk:** 200↔300 mismatch — migrate by rule and visually verify; regression returns if the lint gate doesn't land.

## Workstream 4 — Targeted a11y

**Current:** audit H7 — `text-slate-400` on light bg (~2.6:1), case-by-case in CommandPalette (~483-589); decorative icons missing `aria-hidden` (CommandPalette 480/500/520). **H6 (ConfirmModal aria) is already resolved** — `ConfirmModal.jsx:99` uses `aria-busy` and neither button carries a redundant aria-label (label becomes "Processing…"); excluded from scope.

**Design:** swap `text-slate-400`→`text-slate-500`/`--ds-fg-muted` **only** where it sits on light surfaces (leave `dark:` variants alone) — case-by-case, not a blanket replace; add `aria-hidden` to the decorative icons. Surgical, audit-driven — not app-wide.

**Tests (TDD):** RTL/axe on touched components (ConfirmModal `aria-busy`; CommandPalette uses contrast-safe classes).
**Risk:** low.

## Decisions for owner (confirm at review)

- **D1 — Ultrawide:** raise cap to ~2400 with adaptive density *(recommended)* vs. keep fixed cap and only trim gutters. (Pin the exact cap — 2400 vs 2560 — before the W1 PR.)
- **D2 — Resize:** stays out (roadmap) — confirm.
- **D3 — Token migration:** incremental + lint gate *(recommended)* vs. big-bang.

## Rollout

Small, focused PRs in order **3 → 1 → 2 → 4** (tokens/breakpoints first because 1 and 2 consume them), each with tests. Final visual verification (Playwright, viewports + themes) + full unit suite + code review. No commit/push without owner approval.
