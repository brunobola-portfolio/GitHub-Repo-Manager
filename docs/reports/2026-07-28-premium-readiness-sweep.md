# Premium-readiness sweep — 2026-07-28

Status of the open-PR triage, one shipped fix, and the findings from three
audit lenses. Two lenses (premium gating/metering, client↔server contract
sweep) and two follow-ups (vaporware, docs drift) were **cut short by a
session limit and never ran** — they are listed under "Not yet covered" so
nobody mistakes their absence for a clean bill.

Everything below was verified by reading the implementation. Nothing here is
inferred from naming.

---

## 1. Shipped in this pass

**`fix(pr-review): AI review summary 400'd on every call`** (317bc568)

`POST /api/ai/review-summary` had never once worked outside mock mode.
`useReviewAI` sent `topFilePatches` as a joined string; `aiReviewSummarySchema`
requires an array of `{filename, patch}` and the handler maps over it. Zod
rejected every request, so the panel always rendered "Something went wrong ·
PR review" with a Retry that could not succeed.

Why tests never caught it: they mock `apiCall`, so they only ever assert the
client against itself. `tests/ai-request-contracts.test.js` now runs the real
builder output through the real server schema. **Add every new AI route's
payload builder to that gate.**

Also closed in the same payload: unbounded `fileManifest` (schema caps at 500,
so big PRs 400'd rather than degrading), `topFilePatches` sliced before
filtering for a patch, and `prMetadata` omitting `repo`/`number` — every
review summary was written to the audit trail against an undefined repo.

Plus an InboxPanel deflake — see §3.

---

## 2. CI: branch protection is broken by the sharding change

**This blocks every new PR and needs an owner action.**

Required status contexts on `main` are `lint`, `test`, `build`, `e2e`
(`gh api repos/:owner/:repo/branches/main/protection`). The sharding commit
(7e495f52) renamed the aggregate jobs to **`test (merge + coverage floors)`**
and **`e2e (merged report)`**. GitHub matches protection on the check-run
*display name*, so the contexts `test` and `e2e` will never report again.

Consequence: PR #273 sits at `mergeStateStatus: BLOCKED` with zero failing
checks, and so will every future PR. The open dependabot PRs only escape
because they were branched before the rename.

**Recommended fix:** rename the two aggregate jobs' `name:` back to exactly
`test` and `e2e` in `.github/workflows/ci.yml`. The shards keep their
descriptive names. This restores the gate with no settings drift, versus
editing protection to track the new strings.

One owner action is unavoidable either way, because the fix PR is itself
blocked by the thing it fixes: admin-merge that one PR, or update the two
contexts once in settings.

### 2b. A false-green hole in the same workflow

`e2e (merged report)` explicitly fails on a red shard
(`.github/workflows/ci.yml:263-266`). **`test (merge + coverage floors)` has no
equivalent step** — it relies on `vitest --merge-reports` exiting non-zero.
That covers a shard whose tests failed, but not a shard that died before
producing a blob (runner loss, `npm ci` failure). With `if: always()`, the
merge job would then evaluate two thirds of the suite and pass. Mirror the
e2e guard.

### 2c. `package-and-smoke` never sees dependency bumps

`.github/workflows/windows-package.yml:11-16` filters on `packaging/**`,
`scripts/package-windows.mjs`, `scripts/first-run.mjs` and the two workflow
files. A `better-sqlite3` major bump changes the **native module bundled into
the Windows installer** and does not touch any of those paths, so the only job
that validates packaging never runs. Add `package.json` and
`package-lock.json` to the filter.

---

## 3. Open PRs — triage

Verified against the latest run for each, per the merging discipline in
CLAUDE.md.

| PR | Bump | Verdict |
|---|---|---|
| #273 | windows self-update fix (ours) | All checks green incl. `package-and-smoke`. Blocked only by §2. |
| #272 | postcss 8.5.23 | Green — safe |
| #262 | prod-minor group (20) | Green — safe |
| #263 | dev-minor group (14) | Green — safe |
| #266 | @testing-library/jest-dom 7 | Green — safe |
| #265 | **better-sqlite3 13** | Green but **unvalidated** — see §2c. Widen the smoke filter first. |
| #267 | **connect-redis 10** | Green but CI never runs it — see below |
| #269 | **rate-limit-redis 6** | Same, plus a two-major jump |
| #264 | lint-staged 17 | Failed on the InboxPanel flake, not the dep. Fixed in 317bc568. |
| #268 | eslint 10 | **Cannot merge** |
| #270 | @eslint/js 10 | **Cannot merge** |

**#268 / #270 are hard-blocked**, not flaky: `eslint-plugin-jsx-a11y@6.10.2`
declares `peer eslint@"^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9"`, so `npm ci`
dies with ERESOLVE in ~10s. Nothing to do until jsx-a11y ships v10 support.
Close them or add a dependabot ignore for eslint majors.

**#267 / #269 have a green CI that proves nothing.** `REDIS_URL` appears in no
workflow and in no test env, so neither `server/lib/session-store-redis.js` nor
the Redis branch of `server/middleware/tenant-rate-limit.js` executes in CI.
Both are majors on a security-relevant path (session store, rate limiting).
`session-store-redis.js:4` still documents "connect-redis v9 + node-redis v5".
Write a test that actually exercises `RedisStore` before merging either.

**#269 / #264 failed on a real flake, now fixed.** Both died in
`InboxPanel.test.jsx` on *different* test cases; the file passes 20/20 locally,
8 runs in a row. Root cause: the keydown listener mounts immediately but
returns early while `active.items` is empty
(`src/components/Dashboard/Premium/InboxPanel.jsx:130`), so a key pressed in
that window is swallowed with nothing to retry it.

Worth internalising from that fix: three of those tests asserted a *negative*
behind `await new Promise(r => setTimeout(r, 0))`, which passes just as happily
against a listener that never fired — permanent false greens. They now
cross-check via the other shortcut. The first attempt used `e` twice and the
mutation survived, because `e` archives optimistically so the second press
finds an empty section and no-ops. **Negative assertions need a barrier that
does not disturb the state they are measuring, and the only way to know you
have one is to mutate the guard and watch the test go red.**

---

## 4. Accessibility — contrast debt, classified

The inverted muted pair `text-slate-400 dark:text-slate-500` fails AA in both
themes (2.56:1 light, 3.74:1 dark). **137 occurrences: 95 TEXT (fix), 41 ICON
(leave — they pass the 3:1 non-text threshold), 1 dead style.** A blind
find-and-replace would regress the 41 icons. Replacement for every TEXT hit is
`text-slate-500 dark:text-slate-400`.

Full per-file classification is in the audit transcript; the load-bearing part:

**Highest leverage — one edit each, many screens:**
- `src/components/ui/Select.jsx:312` — placeholder of *every* shared Select
- `src/components/ui/form/Field.jsx:69` — `(optional)` on *every* shared Field
- `src/components/ui/Select.jsx:398` — option-group headers

**Three are live-region text**, i.e. exactly what a low-vision user needs:
`security/SecurityScanModal.jsx:157`, `Settings/AzureCredentialsSection.jsx:586`,
`MigrationWizard/steps/SourceStep/OrgField.jsx:78`.

**Latent, inside axe-scanned views** — one data change from turning CI red:
`MigrationWizard/Steppers.jsx:138, 227, 358, 365`, `Pricing/PricingPage.jsx:378`,
`RepoList/RepoCard.jsx:273`, `Dashboard/AttentionFeed.jsx:300`,
`Dashboard/WhatNeedsYouGrid.jsx:101`, `ui/AIQuotaMeter.jsx:126`.

**A second untracked pair, worse:** `text-slate-400 dark:text-slate-600`
(2.56:1 / 2.19:1) at `Dashboard/WhatNeedsYouGrid.jsx:87`,
`MigrationWizard/Steppers.jsx:147, 151`, `PRReview/AIDeepReview/AIReviewPanel.jsx:67`.
`Steppers.jsx:151`'s `hint` is `text-slate-300 dark:text-slate-700` — **1.74:1**,
the worst in the codebase.

**Text on fills:** white on `bg-amber-600` is 3.18:1 —
`PRReview/AIDeepReview/PublishReviewModal.jsx:10`,
`PRReview/DiffPanel/DiffComputeOnDemand.jsx:48`, `ui/Button.jsx:8` (warning
variant), `ui/OfflineBanner.jsx:27` (amber-500, 2.5:1),
`MigrationWizard/Steppers.jsx:150` (`bg-amber-400 text-white`, **2.0:1**).
Fix: `bg-amber-700`, or keep the fill and use `text-slate-900`.

**Also:** 329 bare `text-slate-400` with no dark pair across 158 files need the
same TEXT/ICON triage. Risk tokens came back clean — every text surface
correctly uses `riskTextClass`.

**The scan is narrower than it looks.** AGENTS.md says twelve views; the
`VIEWS` array has 12 and PR Review is scanned separately in
`e2e/pr-review.spec.js`, so 13. But a scanned view only covers what renders by
default — dropdowns, modals, non-default tabs and conditional branches inside a
scanned view are as ungated as an unscanned one. Both docstrings
(`e2e/a11y-smoke.spec.js:21` "ten", `e2e/a11y-helpers.js:16` "nine") are stale.

**Guardrail worth adding:** nothing enforces the pair, which is why the debt
exists. Extend the prebuild CSS-class guard to reject the inverted pair on
anything that is not a lucide component or `aria-hidden`. Without it this pass
gets redone in six months.

### PR Review a11y — would hard-fail if the state were reached
- `AIDeepReview/AIInlineComment.jsx:48, 88` — `aria-label` on a roleless
  `<div>` (`role=generic`) is prohibited; axe `aria-prohibited-attr`, serious.
- `ReviewToolbar/ReviewToolbar.jsx:209-225` — `role="menu"` containing a
  `<label>` + `<textarea>`; `aria-required-children`, serious. It is not a
  menu — drop the roles.
- `ReviewToolbar/ReviewStatusBar.jsx:58` — `aria-live` on the `<footer>` *and*
  on the sr-only summary at `:119-122`, whose own comment explains why the
  footer must not carry it. Every "mark viewed" narrates the whole footer
  twice. Delete the one on line 58.
- `AIDeepReview/PublishReviewModal.jsx:82-96` — `sr-only` radios with no
  `focus-within` ring: invisible focus, WCAG 2.4.7.
- `ReviewToolbar.jsx:109` — Escape closes the dropdown without returning focus
  to the trigger.
- No `<h1>`/`<h2>` in the whole view; first heading is `<h4>`. The PR title is
  a `<span>` in the breadcrumb (`ReviewToolbar.jsx:61`).
- `CommentsListTab.jsx:46` and `AIReviewPanel.jsx:229` use `×` / `↻` glyphs as
  accessible names.
- `WalkthroughTab.jsx:115` — injected Mermaid SVG has no text alternative.

Credit where due: the `FileTree` `aria-activedescendant` implementation is
correct, and there are **no** non-semantic clickable divs anywhere in PR Review.

---

## 5. Error and empty states — the systemic defect

The orange "Something went wrong · PR review / contact bruno@bolalabs.pt" box
was **two bugs stacked**. §1 fixed the payload. The second is still open and
will render identically for the next deterministic 400 anywhere in the app:

**`validation_failed` is not in `KNOWN_ERRORS` or `CODE_ALIASES`**
(`src/utils/errors.js:104-303, 330-359`), and `formatUserError`
(`:439-460`) has status heuristics for **only 401, 429, 413** — no branch for
400, 403, 404, 422 or 5xx. The server emits **101 distinct `code:` values;
roughly 55 are unmapped**, so over half the error vocabulary lands on
"Something went wrong" + a Retry button.

**Fix first (retires the archetype everywhere):** add a status fallback ladder
to `errors.js` — 400/422 → non-retryable "we couldn't send that request";
403 → permission/upgrade; 404 → not found; 409 → terminal — and map at minimum
`validation_failed`, `INVALID_PARAM`, `csrf_invalid`, `AI_COST_CAP_REACHED`,
`tier_limit_exceeded`, `MIGRATION_QUOTA_EXCEEDED`, `INSUFFICIENT_PERMISSIONS`.

### The worst single finding: a bad AI key signs the user out

`routes/ai/dev-toolkit.js:199` routes its catch through
`mapAIErrorToResponse`, which returns **401** for a provider auth failure
(`middleware/ai-error-mapper.js:60`). Client-side, 401 →
`categorizeError` (`src/utils/api.js:248-250`) → `notifySessionExpired()` →
`window.location.href = '/?error=session_expired'` plus a module-level latch
that short-circuits every later request.

So "your BYOK key is wrong" is presented as "your session expired, you've been
signed out". `ai/shared.js:60` deliberately uses **422** for the same
condition to dodge exactly this; the legacy mapper was never updated, which
also makes the correctly-mapped `ai_auth → INVALID_API_KEY` entry
(`errors.js:335`) unreachable on these routes. The DEV+mock guard at
`api.js:88` is why it never reproduces in e2e. **Change the mapper to 422.**

Also: `AI_COST_CAP_REACHED` (`middleware/work-board-ai-gate.js:40`) is a 429,
so the rate-limit heuristic tells the user "too many requests, try again
shortly" for what is a **monthly budget cap**. `AI_SPEND_CAP_REACHED` is
mapped correctly — mirror it.

### Honesty violations — the ones that matter most given the product value
- **`Dashboard/ActivityChart.jsx:14-24`** — with no activity the chart renders
  **fabricated data**: a drawn three-series trend showing 41 commits, 13 PRs,
  7 issues that do not exist, unmarked. Every new or quiet account sees this.
- **`useYourWork.js:31-33`** + `Dashboard/WhatNeedsYouGrid.jsx:162-168` —
  every failure is caught into `{count: 0}` with `status: 'ready'`, so with all
  three endpoints down the grid states **"You're all caught up. Nothing needs
  you right now."** A false all-clear.
- **`MigrationHistory.jsx:106, 128`** — load failure renders "No migration
  plans yet". `Dashboard/MigrationActivity.jsx:53` gets this right next door.
- `useRepoNameConflicts.js:74` and `TargetConfigStep.jsx:56` — a failed
  conflict check is indistinguishable from "name is free".

### Bricked / crashing
- **`Dashboard/AttentionFeed.jsx:91-99`** — `.then()` with no `.catch()`. On
  rejection `setLoading(false)` never runs, so the card spins forever and its
  Refresh button is `disabled={loading}` — permanently. Needs a reload.
- **`AIPrompts/PromptStudioPage.jsx:90`** — renders `{studio.error}` where
  `usePromptStudio.js:58` does `setError(err)` with an Error **object**. React
  throws "Objects are not valid as a React child" → the whole page crashes to
  the error boundary on any preset-load failure.
- **`MigrationWizard/StepRenderer.jsx:132, 139, 146, 178, 189`** — five
  `.catch(() => {})` on destructive migration recovery, including "Replace &
  retry" which deletes the target repo first. An expired PAT produces no toast,
  no spinner, no state change: a dead button on the highest-stakes screen.

### Double-submit on primary actions
- **`PRReview/ReviewToolbar/ReviewStatusBar.jsx:132-160`** — Approve / Comment
  / Request changes have no `disabled`, no pending state, no spinner, and the
  component does not even accept a `submitting` prop. `max-md:flex-1`, so on
  mobile these are the full-width primary affordance. Two taps posts two
  GitHub reviews. `ReviewToolbar.jsx:184, 234` does it right with the same
  handler.
- **`MigrationWizard/steps/TargetConfigStep.jsx:171-181`** — two clicks, two
  imports. `useWizardNavigation.js:42-43` tracks `importing` but never threads
  it back.

### Raw leakage
`MigrationWizard/steps/ProgressStep.jsx:126` and `SimpleProgressStep.jsx:441,
562` render raw `task.error_message` — git stderr, **which can contain the
source URL with an embedded credential**. `useReviewData.js:49` →
`PRReviewView.jsx:353` flattens `ApiError` to `e.message`, and
`safeParseJson` (`src/utils/api.js:529`) throws `'Invalid JSON: ' +
txt.slice(0,500)`, so a proxy HTML error page prints 500 chars of raw HTML onto
the PR Review screen. Server-side, `routes/user-ai-config.js:286` returns the
raw provider exception plus `upstreamRaw` **with HTTP 200**.

### Wrong recovery affordance
`ui/AIErrorState.jsx:45-47, 99` labels itself "Retry" and calls
`onRetry?.()` when no action is mapped — with no handler passed, that is a
visible, focusable button that does nothing. It is the generator behind several
findings. `PRReview/AIDeepReview/ChatTab.jsx:86` is a literal
`onRetry={() => {}}`. `AI/CommunityHealthFixModal.jsx:166-175` retries a
*commit* failure by re-running generation, discarding the reviewed diff and
burning another AI call.

### Consistency
`formatUserError`, `AIErrorState` and `QuotaExceededState` have **zero imports
anywhere under `src/components/MigrationWizard/`** — all 13+ error surfaces
there are hand-rolled. Four byte-identical bespoke red divs handle "commit
failed" (`AI/AgentRulesModal.jsx:289`, `AI/DiagramGenerator.jsx:520`,
`AI/ImageGeneratorModal.jsx:246`, `AI/ReadmeStudioModal.jsx:436`) — **all four
already use `AIErrorState` for the generate error two screens earlier**.

Best-in-class references to copy: `AIDeepReview/AIReviewPanel.jsx:30-109`
(skeletons mirroring final layout, honest elapsed-seconds narration, explicit
refusal to fake progress) and `ProgressStep.jsx:372-375` (the best error copy
in the codebase).

### Copy
`MigrationWizard/steps/SourceStep/PatPasteGuide.jsx:344` is the **only
Portuguese user-facing string in `src/`** — a rendered `<summary>` reading
"Alternativa por CLI (az devops)". `errors.js:307` hardcodes
**`bruno@bolalabs.pt`** as the shipped escalation path.

---

## 6. Dead UI — promises with nothing behind them

`emitAppEvent` returns silently when nothing is registered
(`src/utils/appEvents.js:101-103`), which is how these shipped.

**Command palette — 18 commands with no listener.** Worst: the "Work Board
Actions" group (`CommandPalette.jsx:387-389`) renders in **every view** and
`runWorkBoardCommand` falls through to `toast.success(\`${item.label} ✓\`)`
at `:399`. The user sees **"Clear Work Board filters ✓"** and nothing happened.
Also 6 `repos:*` commands, 7 `repo-detail:*`, 2 `teams:*`. For contrast,
`workboard:go-tab` and all `pr-review:*` commands are correctly wired.

**`WorkBoard/KeyboardHelpModal.jsx:4-24` advertises 8 shortcuts that do not
exist.** Only `j`, `k`, `Escape`, `?`, `⌘K` work. `Enter` is documented but
`useFocusedRow` is called with no `onOpen`. Arrow keys are not bound. Worst:
**`r` is documented as "re-request review" but is globally bound to "Go to
Repositories"** (`src/config/keyboardShortcuts.js:45`) — pressing it navigates
you off the Work Board. A `useRowNavigation` hook that supports arrows exists
and is imported by nothing.

**`SettingsModal.jsx:290-297, 304-316`** — "Default visibility for imports" and
"Max retries for failed tasks" persist to localStorage and toast "Settings
saved". Nothing reads them: the wizard hardcodes `visibility: 'private'`
(`useEnrichedRepos.js:55, 81`) and retries come from `maxRetries: 3`
(`src/utils/api.js:320`). Their two neighbours in the same panel *are* wired,
which makes it worse.

**`Header.jsx:709-720`** — "Failed migrations" notification rows get
`href="#"` with no `preventDefault`. The app is hash-routed, so
`useAppRouter.js:65` maps `'#'` → dashboard and clears `selectedRepoDetail` /
`reviewingPR`. Clicking a failure alert **throws you out of whatever repo or PR
review you were in** and never shows the failure.

**`RepoDetail/PRFilesTab.jsx:32-33`** — `collapsed={false}` and
`onToggle={() => {}}`, while `AISummaryPanel.jsx:55-66` renders a real button
with a chevron and `aria-expanded` that never changes.

**`AI/CommunityHealthFixModal.jsx:151-161`** — the "Configure AI" CTA emits
`{ section: 'ai' }` but `useAppEventBridge.js:87` reads `tab`, so Settings
opens on General. Every other emitter in the codebase uses `tab`.

**`WorkBoardPage.jsx:186-191`** — "Save current filters as preset" toasts
"Use the Presets dropdown in the filter bar to save…". **`OrgSidebar.jsx:119-127`**
— avatar button with hover state and tooltip, no `onClick`.

The agent also cleared ~10 look-alikes (`StepRenderer` pause/cancel,
`LicensePlanSection` buttons that bubble to a `Card onClick`, the
"coming soon" pricing rows) — those are correct and should not be re-flagged.

---

## 7. Not yet covered — do not read absence as clean

| Lens | Status |
|---|---|
| Premium gating / metering / revenue leak | **Never ran** (session limit) |
| Client↔server contract sweep across ~90 `validateBody` routes | **Never ran** — only the one route in §1 is verified |
| Vaporware: tier claims vs `TIER_FEATURES`, purchase path | **Never ran** |
| Docs / README drift | **Never ran** |

The contract sweep is the highest-value of the four: §1 proves the bug class
is real and shipped, and nothing has checked the other ~89 routes.

---

## Suggested order

1. §2 — rename the two CI jobs so PRs can merge at all (needs one owner merge)
2. §2b, §2c — close the two false-green holes
3. Merge #272, #262, #263, #266; close #268/#270
4. §5 — `ai-error-mapper.js:60` 401 → 422 (a wrong key logs users out), then
   the `errors.js` status ladder
5. §5 — `ActivityChart` fabricated data, `AttentionFeed` bricked spinner,
   `PromptStudioPage` crash, `useYourWork` false all-clear
6. §6 — delete or wire the dead commands; fix the `r` shortcut collision
7. §4 — contrast, highest-leverage shared primitives first, plus the lint
   guardrail so it does not regrow
8. Redis test, then #267/#269; smoke filter, then #265
9. Re-run the four lenses in §7
