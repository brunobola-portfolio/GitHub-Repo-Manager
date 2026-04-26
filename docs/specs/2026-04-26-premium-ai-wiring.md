# Premium AI — Wiring & Auto-Tag

**Date:** 2026-04-26
**Status:** Draft
**Slice:** #2 of 4 in the "tudo lindo, sem vaporware, premium" final pass.
**Predecessor:** [2026-04-26-vaporware-and-honesty-audit.md](./2026-04-26-vaporware-and-honesty-audit.md) (Slice #1, closed). Mocks eliminated, error/quota UX uniform, build honesty CI gate live.

---

## Problem

The 2026-04-11 product-honesty pass and the 2026-04-26 vaporware audit closed the visible vaporware. But four AI capabilities are *more done than they appear* — backend endpoints exist, sometimes the prop or button is even rendered, but the click either does nothing meaningful or leads to a deeper-than-expected flow:

1. **Commit message AI** — fully wired in [DevToolkit/CommitTab/CommitTab.jsx:83](../../src/components/DevToolkit/CommitTab/CommitTab.jsx#L83) against [POST /api/ai/generate-commit](../../server/routes/ai/dev-toolkit.js#L174). Risk: when no AI provider is configured the button might still appear and 503 silently. Need explicit fail-silent audit.

2. **PR description AI** — `onGenerateDescription` plumbed from [App.jsx:928](../../src/App.jsx#L928) → RepoDetail → PullRequestsTab → [PRDetailPanel.jsx:234](../../src/components/RepoDetail/PRDetailPanel.jsx#L234) where the button is rendered. Click opens the DevToolkit PR tab which streams from [POST /api/ai/generate-pr](../../server/routes/ai/dev-toolkit.js#L281). The flow works but the user is teleported away from the PR detail to a different surface — a small UX cost. Worth a verification pass and a one-line fail-silent gate.

3. **Repo health "explain"** — [RepoHealthBadge.jsx](../../src/components/AI/RepoHealthBadge.jsx) explicitly says *"click is a no-op — the full insights live in RepoInsightsModal a click away on the row itself"*. The modal exists, has a Quality tab with score breakdown + recommendations, accepts `initialTab='quality'`, and is registered as `showRepoInsights` in ModalContext. The badge just doesn't propagate a click that opens it. One-line wiring fix.

4. **AI auto-tag (suggest topics)** — repos indexed via [POST /api/ai/index](../../server/routes/ai/indexing.js#L84) already produce `analysis.suggested_topics` and store them in [repo_metadata.topics](../../server/routes/ai/indexing.js#L89). The frontend never surfaces these. Meanwhile [PUT /api/repos/:owner/:repo/topics](../../server/routes/repos/crud.js#L211) already lets us write topics back to GitHub with audit logging. The only missing piece is a small UI in RepoDetail Settings tab that *reads* the suggestions, lets the user pick, and *writes* them back.

The sum: four "premium AI" features that the user expected to take 6 hours actually take ~2h because the heavy lifting is done. This spec calls out each gap explicitly so the implementer can't mistake "done in plumbing" for "done end-to-end".

## Goals

1. **Commit AI** never shows a "Generate" affordance when AI isn't configured (or shows it disabled with a tooltip pointing at Settings → AI).
2. **PR description AI** verifiably reaches the user from the PR detail panel — confirm the existing route works and the button is gated by `useAIStatus`.
3. **RepoHealthBadge** is clickable and opens RepoInsightsModal on the Quality tab, with a recognisable hover affordance (cursor + ring).
4. **Auto-tag** flow lives in `RepoDetail/SettingsTab.jsx` as a new "AI-suggested topics" section that:
   - Shows current GitHub topics for the repo
   - Shows AI-suggested topics that are NOT already on the repo (additive only — never proposes deletions)
   - User checks the ones to apply, clicks "Add topics"
   - PUT to `/api/repos/:owner/:repo/topics` with the union of existing + selected
   - Toast on success/failure via `formatUserError` from slice #1
5. **Zero new backend endpoints.** Everything reuses existing routes. The only server change (if any) is a tiny GET to read `repo_metadata.topics` for a repo, but that may already exist via the metadata endpoint.

## Non-goals

- **No new AI features.** The four above are all that's in scope.
- **No bulk auto-tag** ("tag selected repos at once"). One-at-a-time only — bulk infra would double the work and isn't required by the user brief.
- **No streaming for auto-tag.** The suggestions come from existing indexed data; no AI inference at apply time.
- **No re-indexing trigger from the topics UI.** If the repo isn't indexed, the section shows an "Index this repo first" CTA that opens the existing index flow. Don't kick off indexing from inside SettingsTab — keep the flows separate.
- **No retroactive `requireTier` enforcement.** The features stay free for users with their own AI configured (BYOK) and rate-limited via the existing `checkAIFeatureLimit` helpers when applicable.
- **No PR description redesign.** Verifying the existing button works is enough. If we later decide to inline the stream directly in PRDetailPanel instead of teleporting to DevToolkit, that's a separate slice.

---

## Solution overview

Single spec, four small slices. Each is committable + pushable independently. Total ~2h.

| Slice | Scope | Effort |
|---|---|---|
| **2.1** | Audit Commit AI fail-silent on `useAIStatus` (gate the Generate button) | ~15 min |
| **2.2** | Verify PR description button + add `useAIStatus` gate (mirror 2.1) | ~15 min |
| **2.3** | Make RepoHealthBadge clickable + propagate click upward to open insights modal | ~30 min |
| **2.4** | New "AI-suggested topics" section in RepoDetail/SettingsTab + tests | ~1h |

---

## Slice 2.1 — Commit AI fail-silent

### Current state

[DevToolkit/CommitTab/CommitTab.jsx](../../src/components/DevToolkit/CommitTab/CommitTab.jsx) already streams from `/api/ai/generate-commit`. Need to confirm the Generate button is hidden or disabled when `useAIStatus().status?.configured` is false.

### Changes

- Read `useAIStatus()` near the top of CommitTab.
- Wrap the Generate button (line ~80-150 area, the one calling `startStream`) in a guard:
  - If `status.configured === false`, render a disabled button with tooltip "Configure AI in Settings → AI".
  - Otherwise render normally.
- The same gate applies to the "Regenerate" action chip if present.

### Tests

- Extend [tests/components/DevToolkit/CommitTab.test.jsx](../../tests/components/DevToolkit/CommitTab.test.jsx) (or create) with one case: AI not configured → Generate button disabled + tooltip visible.

---

## Slice 2.2 — PR description AI verification

### Current state

[App.jsx:928](../../src/App.jsx#L928) wires `onGenerateDescription` → opens DevToolkit on the PR tab with `{ pr: { number, head, base } }` initial data. [PRDetailPanel.jsx:234](../../src/components/RepoDetail/PRDetailPanel.jsx#L234) renders the button only when `onGenerateDescription` is truthy.

### Changes

- In [PRDetailPanel.jsx:234](../../src/components/RepoDetail/PRDetailPanel.jsx#L234), gate the button by `useAIStatus()` in addition to the `onGenerateDescription` prop check. When AI is not configured, render the button disabled with the same tooltip pattern as Slice 2.1.
- No backend changes.
- Manual smoke: open a PR detail, click "Generate Description" → DevToolkit opens on PR tab with that PR pre-loaded; confirm the streaming generation works.

### Tests

- Extend [tests/components/RepoDetail/PRDetailPanel.test.jsx](../../tests/components/RepoDetail/PRDetailPanel.test.jsx) with: AI configured → button enabled; AI not configured → button disabled.

---

## Slice 2.3 — RepoHealthBadge → Insights Quality tab

### Current state

[RepoHealthBadge.jsx](../../src/components/AI/RepoHealthBadge.jsx) is a `<span>` (not interactive). Its docblock says click is a no-op intentionally. The repo card hosts the modal trigger separately ([RepoList/index.jsx:216](../../src/components/RepoList/index.jsx#L216) calls `openModalWithData('showRepoInsights', { repo, initialTab: 'quality' })` from the Quality Report context-menu item).

### Changes

- Convert `<span>` to `<button type="button">` in `RepoHealthBadge.jsx`.
- Accept a new `onClick` prop. When provided, fire it on click; otherwise behave as today (no-op, keep tooltip).
- Add `cursor-pointer` and a focus ring class (`ds-focus-ring` if it exists, else `focus-visible:ring-2 focus-visible:ring-indigo-500`).
- Update [RepoList/RepoCard.jsx](../../src/components/RepoList/RepoCard.jsx) (the only existing consumer) to pass `onClick={() => openInsights(repo, 'quality')}` where `openInsights` is the existing helper that fires `openModalWithData('showRepoInsights', { repo, initialTab: 'quality' })`. If RepoCard doesn't have access to `openModalWithData`, propagate via a prop the way `onOpenInsights` already flows in RepoList:139.
- If badge is also rendered elsewhere, propagate the same wiring.

### UX

Hover: subtle brightness bump on the existing tone background. Cursor changes to pointer. Focus ring appears on keyboard nav. Click fires the Quality tab. Existing tooltip ("AI health score: X/100") stays.

### Tests

- Extend [tests/components/AI/RepoHealthBadge.test.jsx](../../tests/components/AI/RepoHealthBadge.test.jsx) (create if missing): renders as button when `onClick` provided; click fires the handler with the repo.

---

## Slice 2.4 — Auto-tag UI in RepoDetail SettingsTab

### Current state

- `repo_metadata.topics` row stores AI suggestions as JSON ([indexing.js:107](../../server/routes/ai/indexing.js#L107)).
- [PUT /api/repos/:owner/:repo/topics](../../server/routes/repos/crud.js#L211) accepts `{ names: string[] }` and writes to GitHub with audit logging.
- A GET endpoint to retrieve the metadata row exists via the AI metadata route. Confirm in implementation; if absent, add a thin `GET /api/ai/metadata/:repoId` reader (one query, one response). The plan covers both branches.

### Changes

**Frontend — [src/components/RepoDetail/SettingsTab.jsx](../../src/components/RepoDetail/SettingsTab.jsx) gains a new section.**

```jsx
<section data-testid="ai-suggested-topics" className="ds-card ...">
  <h3>AI-suggested topics</h3>
  {!aiStatus.configured && <AINotConfiguredBanner variant="inline" />}
  {!suggestions && <Button onClick={loadSuggestions}>Suggest topics</Button>}
  {suggestions?.length === 0 && <EmptyState ... title="Looks good" description="No new topics suggested. Try re-indexing this repo." />}
  {suggestions?.length > 0 && (
    <>
      <p>{N} topic suggestions for this repo. Pick which ones to add.</p>
      <ul>
        {suggestions.map(t => <Checkbox label={t} ... />)}
      </ul>
      <Button onClick={apply} disabled={selected.length === 0}>Add {selected.length} topic(s)</Button>
    </>
  )}
</section>
```

**Data flow:**

1. Load step: `loadSuggestions()` GETs `/api/ai/metadata/:repoId` (or whatever current endpoint exists for that), parses `topics` array, **filters out topics already on the repo** (intersection check against `repo.topics`), sets state. If no suggestions remain → show "Looks good" empty state.
2. Apply step: `apply()` collects checked items, computes `union = [...currentTopics, ...checked]`, PUTs `/api/repos/:owner/:repo/topics` with `{ names: union }`. On 200 → toast.success "Topics updated", refresh the repo to show new topics. On error → `toast.errorFromException(err, { fallbackTitle: 'Failed to update topics' })`.

**Edge cases:**
- Repo not indexed → metadata GET returns 404 → render an empty state "This repo isn't indexed yet" with a link/button to the existing index flow.
- All AI suggestions already on repo → "Looks good" state, no checkboxes.
- AI not configured → banner instead of suggestions list, button disabled.
- Repo is archived / read-only → disable the Apply button with tooltip "Cannot modify archived repos".

### Backend (one-line addition only if needed)

If no `GET /api/ai/metadata/:repoId` exists, add it in [server/routes/ai/indexing.js](../../server/routes/ai/indexing.js):

```js
router.get('/ai/metadata/:repoId', requireAuth, (req, res) => {
  const row = db.prepare(`SELECT topics, summary, health_score FROM repo_metadata WHERE repo_id = ? AND user_id = ?`).get(req.params.repoId, req.session.user.id)
  if (!row) return res.status(404).json({ error: 'Not indexed', code: 'NOT_INDEXED' })
  res.json({ ...row, topics: row.topics ? JSON.parse(row.topics) : [] })
})
```

Confirmed in implementation. If a metadata reader already exists with a different shape, the frontend adapts to it.

### Tests

- Unit: new SettingsTab section renders the three states (idle, loading, suggestions, empty).
- Unit: clicking "Add topics" PUTs the union with `{ names }`.
- Backend (if endpoint added): GET returns 404 when no metadata, 200 with shape when present.

---

## Architecture — shared concerns

### `useAIStatus` gate pattern (Slices 2.1, 2.2, 2.4)

All three AI-affordance gates use the same idiom:

```jsx
const { status } = useAIStatus()
const aiOff = status && status.configured === false
return (
  <Button
    onClick={onGenerate}
    disabled={aiOff || ...other}
    title={aiOff ? 'Configure AI in Settings → AI' : undefined}
  >
    {label}
  </Button>
)
```

When `useAIStatus` is loading (status === null), default to enabled — the worst case is a disabled-AI 503 caught by the existing `formatUserError` flow with the `AI_NOT_CONFIGURED` mapping that points the user at Settings.

### Telemetry

Every AI feature kept its existing audit logging. Auto-tag specifically logs `repo.topics.update` (already in `crud.js:221`). No new audit lines needed.

### Failure modes

| Scenario | Handling |
|---|---|
| AI not configured, button still rendered (regression) | Slice 2.1/2.2 unit test catches it |
| `repo_metadata.topics` is empty (indexed but no topics) | Render "Looks good" state, no checkboxes |
| GitHub topics PUT returns 422 (invalid topic format) | `formatUserError` → fallback toast with the explicit error code |
| User dismisses, re-opens → suggestions cached | Acceptable; not stale unless re-indexed |
| Race: user toggles checkboxes during PUT | Apply button disabled while loading |

---

## Testing strategy

- Unit tests scoped to each slice. No new e2e specs in this pass — the existing flakiness in CI is being tracked separately.
- Suite green between commits (`npx vitest run`).
- Build honesty test still green (no mock data added).

## Shipping order

1. Slice 2.1 (commit fail-silent)
2. Slice 2.2 (PR description gate + verify)
3. Slice 2.3 (RepoHealthBadge wiring)
4. Slice 2.4 (auto-tag UI)

Each slice: commit (Conventional Commits, no Co-Authored-By, ≤72 chars subject), push to origin/main per the user's standing preference, suite must be green.

## Success metrics

- **Zero** "Generate" buttons render when `useAIStatus().status.configured === false` across CommitTab, PRDetailPanel, and the new SettingsTab section.
- **One click** from RepoCard → Quality tab via the badge (verified by unit test).
- **One round trip** (load + apply) closes the auto-tag flow for indexed repos with new suggestions.
- **No new vaporware** — `tests/build/build-honesty.test.js` continues to pass.
- **No regressions** — `npx vitest run` passes (2700+ tests).

---

## Open questions

1. **Does `GET /api/ai/metadata/:repoId` exist?** The implementation plan opens with a search; if absent, add the one-line endpoint in 2.4 before the frontend work.
2. **Where does RepoCard get `openModalWithData`?** From a context or via prop drilling? Confirm in the implementation plan and pick the cheapest wiring.
3. **Is `useAIStatus` already imported in CommitTab?** If yes, just consume; if not, one-line import. Plan-time decision.

These resolve during the implementation plan phase.
