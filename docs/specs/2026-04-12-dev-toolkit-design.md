# Dev Toolkit — Design Spec

**Date**: 2026-04-12
**Status**: Approved
**Scope**: Enhanced Commit Generator + PR Description Generator + Review Quick Summary

---

## 1. Overview

The Dev Toolkit is a unified, context-aware modal that consolidates three AI-powered developer productivity tools into a single, cohesive experience. It replaces the existing `CommitGeneratorModal` and adds two new capabilities: PR Description generation and a Review quick-summary launcher.

### Goals

- Eliminate manual friction (no more pasting diffs by hand)
- Auto-detect context from where the user opens the tool (repo, branch, PR)
- Provide intelligent, iterative AI refinement (not just one-shot generation)
- Close the loop: generate content AND act on it (copy, create PR, approve)
- Match the design quality of the existing app (glass, gradients, motion, responsive)

### Non-Goals

- Replace the full-screen PRReviewView (it stays as-is)
- Add new AI models or providers (uses existing Gemini integration)
- Change the AI Assistant floating widget

---

## 2. Architecture & Entry Points

### Modal Identity

- **Modal key**: `showDevToolkit` (replaces `showCommitGen`)
- **Component**: `DevToolkitModal.jsx` (replaces `CommitGeneratorModal.jsx`)
- **Size**: `3xl` (matches RepoInsightsModal)
- **Mobile**: `mobileVariant="sheet"` (bottom sheet)
- **Tabs**: Uses existing `TabBar` component with `variant="pill"`

### Tabs

| ID | Label | Icon |
|----|-------|------|
| `commits` | Commits | `GitCommitHorizontal` |
| `pr` | Pull Request | `GitPullRequest` |
| `review` | Review | `Eye` |

### Entry Points

| Location | Action | Context Passed |
|----------|--------|----------------|
| **Header** — existing Wand2 button | Opens Dev Toolkit, Commits tab | None (user picks repo/branch) |
| **Repo context menu** — "AI Commit" | Opens Commits tab | `{ repo, branch: null }` |
| **Repo context menu** — "Generate PR" (new) | Opens PR tab | `{ repo }` |
| **PR Detail panel** — "Generate Description" button (new) | Opens PR tab | `{ repo, pr: { number, base, head, title } }` |
| **Keyboard shortcut `g`** | Opens last-used tab | Remembers last `activeTab` in sessionStorage |

### Context Flow

```javascript
openModalWithData('showDevToolkit', {
  initialTab: 'commits' | 'pr' | 'review',
  repo: { full_name, owner: { login }, name },  // optional
  branch: 'feature-xyz',                         // optional
  pr: { number, base, head, title },             // optional
})
```

The modal reads `getModalData('showDevToolkit')` on open and auto-configures each tab. If no context is provided, the user selects manually via dropdowns.

### Migration from CommitGeneratorModal

- All existing `openModal('showCommitGen')` calls change to `openModalWithData('showDevToolkit', { initialTab: 'commits', ... })`
- All existing `openModalWithData('showCommitGen', data)` calls adapt the data shape
- `CommitGeneratorModal.jsx` is deleted after `DevToolkitModal.jsx` is complete
- Context menu action `'aiCommit'` is preserved, mapped to new modal

---

## 3. Tab: Commits (Enhanced Commit Generator)

### Input Modes

Two modes, toggled by a segmented control at the top:

#### Auto-Fetch Mode (default when repo context exists)

1. **Repo selector**: Searchable dropdown of the user's repos. Pre-filled when context is provided.
2. **Branch comparison**: Two dropdowns — "Branch" and "Compare against". The base branch is auto-detected (main/master/develop based on repo default branch). Branches are fetched from GitHub API on repo selection.
3. **Diff summary**: Collapsible panel showing files changed, lines added/removed per file. Fetched via the new Compare endpoint. Each file row is expandable to show its patch.
4. The full diff is sent to the AI but the user sees only the summary (not a wall of text).

#### Manual Paste Mode (fallback)

- Textarea (same as current `CommitGeneratorModal`)
- Placeholder: "Paste a git diff, file changes, or describe what you changed"
- Available always — for repos not on GitHub, quick use, or offline scenarios

### Format Selector

Horizontal pill group above the output area:

| Format | Output Style | Example |
|--------|-------------|---------|
| **Conventional** (default) | `type(scope): description` | `feat(auth): add JWT login with email validation` |
| **Gitmoji** | `emoji description` | `:sparkles: add JWT login with email validation` |
| **Descriptive** | Full sentence | `Add user login functionality with JWT tokens and email validation` |
| **Repo Convention** | Mimics repo's actual style | Varies — detected from last 20 commits |

"Repo Convention" calls the new `/api/repos/:owner/:repo/commits/style` endpoint which analyzes recent commit messages and returns a detected pattern (e.g., "conventional with JIRA prefix", "lowercase imperative", "gitmoji"). The AI prompt includes this pattern as a formatting instruction.

### Output Area

Terminal-style display (dark bg, monospace, green/emerald accent — matches current design) showing the generated commit message.

**Refinement chips** (below the output):

| Chip | AI Instruction |
|------|----------------|
| Shorter | Compress to single line, remove body |
| More detail | Add multi-line body with bullet points |
| + Body | Keep subject, add explanatory body paragraph |
| Breaking change | Add `BREAKING CHANGE:` footer |
| Regenerate | Generate a completely different message |

Each refinement sends the original diff + previous output + instruction to `/api/ai/refine`. The AI maintains context — refinements are incremental, not from scratch.

**Copy actions**:
- "Copy message" — plain text of the commit message
- "Copy as git command" — wraps in `git commit -m "..."` (handles multi-line with heredoc)

Both show a checkmark animation on click (spring transition, 2s revert).

### Multi-Commit Splitting

When the diff exceeds **300 total changed lines** (additions + deletions combined), a suggestion appears:

```
💡 Large diff detected. Split into logical commits?
   [Split into commits]   [No thanks]
```

If accepted, the AI analyzes the diff and returns an ordered list of suggested commits, each with:
- Commit message (in the selected format)
- List of files belonging to that commit
- Copy button per commit

The user can:
- **Use all** — copies the full sequence
- **Edit** — inline edit any individual message
- **Dismiss** — return to single commit mode

### Session History

A horizontal ribbon at the bottom of the output area showing the last 5 generated messages in the current modal session (not persisted to storage). Each is a truncated pill — click to restore.

---

## 4. Tab: Pull Request (PR Description Generator)

### Context Detection

Three entry scenarios:

| Scenario | What Happens |
|----------|--------------|
| **Opened from PR Detail** | PR number, base, head, title, existing body all pre-loaded. Commits and diff fetched automatically. |
| **Opened from repo context** | Repo pre-filled. User selects base/head branches. System checks if a PR already exists for this comparison. |
| **No context** | User selects repo, then branches. Same flow as Commits tab repo/branch selectors. |

### PR Template Detection

On repo selection, the backend checks for `.github/PULL_REQUEST_TEMPLATE.md` (case-insensitive). If found, the AI uses it as the structural skeleton — filling in each section rather than inventing its own format. A small badge shows "Using repo template" or "Using default template".

### Generated Sections

Each section is independently editable, copyable, and refinable:

#### Title
- Single line, conventional format by default
- Edit icon toggles inline editing
- Copy icon copies just the title

#### Summary
- Markdown bullet points of key changes
- Derived from commit messages + diff analysis
- Refinement chips: `[Shorter]` `[More context]` `[Add architecture notes]`

#### Test Plan
- Markdown checklist format (`- [ ] ...`)
- AI infers testable behaviors from the diff
- Refinement chips: `[More cases]` `[Add edge cases]` `[E2E focus]`

#### Breaking Changes
- Auto-detected from: removed exports, changed function signatures, schema migrations, API endpoint changes
- Shows "None detected" with a green indicator when clean
- If detected, formatted as a markdown section with migration instructions

#### Related Issues
- Auto-extracted from commit messages (patterns: `#123`, `fixes #123`, `closes #123`, `JIRA-456`)
- Classified as: Closes / Fixes / Relates to
- User can add more manually

#### Labels
- Auto-suggested based on:
  - File paths changed (e.g., `src/components/` → `frontend`, `server/` → `backend`, `tests/` → `testing`)
  - Commit type (feat → `feature`, fix → `bug`, docs → `documentation`)
  - Diff characteristics (large diff → `major`, only tests → `testing`)
- Shown as removable pills with an "+ Add" button
- Matched against actual repo labels from GitHub API

#### Reviewers
- Source 1: `CODEOWNERS` file (if exists) — matched against changed file paths
- Source 2: Git history — most frequent contributors to the changed files
- Shown as user avatars/pills, removable, with "+ Add" button

### Actions

Three primary actions in the footer:

| Button | Condition | Behavior |
|--------|-----------|----------|
| **Copy All** | Always available | Copies full markdown (title + all sections) |
| **Create PR** | No PR exists for base...head | Creates PR via GitHub API with generated title, body, labels, reviewers |
| **Update PR** | PR already exists | Updates existing PR description via GitHub API |

"Create PR" and "Update PR" show a confirmation step (small inline confirmation, not a separate modal) before executing. On success, a toast notification appears with a link to the PR on GitHub.

### Regenerate

"Regenerate" button re-generates all sections from scratch. Individual section refinement chips only re-generate that section.

---

## 5. Tab: Review (Quick Summary + Launcher)

This tab does NOT replicate PRReviewView. It provides a fast AI-powered overview and a bridge to the full review experience.

### PR Selection

If no PR context is provided, shows a list of open PRs for the selected repo (or across all repos if no repo selected). Each card shows: title, author avatar, age, file count, draft status.

### Quick Summary Panel

When a PR is selected, displays:

- **Risk level**: Color-coded badge (Low/Medium/High/Critical) with icon
- **Estimated review time**: e.g., "~15 min"
- **Overview**: 2-3 sentence AI summary of what the PR does
- **Key Changes**: Bullet list of the most important changes
- **High-Risk Files**: Top 5 files by risk score, each showing filename + additions/deletions + risk reason. Clickable — opens in the full review.

This reuses the existing `useReviewAI` hook and its 1-hour localStorage cache. No new AI endpoint needed.

### Quick Actions

For simple, low-risk PRs where a full review is overkill:

| Action | What It Does |
|--------|-------------|
| **Quick Approve** | Submits an "APPROVE" review with an optional one-line comment |
| **Quick Comment** | Submits a "COMMENT" review with a text input |

Quick Approve is only shown when the user has write/maintain permission on the repo (checked via GitHub API collaborator permissions). For users with read-only access, only Quick Comment is available.

Both use the existing review submission API (`POST /api/repos/:owner/:repo/pulls/:number/reviews`). A confirmation step is shown before submission.

### Full Review Launch

A prominent "Open Full Review" button navigates to the existing PRReviewView (sets `activeView` to `pr-review` and `reviewingPR` state). The toolkit modal closes automatically.

---

## 6. Shared UX Patterns

### Repo & Branch Selectors (shared across tabs)

The Commits and PR tabs share the same repo/branch selector components:

- **Repo selector**: Searchable dropdown with repo avatars, filtered as user types. Uses existing repo list from `useGitHub`.
- **Branch selector**: Dropdown populated on repo selection. Shows default branch with a star indicator. Supports search for repos with many branches.
- When the user selects a repo in one tab, the selection persists when switching to another tab (shared state within the modal).

### Loading States

- **Diff fetching**: Shimmer skeleton in the diff summary area (3 rows)
- **AI generation**: Shimmer skeleton in the output area, pulsing. NOT a spinner.
- **Section regeneration**: Only the affected section shows shimmer; others remain stable.
- **Quick summary**: Shimmer in the summary panel, same as existing AISummaryPanel pattern.

### Error States

- **No API key**: Friendly message with link to Settings. "Configure your Gemini API key in Settings to use AI features."
- **Rate limit exceeded (429)**: Shows remaining quota and reset time. "You've used all your AI queries this month. Resets on [date]."
- **GitHub API error**: Specific message per error type (404 → "Repository not found", 403 → "Access denied", network → "Could not reach GitHub").
- **AI generation error**: "Something went wrong generating your content. Try again." with a Retry button.

### Animations (Framer Motion)

| Element | Animation |
|---------|-----------|
| Tab switch | `layoutId` animated indicator on TabBar (existing pattern) |
| Output appearance | `opacity: 0, y: 8` → `opacity: 1, y: 0`, duration 250ms |
| Refinement | Crossfade on content change, duration 200ms |
| Diff summary accordion | `height: auto` animation with overflow hidden |
| Multi-commit cards | `staggerChildren` with 50ms delay |
| Copy feedback | Spring animation (checkmark replaces clipboard icon) |
| Section edit toggle | Scale 0.95 → 1.0 on focus |
| Loading shimmer | CSS animation via `ds-skeleton` class |

### Keyboard Shortcuts (inside toolkit)

| Shortcut | Action |
|----------|--------|
| `g` | Open Dev Toolkit (global) |
| `1` / `2` / `3` | Switch tabs |
| `Cmd/Ctrl + Enter` | Generate / Regenerate |
| `Cmd/Ctrl + Shift + C` | Copy primary output |
| `Escape` | Close toolkit |

Shortcuts are disabled when focus is inside a textarea or input (same pattern as `useKeyboardShortcuts`).

---

## 7. Mobile Experience

### Layout

- Modal opens as bottom sheet (`mobileVariant="sheet"`)
- Tabs remain at the top, horizontally scrollable if needed
- Repo/branch selectors become full-width stacked dropdowns
- Output sections stack vertically, each collapsible with tap-to-expand
- Action buttons are in a sticky footer (always visible)
- Diff summary shows only file count + total lines; tap to expand individual files

### Gestures

- Horizontal swipe between tabs (using Framer Motion drag)
- Pull-down on sheet to close
- Tap outside sheet to close

### Responsive Breakpoints

| Breakpoint | Behavior |
|------------|----------|
| `< 640px` (mobile) | Sheet variant, stacked layout, sticky footer |
| `640px - 1024px` (tablet) | Modal variant, slightly narrower max-width |
| `> 1024px` (desktop) | Full 3xl modal, side-by-side elements where applicable |

---

## 8. Backend — New Endpoints

### Compare Branches

```
GET /api/repos/:owner/:repo/compare/:base...:head
```

Proxies the GitHub Compare API. Returns:

```json
{
  "ahead_by": 5,
  "behind_by": 0,
  "total_commits": 5,
  "commits": [{ "sha": "...", "message": "...", "author": "..." }],
  "files": [{ "filename": "...", "status": "modified", "additions": 89, "deletions": 12, "patch": "..." }],
  "diff_summary": { "files_changed": 5, "additions": 142, "deletions": 38 }
}
```

### Detect Commit Style

```
GET /api/repos/:owner/:repo/commits/style
```

Fetches the last 20 commit messages and analyzes the pattern using heuristic pattern matching (regex-based detection of conventional commits, gitmoji, JIRA prefixes, etc.) — no AI call needed. Returns:

```json
{
  "detected_style": "conventional",
  "pattern": "type(scope): description",
  "examples": ["feat(auth): add login", "fix(api): handle 404"],
  "confidence": 0.85,
  "prefixes": { "feat": 8, "fix": 5, "chore": 4, "refactor": 3 }
}
```

### Fetch PR Template

```
GET /api/repos/:owner/:repo/pr-template
```

Checks for `.github/PULL_REQUEST_TEMPLATE.md` (case-insensitive). Returns:

```json
{
  "found": true,
  "template": "## Summary\n\n## Test Plan\n\n## Breaking Changes\n",
  "path": ".github/PULL_REQUEST_TEMPLATE.md"
}
```

### Parse CODEOWNERS

```
GET /api/repos/:owner/:repo/codeowners
```

Fetches and parses CODEOWNERS file. Returns:

```json
{
  "found": true,
  "rules": [
    { "pattern": "src/components/*", "owners": ["@alice", "@bob"] },
    { "pattern": "server/*", "owners": ["@charlie"] }
  ]
}
```

### Generate Commit Message (dedicated)

```
POST /api/ai/generate-commit
```

Request:

```json
{
  "diff": "...",
  "format": "conventional | gitmoji | descriptive | repo-convention",
  "repo_style": { "detected_style": "...", "pattern": "...", "examples": [...] },
  "repo_context": { "name": "...", "description": "..." }
}
```

The `repo_style` field matches the response shape from `GET /commits/style`. It is only required when `format` is `"repo-convention"`; omit it for other formats.

Response:

```json
{
  "message": "feat(auth): add JWT login with email validation",
  "subject": "feat(auth): add JWT login with email validation",
  "body": "- Implement login endpoint with JWT tokens\n- Add bcrypt password hashing\n- Validate email format on registration",
  "format_used": "conventional"
}
```

### Generate PR Description (dedicated)

```
POST /api/ai/generate-pr
```

Request:

```json
{
  "commits": [{ "sha": "...", "message": "..." }],
  "diff_summary": { "files": [...], "additions": 142, "deletions": 38 },
  "top_patches": "...",
  "template": "...",
  "repo_context": { "name": "...", "description": "...", "labels": [...] }
}
```

Response:

```json
{
  "title": "feat(auth): add JWT authentication system",
  "summary": "## Summary\n- Add JWT-based login...",
  "test_plan": "## Test plan\n- [ ] Login with valid credentials...",
  "breaking_changes": null,
  "related_issues": [{ "number": 42, "relation": "closes" }],
  "suggested_labels": ["feature", "auth", "backend"],
  "suggested_reviewers": ["alice", "bob"]
}
```

### Refine Content (shared)

```
POST /api/ai/refine
```

Request:

```json
{
  "original_content": "...",
  "original_diff": "...",
  "instruction": "shorter | more_detail | add_body | breaking_change | more_cases | edge_cases | e2e_focus | architecture_notes",
  "content_type": "commit | pr_summary | pr_test_plan"
}
```

Response:

```json
{
  "refined_content": "..."
}
```

All three AI endpoints:
- Require `requireAuth` middleware
- Check `checkUsageLimit(userId, 'ai_queries')`
- Log to audit trail
- Increment usage meter
- Return structured JSON (not raw text)

---

## 9. Component Structure

```
src/components/DevToolkit/
├── DevToolkitModal.jsx              // Main modal shell with tabs
├── shared/
│   ├── RepoSelector.jsx             // Searchable repo dropdown
│   ├── BranchSelector.jsx           // Branch dropdown with auto-detect
│   ├── DiffSummary.jsx              // Collapsible file change summary
│   ├── OutputSection.jsx            // Terminal-style output with copy
│   ├── RefinementChips.jsx          // Refinement action pills
│   └── SectionCard.jsx              // Editable/copyable section wrapper
├── CommitTab/
│   ├── CommitTab.jsx                // Main commits tab
│   ├── FormatSelector.jsx           // Commit format pills
│   ├── MultiCommitSplit.jsx         // Multi-commit suggestion UI
│   └── SessionHistory.jsx           // Recent generations ribbon
├── PRTab/
│   ├── PRTab.jsx                    // Main PR tab
│   ├── PRSections.jsx               // All generated sections
│   ├── LabelPills.jsx               // Suggested labels with add/remove
│   ├── ReviewerPills.jsx            // Suggested reviewers with add/remove
│   └── CreatePRConfirm.jsx          // Inline confirmation for Create/Update PR
└── ReviewTab/
    ├── ReviewTab.jsx                // Main review tab
    ├── PRSelector.jsx               // Open PR list for selection
    ├── QuickSummary.jsx             // AI risk summary panel
    └── QuickActions.jsx             // Approve/Comment quick actions
```

### Hook

```
src/hooks/useDevToolkit.js
```

Manages shared state across tabs:
- Selected repo and branches (shared between Commits and PR tabs)
- Fetched diff data (shared — no duplicate API calls)
- Active tab (persisted to sessionStorage)
- Generation history (session-scoped)

---

## 10. Migration Plan

### What Changes

| Before | After |
|--------|-------|
| `CommitGeneratorModal.jsx` | Deleted — replaced by `DevToolkitModal.jsx` |
| `showCommitGen` modal key | Replaced by `showDevToolkit` |
| Header Wand2 button opens CommitGen | Opens Dev Toolkit (Commits tab) |
| Context menu "AI Commit" | Opens Dev Toolkit (Commits tab) with repo context |
| No PR description generation | New tab in Dev Toolkit |
| PR Review only via PR Detail → Review button | Also accessible via Dev Toolkit Review tab |

### What Stays the Same

| Feature | Status |
|---------|--------|
| PRReviewView full-screen experience | Unchanged |
| AI Assistant floating widget | Unchanged |
| RepoInsightsModal | Unchanged |
| `/api/ai/chat` endpoint | Unchanged (still used by AI Assistant) |
| `useAI` hook | Unchanged (still used by AI Assistant) |
| `useReviewAI` hook | Reused by Review tab |

### Backward Compatibility

- No breaking changes to existing features
- Users who used the old Commit Generator will find the same functionality in the Commits tab (plus improvements)
- All existing keyboard shortcuts preserved; `g` is new
- Context menu actions preserved with updated targets
