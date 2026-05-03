# PR Review Premium — Design Spec

**Date:** 2026-05-03  
**Status:** Approved — ready for implementation

---

## Goal

Transform the PR detail panel's Files tab into a premium, 3-column code review surface that rivals and surpasses GitHub's review experience — reusing 100% of the production-ready components already in `src/components/PRReview/`.

---

## Problem Statement

The current `PRDetailPanel` Files tab renders diffs as plain monospace text (`<pre>` blocks). The full-featured `PRReviewView` (syntax highlight, file tree, AI insights, inline comments, keyboard shortcuts) exists and is production-ready but is only accessible via a secondary "Start Review" button. Most users never discover it. The two modes fetch the same data independently (double-fetch).

---

## Solution Architecture

### Shared Data Layer

Create `src/hooks/usePRData.js` — a single hook that:
- Fetches PR detail, files, reviews, and comments in parallel
- Caches results in a module-level Map (keyed by `owner/repo/number`)
- Is used by **both** `PRDetailPanel` and `PRReviewView` — zero double-fetch
- Is MOCK_MODE-aware (returns mock data without hitting the server)

### New Files Tab Component

Create `src/components/RepoDetail/PRFilesTab.jsx` — a self-contained 3-column layout:

```
┌──────────────┬──────────────────────────────┬───────────────┐
│  File Tree   │  DiffRenderer (active file)  │  AI Summary   │
│  220px fixed │  flex-1, syntax highlight    │  280px fixed  │
│              │  unified ↔ split toggle      │  collapsible  │
│  ○ client.js │                              │  PR-level     │
│  ● useAuth   │  @@ -10,7 +10,10 @@         │  overview,    │
│  ✓ Button    │  - old line                 │  key changes, │
│              │  + new line                 │  top risks    │
│  [✓] 1/4    │                              │               │
└──────────────┴──────────────────────────────┴───────────────┘
```

**Columns:**
- **Left (220px):** `FileTree` + `FileTreeItem` from `src/components/PRReview/FileTree/` — shows all changed files sorted by AI risk score, with per-file reviewed state (○/●/✓)
- **Centre (flex-1):** `DiffRenderer` from `src/components/PRReview/DiffPanel/DiffRenderer.jsx` — syntax-highlighted diff of active file, unified/split toggle
- **Right (280px, collapsible):** `AISummaryPanel` from `src/components/PRReview/AIInsights/AISummaryPanel.jsx` — PR-level AI analysis (overview, key changes, top 5 risk files, estimated review time). Stays constant while navigating files.

**Responsive behaviour:**
- < 1100px: AI sidebar hidden by default (toggle button to reveal)
- < 900px: File tree auto-collapses, toggle button to reveal
- Mobile: stacked layout, tabs for tree/diff/AI

### Wire PRDetailPanel

`PRDetailPanel` delegates its Files tab entirely to `<PRFilesTab>`. The panel keeps its existing Overview and Reviews tabs unchanged. The `usePRData` hook replaces the inline `Promise.all` fetch.

### Wire PRReviewView

`PRReviewView` reads from the same `usePRData` cache — if data is already loaded (user came from PRDetailPanel), it opens instantly with no loading state.

---

## Components Reused — Zero Modifications

| Component | Location | Used As |
|---|---|---|
| `DiffRenderer` | `src/components/PRReview/DiffPanel/DiffRenderer.jsx` | Diff centre column |
| `FileTree` | `src/components/PRReview/FileTree/FileTree.jsx` | Left sidebar |
| `FileTreeItem` | `src/components/PRReview/FileTree/FileTreeItem.jsx` | Tree rows |
| `AISummaryPanel` | `src/components/PRReview/AIInsights/AISummaryPanel.jsx` | Right sidebar |
| `useReviewAI` | `src/components/PRReview/hooks/useReviewAI.js` | AI summary fetch |
| `heuristicRisk` | `src/components/PRReview/hooks/useReviewAI.js` | File risk scoring |
| `sortFilesByRisk` | `src/components/PRReview/hooks/useReviewAI.js` | File sort order |

---

## Scope Boundaries (NOT in this spec)

- Inline line comments in the Files tab (remains PRReviewView-only, Pro+)
- Keyboard shortcuts j/k in the Files tab (PRReviewView-only)
- Merge conflict resolution UI
- CI/status checks integration
- Real-time collaboration indicators

---

## Files Created / Modified

| Action | File | Purpose |
|---|---|---|
| CREATE | `src/hooks/usePRData.js` | Shared PR data hook with cache |
| CREATE | `src/components/RepoDetail/PRFilesTab.jsx` | 3-column premium files view |
| MODIFY | `src/components/RepoDetail/PRDetailPanel.jsx` | Delegate Files tab to PRFilesTab |
| MODIFY | `src/components/PRReview/PRReviewView.jsx` | Use usePRData (shared cache) |
| MODIFY | `src/__mocks__/mockRepoDetail.js` | Richer mock patches for demo |
| CREATE | `tests/hooks/usePRData.test.js` | Unit tests for shared hook |

---

## Success Criteria

1. Opening the Files tab shows syntax-highlighted diffs (not monospace text)
2. FileTree sidebar shows all changed files sorted by risk, with ✓/○ state
3. Clicking a file in the tree or AI panel navigates to that diff
4. AI panel loads PR-level summary (uses 1h localStorage cache)
5. "Deep Review →" button opens PRReviewView instantly (no loading state if already viewed Files tab)
6. Zero 401/404 console errors in mock mode
7. Works in dark mode
8. Responsive: usable on 1280px+ screens without horizontal scroll
