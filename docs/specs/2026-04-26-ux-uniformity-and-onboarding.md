# UX/UI Uniformity & Onboarding Tour

**Date:** 2026-04-26
**Status:** Draft
**Slice:** #3 of 4 in the "tudo lindo, sem vaporware, premium" final pass.
**Predecessors:** [Slice #1 vaporware audit](./2026-04-26-vaporware-and-honesty-audit.md), [Slice #2 premium AI wiring](./2026-04-26-premium-ai-wiring.md). Both closed.

---

## Problem

Three months of feature shipping have left UX inconsistencies that don't break anything but accumulate as visual debt:

1. **Spinner sprawl.** A grep of `<Loader2.*animate-spin` in `src/components/` returns 75 occurrences across 54 files. ~8 are inside `<button>` / `<Button>` (idiomatic — those stay), but ~26 are full-page or section-level standalones with bespoke styling: different sizes, different tones, different padding. Examples: [CompareSimilarDrawer.jsx](../../src/components/AI/CompareSimilarDrawer.jsx) uses `w-8 h-8 text-indigo-500`, [Dashboard/MigrationActivity.jsx](../../src/components/Dashboard/MigrationActivity.jsx) uses `w-6 h-6 text-slate-400`, [Setup/SystemSetup.jsx](../../src/components/Setup/SystemSetup.jsx) uses `w-5 h-5` with no tone class. The canonical [Spinner / PageSpinner / SectionSpinner](../../src/components/ui/Spinner.jsx) primitives already exist — they're just not consumed everywhere.

2. **Modal-header drift.** The [PageHeader](../../src/components/ui/PageHeader.jsx) primitive is canonical for page-level titles (the docblock explicitly notes the audit found six different H1 sizes). Some modals still hand-roll their own header markup with inconsistent padding, icon treatment, and h1 size. Slice 1 added new modals (QuotaExceededState) that bypassed PageHeader to avoid the heavy Modal primitive — those are deliberate exceptions, but other modal headers can canonicalize.

3. **First-run discoverability.** New users land on the app with no clue that `Cmd+K` opens the command palette, that AI lives in Settings → AI Configuration, or that the Work Board exists. Three of the most valuable features are invisible from the entry surface. There's no onboarding tour, no tooltips, no "what's next" prompt.

4. **Quiet a11y debt.** [Toast.jsx](../../src/components/ui/Toast.jsx#L58) already has `aria-live` (`assertive` for errors, `polite` otherwise). [Modal](../../src/components/ui/Modal.jsx#L92), [ConfirmModal](../../src/components/ui/ConfirmModal.jsx#L23), and [SidePanel](../../src/components/ui/SidePanel.jsx) already use `useFocusTrap`. But **slice 1's QuotaExceededState backdrop in App.jsx** is a hand-rolled overlay with `role="dialog"` and Escape handling, **without focus trap**. The hand-rolled onClick + onKeyDown disable comments admit it. New custom overlays in this slice (the onboarding tour) must use focus trap from day one.

5. **Dark mode + mobile gaps.** Surfaces shipped in March-April (ProbeStatsSection, NotificationsDropdown, Cmd+K Ask mode, AttentionFeed top-3 narratives) were never systematically audited at dark + 390×844. Visual smoke is needed to surface contrast or layout breakage; this slice records findings without necessarily fixing them all.

The sum: a competent app that feels less premium than its features warrant, plus an entirely missing onboarding moment that costs us discoverability for the three highest-value features.

## Goals

1. **Spinner uniformity:** every full-page or section-level loading spinner uses `<PageSpinner />` or `<SectionSpinner />`. Inline icon spinners inside buttons stay as `<Loader2 className="...animate-spin" />` (idiomatic). The lint-style audit produces a **zero remaining standalone Loader2** in `src/components/` outside the `ui/Spinner.jsx` source itself.
2. **Modal-header canonicalization:** every modal that has a header with title + optional description + icon uses `<PageHeader />` (or alternatively the existing Modal `title`/`description` props that internally render PageHeader). The audit lists each modal that doesn't conform and either migrates it or documents why it's an exception (e.g., a small wizard step that doesn't need an h1).
3. **A11y closeout for new overlays:** the QuotaExceededState backdrop in App.jsx gains a real focus trap. Any new dialogs introduced in this slice (onboarding tour) ship with focus trap + Escape + return-focus behavior. Toast aria-live and existing focus traps stay as-is — no regressions.
4. **Onboarding tour:** first-visit users see a 3-step modal carousel introducing Cmd+K (command palette), AI Configuration (Settings → AI), and the Work Board. Skippable at any step, with "Don't show again" persisted to `localStorage`. Re-openable from a hidden Settings → "Re-run onboarding tour" button (so testing/QA stays cheap). Tour does NOT block the app; if the user navigates away the tour closes silently.
5. **Dark + mobile findings doc:** a short `docs/reports/2026-04-26-ux-audit.md` lists each of the 4 surfaces with a screenshot or note per viewport (light/dark × desktop/mobile). Findings that are 1-line fixes get patched in this slice; findings that need more land in slice #4 or a follow-up.

## Non-goals

- **No spotlight/DOM-positioned tour.** Modal carousel only. Spotlight tours need DOM measurement + portal + responsive positioning that doesn't fit the time budget.
- **No new design tokens.** All `ds-*` classes and Tailwind utilities exist already; we consume them.
- **No PageHeader API extension.** Slot props are sufficient.
- **No E2E test for the onboarding tour.** Unit tests cover the carousel state machine; e2e is not gated by this slice.
- **No retroactive `aria-live` audit on every banner or status pill.** Toast and the new tour are the surfaces that matter; the rest is YAGNI for this pass.
- **No replacement of `useFocusTrap` itself.** It works; we just wire it to the QuotaExceededState backdrop.
- **No icon library swap.** Existing Lucide icons stay.

---

## Solution overview

Single spec, three slices, ~3.5h total.

| Slice | Theme | Effort |
|---|---|---|
| **3.1** | Spinner audit + sweep (PageSpinner / SectionSpinner) | ~1.5h |
| **3.2** | Modal-header canonicalization + QuotaExceededState focus trap + UX audit doc | ~45min |
| **3.3** | Onboarding tour (3-step modal carousel + localStorage flag + Settings re-run) | ~1.25h |

Each slice ships independently. Suite green between commits.

---

## Slice 3.1 — Spinner uniformity sweep

### Approach

Two-pass categorization:

1. **Pass A — keep (idiomatic).** Loader2 inside `<button>` / `<Button>` / `<motion.button>`. These are inline icons that complement a button's loading state. Don't touch.
2. **Pass B — replace (standalone).** Loader2 wrapped in a `<div className="flex ... justify-center ... py-N">` (or similar full-section/page wrapper). These all become `<SectionSpinner label="..." />` (default) or `<PageSpinner label="..." />` if the surrounding wrapper uses `min-h-[60vh]` or equivalent viewport-stretching.
3. **Pass C — inline icon (status indicator, not loading).** `Loader2` next to text labels like "Saving…" or "Indexing…" inside cards that are NOT primarily loading screens. These stay as inline `<Spinner size="sm" />` (the bare component, no PageSpinner wrapper). Migrate to keep visual consistency but don't change layout.

### Procedure

```bash
# 1. Enumerate all standalone sites
grep -rn '<Loader2.*animate-spin' src/components/ \
  | grep -v 'ui/Spinner.jsx' \
  > .dev/spinner-sites.txt

# 2. For each line, classify (button / standalone / inline-status).
# 3. Apply replacements per pass.
```

The implementation plan enumerates each file with the exact replacement so the engineer doesn't re-categorize.

### Files (estimated)

Modify: ~20 files across `src/components/` (primarily AI/, Dashboard/, RepoDetail/*, MigrationWizard/steps/*, Settings/*, WorkBoard/tabs/*).

### Tests

- Existing tests stay green (the sweep is visually equivalent — same animation, same default tone).
- New regression test [tests/lint/no-standalone-loader2.test.js](../../tests/lint/no-standalone-loader2.test.js): walks `src/components/` (excluding `ui/Spinner.jsx`), greps for `<Loader2 .* animate-spin` without an enclosing `<button>` / `<Button>` ancestor in the same JSX. Fails if any are found.

The regex-only test is not perfect (it can't reliably parse JSX scope), so it's scoped to a deny-list approach: it counts standalone Loader2 occurrences and asserts the count is zero. If a future feature needs an exception, the engineer adds it to a small `ALLOWED` list with a reason.

### Spinner replacement examples

- `<Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />` inside a `<div className="flex flex-col items-center justify-center py-12 gap-3">` block → replace the whole div with `<SectionSpinner label="Finding similar repos…" />`.
- `<Loader2 className="w-6 h-6 text-slate-400 animate-spin" />` inside a `<div className="flex items-center justify-center py-12">` → `<SectionSpinner padding="py-12" />`.
- Inline status icon like `<Loader2 className="w-3.5 h-3.5 animate-spin" />` next to "Indexing…" text → `<Spinner size="sm" />` (no wrapper).

---

## Slice 3.2 — Modal-header canonicalization + a11y patches + UX audit doc

### 3.2.1 Modal-header audit

Run a grep for hand-rolled headers in modals:

```bash
grep -rn 'isOpen.*onClose' src/components --include '*.jsx' \
  | xargs -n1 -I{} grep -l '<h1\|<h2.*text-xl\|<h2.*text-2xl' {}
```

For each modal with a hand-rolled header that should be a PageHeader:
- Replace the JSX with `<PageHeader title="…" description="…" icon={Icon} actions={…} />` (PageHeader's own padding handles the spacing).
- If the modal already passes a `title`/`description` to the `Modal` primitive's slot props, leave it — Modal's internal header already uses PageHeader-equivalent sizing.

Expected scope: 4-8 modals. Most non-conforming ones are smaller dialogs that don't need full PageHeader treatment — those become an explicit exception list in a comment at the top of the slice's commit.

### 3.2.2 QuotaExceededState focus trap

Currently the backdrop in App.jsx is hand-rolled:

```jsx
<div role="dialog" aria-modal="true" aria-label="Quota exceeded" tabIndex={-1}
  onClick={() => setQuotaModal(null)}
  onKeyDown={(e) => e.key === 'Escape' && setQuotaModal(null)}>
```

It correctly handles Escape and click-outside but has **no focus trap** — Tab cycles through page elements behind the dialog. Fix: wrap the inner `<QuotaExceededState />` in a `useFocusTrap` ref. Either:

a) Refactor to use the `Modal` primitive (cleanest, but Modal has heavy chrome we don't want).
b) Apply `useFocusTrap` directly to the inner div via the existing hook. Cheaper.

Recommendation: **(b)**. The hook signature is `useFocusTrap(isOpen, onClose, opts) -> ref`. Apply it to the inner card.

### 3.2.3 UX audit doc

Create `docs/reports/2026-04-26-ux-audit.md` with sections:

- **ProbeStatsSection** — light/dark/mobile screenshots, findings list
- **NotificationsDropdown** — same
- **Cmd+K Ask mode** — same
- **AttentionFeed top-3 narratives** — same

Each section uses the format:

```md
### Surface name
- **Light desktop:** ✅ pass / 📋 finding
- **Dark desktop:** ✅ pass / 📋 finding
- **Light mobile (390×844):** ✅ pass / 📋 finding
- **Dark mobile (390×844):** ✅ pass / 📋 finding

#### Findings
- [ ] One-line description, severity (low/med/high)
```

The doc itself is the deliverable. 1-line fixes get committed in this slice; bigger findings link to follow-up tickets in slice #4 or a fresh spec.

The screenshots are taken via Playwright MCP at 1920×1080 (desktop) and 390×844 (mobile) — but to keep the slice cheap, the screenshots are saved to `.dev/screenshots/2026-04-26-ux/` (gitignored) and only the markdown findings get committed. If a finding is non-obvious without a picture, drop the picture in `docs/images/`.

---

## Slice 3.3 — Onboarding tour (modal carousel)

### Component contract

```jsx
<OnboardingTour
  isOpen={boolean}
  onClose={() => void}        // also called on "Skip" and on completion
  onNeverShow={() => void}    // wired to localStorage flag setter
/>
```

Renders a 3-step modal carousel using the existing `Modal` primitive (size="md") with `useFocusTrap` already baked in. Each step:

- Icon (Lucide, gradient background like the canonical EmptyState)
- Title (h2, ~text-xl)
- Body (1-2 sentences explaining the feature + a kbd or button hint)
- "Step N of 3" indicator
- Footer: "Skip tour" (left) | "← Back" (when N>1) + "Next →" / "Got it" (right)
- Final step's "Got it" button calls `onNeverShow` then `onClose`
- Keyboard: ←/→ navigate steps, Esc closes (Modal handles Esc → onClose)
- aria-live="polite" announces the active step's title to screen readers

### Step content

| Step | Icon | Title | Body |
|---|---|---|---|
| 1 | `Search` | Press Cmd+K from anywhere | The command palette finds repos, opens settings, and runs AI searches. Try it now or later. |
| 2 | `Sparkles` | Add your AI key in Settings → AI | Power semantic search, README enhance, commit AI, and topic suggestions with your own Gemini key. Free tier works without it but most AI features need a key. |
| 3 | `Layers` | Cross-repo Work Board | One inbox for all your reviews, stale PRs, and DORA metrics across every repo you track. Open from the sidebar. |

(Wording stays in English to match the rest of the app's UI.)

### State machine

```
mount with isOpen=true
  → step=1
  → user clicks Next       → step=2
  → user clicks Next       → step=3
  → user clicks Got it     → onNeverShow(); onClose()
  → user clicks Skip tour  → onNeverShow(); onClose()      (both = "don't show again")
  → user presses Esc       → onClose() only (allow re-open later)
  → user clicks ←          → step=max(1, step-1)
```

The "don't show again" persistence happens on **completion or explicit skip**, not on Esc. Esc means "not now"; completion or skip means "I've seen this".

### `localStorage` key

`grm.onboarding.completedAt` — ISO 8601 timestamp of completion / skip. Read on app mount; if missing, show tour after a 1.5s delay (so the user sees the dashboard for a moment first, then the tour overlays).

A second key `grm.onboarding.lastSeenAt` records every Esc-close so we don't re-show the tour repeatedly within the same session — minimum re-show interval is 6 hours. Tweak in implementation if this feels noisy.

### Settings → "Re-run onboarding tour" button

In the existing AIConfigSection or DangerZoneSection (depending on which feels less crowded — pick in implementation), add a small `Button variant="ghost"` "Re-run onboarding tour" that:

- Clears both localStorage keys
- Dispatches `window.dispatchEvent(new CustomEvent('app:show-onboarding'))`
- The App.jsx-level effect that mounts the tour listens for this event and forces `isOpen=true`

This pattern matches the existing event-based modals (e.g. `app:open-settings`, `app:show-quota-exceeded` from slice 1).

### Files

**Create:**
- `src/components/Onboarding/OnboardingTour.jsx` — the carousel
- `src/components/Onboarding/onboardingSteps.js` — the 3 step definitions (icon + title + body)
- `src/hooks/useOnboarding.js` — wraps localStorage read/write + the 6-hour re-show throttle
- `tests/components/Onboarding/OnboardingTour.test.jsx`
- `tests/hooks/useOnboarding.test.js`

**Modify:**
- `src/App.jsx` — mount `<OnboardingTour isOpen={…} onClose={…} onNeverShow={…} />` at the top level alongside the other modals; add the `useOnboarding` hook call to drive `isOpen`
- `src/components/Settings/AIConfigSection.jsx` (or DangerZoneSection.jsx) — add the "Re-run onboarding tour" button

---

## Architecture — shared concerns

### Event bus consistency

The custom-event-based dispatch (`app:open-settings`, `app:show-quota-exceeded`, new `app:show-onboarding`) is the established pattern. Don't introduce a context-based alternative.

### Test coverage

- Spinner sweep: lint-style guard test catches regressions.
- Onboarding state machine: unit tests for each transition (Next, Back, Skip, complete, Esc).
- localStorage flag: unit test for `useOnboarding` (mounts, reads stored value, sets stored value on `markComplete`).
- a11y: unit test that the tour modal has `role="dialog"` and the active step has `aria-live="polite"`.

### Failure modes

| Scenario | Handling |
|---|---|
| localStorage disabled (Safari private, etc.) | `useOnboarding` falls back to in-memory state for the session; tour shows once per session reload (acceptable degradation) |
| User rapidly clicks Next | step state debounced via React's batched updates; no race |
| Tour mounted in test that doesn't isOpen | Component unmounts cleanly; no localStorage write |
| Settings "Re-run" clicked while tour is already open | Event handler is a no-op when `isOpen` is true |

---

## Testing strategy

### Unit tests (Vitest + RTL)

- `OnboardingTour` — Skip button, Next/Back, "Got it" calls onNeverShow, Esc only calls onClose.
- `useOnboarding` — localStorage read/write, 6-hour throttle, fallback when storage throws.
- Spinner sweep regression — see above.

### Manual visual QA before committing slice 3.3

- Open the app in fresh browser profile (or clear localStorage), confirm tour appears after ~1.5s.
- Navigate steps with both buttons and arrow keys.
- Complete tour, refresh page, confirm tour does NOT re-appear.
- Visit Settings → click "Re-run onboarding tour", confirm it re-appears.

### Suite green between commits

Same standard as slices 1 & 2: `npx vitest run` must pass after every commit.

---

## Shipping order

1. **Slice 3.1** — spinner sweep first. Lowest risk, mostly mechanical, builds discipline-by-default for the rest.
2. **Slice 3.2** — modal headers + a11y + audit doc. Mid-effort, surfaces UI bugs that the tour might collide with.
3. **Slice 3.3** — onboarding tour. Greenfield, biggest user-facing impact, last so it lands on a clean baseline.

Each slice: commit + push + suite green.

---

## Success metrics

- **Zero** standalone `<Loader2.*animate-spin>` in `src/components/` (excluding `ui/Spinner.jsx` itself); buttons exempt.
- **Zero** modals with hand-rolled headers that should use PageHeader (exceptions documented in code comments).
- **One** focus trap added to QuotaExceededState backdrop.
- **One** UX audit doc committed at `docs/reports/2026-04-26-ux-audit.md`.
- **One** onboarding tour primitive shipped + wired + tested.
- **No regressions** — `npx vitest run` ≥ 2712 passing (current baseline + new tests added by this slice).
- **Build honesty test still green** — `RUN_BUILD_TESTS=1 npx vitest run tests/build/` 21+ passing.

---

## Open questions

1. **Settings location for "Re-run onboarding tour" button.** AIConfigSection vs DangerZoneSection. Resolved at plan-time by reading both for current density.
2. **Initial-show delay tuning.** 1.5s is a guess. If the dashboard doesn't render that fast, the user sees the tour overlay an empty page. Implementation may switch to "show after first successful repo fetch" to feel more grounded.
3. **Modal size for the tour.** `md` (max-w-lg) is sensible for 3 step cards; if step 3's body grows, switch to `lg`. Cheap to change.

These resolve during the implementation plan.
