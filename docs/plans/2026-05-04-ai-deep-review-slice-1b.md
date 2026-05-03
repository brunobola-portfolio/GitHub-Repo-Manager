# AI Deep Review — Slice 1b Implementation Plan (Premium Prompt Studio)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Layer the premium "Prompt Studio" on top of the free slice 1a engine — multi-preset library at user/repo scope, path-scoped extras, severity floor, style-guide ingestion, and 5 built-in presets surfaced to free users.

**Architecture:** New SQLite table `ai_review_prompts` separate from the existing single-prompt-per-user `user_ai_prompts` table — multi-preset is a richer model that doesn't fit the existing one. New `prompt-registry.js` module performs resolution: scope precedence (repo → user → builtin) + path-rule extras + severity floor + `${REPO_STYLE_GUIDE}` token substitution. Engine `runDeepReview` consumes the resolved bundle. 7 new HTTP routes; CRUD requires `requireTier('pro')`, GET works free. New top-level page `/ai/prompts` (Library / Editor / picker dropdown surfaces in the AI panel toolbar).

**Tech Stack:** Same as slice 1a — Express + better-sqlite3, React 19 + Vite + Tailwind v4, Vitest + Playwright.

**Spec:** [docs/specs/2026-05-03-ai-deep-review.md](../specs/2026-05-03-ai-deep-review.md) "Premium — Prompt Studio (slice 1b)" section.

---

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| MODIFY | `server/db.js` | Add `ai_review_prompts` table migration |
| CREATE | `server/lib/ai-features/builtin-prompts.js` | 5 built-in preset bodies (General, Security, Performance, Accessibility, Refactor) |
| CREATE | `server/lib/ai-features/prompt-registry.js` | Resolution: scope → path rules → token substitution → severity floor |
| CREATE | `server/lib/ai-prompt-store.js` | DB CRUD for `ai_review_prompts` |
| CREATE | `server/routes/ai/prompt-studio.js` | 7 endpoints — list/get/create/update/delete/test/set-default |
| MODIFY | `server/lib/ai-features/pr-deep-review.js` | Accept `presetKey` param, call resolver, apply path-rule extras + severity floor in postProcess |
| MODIFY | `server/routes/ai/deep-review.js` | Pass `?presetKey=` from query through to engine |
| MODIFY | `server/routes/ai.js` | Mount the new prompt-studio router |
| CREATE | `server/__tests__/ai-features/builtin-prompts.test.js` | Verify each built-in is well-formed |
| CREATE | `server/__tests__/ai-features/prompt-registry.test.js` | Resolution precedence + path rules + token + severity |
| CREATE | `server/__tests__/ai-prompt-store.test.js` | CRUD + ownership |
| CREATE | `server/__tests__/ai/prompt-studio-routes.test.js` | All 7 endpoints + tier gating |
| CREATE | `src/hooks/usePromptStudio.js` | API client hook |
| CREATE | `src/components/AIPrompts/PromptPicker.jsx` | Dropdown wired into AIReviewPanel toolbar |
| CREATE | `src/components/AIPrompts/PromptLibrary.jsx` | List + filter view |
| CREATE | `src/components/AIPrompts/PromptEditor.jsx` | Split-pane editor with live test-on-sample |
| CREATE | `src/components/AIPrompts/PromptStudioPage.jsx` | Page shell + routing |
| MODIFY | `src/App.jsx` | Add route `/ai/prompts` |
| MODIFY | `src/components/PRReview/AIDeepReview/AIReviewPanel.jsx` | Add `<PromptPicker>` to toolbar; surface active preset |
| MODIFY | `src/hooks/useAIDeepReview.js` | Accept `presetKey` arg in `generate()`, pass as query param |
| CREATE | `tests/hooks/usePromptStudio.test.js` | Hook tests |
| CREATE | `tests/components/AIPrompts/PromptPicker.test.jsx` | Picker tests |
| CREATE | `e2e/prompt-studio.spec.js` | Smoke E2E |

---

## Tasks

### Task 1b.1 — `ai_review_prompts` migration + `builtin-prompts.js` module

**Files:** `server/db.js`, `server/lib/ai-features/builtin-prompts.js`, `server/__tests__/ai-features/builtin-prompts.test.js`

Add the migration:

```sql
CREATE TABLE IF NOT EXISTS ai_review_prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    scope TEXT NOT NULL CHECK(scope IN ('user', 'repo', 'org')),
    scope_target TEXT,
    preset_key TEXT NOT NULL,
    name TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    path_rules_json TEXT,
    severity_floor TEXT CHECK(severity_floor IS NULL OR severity_floor IN ('info','suggestion','warning','critical')),
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, scope, scope_target, preset_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_review_prompts_lookup ON ai_review_prompts(scope, scope_target, is_default);
CREATE INDEX IF NOT EXISTS idx_ai_review_prompts_user ON ai_review_prompts(user_id);
```

Built-in presets (read-only, served from `builtin-prompts.js`):

```js
export const BUILTIN_PRESETS = Object.freeze({
    general: { key: 'general', name: 'General', body: '...' },
    security: { key: 'security', name: 'Security audit', body: '...', severityFloor: 'warning' },
    performance: { key: 'performance', name: 'Performance', body: '...' },
    accessibility: { key: 'accessibility', name: 'Accessibility', body: '...' },
    refactor: { key: 'refactor', name: 'Refactor coach', body: '...', severityFloor: 'info' },
});
```

Each `body` is a 4–10 line prompt that complements the base `pr_deep_review` system prompt — focused lens, not full replacement. The engine concatenates: base prompt + preset body.

Tests: each built-in has key/name/body, body length > 100 chars, severityFloor (when present) is a valid enum.

### Task 1b.2 — `prompt-registry.js` resolver + `ai-prompt-store.js`

**Files:** `server/lib/ai-prompt-store.js`, `server/lib/ai-features/prompt-registry.js`, plus their tests.

Store API (mirrors `ai-pr-review-store.js` shape):
- `listPresets(userId, { scope?, scopeTarget? })` → array
- `getPresetById(userId, id)` → row or null (ownership check)
- `getDefaultForScope(userId, scope, scopeTarget)` → row or null (looks up `is_default=1`)
- `savePreset(userId, payload)` → id (upsert by composite UNIQUE)
- `updatePreset(userId, id, payload)` → changes
- `deletePreset(userId, id)` → changes
- `setDefault(userId, id)` → updates `is_default=1` for given row, clears for siblings in same scope

Resolver `resolvePromptForGenerate({ userId, repoOwner, repoName, presetKey?, fileBeingReviewed? })` returns:
```js
{
    name: 'Security audit',
    systemPrompt: 'full assembled prompt',
    severityFloor: 'warning' | null,
    pathRulesApplied: ['src/components/**'] | [],
    source: 'preset:security' | 'user-default' | 'repo-default' | 'builtin:general',
}
```

Resolution order:
1. If `presetKey` is explicitly given: load that preset (built-in OR user-owned). 404 if user tries to use a custom preset they don't own.
2. Else if `presetKey` not given: look up repo-default for `(userId, 'repo', '${owner}/${name}')`. If found, use it.
3. Else look up user-default for `(userId, 'user', null)`. If found, use it.
4. Else fall back to `BUILTIN_PRESETS.general`.

Then assemble the system prompt: base (from `AI_PROMPT_REGISTRY['pr_deep_review']`) + `\n\n` + preset body. Apply path-rule extras (filter rules whose glob matches `fileBeingReviewed`, append their `extraPrompt`). Substitute `${REPO_STYLE_GUIDE}` with `.repomanager/review-rules.md` content from the repo head if present (cached 1h via `gh-cache.readThrough`); empty string if absent or fetch fails.

Tests cover: scope precedence (repo overrides user, user overrides builtin), explicit `presetKey` overrides default, custom preset ownership 404, path rules filtered correctly, `${REPO_STYLE_GUIDE}` substitution, severity floor preserved.

### Task 1b.3 — Engine integration

**Files:** `server/lib/ai-features/pr-deep-review.js` (modify), `server/__tests__/ai-features/pr-deep-review.test.js` (extend).

`runDeepReview` accepts a new optional `resolvedPrompt` arg (the route layer calls the resolver and passes the result). When provided:
- Use `resolvedPrompt.systemPrompt` instead of calling `getResolvedPrompt('pr_deep_review', ...)` directly.
- After post-processing, apply `resolvedPrompt.severityFloor` filter (drop comments below the floor).

Engine no longer calls the prompt-registry directly — that's the resolver's job. Engine becomes a pure function over `{ provider, prompts, prMetadata, fileManifest, diffPatch }`.

Backwards-compat: when `resolvedPrompt` is omitted, fall back to the slice-1a behavior (use `getResolvedPrompt('pr_deep_review', ...)` with no preset).

New tests: severity floor drops below-floor comments; `resolvedPrompt.systemPrompt` is used verbatim.

### Task 1b.4 — 7 prompt-studio routes

**Files:** `server/routes/ai/prompt-studio.js`, `server/routes/ai.js` (mount), `server/__tests__/ai/prompt-studio-routes.test.js`.

| Method | Path | Gate |
|---|---|---|
| `GET` | `/api/ai/prompt-studio/presets` | requireAuth |
| `GET` | `/api/ai/prompt-studio/presets/:id` | requireAuth |
| `POST` | `/api/ai/prompt-studio/presets` | requireAuth + requireTier('pro') |
| `PATCH` | `/api/ai/prompt-studio/presets/:id` | requireAuth + requireTier('pro') |
| `DELETE` | `/api/ai/prompt-studio/presets/:id` | requireAuth + requireTier('pro') |
| `POST` | `/api/ai/prompt-studio/presets/:id/test` | requireAuth + requireTier('pro') (rate-limited 1/10s/user) |
| `POST` | `/api/ai/prompt-studio/presets/:id/set-default` | requireAuth + requireTier('pro') |

GET `/presets` returns built-ins + user's custom + any visible org-shared presets (org-shared deferred to slice 5; for now just built-ins + user's custom).

GET `/presets/:id` returns the full body. For built-in keys (string id like `'general'`), serve from `BUILTIN_PRESETS`. For numeric id, look up via store.

POST/PATCH validate payload shape (zod): name (required, ≤ 100 chars), system_prompt (required, ≤ 8000 chars), scope (`user|repo`), scope_target (required for repo, must be `<owner>/<name>` shape), path_rules (array of `{glob, extraPrompt}`, max 20 entries), severity_floor (optional enum).

POST `/test` runs `runDeepReview` against a fixed sample diff with the preset applied and returns the structured output. Rate-limited to 1/10s per user (mirror the pattern in `routes/user-ai-config.js`).

### Task 1b.5 — Frontend hook + picker

**Files:** `src/hooks/usePromptStudio.js`, `src/components/AIPrompts/PromptPicker.jsx`, `src/components/PRReview/AIDeepReview/AIReviewPanel.jsx` (modify), `src/hooks/useAIDeepReview.js` (modify), tests.

Hook: `usePromptStudio()` returns `{ presets, loading, error, refresh, save, remove, setDefault, test }`. Loads presets on mount.

`useAIDeepReview` modifications: `generate(presetKey?)` accepts optional preset key, passes as `?presetKey=...` query param to the POST.

`<PromptPicker>` renders inline in the AIReviewPanel toolbar. Shows `Preset: [General ▼]` dropdown. Free users see built-ins. Pro users also see their custom presets. Selection triggers `deep.generate(selectedKey)`. Default selection comes from `usePromptStudio` (server-resolved default for current repo).

### Task 1b.6 — Library + Editor + Page

**Files:** `src/components/AIPrompts/PromptLibrary.jsx`, `src/components/AIPrompts/PromptEditor.jsx`, `src/components/AIPrompts/PromptStudioPage.jsx`, `src/App.jsx` (route), tests, `e2e/prompt-studio.spec.js`.

`<PromptLibrary>`: list of all presets visible to user. Built-ins always shown at top with a `[BUILTIN]` badge. Custom presets show edit/delete buttons (Pro only). "New preset" CTA opens the Editor.

`<PromptEditor>`: split-pane (mobile: stacked tabs). Left = form (name, scope picker, scope target input, system_prompt textarea, path_rules editor, severity_floor select). Right = "Test on sample diff" button + result preview. Save/Delete buttons.

`<PromptStudioPage>`: page shell rendering Library by default; Editor when `?edit=:id` or `?new=1`. Uses the existing app's page header pattern.

`/ai/prompts` route added in `src/App.jsx`. Smoke E2E: navigate to page → see built-ins → upgrade-required toast on edit attempt for free user (or just check the edit/delete CTAs are absent).

---

## Pricing gate enforcement

The pricing model from the spec:
- Free user: pick from 5 built-in presets via PromptPicker. Custom prompts blocked.
- Pro user: full CRUD + custom presets at user/repo scope.

Gate enforced ONLY at CRUD endpoints (`requireTier('pro')` from existing middleware). GET endpoints are free for browsing built-ins. Engine accepts any `presetKey` — if the user references a custom preset they don't own, store lookup returns null and resolver falls back to default (or surfaces 404 if explicitly requested).

---

## Out of scope (slice 1b)

- Org-shared presets (`scope='org'`) — deferred to slice 5
- Per-team prompt sync
- Marketplace of community-shared prompts
- Prompt usage analytics
- Slash commands (`/test_plan`, `/describe`, `/improve`) — slice 3

---

## Success criteria

1. Free user navigates to `/ai/prompts` → sees the 5 built-in presets read-only
2. Free user picks "Security audit" in the PR Deep Review panel → engine uses that preset's body
3. Pro user creates a custom preset at user scope → it appears in the picker dropdown and Library
4. Pro user marks a preset as repo-default → next AI Deep Review on that repo uses it without explicit picker selection
5. Path-scoped extras append the right glob's extraPrompt when the file matches (verified by unit test)
6. `${REPO_STYLE_GUIDE}` token substitutes with `.repomanager/review-rules.md` content
7. `severity_floor` drops below-threshold comments
8. Free user POST/PATCH/DELETE → 403
9. Test endpoint rate-limited 1/10s
10. All 7 success criteria from spec slice 1b section
