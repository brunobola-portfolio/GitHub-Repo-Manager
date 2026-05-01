# Intent Affordances Audit

**Date:** 2026-05-01
**Status:** Spec — pending review
**Owner:** Bruno
**Decomposition note:** Slice **(2) of (5)** in the broader UX uniformity initiative. Slice 1 (Action Surface Unification) shipped the action registry pattern with `description` + `confirm` for repo actions. This slice extends that discipline to action surfaces *outside* the repo registry.

---

## 1. Goals & non-goals

### Goal

Every destructive or hard-to-reverse action in the app — across Settings, Teams, Work Board, Migration history, Modals — provides:
1. A clear **description** of what will happen *before* the click (tooltip or inline copy).
2. A **proportional confirmation** for actions that mutate state (modal with optional type-name verification).
3. **Consistent visual language**: red for destructive, amber for mutations with side effects, neutral for navigation.

The goal is uniformity: a user who just learned "Delete Repository asks me to type the name" can predict the same shape for "Delete Account", "Leave Team", "Delete Preset", "Reset Demo Data", etc.

### Non-goals

1. Re-extending `repoActions.js` to cover non-repo actions. Settings actions stay where they are; this spec audits + applies the same *patterns*, not the same registry.
2. Building a centralized "action registry v2". Premature; we just need consistency, not a new abstraction.
3. Animation polish. Confirmations stay modal-based via the existing `<ConfirmModal>` (no toast-with-Undo — same Phase 1 boundary as slice 1).
4. Localizing copy. Strings stay English-only.
5. Touching read-only navigation actions (e.g. "View History"). Only mutations and destructive actions are in scope.

### Success criteria

- Every audited mutation/destructive call site has either a `description` (tooltip) or a `confirm` modal — no exceptions.
- Every type-name modal uses `<ConfirmModal requiresInput={...}>` — no bespoke text-input gates.
- Every danger action uses `variant: 'danger'`, every warning uses `variant: 'warning'`, every info uses `variant: 'info'` — no ad-hoc colors.
- Audit checklist (Section 3) is fully ticked off in the PR description.

---

## 2. Architecture

### Reusable primitives (already exist; this spec doesn't re-create them)

- `<ConfirmModal>` — `{ title, message, variant, requiresInput, onConfirm, onClose }` from [`src/components/ui/ConfirmModal.jsx`](../../src/components/ui/ConfirmModal.jsx).
- `useModal()` `openModalWithData('showConfirm', cfg)` pattern — used everywhere.
- The `description` field convention from `repoActions.js` (slice 1) is the model.

### What this spec adds

1. **`useDangerAction({ title, message, variant, requiresInput, onConfirm })` hook** — a tiny convenience that wraps the imperative `openModalWithData('showConfirm', …)` boilerplate. Reduces ~10 lines per call site to one. Lives at [`src/hooks/useDangerAction.js`](../../src/hooks/useDangerAction.js) (new).

   ```js
   const { run } = useDangerAction({
     title: 'Delete account?',
     message: 'This permanently deletes your account, all repositories metadata, and AI history.',
     variant: 'danger',
     requiresInput: 'delete my account',
     onConfirm: () => api.deleteAccount(),
   })
   // <Button onClick={run}>Delete account</Button>
   ```

2. **Lint test** at `tests/lint/no-bare-destructive-buttons.test.js` that scans for `<Button variant="danger">` / `<Button … destructive>` / class names containing `bg-red-` on buttons that are NOT inside a `useDangerAction` / `openModalWithData('showConfirm'` / known-safe allow-list. Drives the audit; failing tests force the audit to complete.

   Pre-existing pattern: `tests/lint/no-standalone-loader2.test.js` already exists in the project as a reference.

3. **Style guide subsection** in `docs/architecture/overview.md`: "Action affordances — when to confirm, what variant to use".

### What this spec does NOT add

- A registry. Audit work is mechanical, registry would be over-engineering.
- A telemetry hook. Phase 2.

---

## 3. Audit catalogue

This is the deliverable. Each row is a call site that needs either a description or a confirm gate (or both).

> **Status legend:** ✅ already compliant · 🚧 needs work · ❓ unclear, requires investigation in Task 1.

| # | Surface | Action | Today | Target | Status |
|---|---|---|---|---|---|
| 1 | Settings → Account | Delete account | bare button + native `confirm()` | `<ConfirmModal danger requiresInput="delete my account">` | 🚧 |
| 2 | Settings → AI | Reset all AI keys | bare button | `<ConfirmModal warning>` ("removes BYOK keys; re-add to use AI") | 🚧 |
| 3 | Settings → Danger Zone | Reset onboarding | bare button | tooltip + no confirm needed (reversible) | 🚧 |
| 4 | Settings → Danger Zone | Wipe local cache | bare button | `<ConfirmModal info>` (data is reversible from server) | 🚧 |
| 5 | Settings → WorkBoard → Danger | Reset Work Board state | bare button | `<ConfirmModal warning>` | 🚧 |
| 6 | Teams → Members | Remove member | inline X button + native `confirm()` | `<ConfirmModal warning>` ("they lose access immediately") | 🚧 |
| 7 | Teams → Settings | Leave team | bare button + native `confirm()` | `<ConfirmModal warning requiresInput="{team.name}">` | 🚧 |
| 8 | Teams → Settings | Delete team (admin) | bare button + native `confirm()` | `<ConfirmModal danger requiresInput="{team.name}">` | 🚧 |
| 9 | Migration → History | Delete migration job | bare button | `<ConfirmModal warning>` ("removes the job record; does not undo migration") | 🚧 |
| 10 | Migration → Wizard | Cancel running migration | bare button | `<ConfirmModal warning>` ("force-cancels mid-flight; partial data may remain") | 🚧 |
| 11 | Work Board → Presets | Delete preset | bare button | `<ConfirmModal warning>` | 🚧 |
| 12 | Work Board → Tracked Repos | Untrack all | bare button | `<ConfirmModal info>` (reversible) | 🚧 |
| 13 | Admin → DLQ | Retry failed job | bare button | tooltip; no confirm (idempotent) | 🚧 |
| 14 | Admin → DLQ | Drop failed job | bare button | `<ConfirmModal danger>` (irreversible) | 🚧 |
| 15 | RepoDetail → Settings → Danger | Archive (per-repo) | already in repoActions registry from slice 1 | n/a | ✅ |
| 16 | RepoDetail → Settings → Danger | Delete (per-repo) | already in repoActions registry from slice 1 | n/a | ✅ |
| 17 | Header → Logout | Sign out | bare button | tooltip + no confirm (low cost) | 🚧 |
| 18 | Header → Org switcher | Force re-sync orgs | spinner button | tooltip ("re-fetches all orgs from GitHub; takes ~5s") | 🚧 |
| 19 | Pricing → license entry | Detach license | bare button | `<ConfirmModal warning>` ("seat freed; downgrades to Free immediately") | 🚧 |
| 20 | Modal context | (any modal X-button) | already accessible | n/a | ✅ |
| 21 | Settings → Notifications | Mark all as read | bare button | tooltip; no confirm (reversible per-item) | 🚧 |
| 22 | Settings → AI Instructions | Reset to default | bare button | `<ConfirmModal info>` ("replaces your custom instructions") | 🚧 |
| 23 | RepoDetail → Branches | Delete branch | bare button + native `confirm()` | `<ConfirmModal warning requiresInput="{branch.name}">` | 🚧 |
| 24 | RepoDetail → Branches | Toggle branch protection | toggle | tooltip on hover ("enabling requires admin permissions") | 🚧 |

**Non-actionable rows ("✅" status):** entries already compliant via slice 1's work or the modal close button (which is a navigation, not a mutation).

---

## 4. Migration plan

### Steps

Each task is a separate commit. Mergeable independently. Each commit fixes a small, related cluster of audit rows.

1. **Inventory** — run a grep audit, refine the table. Resolve all `❓` rows. Output: an updated table committed to the spec doc itself (this file).
2. **Build `useDangerAction` hook + tests.** No call-site changes yet.
3. **Build the lint test** (`no-bare-destructive-buttons.test.js`). It WILL fail on master at first — that's the audit signal. Add an allow-list of compliant call sites; everything else fails until migrated.
4. **Cluster A — Settings (rows 1-5, 17-22):** convert each call site to use `useDangerAction` or add a tooltip. ~10 commits OR one commit per cluster, controller's choice.
5. **Cluster B — Teams (rows 6-8):** ditto.
6. **Cluster C — Migration & Work Board (rows 9-12):** ditto.
7. **Cluster D — Admin (rows 13-14):** ditto.
8. **Cluster E — RepoDetail Branches (rows 23-24):** ditto.
9. **Final lint test green.** Every row has its check.
10. **Style guide doc** in `docs/architecture/overview.md`.

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| Native `confirm()` callers expect synchronous return — `<ConfirmModal>` is async via Promise gate | The `useDangerAction` hook adapts: `run()` returns a Promise that resolves when the user confirms. Caller awaits. |
| Lint test false positives on legitimate red buttons (e.g. "Stop scan" mid-flight) | Allow-list with explicit per-file annotation `// danger-button-allowed: <reason>`. The test reads the comment as opt-out. |
| Migration noisy — many small commits | Use a single PR with the cluster commits squashed-on-merge. The audit checklist in the PR description gives reviewer overview. |
| Existing `<ConfirmModal>` props might need extending | If a row needs e.g. multi-step confirmation, propose a new prop in a follow-up; for Phase 1 use existing primitives only. |

### Out-of-spec follow-ups

1. Toast-with-Undo for the "info" tier (deferred from slice 1 — same boundary).
2. Multi-step confirmation flows (e.g. "Are you sure? · Type name · Wait 5s").
3. Localizing copy.

---

## 5. Testing & acceptance

### Unit

- `tests/hooks/useDangerAction.test.js`
  - Calling `run()` opens the `showConfirm` modal with the right config.
  - Confirming → resolves `run()`'s Promise + calls `onConfirm`.
  - Cancelling → resolves Promise as `false`, `onConfirm` not called.
  - `requiresInput` prop is passed through.
- `tests/lint/no-bare-destructive-buttons.test.js`
  - Scans `src/` for `<Button variant="danger">`, `<Button … destructive>`, `bg-red-` on buttons.
  - Each match must be inside a `useDangerAction` call OR an `openModalWithData('showConfirm'` call OR have a `// danger-button-allowed` comment within 5 lines.
  - Fails with a list of offenders.

### Component

- For each cluster (A-E), one test verifying the modal opens with the right title/variant/message when the button is clicked.

### Acceptance

| # | Criterion | Verification |
|---|---|---|
| 1 | Every row in the audit catalogue is implemented | Manual checklist tick in PR |
| 2 | Lint test passes | `npx vitest run tests/lint/no-bare-destructive-buttons.test.js` green |
| 3 | No native `confirm()` calls remain in audited files | `grep "window\.confirm\|confirm("` returns nothing in audit-touched files |
| 4 | Style guide subsection added | `docs/architecture/overview.md` has the new section |
| 5 | All visual variants used consistently | Manual visual smoke test on a `?mock=1` browser session |

---

## 6. Definition of done

After all tasks merge:
- ~24 call sites have either a tooltip or a `<ConfirmModal>`.
- One new hook (`useDangerAction`) used by the bulk of them.
- One new lint test enforcing the discipline going forward.
- Bundle delta neutral or smaller (replacing inline `confirm()` calls with the hook should be net zero or slight reduction).
- A user can predict, after using one destructive flow, exactly what every other destructive flow will look like.
