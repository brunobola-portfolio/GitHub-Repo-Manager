# PR Review Experience — Design Spec

**Date:** 2026-04-09
**Status:** Draft
**Author:** Bruno + Claude

## Problem Statement

GitHub's PR review experience is broken for large PRs: 300+ file diffs freeze the browser for 8-10s, file tree filters lag, and there's no AI-assisted triage. Developers resort to reviewing locally or using expensive third-party tools like Graphite.

This app already manages repositories, PRs, and has Gemini AI integrated — but the PR experience is metadata-only (list, merge, close). There is no diff viewer, no inline commenting, no code review workflow.

## Goal

Build a fast, AI-assisted PR review experience that handles large PRs (500+ files) gracefully, with full bidirectional sync to GitHub. The experience should feel like a purpose-built review tool, not a GitHub wrapper.

## Non-Goals

- Stacked PRs / stacked diffs (requires CLI tool, massive scope)
- Merge queues (GitHub has native support)
- PR creation workflow (already functional)
- Suggested changes (V2)
- Reactions on comments (V2)
- Edit/delete own comments (V2)
- Draft reviews / PENDING state management (V2)
- Command palette (V2)
- Custom keybindings (V2)

---

## Architecture

### New View: `pr-review`

Full-screen view added to the `activeView` state-based routing in `App.jsx`. Accessed via "Review" button in `PRDetailPanel`. Exits via breadcrumb navigation back to repo detail.

### Component Structure

```
src/components/PRReview/
├── PRReviewView.jsx          — Container full-screen (entry point, lazy-loaded)
├── FileTree/
│   ├── FileTree.jsx          — Virtualized file tree (@tanstack/react-virtual)
│   └── FileTreeItem.jsx      — Individual row (status icon + name + checkmark + risk badge)
├── DiffPanel/
│   ├── DiffPanel.jsx         — Container (manages active file)
│   ├── DiffRenderer.jsx      — Abstraction over @git-diff-view/react (swappable to CM6)
│   └── InlineComment.jsx     — Comment widget (thread + reply + resolve)
├── ReviewToolbar/
│   ├── ReviewToolbar.jsx     — Top bar (breadcrumbs, submit review, split/unified toggle)
│   └── ReviewStatusBar.jsx   — Bottom bar (progress, pending count, shortcut hints)
├── AIInsights/
│   ├── AISummaryPanel.jsx    — Collapsible AI summary at top of diff area
│   └── FileRiskBadge.jsx     — Risk indicator dot per file in tree
└── hooks/
    ├── useReviewData.js      — Fetch PR data, diff, comments, reviews
    ├── useReviewState.js     — Local state: active file, reviewed set, view mode
    ├── useReviewKeyboard.js  — 6 keyboard shortcuts
    └── useReviewAI.js        — Gemini summary + file risk scoring
```

### Layout (3 zones)

```
┌─────────────────────────────────────────────────────────┐
│  ReviewToolbar (breadcrumbs, submit, split/unified)     │
├────────────┬────────────────────────────────────────────┤
│            │  AISummaryPanel (collapsible)              │
│  FileTree  ├────────────────────────────────────────────┤
│  (250px,   │                                            │
│  resizable)│  DiffRenderer                              │
│            │  (selected file)                           │
│  - badges  │                                            │
│  - ✓ marks │  [InlineComment threads intercalated]      │
│  - risk    │                                            │
│            │                                            │
├────────────┴────────────────────────────────────────────┤
│  ReviewStatusBar (12/47 reviewed · j/k nav · x mark)   │
└─────────────────────────────────────────────────────────┘
```

### Navigation

- **Entry:** PullRequestsTab → PRDetailPanel → "Review" button → `setActiveView('pr-review')`
- **Exit:** Breadcrumbs `Repo > Pull Requests > PR #42 > Review` — each level clickable
- **Context preserved:** RepoDetail state maintained when navigating back

### DiffRenderer Abstraction

```jsx
// DiffRenderer.jsx — stable interface
<DiffRenderer
  filename="src/App.jsx"
  patch={unifiedDiffString}
  viewMode="split" | "unified"
  comments={inlineComments}
  onAddComment={(line, side) => {}}
  onLineHover={(line) => {}}
  highlightLanguage="javascript"
/>

// Internally uses @git-diff-view/react
// If migration to CM6 needed, only this component's internals change
```

---

## Technology Stack

| Component | Library | Bundle Size | Rationale |
|-----------|---------|-------------|-----------|
| Diff viewer | `@git-diff-view/react` | ~40 KB | Built-in virtual scrolling (60fps), widget API for inline comments, split+unified, GitHub-style rendering |
| Syntax highlighting | Shiki (via HAST AST) | ~200 KB on demand | 200+ languages, VS Code quality, lazy-loads grammars, native support in @git-diff-view |
| File tree virtualizer | `@tanstack/react-virtual` | ~5 KB | Headless, handles 500+ files, full rendering control |
| Diff parsing (large PRs) | Web Worker | — | Off-thread diff computation for diffs > 50KB |
| AI summaries | Gemini (existing) | 0 KB | Reuses ai-service.js infrastructure |
| Animations | Framer Motion (existing) | 0 KB | Already a project dependency |

### Fallback path

If `@git-diff-view/react` proves limiting (maintenance risk at 676 stars), the `DiffRenderer` abstraction allows swapping to CodeMirror 6 (`@codemirror/merge`, ~124 KB) without touching any other component. CM6 offers better mobile support and is battle-tested (Sourcegraph, Replit).

### Reference implementations to study

- **Diffity** (535 stars) — React + Vite + Tailwind, inline commenting, closest stack match
- **Pulldash** (108 stars, by Coder) — Keybind-driven, `useSyncExternalStore` for O(1) navigation

---

## Backend API

### Existing endpoints (no changes needed)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/:owner/:repo/pulls` | GET | List PRs |
| `/:owner/:repo/pulls/:pull_number` | GET | Get single PR |
| `/:owner/:repo/pulls/:pull_number/reviews` | GET | List reviews |
| `/:owner/:repo/pulls/:pull_number/files` | GET | List files with patches |
| `/:owner/:repo/pulls/:pull_number/merge` | PUT | Merge PR |

### New endpoints

| Endpoint | Method | GitHub API Proxy | Purpose |
|----------|--------|-----------------|---------|
| `/:owner/:repo/pulls/:pull_number/diff` | GET | `Accept: application/vnd.github.diff` | Full unified diff (for AI summary) |
| `/:owner/:repo/pulls/:pull_number/comments` | GET | `GET /pulls/{n}/comments` | Inline review comments (not general issue comments) |
| `/:owner/:repo/pulls/:pull_number/comments` | POST | `POST /pulls/{n}/comments` | Create inline comment (path, line, side, body) |
| `/:owner/:repo/pulls/:pull_number/comments/:comment_id/replies` | POST | `POST /pulls/{n}/comments/{id}/replies` | Reply to comment thread |
| `/:owner/:repo/pulls/:pull_number/reviews` | POST | `POST /pulls/{n}/reviews` | Submit review (event + body + comments array) |

### AI endpoint

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/ai/review-summary` | POST | Send diff to Gemini, return summary + risk scores per file |

New method `reviewPullRequest(diffText, prMetadata)` in `server/ai-service.js`.

---

## Data Flow

```
1. User clicks "Review" in PRDetailPanel
   │
   ├─ setActiveView('pr-review')
   └─ useReviewData(owner, repo, pullNumber) initiates:
      │
      ├─── GET /pulls/:n              → PR metadata
      ├─── GET /pulls/:n/files        → File list with patches
      ├─── GET /pulls/:n/comments     → Existing inline comments
      ├─── GET /pulls/:n/reviews      → Existing reviews
      └─── POST /api/ai/review-summary → AI summary (async, non-blocking)
           │
           │  (all in parallel via Promise.all, AI separate)
           │
           ▼
      useReviewState receives data:
      │
      ├─ fileTree: files sorted by AI risk score (descending)
      ├─ reviewedFiles: Set<string> (persisted in localStorage)
      ├─ activeFile: string (first file by default)
      ├─ viewMode: 'split' | 'unified' (persisted in localStorage)
      └─ comments: Map<filename, Comment[]> (grouped by file)
           │
           ▼
      DiffRenderer receives:
      ├─ patch from active file (from /files response)
      ├─ comments filtered for that file
      └─ viewMode
```

### State shape

```javascript
// useReviewState.js
{
  // PR data (immutable during session)
  pr: { title, number, author, base, head },
  files: [{ filename, status, additions, deletions, patch }],
  
  // Local state (mutable)
  activeFile: 'src/App.jsx',
  reviewedFiles: new Set(['src/index.js']),  // persisted in localStorage
  viewMode: 'split',                          // persisted in localStorage
  fileTreeCollapsed: false,
  aiSummaryCollapsed: false,
  
  // Comments (synced with GitHub)
  comments: Map<filename, Comment[]>,
  pendingComments: [],   // comments not yet submitted to GitHub
  
  // AI
  aiSummary: { overview, riskLevel, keyChanges, fileRisks, suggestedReviewOrder, estimatedReviewTime },
  aiLoading: boolean
}
```

### Review submission — batch strategy

Accumulate all `pendingComments` and submit in a single `POST /pulls/{n}/reviews`:

```json
{
  "event": "APPROVE",
  "body": "Looks good overall.",
  "comments": [
    { "path": "src/App.jsx", "line": 42, "side": "RIGHT", "body": "Consider memoizing" },
    { "path": "src/utils.js", "line": 10, "side": "RIGHT", "body": "Possible null deref" }
  ]
}
```

Single API call, avoids rate limits (500 content-creation/hour).

**Note:** This is an in-memory batch within the current session, not a GitHub PENDING review. The user accumulates comments locally, then submits everything at once. If the user closes the tab before submitting, pending comments are lost (intentional — avoids stale PENDING reviews on GitHub).

### Diff source

The `/pulls/{n}/files` endpoint returns a `patch` field per file — a unified diff string ready for `@git-diff-view/react` to parse. The full diff (`Accept: application/vnd.github.diff`) is only used for the AI summary (needs global context).

---

## AI Integration

### Gemini Review Summary

New method in `ai-service.js`, reusing the existing Gemini client:

```javascript
// Prompt structure for reviewPullRequest()
{
  systemInstruction: "You are a senior code reviewer. Analyze this PR diff and provide a structured review summary.",
  
  input: {
    diff: "<full unified diff text>",
    prTitle: "Add user authentication",
    prDescription: "Implements JWT-based auth...",
    filesChanged: 47,
    additions: 1200,
    deletions: 340
  },
  
  output: {
    overview: "This PR adds JWT authentication with refresh tokens...",
    riskLevel: "medium",           // low | medium | high | critical
    keyChanges: [
      "New auth middleware in server/middleware/auth.js",
      "Token refresh logic in src/hooks/useAuth.js",
      "Database migration for sessions table"
    ],
    fileRisks: [
      { file: "server/middleware/auth.js", risk: "high", reason: "Security-critical: token validation logic" },
      { file: "src/hooks/useAuth.js", risk: "medium", reason: "State management complexity" },
      { file: "src/App.jsx", risk: "low", reason: "Only adds route guards" }
    ],
    suggestedReviewOrder: [
      "server/middleware/auth.js",
      "server/db/migrations/003.sql",
      "src/hooks/useAuth.js"
    ],
    estimatedReviewTime: "25-35 min"
  }
}
```

### AI Summary Panel UI

Collapsible panel at the top of the diff area:

```
┌─ AI Review Summary ──────────────────────── ▼ Collapse ─┐
│                                                          │
│  Medium Risk · 47 files · ~30 min review                 │
│                                                          │
│  This PR adds JWT authentication with refresh tokens.    │
│  Key areas: auth middleware, token refresh, DB migration. │
│                                                          │
│  Priority files:                                         │
│  [red]    server/middleware/auth.js — token validation    │
│  [yellow] src/hooks/useAuth.js — state complexity        │
│  [green]  src/App.jsx — only route guards                │
│                                                          │
│  Following AI suggested review order                     │
└──────────────────────────────────────────────────────────┘
```

### File risk badges in tree

Each file in the FileTree shows a colored dot from `fileRisks`:

```
server/
  [red]    middleware/auth.js        ✓
  [green]  routes/users.js
src/
  [yellow] hooks/useAuth.js
  [green]  App.jsx                   ✓
```

### AI Behavior

- **Non-blocking:** AI summary fetched in parallel. Review is usable immediately; summary appears when ready (skeleton loader)
- **Ordering opt-in:** File tree sorts by AI risk by default, toggle for alphabetical
- **Cache:** Summary stored in `sessionStorage` keyed by PR number. No re-fetch on revisit
- **Graceful fallback:** If Gemini fails or `GEMINI_API_KEY` not set, the AI panel simply doesn't appear. Zero impact on review functionality
- **Token limit:** For diffs > 100KB, truncate low-risk files and send only the most relevant (by additions/deletions count)

---

## UX Details

### Keyboard Shortcuts

Hook `useReviewKeyboard.js`, same pattern as existing `useKeyboardShortcuts.js`:

| Key | Action | Context |
|-----|--------|---------|
| `j` | Next file in tree | Always active (except inside inputs) |
| `k` | Previous file | Always active |
| `x` | Toggle "reviewed" on active file | Always active |
| `Enter` | Expand/collapse selected file in tree | Focus on file tree |
| `c` | Open comment box at hovered line | Focus on diff |
| `Escape` | Close comment box / close AI panel / navigate back | Contextual (innermost first) |
| `[` / `]` | Previous / next hunk within diff | Focus on diff |
| `Ctrl+Enter` | Submit comment being edited | Inside comment box |

Shortcuts disabled when focus is on `input`, `textarea`, or `[contenteditable]`.

### Review Status Bar

Fixed at bottom, always visible:

```
┌──────────────────────────────────────────────────────────┐
│ ✓ 12/47 reviewed · 3 comments pending · j/k nav · x mark│
└──────────────────────────────────────────────────────────┘
```

- Visual progress bar (gradient) showing % reviewed
- Pending comments counter
- Shortcut hints (disappear after 3 sessions via localStorage counter)

### Submit Review Flow

"Submit Review" button in ReviewToolbar opens dropdown:

- **Comment** — general feedback only
- **Approve** — approve this PR
- **Request Changes** — block merge until resolved

Text area for review body (optional). Submit sends all pending inline comments as part of the review.

### Inline Comment Widget

Injected between diff lines via `@git-diff-view/react` widget API:

```
  41 │  const token = getToken();
  42 │  if (!token) return null;      ← hover shows [+] button in gutter
     │ ┌──────────────────────────────────────┐
     │ │ bruno · 2 min ago                    │
     │ │ Consider using optional chaining here│
     │ │                                       │
     │ │   ana · 1 min ago                     │
     │ │   Good catch, fixing now              │
     │ │                                       │
     │ │ [Reply...]              [Resolve]     │
     │ └──────────────────────────────────────┘
  43 │  const decoded = jwt.verify(token);
```

- **New comment:** Click gutter `[+]` or press `c` → inline textarea expands
- **Threading:** Comments grouped by `in_reply_to_id`, collapsible
- **Resolve:** Local-only visual state (reduced opacity, collapsed by default). GitHub's PR review comments API does not support resolve/unresolve — this is a UI convenience stored in localStorage, not synced to GitHub. If GitHub adds resolve support in the future, this can be upgraded.
- **Pending vs submitted:** Pending comments have dashed border and "pending" badge

### Dark Mode

Follows existing system: `.dark` class on `<html>` with `@custom-variant dark`.

| Element | Light | Dark |
|---------|-------|------|
| File tree background | `bg-gray-50` | `dark:bg-gray-900` |
| Diff added lines | `bg-green-50` | `dark:bg-green-950/30` |
| Diff removed lines | `bg-red-50` | `dark:bg-red-950/30` |
| Active file highlight | `bg-blue-100` | `dark:bg-blue-900/40` |
| Comment widget | `bg-white border` | `dark:bg-gray-800 border-gray-700` |
| Risk badge high | `text-red-600` | `dark:text-red-400` |
| Toolbar | `bg-white border-b` | `dark:bg-gray-900 border-gray-800` |
| Status bar | `bg-gray-100` | `dark:bg-gray-900` |

No new design system classes. Tailwind utilities only. Animations via Framer Motion (fade-in for comment widgets, slide-in for AI summary panel).

### Responsiveness

| Breakpoint | Behavior |
|-----------|----------|
| Desktop (>1024px) | File tree + diff side by side |
| Tablet (768-1024px) | File tree as collapsible drawer overlay |
| Mobile (<768px) | File tree as bottom sheet, diff full-width, keyboard shortcuts disabled |

Responsive drawer pattern already exists in `App.jsx` (lines 904-934).

### State Persistence

`reviewedFiles` persisted in `localStorage` with key `pr-review-${owner}-${repo}-${pullNumber}`:

```json
{
  "reviewedFiles": ["src/App.jsx", "server/routes/users.js"],
  "viewMode": "split",
  "lastActiveFile": "src/hooks/useAuth.js",
  "aiSummaryCollapsed": true
}
```

Auto-cleaned after 30 days (cleanup on `useReviewState` mount).

---

## Dependencies (new)

| Package | Version | Purpose |
|---------|---------|---------|
| `@git-diff-view/react` | latest | Diff rendering with virtual scrolling |
| `@git-diff-view/shiki` | latest | Syntax highlighting integration |
| `@tanstack/react-virtual` | latest | File tree virtualization |
| `shiki` | latest | Syntax highlighting engine |

All MIT licensed. Total added bundle: ~245 KB (before tree-shaking).

---

## Future Work (V2)

- Suggested changes (markdown `suggestion` blocks with "Apply" button)
- Reactions on review comments (emoji picker)
- Edit/delete own comments
- Draft reviews (PENDING state — accumulate review, submit later)
- Command palette (Ctrl+K)
- Custom keybindings
- Azure DevOps Server (on-prem) migration support (separate spec)
- Inter-diff view (compare PR versions)
