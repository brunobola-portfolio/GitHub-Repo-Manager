# Premium Context-Aware Name & Description Suggestions

**Status:** Draft
**Date:** 2026-05-09
**Owner:** Bruno Silva Marques
**Related:** [2026-04-28-suggest-name-description](./2026-04-28-suggest-name-description.md), [2026-05-08-post-migration-ai-polish](./2026-05-08-post-migration-ai-polish.md)

## Problem

Today the AI suggestions for repo name and description draw from a thin slice of context: repo metadata (language, topics, visibility) plus a 1500-byte head of the README. That is enough for the deterministic fallback but produces generic AI proposals when the README is short, when the project is described better by its `package.json` scripts, or when the user has a specific file in mind that captures intent (e.g. `docs/architecture.md`).

The output side is also bare. A single suggestion lands without any visible reasoning, signals used, or confidence — the user has no basis for trusting or distrusting it before clicking Apply.

The two surfaces that produce these suggestions (`SuggestNameDescriptionModal` for single repos, `AIPolishModal` for post-migration batch) duplicate the metadata fetch and have no shared concept of "context budget" or "premium signals".

## Goals

- Lift suggestion quality by feeding the AI a configurable, multi-signal view of the repo (manifest, entrypoints, folder structure, custom files), bounded by a hard byte cap.
- Give the user explicit control over what gets sent to the AI provider, with sensible defaults so the common case requires zero clicks.
- Show the user the reasoning, the signals used, and a confidence score — so trust is informed, not blind.
- Share one pipeline between the single-repo and batch surfaces so behaviour stays consistent.
- Redact obvious secrets server-side before any code is sent to a third-party provider.

## Non-Goals

- Multiple alternatives ("propose 3 names, pick one") — Phase B.
- Plan/billing tiers driven by context depth — Phase B.
- Caching suggestions across same-context-hash calls — Phase B.
- Multi-ecosystem manifest combination (e.g. detect Cargo + go.mod in one mono-repo and merge them) — Phase B.
- Custom prompt templates exposed in the picker UI — Phase B.
- Adding Name suggestions to the post-migration batch surface. The batch stays description-only; renaming en masse immediately after a migration creates URL/clone churn.

## User Experience

### Single-repo: `SuggestNameDescriptionModal`

A new collapsed `<ContextPicker mode="single" />` panel sits above the existing "Suggest with AI" button. Header reads `Context (4 signals on, 2.1 KB)`. Expanded:

```text
☑ README                     [████░░░░] 1.4 KB / 3 KB
☑ Manifest (package.json)    [██░░░░░░] 0.6 KB / 1.5 KB
☑ Topics + language          [█░░░░░░░] 0.1 KB
☐ Entrypoints (3 files)      —
☐ Folder structure           —
─────────────────────────────────
+ Add specific file (max 5)
─────────────────────────────────
Total: 2.1 KB / 8 KB    [✦ premium signals]
```

Default signals ON: README, manifest, topics, language. OFF: entrypoints, folder structure.

`+ Add specific file` opens a `<FileTreePicker />` that lazy-fetches the repo tree (`GET /repos/:owner/:repo/git/trees/:branch?recursive=1`) and shows a search-filterable list. Up to 5 custom files. Each chip shows file size; oversized files show an amber "Will be truncated" badge.

When a signal's allocated budget would be exceeded, that row shows a truncation badge so the user knows what is dropping out.

### Batch: `AIPolishModal` (post-migration)

Same `<ContextPicker mode="batch" />` lives at the top of the table. No `+ Add specific file` (custom files don't translate to N repos). Below the picker, a quota banner: `"Esgotará 30 de 50 quota slots"` when `repos × 1` exceeds remaining quota.

Each row keeps the existing description input, plus a new confidence dot (green/amber/red) on the left of the status pill. Hover/focus shows the rationale tooltip. The "signals used" chip set displays once at the top of the table since signals are global for the batch.

### Premium output — `<PremiumRationale />` block

Replaces the current rationale `InsightCard` in the single-repo modal. Sits below the field cards.

```text
[✦ AI · Confidence HIGH]
"Based on README intro + package.json scripts, this is a CLI
tool for parsing OpenAPI specs into TypeScript types..."

Signals used:
[README 1.4KB] [package.json] [topics: cli, openapi] [language: ts]

ⓘ 2 lines redacted from package.json (possible secrets)
```

When confidence is low: amber notice "Suggestion quality limited — README is empty or too short. Consider adding more signals or improving the README first."

In the batch, the per-row tooltip uses a compact variant: confidence pill + 1-line rationale + signals chips (no redaction notice unless redactions occurred for that repo).

### Persistence

Toggle state persists in `localStorage` under `ai-context-prefs-v1` (per-user via session). Custom files are per-call and never persist. A "Reset to defaults" link lives in the picker.

## Architecture

### Backend

**`server/lib/repo-context-builder.js` (new)**

```js
buildContext({
  accessToken,
  owner,
  repo,
  signals: { readme, manifest, entrypoints, folderStructure, topics, language },
  customFiles,        // string[] of paths; ignored in batch mode
  byteCap = 8192,
})
// → {
//   sections: [{ kind, label, content, bytes, redactions }],
//   totalBytes,
//   confidence: 'high' | 'medium' | 'low',
//   signalsUsed: [{ kind, label, bytes }],
// }
```

Manifest detection probes in order: `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `Gemfile`, `composer.json`. First match wins. Cargo `[[package]]` and go `require` blocks are stripped to keep signal density up.

Byte budget allocation (8 KB total):

| Signal           | Cap     | Notes                                  |
| ---------------- | ------- | -------------------------------------- |
| README           | 3 KB    | head                                   |
| Manifest         | 1.5 KB  | after lockfile-noise strip             |
| Entrypoints      | 1.5 KB  | total across up to 3 files (head each) |
| Folder structure | 0.5 KB  | top-level dirs only                    |
| Topics+language  | ~0.2 KB |                                        |
| Custom files     | rest    | divided equally                        |

If a signal is OFF, its budget is not redistributed — the cap on remaining signals stays the same. (Simpler to reason about and prevents one large signal from drowning the rest.)

Confidence (deterministic, computed regardless of source):

- **high** — README ≥ 500 B AND manifest present AND (topics OR language)
- **medium** — README ≥ 100 B OR manifest present
- **low** — only metadata (no README, no manifest)

**`server/lib/secret-redactor.js` (new)**

Single regex set runs line-by-line over fetched content before it leaves the server:

```js
/(api[_-]?key|secret|token|password|aws_access|bearer\s+\w+|sk-[\w-]{20,}|ghp_\w{36}|github_pat_\w+|xox[baprs]-\w+)/i
```

Matched lines become `[REDACTED — possible secret]`. The redactor returns both the cleaned content and a `count` for the response.

**`server/routes/ai/suggest-name-description.js` (update)**

Body schema gains:

```js
context: z.object({
  signals: z.object({
    readme: z.boolean().default(true),
    manifest: z.boolean().default(true),
    entrypoints: z.boolean().default(false),
    folderStructure: z.boolean().default(false),
    topics: z.boolean().default(true),
    language: z.boolean().default(true),
  }).default({}),
  customFiles: z.array(z.string().min(1).max(255)).max(5).default([]),
}).default({}),
```

The handler delegates context fetch to `buildContext()` and feeds the structured `sections` into the AI prompt. Confidence + signals + redactions ride back in the response.

**Batch path — no separate endpoint needed.** The post-migration polish flow (`useAIPolish` → `aiApi.polish.getDescription`) already delegates to `aiApi.suggestNameDescription(repoId)` once per repo (verified in [`src/api/ai.js`](../../src/api/ai.js)). The batch surface therefore inherits the new `context` field for free; the hook just threads the shared `context` (with `customFiles: []`) into each per-repo call. No new server route.

**`server/routes/repos/tree.js` (new) — `GET /api/repos/:owner/:name/tree?branch=...`**

Wraps GitHub's `GET /repos/:owner/:repo/git/trees/:sha?recursive=1` after resolving `branch` → tree SHA via `/repos/:owner/:repo/branches/:branch`. Returns a flat array `[{ path, type, size }]`, filtered to `type === 'blob'` (the picker has no use for tree nodes), capped at 500 entries with a `truncated: true` flag when the underlying GitHub response is truncated. Cached in `gh-cache` with a short TTL (60s) since the user opens the picker once per modal session.

### Frontend

**New components:**

- `src/components/AI/ContextPicker.jsx` — modes `single` and `batch`. Toggles, byte meter, custom-file chip rail (single mode only).
- `src/components/AI/FileTreePicker.jsx` — single mode only. Tree + search + size. The codebase has no existing tree endpoint (verified: only `/contents/{path}` wrappers exist, e.g. [`server/routes/repos/crud.js:306`](../../server/routes/repos/crud.js#L306)). A new server endpoint is required (see below).
- `src/components/AI/PremiumRationale.jsx` — confidence pill + rationale + signal chips + redaction notice.

**New hook:**

- `src/hooks/useContextPrefs.js` — `localStorage` wrapper for `ai-context-prefs-v1`. Returns `{ prefs, setSignal, addCustomFile, removeCustomFile, reset }`.

**Updated:**

- `src/components/AI/SuggestNameDescriptionModal.jsx` — embed `ContextPicker` above suggest button, swap rationale `InsightCard` for `PremiumRationale`. The existing `Suggest`/`Regenerate`/edit/apply flow stays intact.
- `src/components/AIPolish/PolishReview.jsx` — embed `ContextPicker` (batch mode) at top, add confidence dot per row, swap status pill for the dot+pill combo.
- `src/hooks/useAIPolish.js` — accept `context` argument; thread through batch payload.

### API contract

Single-repo response (additive — fields below current shape):

```json
{
  "source": "ai",
  "current": { "name": "...", "description": "..." },
  "proposed": { "name": "...", "description": "..." },
  "rationale": "...",
  "noChange": { "name": false, "description": false },

  "confidence": "high",
  "signalsUsed": [
    { "kind": "readme", "label": "README", "bytes": 1432 },
    { "kind": "manifest", "label": "package.json", "bytes": 612 },
    { "kind": "topics", "label": "topics: cli, openapi", "bytes": 24 },
    { "kind": "language", "label": "TypeScript", "bytes": 11 }
  ],
  "redactions": [{ "file": "package.json", "count": 2 }]
}
```

Batch response: same per-row, `signalsUsed` once at the top level (since shared across rows).

## Data Flow

1. User opens the modal. `useContextPrefs` reads `localStorage` → defaults applied.
2. `ContextPicker` displays toggles + meter. User adjusts (or doesn't).
3. User clicks Suggest. Frontend POSTs `{ repoId, context: { signals, customFiles } }`.
4. Server handler calls `buildContext()`:
   - Fetches each enabled signal from GitHub (existing `githubApi` helper for README, tree-fetch for manifest/entrypoints/custom files).
   - Routes content through `secretRedactor` line-by-line, summing redaction counts.
   - Truncates per-section to its budget; concatenates into a structured prompt block.
   - Computes confidence from raw byte sizes (post-truncation but pre-redaction byte counts).
5. Prompt is built via the existing `getResolvedPrompt(userId, 'suggest_name_description', vars)` registry; `vars` gains a `signalsBlock` placeholder.
6. AI provider call. On success, parse JSON. On any failure path, deterministic fallback runs against the same `sections` block.
7. Response shape is enriched (`confidence`, `signalsUsed`, `redactions`) regardless of source.
8. Frontend renders `<PremiumRationale />` from the response.

## Error Handling

- **Custom file path 404** → drop that file, show toast "1 file skipped (not found): src/foo.js". Other signals proceed.
- **Tree-fetch fails** → only README + topics + language available; banner in picker `"Could not load repo tree — file picker disabled"`.
- **Provider error** → silent fallback to deterministic, `source: 'deterministic'`, confidence still computed from same signals.
- **Quota hit mid-batch** → existing behaviour preserved; rows after the hit show `quota` status. No regression.
- **Byte cap exceeded by custom files alone** → reject at validation; toast `"Selected files exceed 8 KB budget. Remove some or untick a signal."` Avoid silent over-truncation that would give the user a useless suggestion.

## Testing

### Backend tests

- `server/__tests__/repo-context-builder.test.js`
  - Each manifest type detected in priority order
  - Byte cap honoured per signal and overall
  - Disabled signals not fetched (no GitHub call)
  - Confidence levels (high/medium/low) match the matrix
  - Custom files exceeded → builder throws typed error
- `server/__tests__/secret-redactor.test.js`
  - Each regex pattern catches a representative example
  - Multiple matches in one file → single counter increment per line
  - No-secret content unchanged
- `server/__tests__/suggest-name-description.test.js` (extend)
  - `context` field validated and threaded through
  - Response includes new fields (`confidence`, `signalsUsed`, `redactions`)
  - AI failure path still returns enriched shape

### Frontend tests

- `tests/components/AI/ContextPicker.test.jsx`
  - Toggles flip, byte meter recomputes
  - `localStorage` round-trip via `useContextPrefs`
  - Custom file cap (max 5) enforced
  - Reset button restores defaults
- `tests/components/AI/PremiumRationale.test.jsx`
  - Confidence pill colour matches level
  - Redaction notice hidden when zero
  - Signal chips render from response
- `tests/components/AI/SuggestNameDescriptionModal.test.jsx` (update)
  - ContextPicker integrated; suggest payload includes `context`
- `tests/components/AIPolish/PolishReview.test.jsx` (update)
  - Batch picker drives all rows
  - Per-row confidence dot renders
- `e2e/suggest-name-description-premium.spec.js`
  - Golden path: open modal, toggle entrypoints on, suggest, see signals chips, apply
  - Custom file picker: add file, exceeds budget → error toast

## Rollout

Single landing — no flag. The `ContextPicker` defaults match today's behaviour byte-for-byte (README + topics + language ON, manifest ON is the only addition). Existing users see a richer rationale block on next suggest; opting into more signals is discoverable but not pushed. Batch users get the picker but defaults preserve current effective inputs.

## Open Questions

- Should the `<PremiumRationale />` low-confidence amber notice link to a help doc explaining how to improve the README? (Probably yes if such a doc exists; check during plan phase.)
- The new tree endpoint caps the picker at 500 blobs with `truncated: true`; the picker itself should default to a search-required notice when the flag is set. Confirm exact UX (empty state vs partial list with banner) during plan.
