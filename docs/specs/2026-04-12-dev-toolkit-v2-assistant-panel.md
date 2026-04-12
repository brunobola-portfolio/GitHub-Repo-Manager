# Dev Toolkit v2 — AI Assistant Panel

**Date**: 2026-04-12
**Status**: Draft
**Scope**: Transform Dev Toolkit from centered modal to intelligent side panel with streaming AI, proactive suggestions, and conversational refinement
**Supersedes**: `2026-04-12-dev-toolkit-design.md`

---

## 1. Overview

The Dev Toolkit v2 converts the existing 3-tab modal (Commits, Pull Request, Review) into a **right-side panel** with full-height layout, streaming AI responses, proactive intelligence, and conversational refinement. The toolkit becomes an always-contextual AI assistant that devs can use alongside their workflow.

### Goals

- More usable area (full-height panel vs height-constrained modal)
- Context-aware: auto-attach to repo when opened from RepoDetail, standalone otherwise
- Streaming AI responses for instant feedback (no more staring at spinners)
- Proactive intelligence: AI analyzes context and suggests actions
- Cross-tab context: commit → PR → review flow shares state automatically
- Conversational refinement: free-text input alongside quick-action chips

### Non-Goals

- Replacing the existing PR Review full-screen view (that stays separate)
- Changing backend AI model (stays Gemini, only adding streaming + new endpoints)
- Making it a permanent always-visible panel (it's still opened/closed on demand)

---

## 2. Layout & Container

### SidePanel (replaces modal)

The DevToolkit changes from `Modal` (size `3xl`, max-w 1152px) to a `SidePanel`-based component that slides from the right edge of the viewport.

**Dimensions:**
- Width: 640px default
- Resizable via drag handle on left edge (min 480px, max 900px)
- Height: 100vh (full viewport)
- Position: `fixed right-0 top-0 bottom-0`
- z-index: 60 (consistent with existing SidePanel)

**Drag handle:**
- 4px hover zone on left border
- Cursor: `col-resize` on hover
- Visual: thin line that highlights on hover/drag
- Width persists in sessionStorage

**Backdrop:**
- `bg-black/40 backdrop-blur-sm` — subtler than current modal backdrop
- Click to close (same as existing SidePanel behavior)

**Animation:**
- Framer Motion spring: `type: 'spring', damping: 30, stiffness: 300`
- Slides in from right edge
- Backdrop fades in simultaneously

**Styling:**
- `bg-white/70 dark:bg-slate-900/95 backdrop-blur-xl`
- `border-l border-slate-200/40 dark:border-slate-700/40`
- `shadow-2xl`

### Header

```
┌─────────────────────────────────────────────────────┐
│ ◆ Dev Toolkit                          [pin] [✕]    │
│   AI-powered developer tools                        │
│ ┌─────────────────────────────────────────────────┐ │
│ │ 📌 brunobola-portfolio/GitHub-Repo-Manager  ▾   │ │
│ └─────────────────────────────────────────────────┘ │
│  ── Commits ──── Pull Request ──── Review ────────  │
└─────────────────────────────────────────────────────┘
```

- Gradient top bar: `from-indigo-600 to-purple-600` (consistent with current modal)
- Title: "Dev Toolkit" + subtitle "AI-powered developer tools"
- **Repo badge**: clickable chip in the header area
  - **Pinned state**: shows `owner/repo` with pin icon, click to unpin or change
  - **Standalone state**: shows "Select repo..." as dropdown trigger
  - Clicking opens inline dropdown with search (same as current RepoSelector but embedded)
- Pin/Unpin button: toggles between attached and standalone mode
- Close button (X): top-right corner

### Repo Context Behavior

| Trigger | Initial State | Repo Badge |
|---------|--------------|------------|
| Opened from RepoDetail | Pinned to that repo | `owner/repo 📌` |
| Opened from repo context menu | Pinned to that repo | `owner/repo 📌` |
| Opened from Header button | Standalone | "Select repo... ▾" |
| Opened via keyboard shortcut (Ctrl+Shift+D) | Standalone | "Select repo... ▾" |
| `openModalWithData('showDevToolkit', { repo })` | Pinned to provided repo | `owner/repo 📌` |

When pinned:
- Branches auto-load for that repo
- RepoSelector hidden (badge shows repo name)
- User can unpin via badge button → switches to standalone, shows selector

When standalone:
- RepoSelector dropdown visible below badge
- No branches loaded until repo selected
- All tabs show "Select a repository to get started"

### Tabs

- Three tabs: **Commits** | **Pull Request** | **Review**
- Horizontal layout, underline animated indicator (Framer Motion `layoutId`)
- Full remaining height allocated to tab content
- Tab content scrolls independently (`overflow-y-auto`)

### Mobile (< 768px)

- Bottom sheet: slides up from bottom, full width
- `rounded-t-3xl`, swipe-down to close
- Tabs compact (icons + short labels)
- Repo badge collapses to icon-only with popover

---

## 3. AI Intelligence Layer

A transversal intelligence system that operates across all tabs.

### 3.1 Smart Context Bar

A thin bar between tabs and content that appears when repo + branches are selected.

```
┌─────────────────────────────────────────────────────┐
│ ✨ Feature · 12 files · +342 −89 · Medium           │
│ 💡 5 commits without PR — generate?  │  PR #42 open │
└─────────────────────────────────────────────────────┘
```

**Content:**
- **Change type** (auto-detected): Feature / Bugfix / Refactor / Breaking / Chore
- **Stats**: file count, additions, deletions
- **Complexity**: Low / Medium / High
- **Proactive suggestions** (clickable chips):
  - "N commits without PR — generate description?" → navigates to PR tab
  - "PR #N open on this branch — review?" → navigates to Review tab
  - "Breaking changes detected — mark in commit" → stays on Commits tab with breaking chip pre-selected
  - "Large diff (>300 lines) — consider splitting" → shows multi-commit split

**Powered by:** New `POST /api/ai/analyze-context` endpoint (fast, minimal prompt).

**Behavior:**
- Loads automatically when branches are selected and diff is available
- Subtle fade-in animation
- Suggestions are dismissable (X per chip)
- Clicking a suggestion navigates to the relevant tab with context pre-filled

### 3.2 Cross-Tab Context

State flows automatically between tabs within a session:

| Source Tab | Data Shared | Target Tab |
|-----------|-------------|------------|
| Commits | Generated commit message | PR (used as additional context for generation) |
| Commits | Selected branches | PR & Review (pre-filled, no re-selection) |
| PR | Generated PR (number, URL) | Review (pre-selected in PR list) |
| PR | Selected branches | Commits (synced) |

Implementation: all shared state lives in `useDevToolkit` hook (already manages repo/branches). Extend with `generatedCommit`, `generatedPR`, `contextFlags`.

### 3.3 Auto-Draft

When branches are selected and diff is available:
1. Commit message generation starts automatically in background
2. Smart Context Bar shows "Drafting..." with subtle pulse animation
3. When user navigates to Commits tab, result is already available (or nearly done)
4. If user navigates before completion, streaming continues live in the tab

**Toggle:** "Auto-draft" switch in the header area. Default: ON. Persists in sessionStorage.

**Safeguards:**
- Only triggers when diff < 500 lines (large diffs wait for explicit action)
- Aborts if user changes branches before completion
- Uses AbortController (pattern already in useDevToolkit)

### 3.4 Streaming

All AI responses use **Server-Sent Events (SSE)** for real-time streaming:

**Client-side:**
- `EventSource` or `fetch` with `ReadableStream` reader
- Text accumulates character-by-character in state
- Pulsing green cursor at end of text while streaming
- Cancel button visible during streaming

**Server-side:**
- Response header: `Content-Type: text/event-stream`
- Gemini SDK `generateContentStream()` instead of `generateContent()`
- Each chunk: `data: {"text": "partial content"}\n\n`
- Final chunk: `data: {"done": true, "full": {...}}\n\n`
- Fallback: if `?stream=true` not set, behaves as current (backwards compatible)

**Applies to:**
- `POST /api/ai/generate-commit?stream=true`
- `POST /api/ai/generate-pr?stream=true`
- `POST /api/ai/review-summary?stream=true`
- `POST /api/ai/refine?stream=true`
- `POST /api/ai/chat-refine` (always streaming)

---

## 4. Commits Tab

### Layout (top to bottom)

```
┌─────────────────────────────────────────────────────┐
│  Head branch: [feature/auth ▾]                      │
│  Base branch: [main ▾]            [Compare]         │
├─────────────────────────────────────────────────────┤
│  ✨ Feature · 12 files · +342 −89                   │
│  📁 src/auth/login.jsx (+89 −12)                    │
│     src/auth/register.jsx (+45 −3)                  │
│     ... 10 more files                          [▾]  │
├─────────────────────────────────────────────────────┤
│  Format: [ Conventional | Gitmoji | Desc | Repo ]   │
├─────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────┐│
│  │ feat(auth): add OAuth2 login flow               ││
│  │                                                 ││
│  │ Implement Google and GitHub OAuth providers     ││
│  │ with session management and token refresh.      ││
│  │ █                                               ││
│  └─────────────────────────────────────────────────┘│
│  [Copy message] [Copy git cmd] [Apply]              │
├─────────────────────────────────────────────────────┤
│  [Shorter] [More detail] [+ Body] [Breaking] [↻]   │
│  ┌─────────────────────────────────────────────────┐│
│  │ Refine: "make it more technical"            [→] ││
│  └─────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────┤
│  ▸ Session history (3 previous)                     │
└─────────────────────────────────────────────────────┘
```

**Sections:**

1. **Branch selectors** — head + base side-by-side with search dropdowns
   - Auto-filled when pinned to repo
   - Default branch marked with star
   - Compare button triggers diff fetch

2. **Diff insights** — compact card after branch comparison:
   - File count, total additions/deletions
   - AI-detected change type (from Smart Context Bar data)
   - Collapsible file list with per-file +/− stats
   - Expandable patches with syntax highlighting (existing DiffSummary enhanced)

3. **Format selector** — pill group (existing, keep as-is):
   - Conventional | Gitmoji | Descriptive | Repo Convention
   - Repo Convention auto-detects style via `/api/repos/:owner/:repo/commits/style`
   - Selection persists in sessionStorage

4. **Paste mode** — toggle "Paste diff manually" (collapsed by default, for repos without API access)

5. **Output area** — terminal-style box:
   - Streaming text with pulsing cursor
   - `bg-slate-950 text-emerald-400 font-mono text-sm` (always dark, high contrast)
   - `rounded-xl` with subtle border
   - **Action buttons below:**
     - Copy message (plain text to clipboard)
     - Copy as git command (copies `git commit -m "subject" -m "body"` format)
   - Note: "Copy message" and "Copy as git command" are the two actions. No separate "Apply" — keeping it simple.
   - Multi-commit split indicator if diff > 300 lines (existing feature, keep)

6. **Refinement zone:**
   - Quick chips in a row: Shorter | More detail | + Body | Breaking change | Regenerate
   - Chat input below: text field with placeholder "Refine: e.g. 'make it more technical'"
   - Submit with Enter or arrow button
   - Refinement replaces current output with streaming response
   - Refinement history: collapsible stack showing previous versions (click to restore any)

7. **Session history** — collapsible section at bottom:
   - Shows previous generations in this session (max 5)
   - Click to restore
   - Timestamp for each entry

---

## 5. Pull Request Tab

### Layout

```
┌─────────────────────────────────────────────────────┐
│  Head: [feature/auth ▾]  Base: [main ▾]             │
│  ┌────────────────────────────────────────────────┐ │
│  │ ℹ PR #42 exists on this branch    [Update ▾]  │ │
│  │ ✓ Using commit context from Commits tab        │ │
│  │ 📋 Repo template detected                      │ │
│  └────────────────────────────────────────────────┘ │
│                                    [Generate PR ▶]  │
├─────────────────────────────────────────────────────┤
│  Title ─────────────────────────────────────────    │
│  ┌─────────────────────────────────────────────────┐│
│  │ Add OAuth2 login flow with session management   ││
│  └──────────────────────────────────────── 48/70 ──┘│
│                                                     │
│  Summary ──────────────────────── [✏️] [Shorter] [+]│
│  ┌─────────────────────────────────────────────────┐│
│  │ ## Summary                                      ││
│  │ - Implement Google and GitHub OAuth2 providers  ││
│  │ - Add session management with token refresh     ││
│  │ - Include PKCE flow for security█               ││
│  └─────────────────────────────────────────────────┘│
│                                                     │
│  Test Plan ────────────────────── [✏️] [More cases] │
│  ┌─────────────────────────────────────────────────┐│
│  │ - [ ] Test Google OAuth login flow              ││
│  │ - [ ] Test GitHub OAuth login flow              ││
│  │ - [ ] Verify token refresh after expiry         ││
│  └─────────────────────────────────────────────────┘│
│                                                     │
│  Breaking Changes ─── [✏️]     (only if detected)   │
│  Related Issues ─── #123, #456                      │
│  Labels ─── [auth] [feature] [+]                    │
│  Reviewers ─── [@alice] [@bob] [+]                  │
├─────────────────────────────────────────────────────┤
│  [Shorter] [More context] [Architecture notes]      │
│  ┌─────────────────────────────────────────────────┐│
│  │ Refine: "add migration notes to summary"    [→] ││
│  └─────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────┤
│            [Copy All]  [Create PR on GitHub ▶]      │
└─────────────────────────────────────────────────────┘
```

**Sections:**

1. **Branch selectors** — synced with Commits tab (cross-tab context)

2. **PR context info** — informational card:
   - If existing PR on this branch: shows number + title + "Update existing" badge
   - If commit message was generated: shows "Using commit context ✓"
   - If repo has PR template: shows "Repo template detected 📋"
   - These appear/disappear as conditions are met

3. **Generate button** — "Generate PR Description"
   - Sends: commits, diff_summary, top_patches, template, repo_context, plus any generated commit message as additional context

4. **PR Sections** (each is a SectionCard with streaming):
   - **Title**: editable text input, character counter (max 70), streaming fills it
   - **Summary**: SectionCard with markdown, editable, per-section refinement chips (Shorter | More context | Architecture notes)
   - **Test Plan**: SectionCard with checklist format, chips (More cases | Edge cases | E2E focus)
   - **Breaking Changes**: SectionCard, only rendered if AI detects breaking changes
   - **Related Issues**: pill badges with `#NNN` links, auto-extracted from commits
   - **Labels**: suggested pill badges, add/remove with `+` button
   - **Reviewers**: avatar pill badges, add/remove with `+` button

5. **Refinement zone** (same pattern as Commits):
   - Quick chips relevant to PR content
   - Chat input for free-text refinement
   - AI intelligently targets the right section based on instruction

6. **Actions bar** (sticky at bottom of scroll area):
   - "Copy All" — copies complete PR as formatted markdown
   - "Create PR" / "Update PR #N" — direct GitHub action
   - Confirmation is inline (expand with options: draft yes/no) — no nested modal
   - After creation: shows success with link to PR on GitHub

7. **Session history** — collapsible, same as Commits tab

---

## 6. Review Tab

### Layout

```
┌─────────────────────────────────────────────────────┐
│  Open Pull Requests ────────────────────────────    │
│  ┌─────────────────────────────────────────────────┐│
│  │ #42 Add OAuth2 login flow      @alice  2h ago  ││
│  │ #38 Fix pagination bug         @bob    1d ago  ││
│  │ #35 Update dependencies        @carol  3d ago  ││
│  └─────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────┤
│  ┌─ Risk Assessment ──────────────────────────────┐ │
│  │     🟡 MEDIUM RISK · ~15 min review            │ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  Overview                                           │
│  This PR implements OAuth2 authentication with      │
│  Google and GitHub providers. It adds session█       │
│                                                     │
│  Key Changes                                        │
│  • New OAuth2 provider abstraction layer            │
│  • Session management with JWT tokens               │
│  • PKCE flow implementation for security            │
│                                                     │
│  High-Risk Files ⚠️                                 │
│  ┌─────────────────────────────────────────────────┐│
│  │ 🔴 server/auth/session.js — token storage       ││
│  │ 🟡 src/hooks/useAuth.js — state management      ││
│  └─────────────────────────────────────────────────┘│
│                                                     │
│  Suggested Review Order                             │
│  1. server/auth/providers.js (core logic)           │
│  2. server/auth/session.js (security-critical)      │
│  3. src/hooks/useAuth.js (frontend integration)     │
├─────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────┐│
│  │ Ask: "is the token refresh secure?"         [→] ││
│  └─────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────┤
│  [Quick Approve 👍] [Request Changes] [Comment]     │
│  [Open Full Review →]                               │
└─────────────────────────────────────────────────────┘
```

**Sections:**

1. **PR Selector** — list of open PRs for the selected repo:
   - Shows: number, title, author, age
   - If Smart Context Bar suggested a PR, it's pre-highlighted
   - Click to select → auto-fetches files and generates summary

2. **Risk Assessment** — prominent badge:
   - Color-coded: Low (emerald) | Medium (amber) | High (red)
   - Estimated review time
   - Animated entrance (scale-in)

3. **Quick Summary** (streaming):
   - **Overview**: paragraph describing what the PR does
   - **Key Changes**: bullet list of most important changes
   - **High-Risk Files**: list with risk icon + reason
   - **Suggested Review Order**: numbered list guiding the reviewer

4. **Conversational Q&A** (new):
   - Chat input: "Ask about this PR: e.g. 'is the error handling sufficient?'"
   - AI responds in context of the PR's files and diff
   - Supports multi-turn conversation (max 5 exchanges)
   - Responses appear below the input, scrollable
   - Each response can reference specific files and line ranges

5. **Quick Actions** (sticky bottom):
   - "Quick Approve" — with optional comment field (expandable)
   - "Request Changes" — with required comment field
   - "Comment" — general comment
   - "Open Full Review →" — navigates to the full PR Review view (existing feature)
   - All actions call `POST /api/repos/:owner/:repo/pulls/:number/reviews`

---

## 7. Conversational Refinement System

A unified refinement pattern used across all three tabs.

### Component: `RefinementZone`

Replaces the current `RefinementChips` component with an enhanced version:

```
┌─────────────────────────────────────────────────────┐
│  [Shorter] [More detail] [+ Body] [Breaking] [↻]   │
│  ┌─────────────────────────────────────────────────┐│
│  │ Refine: "make it more technical"            [→] ││
│  └─────────────────────────────────────────────────┘│
│  ▸ Version history (3 refinements)                  │
└─────────────────────────────────────────────────────┘
```

**Behavior:**
- **Quick chips** remain as one-click shortcuts (same as current, using `/api/ai/refine`)
- **Chat input** below chips for free-text instructions
  - Placeholder is contextual: "Refine commit message...", "Refine PR description...", "Ask about this PR..."
  - Submit with Enter or click arrow button
  - Uses new `POST /api/ai/chat-refine` endpoint (streaming)
  - AI receives: current output + original diff + user instruction + conversation history
- **Version history**: collapsible list of all versions (original + each refinement)
  - Click any version to restore it
  - Shows timestamp and instruction used
  - Max 10 versions per session

**Chips per tab:**

| Tab | Chips |
|-----|-------|
| Commits | Shorter, More detail, + Body, Breaking change, Regenerate |
| PR — Summary | Shorter, More context, Architecture notes |
| PR — Test Plan | More cases, Edge cases, E2E focus |
| Review | (no chips — chat-only Q&A) |

---

## 8. Backend Changes

### 8.1 Streaming Support (modify existing endpoints)

Add `?stream=true` query parameter to existing AI endpoints:

**Affected endpoints:**
- `POST /api/ai/generate-commit`
- `POST /api/ai/generate-pr`
- `POST /api/ai/review-summary`
- `POST /api/ai/refine`

**Implementation:**
- When `stream=true`, set response headers:
  ```
  Content-Type: text/event-stream
  Cache-Control: no-cache
  Connection: keep-alive
  ```
- Use Gemini SDK `generateContentStream()` instead of `generateContent()`
- Send chunks as SSE events: `data: {"text": "partial"}\n\n`
- Final event: `data: {"done": true, "full": { ...structured result }}\n\n`
- When `stream` is absent or false, behave exactly as current (backwards compatible)
- Usage tracking and audit logging happen on the final event

**For structured responses (generate-pr, review-summary):**

- Stream the raw AI text as it generates (client shows progressive text)
- On completion, server parses the full text into the structured JSON format (title, summary, etc.)
- Final `done` event contains the parsed structured object
- Client replaces the raw streaming text with the structured UI (SectionCards, risk badges, etc.)
- If parsing fails, client falls back to displaying the raw text with an error note

### 8.2 New Endpoint: Context Analysis

```
POST /api/ai/analyze-context
```

**Request:**
```json
{
  "repo": "owner/repo",
  "diff_summary": { "files": 12, "additions": 342, "deletions": 89 },
  "commits": [ { "message": "...", "sha": "..." } ],
  "file_list": [ "src/auth/login.jsx", "src/auth/register.jsx" ]
}
```

**Response:**
```json
{
  "changeType": "feature",
  "complexity": "medium",
  "suggestions": [
    { "type": "generate_pr", "message": "5 commits without PR — generate description?", "tab": "pr" },
    { "type": "review_pr", "message": "PR #42 open on this branch — review?", "tab": "review", "prNumber": 42 }
  ],
  "breakingChanges": false
}
```

**Implementation:**
- Uses flash model with minimal prompt (fast response, < 1 second)
- Checks GitHub API for open PRs on the head branch
- Counts commits between head and base
- AI classifies change type from file paths and commit messages
- No streaming (response is small and fast)
- Rate limited: max 1 call per repo+branch pair per 30 seconds (cached)

### 8.3 New Endpoint: Conversational Refine

```
POST /api/ai/chat-refine
```

**Request:**
```json
{
  "message": "make it more technical and mention the PKCE flow",
  "current_output": "feat(auth): add OAuth2 login flow...",
  "original_diff": "...",
  "content_type": "commit|pr_summary|pr_test_plan|review_qa",
  "history": [
    { "role": "user", "content": "make it shorter" },
    { "role": "assistant", "content": "feat(auth): add OAuth2 flow" }
  ]
}
```

**Response:** SSE stream (same format as streaming endpoints)

**Implementation:**
- Always streams (no non-streaming mode)
- Maintains conversation context via `history` array (max 5 exchanges)
- AI receives system prompt with content type context
- For `review_qa` type: AI can reference specific files and line numbers
- Usage tracking increments per message
- Diff sanitized to 8K chars

---

## 9. Component Architecture

### New Components

| Component | Location | Responsibility |
|-----------|----------|---------------|
| `DevToolkitPanel.jsx` | `src/components/DevToolkit/` | Main panel container (replaces DevToolkitModal) |
| `SmartContextBar.jsx` | `src/components/DevToolkit/shared/` | AI-powered context insights bar |
| `RefinementZone.jsx` | `src/components/DevToolkit/shared/` | Chips + chat input + version history |
| `StreamingOutput.jsx` | `src/components/DevToolkit/shared/` | Terminal-style streaming text display |
| `RepoBadge.jsx` | `src/components/DevToolkit/shared/` | Pin/unpin repo chip in header |
| `VersionHistory.jsx` | `src/components/DevToolkit/shared/` | Collapsible refinement version stack |
| `ChatInput.jsx` | `src/components/DevToolkit/shared/` | Text input for conversational refinement |

### Modified Components

| Component | Changes |
|-----------|---------|
| `CommitTab.jsx` | Add streaming, replace OutputSection with StreamingOutput, add RefinementZone |
| `PRTab.jsx` | Add streaming per section, add PR context info, add RefinementZone |
| `ReviewTab.jsx` | Add conversational Q&A, enhance QuickSummary with streaming |
| `useDevToolkit.js` | Add cross-tab context state, auto-draft logic, streaming abort controllers |
| `RepoSelector.jsx` | Adapt for inline-in-header embedding (compact mode) |
| `OutputSection.jsx` | Deprecated — replaced by StreamingOutput |

### Removed Components

| Component | Reason |
|-----------|--------|
| `DevToolkitModal.jsx` | Replaced by DevToolkitPanel.jsx |

### Hook Changes: `useDevToolkit.js`

New state additions:
```javascript
{
  // Existing (keep)
  activeTab, repos, selectedRepo, branches, compareData, ...

  // New: cross-tab context
  generatedCommit: null,      // { message, format } — from CommitTab
  generatedPR: null,          // { number, url, title } — after PR creation
  contextFlags: {
    commitUsedInPR: false,    // true after PR tab uses commit context
    prCreated: false,         // true after PR created/updated
  },

  // New: auto-draft
  autoDraftEnabled: true,     // persisted in sessionStorage
  autoDraftResult: null,      // pre-generated commit message
  autoDraftLoading: false,

  // New: context analysis
  contextAnalysis: null,      // { changeType, complexity, suggestions }
  contextAnalysisLoading: false,

  // New: streaming
  streamAbortController: null,

  // New: panel
  panelWidth: 640,            // persisted in sessionStorage
  isPinned: false,            // true when auto-attached to repo
}
```

---

## 10. Styling & Visual Polish

### Consistent with existing app

- Glass morphism: `bg-white/70 dark:bg-slate-900/95 backdrop-blur-xl`
- Borders: `border-slate-200/40 dark:border-slate-700/40`
- Shadows: `shadow-2xl` for the panel, `shadow-lg` for internal cards
- Rounded: `rounded-2xl` (cards), `rounded-xl` (inputs, buttons)
- Gradients: `from-indigo-600 to-purple-600` for primary accents

### New visual elements

- **Streaming cursor**: `w-2 h-5 bg-emerald-400 animate-pulse` after text
- **Terminal output**: `bg-slate-950 text-emerald-400 font-mono text-sm rounded-xl` (always dark, high contrast)
- **Risk badges**: gradient backgrounds — emerald for low, amber for medium, red for high
- **Repo badge**: `bg-indigo-500/10 border-indigo-500/30 text-indigo-400` with subtle glow when pinned
- **Drag handle**: `w-1 bg-slate-300/50 dark:bg-slate-600/50` with `hover:bg-indigo-500/50` transition
- **Smart context bar**: `bg-indigo-500/5 border-b border-indigo-500/20` with subtle gradient
- **Chat input**: `bg-slate-100 dark:bg-slate-800 rounded-xl` with focus ring `ring-indigo-500/40`
- **Version history items**: `text-xs text-slate-500` with hover highlight
- **Tab transitions**: Framer Motion `AnimatePresence` with crossfade between tab content

### Dark mode

- Fully supported via existing `.dark` class system
- Terminal output stays dark in both modes (always `bg-slate-950`)
- Glass morphism opacity adjusts: `bg-white/70` (light) → `bg-slate-900/95` (dark)
- All new elements include `dark:` variants

---

## 11. Accessibility

- Panel: `role="dialog"`, `aria-modal="true"`, `aria-label="Dev Toolkit"`
- Focus trap within panel when open (reuse existing `useFocusTrap`)
- Escape key closes panel
- Tab key navigates between tabs, then into content
- Streaming output: `aria-live="polite"` for screen reader updates
- All interactive elements have `focus-visible` ring
- Drag handle: `aria-label="Resize panel"`, keyboard arrow keys adjust width
- Color contrast: all text meets WCAG AA minimum

---

## 12. Integration Points

### ModalContext Changes

The DevToolkit transitions from modal to panel, but remains managed by ModalContext for consistency:

- `showDevToolkit` key stays the same
- `openModal('showDevToolkit')` → opens panel (standalone)
- `openModalWithData('showDevToolkit', { repo, branch, pr })` → opens panel (pinned)
- Internally, ModalContext renders `DevToolkitPanel` instead of wrapping in `Modal`
- Panel manages its own backdrop and positioning (like SidePanel does)

### Trigger Points (unchanged)

- Header quick action button (Wand2 icon)
- Keyboard shortcut (Ctrl+Shift+D)
- Repo context menu (if exists)
- `openModalWithData` from RepoDetail

### Coexistence with other modals

- Panel lives at z-60 (same level as modals)
- If a modal opens while panel is open, modal appears on top (z-60 + later in DOM = on top)
- Panel can stay open behind modals (no auto-close)
- If another SidePanel opens (CompareSimilarDrawer), DevToolkit closes first
