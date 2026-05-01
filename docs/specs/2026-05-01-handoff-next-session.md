# UX Uniformity Initiative — Handoff for next session

**Date:** 2026-05-01
**Owner:** Bruno
**Purpose:** Bridge document so a fresh agent session can resume the 5-slice UX uniformity initiative without re-reading the full chat history.

---

## What this initiative is

Make the entire app feel "premium and connected" via 5 focused slices. Originally requested via a multi-paragraph user message + screenshots; decomposed during brainstorming into:

| # | Slice | Status | Branch / commits |
|---|---|---|---|
| 1 | Action Surface Unification | ✅ **Shipped** | `feat/action-surface-unification` (PR pending) — 19 commits, registry of 31 actions, runner, all surfaces wired, tests green |
| 2 | Intent affordances audit | ✅ **Shipped** | `feat/intent-affordances-audit` (PR pending) — 3 commits. Audit revealed only 3 destructive offenders (vs 24 specced); all already used valid project confirm patterns (`setConfirmAction`/`setConfirmOpen`/`<ConfirmModal>` + 1 in-card flow with allow comment). Foundation: `useDangerAction` hook + lint guard. |
| 3 | Dashboard wiring | ⚠️ **Part 1 shipped** | On `main` (commit `06698e5`) — StatCards interactive, 8/8 wired. Part 2 (deeper dashboard interactivity) not yet specced. |
| 4 | AI auto-fix Community Health | ✅ **Shipped** (Tasks 1–8 + 11) | `feat/community-health-ai-autofix` (PR pending) — 9 commits, 44 tests green, full suite 2860/2860. Tasks 9 (registry entry) and 10 (e2e) deferred — see follow-ups. Spec: [`2026-05-01-community-health-ai-autofix.md`](2026-05-01-community-health-ai-autofix.md) · Plan: [`../plans/2026-05-01-community-health-ai-autofix.md`](../plans/2026-05-01-community-health-ai-autofix.md) |
| 5 | Mobile parity sweep | ⚠️ **Phase 1 shipped** | `feat/mobile-parity-sweep` (PR pending) — 4 commits. Primitives shipped: `useViewportSafeHeight`, `<MobileFAB>`, `<ModalSticky>` (12 tests). Wirings: toast width clamp, MobileFAB→command palette, Dashboard StatCards stack 1-wide. Tasks 4–13 (Sidebar drawer, RepoFilterBar sheet, RepoDetail tabs/Settings, WorkBoard mobile, SettingsModal sections, ModalSticky migration of existing modals, MigrationWizard sweep) and Task 14 (Playwright mobile smoke) queued for follow-up. |

Plus a one-off bug fix (`b9e093a` on main) that landed during the planning session: AI quota errors now render friendly messages instead of dumping raw Google RPC errors. This fix introduces a pattern reused in slice 4.

---

## Where to start in a fresh session

### Recommended order

**Slice 4 next** (AI auto-fix Community Health) — biggest user-visible impact, was the original screenshot the user showed. Self-contained: doesn't require slice 1 to be merged (one optional registry entry in Task 9 is gated on slice 1).

After slice 4: **slice 2** (small audit, polish), then **slice 5** (mobile sweep, polish). Slice 3 part 2 — only if usage signals show people clicking through dashboard but not finding what they need; otherwise slice 3 is "good enough" today.

### Quick-start for the next agent

1. Read this handoff (you're here).
2. Read the spec for the slice you're starting.
3. Read the plan for the slice you're starting.
4. Confirm the worktree setup if isolating work — slice 1's worktree is at `s:/ghrm-worktree-action-surface`. For new slices, create a fresh worktree: `git worktree add s:/ghrm-worktree-<slice> -b feat/<slice>`.
5. Use `superpowers:subagent-driven-development` to execute the plan task-by-task. The plan is structured so each task is mergeable in isolation with a clear commit message.

### Existing reference implementations

Slice 1's shipped work is the model:
- **Spec:** [`docs/specs/2026-05-01-action-surface-unification.md`](2026-05-01-action-surface-unification.md)
- **Plan:** [`docs/plans/2026-05-01-action-surface-unification.md`](../plans/2026-05-01-action-surface-unification.md)
- **Branch:** `feat/action-surface-unification`
- **Foundation files** all on the branch:
  - `src/actions/repoActions.js` — registry pattern
  - `src/actions/runAction.js` — dispatcher pattern
  - `src/actions/repoActionContext.jsx` — DI hook with `confirmGate` Promise wrapper
  - `src/utils/repoMutations.js` — pure HTTP helpers extracted from `useRepos.js`

Slice 3's interactive StatCard (`06698e5`) is the model for "make passive UI interactive":
- `src/components/Dashboard/StatCard.jsx` — `onClick` + `hint` opt-in, zero regression for non-interactive callers
- `src/hooks/useRepoFiltering.js` — accepts `initial` filter seed for navigation hand-offs

The AI quota fix (`b9e093a`) is the model for friendly AI errors:
- `src/components/WorkBoard/AISummaryCard.jsx` — `friendlyAiError({ status, body })` translator
- `server/routes/work-board-actions.js` — server-side AIError → HTTP mapping

Slice 4's plan calls for extracting both into shared utils: `src/utils/aiErrorFriendly.js` and `server/middleware/ai-error-mapper.js`. Doing that extraction in slice 4 Task 5.4 is mandatory — both should be reused, not duplicated.

---

## Cross-cutting decisions already locked

These came up during slice 1 brainstorming and apply to all remaining slices unless explicitly overridden:

1. **Confirmation policy:** modal-based via `<ConfirmModal>`. **No** toast-with-Undo in any Phase 1 slice. Toast-Undo is a deferred standalone spec (out of scope for slices 2-5).
2. **Variant naming:** `'info' | 'warning' | 'danger'` per `<ConfirmModal>` literal. NOT `'destructive'` — the spec for slice 1 originally used that name; the plan corrected it.
3. **Mobile context menu trigger:** explicit `MoreHorizontal` button. **No** long-press gesture handling.
4. **Tests:** Vitest unit/component, Playwright e2e. Tests live in `tests/` mirroring `src/`. Server tests in `server/__tests__/`.
5. **Commits:** Conventional Commits format. **NEVER** add `Co-Authored-By` lines (per `CLAUDE.md`).
6. **Branch model:** feature branches off `main`. Direct push to `main` IS authorized when the user asks (per memory `feedback_push_on_request.md`).

---

## Open risks / known unfinished work

### From slice 1 execution

- **E2E tests (Tasks 19+20)** were skipped because the project lacks a complete mock-mode setup for Playwright. If/when that infra lands, those tests can be retroactively added — they're listed in [the slice 1 plan](../plans/2026-05-01-action-surface-unification.md).
- **Slice 1 PR not yet merged.** Slice 4's Task 9 (registry entry) is gated on it.

### From the AI quota fix

- The `friendlyAiError` is currently inline inside `AISummaryCard.jsx`. **Slice 4 Task 7.3 is responsible for extracting it.** If a different slice lands first that also needs friendly AI errors, do the extraction there instead.

### From slice 3 part 1

- StatCards filter via `viewParams.initialFilters` work for `visibility` and `archived` filters. The `initialSort` mechanism is **NOT yet wired** — the `Total Stars` and `Total Forks` cards navigate but don't apply a sort. Add sort-seeding to `useRepoFiltering` if needed (probably tiny — same pattern as `initial.type`).
- The "Commits (7d)" card navigates to Work Board but doesn't seed a time range. Same fix pattern.

### Cross-cutting

- **Pre-existing lint test failure:** `tests/lint/no-standalone-loader2.test.js` fails on `MigrationHistory.jsx` and `InlineEditField.jsx`. These are part of the user's separate work-in-progress (uncommitted in the main repo). Don't touch them in this initiative.

---

## How to bootstrap a new session

If you're an agent reading this for the first time:

1. **Confirm the working environment:**
   ```bash
   cd "s:/Git Hub Repo Manager"
   git status --short    # expect uncommitted user work-in-progress; ignore those files
   git log --oneline -10 # recent activity
   ```

2. **Pick a slice from the table at the top.** Read its spec + plan in full.

3. **For execution, follow this pattern:**
   - Worktree if isolating: `git worktree add s:/ghrm-worktree-<name> -b feat/<name>`
   - Or work on `main` directly if changes are small + reviewed
   - Use `superpowers:subagent-driven-development` for multi-task plans
   - Use `superpowers:executing-plans` if staying inline

4. **At the end of each task:** mark it complete in the plan checklist (`- [x]`), commit with the message specified, then move to the next.

5. **At the end of each slice:** push, open PR, update this handoff doc to mark the slice ✅.

---

## Memory pointers

The user's memory at `C:\Users\bruno\.claude\projects\s--Git-Hub-Repo-Manager\memory\` has relevant context:

- `MEMORY.md` — index
- `feedback_push_on_request.md` — push to main authorized
- `feedback_avoid_long_local_tests.md` — don't run full e2e suites locally; push and let CI validate
- `feedback_vite_inline_dce_guards.md` — inline DCE guards for `import.meta.env.DEV`
- `feedback_git_add_check_artifacts.md` — `git status --short` before `git add -A`
- `project_agpl_license.md` — open-core licensing model
- `project_support_email.md` — contact uses `bruno@bolalabs.pt`

Do not invent content beyond what these say. If the user mentions something contradicting memory, trust the user (memory is point-in-time).

---

## What "done" looks like for the whole initiative

The user originally asked for: *"premium tudo interligado, funcional, sem erros. lindo. em desktop e Mobile."*

Concretely, after all 5 slices ship:
- **Discoverable**: every action available from at least 2 entry points (slice 1).
- **Predictable**: every destructive action confirms with the same shape (slices 1+2).
- **Connected**: dashboard cards lead somewhere meaningful (slice 3); Community Health offers fixes, not just diagnoses (slice 4).
- **Mobile-equivalent**: every flow works on a phone (slice 5).
- **Honest about errors**: AI failures show "AI provider quota exceeded — retry in 14s" instead of dumped RPC JSON (already shipped via `b9e093a`).

That's the win.
