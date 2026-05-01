# Community Health AI Auto-Fix

**Date:** 2026-05-01
**Status:** Spec — pending review
**Owner:** Bruno
**Decomposition note:** Slice **(4) of (5)** in the broader UX uniformity initiative. Slice 1 (Action Surface Unification) shipped on `feat/action-surface-unification`. Slice 3 (Dashboard wiring) part 1 shipped on `main`. This spec covers slice 4. Slice 2 (Intent affordances audit) and slice 5 (Mobile parity) have their own specs.

---

## 1. Goals & non-goals

### Goal

When the Community Health dashboard shows a repo with missing standard files (`LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md`), let the user one-click "Fix with AI" and: AI generates the file content tailored to the repo, user previews + edits, then commits straight to the default branch (or opens a PR). The health score updates automatically after the commit.

### Non-goals

1. Replacing the existing health analysis logic (`communityHealthService.analyzeRepository`) — this spec only adds a *fix* path on top.
2. Generating files outside the standard 7 community files. Custom file generation is a Phase 2 spec.
3. Bulk fix across multiple repos at once. One repo at a time; bulk is a separate spec.
4. Fix-all-files single click. Each missing file gets its own "Fix with AI" button — explicit per-file user consent.
5. Editing an existing file (e.g., expand a stub README). Only generation when the file is *missing*.
6. Branch-protection awareness — if the default branch is protected, we open a PR instead of pushing direct. (Detection is in scope; UI affordances for branch protection are Phase 2.)

### Success criteria

- A user with a missing `LICENSE` can click "Fix with AI", see a generated MIT/Apache/etc. license preview, edit if needed, and commit it via one button. The file appears in the repo's default branch within 30 seconds (network-dependent).
- The Community Health score updates after the commit (cache invalidated, re-fetched).
- If AI is not configured (no BYOK), the "Fix with AI" button is hidden — replaced by a "Configure AI" link to Settings.
- If the AI provider returns a quota error, the existing friendly error path (slice 3 fix `b9e093a`) is reused — no raw RPC dump.
- If the default branch is protected, the commit attempt produces a clean error explaining "branch protection rejected — opening a PR instead" and falls back to creating a `chore/community-health-fixes` branch + PR.
- All 7 community file types have AI generators with templates that respect the repo's metadata (name, description, license, language).

---

## 2. Architecture

### Server layer

```
server/
├── lib/
│   └── ai-features/
│       └── community-health-fix.js         ← NEW: per-file generator + GitHub commit/PR helper
├── routes/
│   └── repos/
│       └── actions-community.js            ← MODIFY: add 2 new endpoints
└── __tests__/
    └── community-health-fix.test.js        ← NEW: unit tests for generator + commit logic
```

**New endpoints:**

- `POST /:owner/:repo/community-health/generate` — returns AI-generated content for a missing file. Does NOT commit. Body: `{ fileType: 'license' | 'contributing' | 'code_of_conduct' | 'security' | 'issue_template' | 'pr_template' | 'readme_stub', overrides?: { licenseId?, projectType?, … } }`. Response: `{ filePath: string, content: string, suggestedCommitMessage: string, sha?: null }`.

- `POST /:owner/:repo/community-health/commit-fix` — takes the user-confirmed content and commits it to the repo. Body: `{ filePath: string, content: string, commitMessage: string, mode: 'direct' | 'pr' }`. Response: `{ committed: true, sha: string, branch: string, prUrl?: string }`. If `mode === 'direct'` and the default branch is protected, the route automatically falls back to PR mode with `mode: 'pr-fallback'` in the response.

### File-type generators

Each file type has a template + AI prompt + post-processor. Implementation lives in `community-health-fix.js`:

```js
export const FILE_GENERATORS = {
  license: { path: 'LICENSE', generator: generateLicense, deterministic: true },
  contributing: { path: 'CONTRIBUTING.md', generator: generateContributing, deterministic: false },
  code_of_conduct: { path: 'CODE_OF_CONDUCT.md', generator: generateCodeOfConduct, deterministic: true },
  security: { path: 'SECURITY.md', generator: generateSecurityMd, deterministic: false },
  issue_template: { path: '.github/ISSUE_TEMPLATE/bug_report.md', generator: generateIssueTemplate, deterministic: false },
  pr_template: { path: '.github/PULL_REQUEST_TEMPLATE.md', generator: generatePRTemplate, deterministic: false },
  readme_stub: { path: 'README.md', generator: generateReadmeStub, deterministic: false },
}
```

- **`deterministic: true`** generators (LICENSE, CODE_OF_CONDUCT) use canonical templates filled with repo metadata — no AI call. Cheaper, faster, exact text.
- **`deterministic: false`** generators call the AI provider via `createProviderForUser(userId, 'completion', { featureKey: 'COMMUNITY_HEALTH_FIX' })`.

### GitHub commit helper

Direct file commits via [GitHub Contents API](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents). Branch-protection detection runs before the PUT — if the default branch has required reviews, the helper switches to:
1. Create branch `chore/community-health-fixes-{timestamp}` from default
2. PUT the file on that branch
3. Open PR back to default with the suggested commit message as title

### Client layer

```
src/
└── components/
    ├── CommunityHealthDashboard.jsx        ← MODIFY: add "Fix with AI" button to FileCheckItem when !exists
    └── AI/
        └── CommunityHealthFixModal.jsx     ← NEW: preview + edit + commit modal
```

`<CommunityHealthFixModal>` is a 3-state modal:

1. **Generate state** — calls `/generate`, shows loading skeleton.
2. **Preview state** — full markdown preview side-by-side with a textarea editor. User can edit before committing.
3. **Committed state** — confirmation + link to the commit/PR.

Errors at any state use the `friendlyAiError` pattern (already shipped in slice 3 fix).

### Action registry integration

Add to `src/actions/repoActions.js` (the registry shipped on `feat/action-surface-unification`):

```js
fix_community_health: {
  id: 'fix_community_health',
  label: 'Fix Community Health',
  description: 'AI generates missing community files (LICENSE, CONTRIBUTING, etc.) for one-click commit.',
  icon: Heart,
  intent: 'mutation',
  surfaces: ['contextMenu', 'commandPalette'],
  triggersRefresh: true,
  run: async (repo, ctx) => ctx.openModalWithData('showCommunityHealth', { repo, focus: 'fix' }),
},
```

This is just a navigation entry point; the actual fix happens inside `CommunityHealthDashboard` which accepts a `focus: 'fix'` initial param to scroll to the Files tab and highlight the first missing file.

---

## 3. File-type generators — content rules

### LICENSE (deterministic)

User picks one of: `MIT`, `Apache-2.0`, `GPL-3.0`, `BSD-3-Clause`, `MPL-2.0`. The picker UI lives inside `CommunityHealthFixModal`'s preview state. Templates are pulled from `choosealicense.com` text (committed verbatim under `server/lib/ai-features/license-templates/`). Filled placeholders: `{{year}}`, `{{owner}}` (from `repo.owner.login` or user's full name from session).

### CODE_OF_CONDUCT.md (deterministic)

Contributor Covenant v2.1 verbatim. Placeholder: `{{contact_email}}` — defaulted from session, editable in preview.

### CONTRIBUTING.md (AI)

Prompt: "Write a CONTRIBUTING.md for `{repo.full_name}`, a `{repo.description}`. Cover: setup, build, test, PR guidelines, commit message format. Tone: friendly, professional. ≤ 800 words. No headings deeper than H3."

### SECURITY.md (AI)

Prompt: "Write a SECURITY.md for `{repo.full_name}`. Cover supported versions, how to report a vulnerability, expected response time. Use the email `{{contact_email}}`. ≤ 400 words."

### .github/ISSUE_TEMPLATE/bug_report.md (AI)

Prompt: "Write a GitHub bug report issue template for `{repo.full_name}`. Standard sections: description, reproduction steps, expected behavior, actual behavior, environment. Match the project's tech stack: `{repo.language}`."

### .github/PULL_REQUEST_TEMPLATE.md (AI)

Prompt: "Write a concise PR template for `{repo.full_name}`. Sections: summary, related issues, testing notes, screenshots (if UI). ≤ 300 words."

### README.md stub (AI) — only if README is empty/missing

Prompt: "Write a README.md for `{repo.full_name}`, a `{repo.description}`. Include: title, badges placeholder, install, quick start, license. Tech stack: `{repo.language}`. ≤ 500 words. Use H2 for sections."

---

## 4. Migration plan

### Steps

Each step is a separate commit, mergeable in isolation.

1. **License templates + deterministic LICENSE generator.** Seed `server/lib/ai-features/license-templates/` with verbatim texts. Tests assert placeholder substitution works for all 5 supported licenses.
2. **CODE_OF_CONDUCT.md deterministic generator.** Verbatim Contributor Covenant 2.1 with email placeholder.
3. **AI generators for the 5 non-deterministic types** (CONTRIBUTING, SECURITY, ISSUE_TEMPLATE, PR_TEMPLATE, README stub). Each backed by a unit test that mocks the AI provider and asserts the prompt shape + response sanitization.
4. **GitHub commit helper.** Branch-protection detection + direct commit OR PR fallback. Mocked `githubApi` in tests.
5. **POST `/community-health/generate` endpoint.** Returns the generated content without committing. Errors map through the `friendlyAiError`-equivalent server pattern (already in `work-board-actions.js` from slice 3 fix — extract into shared helper if not already).
6. **POST `/community-health/commit-fix` endpoint.** Calls the commit helper. Invalidates the `community_health_cache` row for the repo on success.
7. **`CommunityHealthFixModal` component.** 3-state modal as specified.
8. **Wire `FileCheckItem` "Fix with AI" button** for missing files. Hides when AI not configured (replace with "Configure AI" link). Tests verify both states.
9. **`fix_community_health` action registered.** When slice 1 lands, this is one entry in `repoActions.js`.

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| AI prompt-injection from `repo.description` | Sanitize via existing `server/lib/ai-features/sanitize.js` before substitution. |
| Generated content is inappropriate (offensive, hallucinated) | Add a "Report" feedback button in the committed state, log to `ai_feedback` table for review. |
| Direct commit hits branch protection mid-flow | Helper detects via `GET /repos/{}/branches/{default}/protection`; falls back to PR mode automatically. Response carries `mode: 'pr-fallback'` so the client shows "Opened PR instead" rather than success. |
| Commit fails after AI generation already burned quota | The `/generate` endpoint returns the content; the `/commit-fix` endpoint is independently re-callable. User can keep the generated text and retry the commit later. |
| Quota exhaustion blocks other AI features | The `featureKey: 'COMMUNITY_HEALTH_FIX'` separates this consumer for per-feature quota tracking. |

### Out-of-spec follow-ups

1. Bulk fix across multiple repos.
2. Custom file generators (CHANGELOG.md, FUNDING.yml, etc.).
3. README enrichment (extending an existing stub).
4. Auto-PR-merge if branch is unprotected and tests pass.
5. Suggesting fixes for *low-quality* existing files (size < 500 bytes, suggesting expansion).

---

## 5. Testing & acceptance

### Unit tests

- `server/__tests__/community-health-fix.test.js`
  - Each deterministic generator produces expected content with placeholder substitution.
  - Each AI generator calls `provider.generate` with the documented prompt shape.
  - Generators sanitize `repo.description` before injecting.
  - Branch-protection detection: protected → PR fallback path; unprotected → direct commit path.
  - Commit helper invalidates the health cache on success.
- `server/__tests__/community-health-fix-route.test.js`
  - `/generate` returns 200 with `content` field for each file type.
  - `/generate` returns 403 `ai_not_configured` when no provider.
  - `/commit-fix` returns 200 with `sha` + `branch`.
  - `/commit-fix` returns `mode: 'pr-fallback'` when default branch is protected.
  - `/commit-fix` invalidates `community_health_cache`.
  - All AIError codes (QUOTA, RATE_LIMITED, OVERLOAD, …) map to friendly error responses (reuses slice 3 pattern).
- `tests/components/AI/CommunityHealthFixModal.test.jsx`
  - Generate state shows loading skeleton.
  - Preview state shows generated content + editable textarea.
  - User edit is preserved when committing.
  - Committed state shows commit URL.
  - Quota error from `/generate` shows friendly headline (not raw RPC).
  - "Configure AI" CTA replaces the modal when `ai_not_configured`.

### E2E test

- `e2e/community-health-fix.spec.js`
  - Mock-mode user opens Community Health for a repo with no LICENSE.
  - Clicks "Fix with AI" on the LICENSE row.
  - Sees license-picker dropdown (default MIT), can change.
  - Sees preview, edits the year placeholder.
  - Clicks "Commit" → success state appears.
  - LICENSE row updates from X to checkmark in the dashboard.

### Acceptance criteria

| # | Criterion | Verification |
|---|---|---|
| 1 | Missing files show "Fix with AI" button | Visual smoke test |
| 2 | Deterministic files (LICENSE, CoC) skip the AI provider | Provider mock asserts not called |
| 3 | AI-generated files use the documented prompt shape | Prompt snapshot test |
| 4 | Branch protection auto-falls back to PR | Mocked GitHub API test |
| 5 | Health cache invalidated after commit | DB row check after commit-fix call |
| 6 | Quota errors use friendly UI (no raw RPC dump) | Reuses pattern from `b9e093a` |
| 7 | "Configure AI" CTA when no provider | Component test |
| 8 | All 7 file types have generators | Catalogue test enumerates and asserts |

---

## 6. Definition of done

After all 9 steps merge:
- 7 file generators tested (2 deterministic + 5 AI).
- 2 new endpoints with full error mapping.
- New modal with 3 states.
- `fix_community_health` action in registry (or skipped if slice 1 hasn't landed yet — note in PR description).
- Health score actually updates after a commit.
- E2E test passes against mock mode.
- Bundle delta < +20 KB gzipped (license texts are the bulk; ~12 KB compressed).
- Documentation updated: `docs/architecture/overview.md` gains a "Community Health AI Auto-Fix" subsection.
