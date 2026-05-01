# UX Uniformity Initiative — Handoff for next session

**Last updated:** 2026-05-01 (end of session)
**Owner:** Bruno
**Status:** All 5 slices merged into `main`. Follow-ups documented below.

This is the canonical entry point for any new agent session resuming the UX uniformity initiative. Read it first; act from it.

---

## 1. What was done in the last sessions

| # | Slice | Status | Where it lives |
|---|---|---|---|
| 1 | Action Surface Unification | ✅ Merged via [#31 (synthesis)](https://github.com/brunobola-portfolio/GitHub-Repo-Manager/pull/31) | commit `de076b3` on main |
| 2 | Intent affordances audit | ✅ Merged via [#28](https://github.com/brunobola-portfolio/GitHub-Repo-Manager/pull/28) | commit `ed0c0a8` on main |
| 3 | Dashboard wiring | ⚠️ Part 1 only on main | commit `06698e5` on main |
| 4 | AI auto-fix Community Health | ✅ Merged via [#29](https://github.com/brunobola-portfolio/GitHub-Repo-Manager/pull/29) (Tasks 1–8 + 11) | commit `b9f2a58` on main |
| 5 | Mobile parity sweep | ✅ Merged via [#30](https://github.com/brunobola-portfolio/GitHub-Repo-Manager/pull/30) (Phase 1+2 = 6/17 audit rows) | commit `cd5086c` on main |
| — | AI quota friendly error | ✅ Merged | commit `b9e093a` on main (predates the 5 slices, related util) |
| — | User WIP feature work | ✅ Merged via stash-pop | commit `60e52f9` + recovery `93fbe1f` on main |

**Tests on main now:** **3002 passing / 3027 total** (24 skipped, 1 pre-existing fail). The 1 fail is `tests/lint/no-standalone-loader2.test.js` flagging two files in the user's WIP — listed in section 5 below.

**Specs + plans for each slice** are at `docs/specs/2026-05-01-*` and `docs/plans/2026-05-01-*`. Each task in the plans has line-by-line code + test snippets.

---

## 2. Cross-cutting decisions already locked

These came up during slice 1 brainstorming and apply to all remaining work:

1. **Confirmation policy:** modal-based via `<ConfirmModal>` from `src/components/ui/ConfirmModal.jsx`. **No** toast-with-Undo in any slice yet — that is a deferred standalone spec.
2. **`<ConfirmModal>` variant literals:** `'info' | 'warning' | 'danger'` (NOT `'destructive'`).
3. **Mobile context-menu trigger:** explicit `MoreHorizontal` button on the card. **No** long-press gesture handling.
4. **Tests:** Vitest unit/component, Playwright e2e. Tests live in `tests/` mirroring `src/`. Server tests in `server/__tests__/`.
5. **Commits:** Conventional Commits format. **NEVER** add `Co-Authored-By` lines (per `CLAUDE.md`).
6. **Branch model:** feature branches off `main`. Direct push to `main` IS authorized when the user asks (memory `feedback_push_on_request.md`). **Force-push to main is BLOCKED by branch protection** even with admin rights — plan accordingly.
7. **Worktrees:** preferred for multi-task slice work. Each gets its own `node_modules` (junction symlink doesn't work for vitest config resolution).

---

## 3. Reusable scaffolding shipped (DO NOT re-build)

| Capability | Where | When to use |
|---|---|---|
| **Action registry** | [`src/actions/repoActions.js`](../../src/actions/repoActions.js) | Adding a new repo action — single edit, surfaces consume automatically |
| **Action dispatcher** | [`src/actions/runAction.js`](../../src/actions/runAction.js) | `runAction(actionId, target, ctx, repoActions)` — single call site |
| **Action DI hook** | [`src/actions/repoActionContext.jsx`](../../src/actions/repoActionContext.jsx) | `useRepoActionContext()` — packages api/toast/modal/refresh/confirmGate |
| **Pure repo mutations** | [`src/utils/repoMutations.js`](../../src/utils/repoMutations.js) | Non-React callers needing `archiveRepos` / `deleteRepos` / `performAction` |
| **Confirmation hook** | [`src/hooks/useDangerAction.js`](../../src/hooks/useDangerAction.js) | Outside the action registry: `useDangerAction({ title, message, variant, requiresInput, onConfirm }).run()` |
| **Mobile FAB** | [`src/components/ui/MobileFAB.jsx`](../../src/components/ui/MobileFAB.jsx) | `<MobileFAB icon={…} label={…} onClick={…} shiftAboveBottomBar />` — renders only `< md` |
| **Sticky modal** | [`src/components/ui/ModalSticky.jsx`](../../src/components/ui/ModalSticky.jsx) | Replace `<Modal>` when the modal has action buttons that should stay visible on mobile |
| **Viewport-safe height** | [`src/hooks/useViewportSafeHeight.js`](../../src/hooks/useViewportSafeHeight.js) | iOS URL-bar-aware sizing (already used by `<ModalSticky>`) |
| **Mobile drawer** | [`src/components/MobileDrawer.jsx`](../../src/components/MobileDrawer.jsx) | `<MobileDrawer isOpen onClose side="…">` (left / right / bottom) |
| **Mobile breakpoint hook** | [`src/hooks/useMobileBreakpoint.jsx`](../../src/hooks/useMobileBreakpoint.jsx) | Returns boolean for `< md` (768 px) |
| **Friendly AI errors (client)** | [`src/utils/aiErrorFriendly.js`](../../src/utils/aiErrorFriendly.js) | `friendlyAiError({ status, body }) → { headline, detail }` |
| **Friendly AI errors (server)** | [`server/middleware/ai-error-mapper.js`](../../server/middleware/ai-error-mapper.js) | `mapAIErrorToResponse(res, err)` — returns the response or null |
| **Confirm modal** | [`src/components/ui/ConfirmModal.jsx`](../../src/components/ui/ConfirmModal.jsx) | `{ title, message, variant, requiresInput, onConfirm, onClose }` |
| **Lint guard** | [`tests/lint/no-bare-destructive-buttons.test.js`](../../tests/lint/no-bare-destructive-buttons.test.js) | Fails CI if a red Button has no recognised confirm pattern |

**Recognised confirm patterns** (the lint guard accepts these neighbours within 5 lines):
- `useDangerAction(...)`
- `openModalWithData('showConfirm', ...)`
- `setConfirmAction(...)` (project state-based pattern)
- `setConfirmOpen(...)`
- `<ConfirmModal>` rendered as sibling
- `// danger-button-allowed: <reason>` (JS) or `{/* danger-button-allowed: <reason> */}` (JSX)

---

## 4. What's left — prioritized todo list

Pick highest-priority unblocked item first. Each line ends with the spec/plan reference and effort estimate.

### Priority 1 — unblocked, high value

- [ ] **Slice 4 Task 9: Register `fix_community_health` action** in `src/actions/repoActions.js`. Was gated on slice 1 merge (now done). [Plan task](../plans/2026-05-01-community-health-ai-autofix.md#task-9-action-registry-entry-depends-on-slice-1). **Effort: 10 min.**
- [ ] **Pre-existing lint regression fix:** `tests/lint/no-standalone-loader2.test.js` flags two files. Migrate `src/components/MigrationHistory.jsx` and `src/components/RepoDetail/InlineEditField.jsx` to use `<SectionSpinner label="…" />` (full-section loading) or `<Spinner size="sm" tone="muted" />` (inline status) per the lint test's expected pattern. **Effort: 15 min total.**

### Priority 2 — unblocked, medium value

- [ ] **Slice 4 follow-up: Apache-2.0 / GPL-3.0 / MPL-2.0 license templates.** Use `WebFetch` against `choosealicense.com` to retrieve canonical text, save into `server/lib/ai-features/license-templates/<id>.txt` with `{{year}}` / `{{owner}}` placeholders, extend `SUPPORTED_LICENSES` in [`server/lib/ai-features/community-health-fix.js`](../../server/lib/ai-features/community-health-fix.js), update `server/__tests__/community-health-fix.test.js` to assert each. [Plan task](../plans/2026-05-01-community-health-ai-autofix.md#task-1-license-templates--deterministic-license-generator). **Effort: 30–45 min.**
- [ ] **Slice 5 audit row 8: RepoDetail tabs scroll fade indicators.** Add `[mask-image:linear-gradient(...)]` Tailwind arbitrary value at horizontal scroll edges. [Spec row 8](2026-05-01-mobile-parity-sweep.md#3-audit-catalogue). **Effort: 20 min.**
- [ ] **Slice 5 audit row 16: tooltip touch audit.** Grep for `<Tooltip` on icon-only buttons; verify each has a `title` attr fallback. [Spec row 16](2026-05-01-mobile-parity-sweep.md#3-audit-catalogue). **Effort: 30 min.**

### Priority 3 — bigger pieces

- [ ] **Slice 5 audit row 4: LanguageChart compact bar variant** at `< sm`. Spec row 4. **Effort: 1 h.**
- [ ] **Slice 5 audit rows 10+11: WorkBoard mobile** (KPI 1-wide stack + AISummaryCard stacked + optional bottom tab bar). [Plan task 8](../plans/2026-05-01-mobile-parity-sweep.md#task-8-cluster-e--workboard-mobile-rows-10-11). **Effort: 2 h.**
- [ ] **Slice 5 audit row 12: SettingsModal horizontal section tab strip** at `< md`. [Plan task 9](../plans/2026-05-01-mobile-parity-sweep.md#task-9-cluster-f--settingsmodal-sections-nav-row-12). **Effort: 1 h.**
- [ ] **Slice 5 audit row 13: `<ModalSticky>` migration** of existing modals with action buttons. [Plan task 10](../plans/2026-05-01-mobile-parity-sweep.md#task-10-cluster-g--apply-modalsticky-to-existing-modals-row-13). **Effort: 2–3 h** (10+ modals to triage).
- [ ] **Slice 5 audit row 14: MigrationWizard responsive sweep.** [Plan task 11](../plans/2026-05-01-mobile-parity-sweep.md#task-11-cluster-h--migrationwizard-mobile-row-14). **Effort: 2 h.**

### Priority 4 — gated on infra

- [ ] **E2E test suites (slices 1, 4, 5).** All gated on a Playwright mock-mode setup that doesn't exist yet. The plan files contain the exact test scripts; only the harness needs to be built first. **Effort: half day for infra + 1 h per suite.**
- [ ] **Slice 4 Task 10: Community Health fix e2e.** Same gating. [Plan task 10](../plans/2026-05-01-community-health-ai-autofix.md#task-10-e2e-test).

### Priority 5 — needs brainstorming first

- [ ] **Slice 3 Part 2: deeper dashboard interactivity.** Not yet specced. Run the brainstorming skill to define scope. Likely candidates: AttentionFeed actions, MigrationActivity click-throughs, AIPromoStrip dismissal persistence.

### Hygiene / cleanup

- [ ] **Slice 4 follow-up: route tests for `actions-community.js` /generate + /commit-fix endpoints.** Was deferred when shipping slice 4 because the harness isn't trivial. Check existing pattern at `server/__tests__/work-board-actions.test.js`. **Effort: 1 h.**
- [ ] **Toast-with-Undo (Phase 2 spec).** Multiple slices deferred this. Needs its own spec — dedicated brainstorming session.

---

## 5. Known issues + pitfalls (read before acting)

### Pre-existing test failure

`tests/lint/no-standalone-loader2.test.js` has been failing since before this initiative. The two offenders are:

- `src/components/MigrationHistory.jsx` — has standalone `<Loader2 className="… animate-spin" />` outside a button
- `src/components/RepoDetail/InlineEditField.jsx` — same

Both need to migrate to `<SectionSpinner label="…" />` or `<Spinner size="sm" tone="muted" />`. The lint test header in the file has the migration recipe. **This is the only test failing on main today.**

### Git workflow gotchas (learned in last session)

1. **`git reset --hard` deletes untracked files** that aren't in git's index. Always `git status --short` first; commit or stash with `-u` before any reset.
2. **`git stash pop` STAGES every file** it restores. If you then `git add <specific file>` and commit, the staged stash files come along. Run `git restore --staged .` first to unstage.
3. **Branch protection on `main` BLOCKS force-push** even with `--admin` flag. Don't try to rewrite history on remote main; redo the work as new commits.
4. **Reflog saves the day.** `git reflog` keeps "lost" commits 30+ days. First recourse for recovery.
5. **For massive merge conflicts (10+ commits, 5+ files vs main),** use **synthesis**: branch off current main, copy/port the feature branch's final state, single squash commit. Documented in memory `feedback_synthesis_branch_for_conflict_resolution.md`.

### Per-cluster gotchas

- The **`SettingsTab.jsx` archive button** has an indirect confirm via `handleArchiveToggle()` calling `setConfirmAction()` — there's already a `// danger-button-allowed` comment at line ~466 explaining why. Don't remove it.
- The user's WIP merged in `60e52f9` includes new files in `server/lib/ai-features/{ai-chat-prompt.js,ai-prompt-registry.js}` + `server/routes/ai/prompts.js`. These were nearly lost in the stash-pop accident; verify they're present (`ls server/lib/ai-features/ai-chat-prompt.js`) before touching anything in that area.
- The slice 5 mobile primitives are in **`src/components/ui/MobileFAB.jsx`** and **`src/components/ui/ModalSticky.jsx`** (NOT under `Mobile*/`). Easy to look in the wrong directory.

---

## 6. Bootstrap protocol for the next session

1. **Read this doc first.** It's the source of truth.
2. **Run** `git log --oneline -10 && git status --short && gh pr list --state open` to verify the state matches what's described above. If it diverges, trust the actual state.
3. **Pick the highest-priority unblocked item** from section 4.
4. **Use a worktree** if the work touches more than 2-3 files, OR if you need isolation from the user's WIP. Pattern:
   ```
   git worktree add s:/ghrm-worktree-<name> -b feat/<name>
   cd s:/ghrm-worktree-<name> && cp s:/Git\ Hub\ Repo\ Manager/.env . && npm install
   ```
5. **For each task: TDD — write failing test, run red, implement, run green, commit, push.** Conventional Commits, no `Co-Authored-By`.
6. **Update this handoff doc** when the task lands. Move the line from "what's left" to "what was done".
7. **Push to feature branch first**, then open PR via `gh pr create`. Squash-merge via `gh pr merge <num> --squash --admin --delete-branch`.
8. **If session is filling up,** commit a `wip(<scope>): partial <task> — <state>` and push. The next session reads this handoff and resumes.

### Key commands

```bash
# Test suites
npx vitest run                                                       # full
npx vitest run tests/actions tests/components/RepoList               # narrow scope
npx vitest run tests/lint/no-bare-destructive-buttons.test.js        # lint guard
npx vitest run tests/lint/no-standalone-loader2.test.js              # the pre-existing failure

# Build
npm run build

# Lint a specific file
npx eslint <path>

# Dev server
npm run dev
```

### When something breaks

- **Test fails after edit:** read the test message; if it's the lint guard, add a `// danger-button-allowed: <reason>` or refactor to use `useDangerAction`.
- **Module not found error:** check if the import path matches an existing file. The user's WIP added some new server libs that might be referenced.
- **`git pull` rejected (conflicts with WIP):** `git stash push -u -m "pre-pull"`, pull, then `git stash pop`. **Beware:** stash pop stages files — see gotcha 2 above.

---

## 7. Memory pointers (auto-loaded into agent context)

The agent's auto-memory is at `C:\Users\bruno\.claude\projects\s--Git-Hub-Repo-Manager\memory\`. Relevant entries (added/updated this session):

- `project_ux_uniformity_initiative_status.md` — current state of all 5 slices + remaining work
- `reference_shared_scaffolding.md` — index of the 14 reusable utilities listed in §3 above
- `feedback_safe_branch_workflow.md` — git workflow lessons from this session

Plus the pre-existing memories that remain valid:

- `feedback_push_on_request.md` — direct push to main is OK on explicit request
- `feedback_avoid_long_local_tests.md` — push and let CI; don't run full e2e locally
- `feedback_vite_inline_dce_guards.md`
- `feedback_git_add_check_artifacts.md`
- `project_agpl_license.md`
- `project_support_email.md`

---

## 8. Definition of "everything done" for the whole initiative

The original user goal: *"premium tudo interligado, funcional, sem erros. lindo. em desktop e Mobile."*

Concretely:
- ✅ Discoverable: every action available from at least 2 entry points (slice 1)
- ✅ Predictable: every destructive action confirms with the same shape (slices 1+2)
- ✅ Connected: dashboard cards lead somewhere meaningful (slice 3 part 1)
- ✅ Health is actionable: Community Health offers fixes, not just diagnoses (slice 4)
- ⚠️ Mobile-equivalent: some flows still desktop-only (slice 5 has 11 audit rows still queued)
- ✅ Honest about errors: AI failures show "AI provider quota exceeded — retry in 14s" (already shipped)

**The initiative is 80% there.** The remaining 20% is the slice 5 cluster work + slice 4 task 9 + slice 3 part 2 brainstorm + the lint regression fix. None of it is hard; it's just careful per-file work.
