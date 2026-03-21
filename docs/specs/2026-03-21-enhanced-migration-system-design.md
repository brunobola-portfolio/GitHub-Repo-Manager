# Enhanced Migration System — Design Spec

**Date:** 2026-03-21
**Status:** Draft
**Scope:** Complete Azure DevOps → GitHub migration (repos, work items, wikis), context menu overhaul, AI orchestration

---

## 1. Overview

Upgrade the existing Azure DevOps migration system from a repo-only importer into a comprehensive migration platform that handles repositories, work items (→ GitHub Issues), and wikis, with AI-powered orchestration, robust error handling, and a modular wizard UI.

### Goals

1. **Complete migration** — repos + work items + wikis (not pipelines)
2. **Bulletproof reliability** — retry, cancel, pause/resume, dry-run, scheduling, rollback
3. **AI orchestrator** — intelligent planning, risk analysis, config suggestions, error diagnosis
4. **Rich context menu** — cascading submenus with migration, AI, and management actions
5. **Real-time feedback** — SSE replaces polling for all migration progress
6. **Improved dialogs** — enhanced TransferModal, CreateRepoModal, SettingsModal, MigrationHistory

### Non-Goals

- Pipeline/CI migration (Azure Pipelines → GitHub Actions)
- TFVC repositories (Git only)
- Cross-platform migrations (only Azure DevOps → GitHub)
- GitHub Enterprise Importer integration (uses direct git operations)

---

## 2. Architecture — Approach B: Modular with Decomposition

### Principle

Decompose the monolithic ImportWizard into a pluggable step system. Create a centralized `MigrationEngine` on the backend that orchestrates all migration types as tasks within a plan.

### System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ FRONTEND                                                        │
│                                                                 │
│  MigrationWizard/                                               │
│  ├── MigrationWizard.jsx     (shell: nav, step routing, state)  │
│  ├── useMigrationWizard.js   (state machine, validation, API)   │
│  └── steps/                                                     │
│      ├── SourceStep.jsx          (Azure org/project/PAT)        │
│      ├── RepoSelectStep.jsx      (pick repos, search/filter)    │
│      ├── RepoConfigStep.jsx      (names, visibility, desc)      │
│      ├── WorkItemsStep.jsx       (types, labels, options)       │
│      ├── WikiStep.jsx            (destination per repo)          │
│      ├── AIReviewStep.jsx        (plan review, risks, suggest)  │
│      ├── ScheduleStep.jsx        (now/scheduled, dry-run)       │
│      ├── ProgressStep.jsx        (SSE timeline, cancel/pause)   │
│      └── SummaryStep.jsx         (report, export, links)        │
│                                                                 │
│  ContextMenu/                                                   │
│  ├── ContextMenu.jsx             (reusable, cascading submenus) │
│  └── RepoContextMenu.jsx        (repo-specific menu config)    │
│                                                                 │
│  Hooks/                                                         │
│  └── useMigrationPlanner.js      (AI planning interface)        │
├─────────────────────────────────────────────────────────────────┤
│ BACKEND                                                         │
│                                                                 │
│  migration-engine.js             (orchestrator, SSE, lifecycle) │
│  work-item-service.js            (ADO work items → GH issues)   │
│  wiki-service.js                 (ADO wiki → GH wiki or docs/)  │
│  migration-planner.js            (AI analysis service)          │
│                                                                 │
│  Existing (enhanced):                                           │
│  ├── azure-service.js            (+ wiki clone URLs, metadata)  │
│  ├── import-service.js           (+ cancel checks, resume)      │
│  └── db.js                       (+ migration_plans/tasks)      │
│                                                                 │
│  Routes:                                                        │
│  └── routes/migration.js         (new unified migration API)    │
└─────────────────────────────────────────────────────────────────┘
```

**File extension convention:** Hooks without JSX output use `.js` (consistent with existing `useKeyboardShortcuts.js`, `useGitHub.js`, `useFocusTrap.js`). Components that render JSX use `.jsx`. All new files follow this pattern.

---

## 3. Backend — MigrationEngine

### 3.1 Data Model

#### `migration_plans` table

```sql
CREATE TABLE migration_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'draft',
    -- draft | scheduled | running | paused | completed | failed | cancelled
  source_type TEXT NOT NULL DEFAULT 'azure',
  source_org TEXT NOT NULL,
  source_project TEXT NOT NULL,
  target_org TEXT,
  is_dry_run INTEGER NOT NULL DEFAULT 0,
  scheduled_at TEXT,           -- ISO timestamp, null = immediate
  credentials_enc TEXT,        -- AES-256-GCM encrypted credentials for scheduled plans, NULL after execution
  started_at TEXT,
  completed_at TEXT,
  ai_analysis TEXT,            -- JSON: { risks, suggestions, order, estimate }
  summary TEXT,                -- JSON: { total, success, failed, skipped, duration }
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_plan_user ON migration_plans(user_id);
CREATE INDEX idx_plan_status ON migration_plans(status);
CREATE INDEX idx_plan_scheduled ON migration_plans(scheduled_at) WHERE status = 'scheduled';
```

#### `migration_tasks` table

```sql
CREATE TABLE migration_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES migration_plans(id),
  type TEXT NOT NULL,           -- 'repo' | 'work-items' | 'wiki'
  execution_order INTEGER NOT NULL DEFAULT 0,
  source_ref TEXT NOT NULL,     -- e.g. "org/project/repo" or "project/wiki-name"
  target_ref TEXT,              -- e.g. "github-org/repo-name"
  config TEXT,                  -- JSON: type-specific configuration
  status TEXT NOT NULL DEFAULT 'pending',
    -- pending | running | completed | failed | cancelled | skipped
  progress_pct INTEGER NOT NULL DEFAULT 0,
  progress_message TEXT,
  error_message TEXT,
  retries INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  started_at TEXT,
  completed_at TEXT,
  metadata TEXT,                -- JSON: type-specific results
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_task_plan ON migration_tasks(plan_id);
CREATE INDEX idx_task_status ON migration_tasks(status);
```

### 3.2 MigrationEngine (`server/migration-engine.js`)

Central orchestrator. Extends `EventEmitter` for SSE.

**Responsibilities:**

- **Plan lifecycle**: create → validate → execute → complete/fail
- **Task ordering**: respects `execution_order` (set by AI or user), repos before dependent work-items/wikis
- **Concurrency**: max 2 repo tasks + 1 work-item task + 1 wiki task simultaneous
- **DB write throttling**: progress updates batched to max 1 write per second per task to avoid SQLite contention under concurrent execution (better-sqlite3 is synchronous and blocks the event loop during writes)
- **Retry**: exponential backoff (5s → 30s → 2min), max 3 attempts per task
- **Cancellation**: sets `cancelled` flag, each service checks `isCancelled()` between atomic operations
- **Pause/Resume**: persists state, resumes from last incomplete task
- **Dry-run**: runs all validations and pre-flight checks without creating anything
- **Scheduling**: `scheduledAt` timestamp, background interval checks every 30s
- **Rollback**: configurable per task type (see §5.4)
- **SSE emission**: emits events for every state/progress change

**Events emitted:**

| Event | Data | When |
|-------|------|------|
| `task-progress` | `{ taskId, type, progress, message }` | During task execution |
| `task-status` | `{ taskId, type, status, error? }` | Status transitions |
| `task-complete` | `{ taskId, type, metadata }` | Task finished successfully |
| `task-failed` | `{ taskId, type, error, retryIn? }` | Task failed (may retry) |
| `plan-status` | `{ planId, status }` | Plan status transitions |
| `plan-complete` | `{ planId, summary }` | All tasks finished |

**Key methods:**

```javascript
class MigrationEngine extends EventEmitter {
  createPlan(userId, source, tasks, options) → planId
  validatePlan(planId) → { valid, errors[], warnings[] }
  executePlan(planId) → void (async, emits events)
  cancelPlan(planId) → void
  pausePlan(planId) → void
  resumePlan(planId) → void
  retryTask(planId, taskId) → void
  getPlanStatus(planId) → PlanWithTasks
  deletePlan(planId) → void
}
```

### 3.3 SSE Endpoint

`GET /api/migration/stream/:planId`

- Authenticated (session cookie — native `EventSource` sends cookies automatically with `sameSite: 'lax'`)
- User can only stream their own plans
- Sends `Content-Type: text/event-stream`
- Each event includes an `id` field (monotonic counter) for `Last-Event-ID` resumption
- Keeps connection alive with `:keepalive\n\n` every 15s
- On client reconnect (native `EventSource` auto-reconnects): reads `Last-Event-ID` header, emits a `catch-up` event with full current plan state, then resumes normal event stream
- Closes when plan reaches terminal state (completed/failed/cancelled)
- Multiple clients can listen to same plan
- If plan was `interrupted` (server restart), emits `plan-interrupted` event on reconnect — frontend shows "Migration was interrupted. Resume?" prompt

```
event: task-progress
data: {"taskId":3,"type":"repo","progress":45,"message":"Cloning bare repository..."}

event: task-complete
data: {"taskId":3,"type":"repo","metadata":{"branches":12,"hasLFS":true,"repoUrl":"https://github.com/org/repo"}}

event: task-failed
data: {"taskId":5,"type":"work-items","error":"GitHub API rate limit exceeded","retryIn":30}

event: plan-complete
data: {"planId":1,"summary":{"total":8,"success":7,"failed":1,"skipped":0,"duration":847}}
```

### 3.4 Work Item Service (`server/work-item-service.js`)

Migrates Azure DevOps Work Items → GitHub Issues.

**Process:**

1. Query work items via WIQL: `SELECT [System.Id] FROM workitems WHERE [System.TeamProject] = @project AND [System.WorkItemType] IN ('Bug', 'User Story', ...)`
2. Batch fetch details (200 per request): fields, relations, comments
3. Build dependency tree from relations (parent/child)
4. Create GitHub Issues in dependency order (parents first, so we have issue numbers for references)
5. For each work item:
   - Title: preserved as-is
   - Body: original description (HTML → Markdown conversion) + metadata table
   - Labels: auto-generated from type (`bug`, `epic`, `user-story`, `task`), state (`done`, `active`, `new`), priority (`priority:1` through `priority:4`)
   - Hierarchy: "Parent: #42" / "Children: #43, #44" links in body
   - Attachments: download from ADO → upload to issue (if enabled)
   - Comments: migrated as issue comments with attribution header
6. Optionally create GitHub Project Board with items organized

**Metadata table in issue body:**

```markdown
---
| Field | Value |
|-------|-------|
| **Source** | Azure DevOps |
| **Original ID** | 1234 |
| **Type** | User Story |
| **State** | Active |
| **Assigned To** | jane@company.com |
| **Area Path** | Project\Backend\API |
| **Iteration** | Sprint 42 |
| **Created** | 2025-11-15 |
---
```

**Config shape (work-items task):**

```json
{
  "types": ["Bug", "User Story", "Task"],
  "includeComments": true,
  "includeAttachments": true,
  "includeHistory": false,
  "createProjectBoard": true,
  "labelMapping": {
    "Bug": "bug",
    "User Story": "user-story",
    "Task": "task"
  }
}
```

**SSRF protection for attachments:** Work item attachment download URLs come from ADO API responses which could be attacker-influenced. All attachment URLs must pass `isInternalUrl()` and `resolveAndValidateHost()` validation (from `import-service.js`) before fetching. Only HTTPS URLs to `*.dev.azure.com` or `*.visualstudio.com` domains are allowed.

**Rate limiting:**
- GitHub Issues API: max 5000 requests/hour
- Tracks remaining quota via `X-RateLimit-Remaining` header
- When remaining < 100: pause and wait for reset
- When 429 received: read `Retry-After`, pause task, auto-resume

**Limits:**
- Max 500 work items per task
- Paginated fetch from ADO (200 per batch)
- Attachment size cap: 25MB per file (GitHub limit)
- Timeout: 15 minutes per task

### 3.5 Wiki Service (`server/wiki-service.js`)

Migrates Azure DevOps Wikis → GitHub Wiki or docs/ folder.

**Process:**

1. List wikis via ADO API: `GET /_apis/wiki/wikis?api-version=7.1`
2. Clone wiki Git repo (ADO wikis are Git repos internally)
3. Convert content:
   - Links: `[text](/page-name)` → `[[page-name]]` (wiki) or `[text](page-name.md)` (docs/)
   - Attachments: adjust relative paths
   - `.order` files: convert to `_Sidebar.md` ordering (wiki) or remove (docs/)
   - Mermaid diagrams: preserved (supported by both platforms)
   - HTML embedded: preserved as-is
4. Push to destination:
   - **GitHub Wiki**: push to `{repo}.wiki.git` (must enable wiki on repo first via API)
   - **Docs folder**: create branch, commit to `docs/`, create PR (or push to default branch)

**Content conversion rules:**

| ADO Format | GitHub Wiki | Docs Folder |
|------------|-------------|-------------|
| `[text](/Page-Name)` | `[[Page-Name]]` | `[text](Page-Name.md)` |
| `[text](/Page/Sub-Page)` | `[[Page/Sub-Page]]` | `[text](Page/Sub-Page.md)` |
| `![img](/.attachments/img.png)` | `![img](/.attachments/img.png)` | `![img](attachments/img.png)` |
| `.order` file | `_Sidebar.md` | removed |
| `::: mermaid` | `` ```mermaid `` | `` ```mermaid `` |
| `[[_TOC_]]` | removed (GitHub auto-generates TOC) | removed (use GitHub TOC button) |
| `@WorkItem:1234` | `[ADO Work Item #1234](https://dev.azure.com/...)` | same (absolute link to ADO) |
| `@query:GUID` | removed with HTML comment `<!-- ADO query embed removed -->` | same |
| `:::code language="csharp" source="file.cs":::` | `` ```csharp `` fenced block (content inlined if file accessible) | same |
| `::: note` / `::: warning` / `::: tip` | `> **Note:**` / `> **Warning:**` / `> **Tip:**` blockquote | same (GitHub blockquote alerts `> [!NOTE]`) |

**Config shape (wiki task):**

```json
{
  "destination": "wiki" | "docs",
  "createPR": true,
  "branch": "docs/wiki-migration"
}
```

**Limits:**
- Max 100 pages per wiki task
- Attachment size: 100MB total per wiki
- Timeout: 10 minutes per task

### 3.6 Task Config Shapes

Each task type has a specific config JSON stored in `migration_tasks.config`:

**Repo task config:**

```json
{
  "makePrivate": true,
  "description": "Repository description",
  "rollbackPolicy": "delete",
  "timeout": 1800000
}
```

- `rollbackPolicy`: `"delete"` (delete GitHub repo on push failure) | `"keep-empty"` (leave empty repo)
- `timeout`: milliseconds, default 1800000 (30 min)

**Work-items task config:** See §3.4

**Wiki task config:** See §3.5

### 3.7 Azure Service Extensions (`server/azure-service.js`)

New functions added to the existing azure-service module:

```javascript
// List wikis in a project
listWikis(org, project, pat) → [{ id, name, type, pageCount, cloneUrl }]

// Count work items by type using WIQL
getWorkItemCounts(org, project, pat) → { Epic: 5, Feature: 12, Bug: 18, ... }

// Preview sample work items (first 10 per type)
previewWorkItems(org, project, pat, types) → [{ id, title, type, state, assignedTo }]

// Fetch work items in batch with full details
fetchWorkItems(org, project, pat, ids, expand) → [WorkItem]

// Get wiki clone URL (wikis are git repos)
getWikiCloneUrl(org, project, pat, wikiId) → string
```

### 3.8 Migration Planner Service (`server/migration-planner.js`)

AI-powered analysis using Gemini API.

**Input context sent to Gemini:**

```json
{
  "repos": [
    {
      "name": "repo-api",
      "size": 45000,
      "branches": 8,
      "hasLFS": false,
      "hasSubmodules": true,
      "submoduleRefs": ["repo-core"],
      "lastUpdated": "2026-03-15",
      "language": "JavaScript",
      "defaultBranch": "main"
    }
  ],
  "workItems": {
    "project": "MyProject",
    "counts": { "Epic": 5, "Feature": 12, "User Story": 42, "Bug": 18, "Task": 67 }
  },
  "wikis": [
    { "repoName": "repo-api", "pageCount": 23, "hasAttachments": true }
  ],
  "target": {
    "org": "company-github",
    "existingRepos": ["legacy-api", "old-frontend"]
  }
}
```

**Expected Gemini response:**

```json
{
  "executionOrder": ["repo-core", "repo-api", "repo-frontend"],
  "orderReason": "repo-api has submodule dependency on repo-core; must be migrated first",
  "risks": [
    {
      "severity": "high",
      "repo": "repo-legacy",
      "title": "Very large repository",
      "description": "Repository is 3.2GB which may timeout during clone/push operations",
      "recommendation": "Consider enabling LFS for binary files before migration, or increase timeout"
    },
    {
      "severity": "medium",
      "repo": "repo-api",
      "title": "Submodule dependency",
      "description": "Has submodule reference to repo-core. Submodule URLs will need updating post-migration",
      "recommendation": "Migrate repo-core first, then update .gitmodules in repo-api after migration"
    },
    {
      "severity": "low",
      "repo": "repo-frontend",
      "title": "Name conflict",
      "description": "Target org already has a repo named 'old-frontend'",
      "recommendation": "Rename to 'frontend' or replace existing repo"
    }
  ],
  "suggestions": [
    {
      "repo": "repo-legacy",
      "targetName": "legacy-service",
      "visibility": "private",
      "description": "Legacy backend service (archived from Azure DevOps migration)",
      "reason": "Name clarifies purpose; private because it contains internal business logic"
    }
  ],
  "estimatedMinutes": 35,
  "warnings": [
    "144 work items will be migrated as GitHub Issues — ensure the target repo has Issues enabled",
    "Wiki for repo-api has 23 pages with attachments totaling ~45MB"
  ]
}
```

**Fallback without AI:**
When Gemini is not configured, the planner performs basic analysis:
- Execution order: alphabetical (no dependency analysis)
- Risks: only detectable programmatically (size > 1GB, LFS detected, name conflicts)
- Suggestions: none (user configures manually)
- Estimate: based on size heuristic (1 min per 100MB + 1 min per 50 work items + 1 min per 20 wiki pages)

---

## 4. Frontend — MigrationWizard

### 4.1 Shell Component (`MigrationWizard.jsx`)

- Renders inside `Modal.jsx` (size `xl`)
- Horizontal progress bar with step dots/labels, clickable for completed steps (on mobile: vertical step indicator to avoid overflow)
- Back/Next buttons with per-step validation
- Step transitions: Framer Motion slide (left/right based on direction)
- Opened via `openModal('showMigrationWizard')` or keyboard shortcut `i`
- **ModalContext integration**: `MODAL_NAMES` in `src/contexts/ModalContext.jsx` must be updated to include `'showMigrationWizard'`. The existing `'showImportWizard'` entry remains for backward compatibility — the old ImportWizard is kept but deprecated (accessible only via MigrationHistory's "re-run legacy job" action).
- **Keyboard shortcut**: the `i` shortcut in `useKeyboardShortcuts.js` is remapped from `onImport` (ImportWizard) to `onMigrate` (MigrationWizard).
- **ARIA**: wizard container uses `role="form"` with `aria-label="Migration Wizard"`. Step indicator uses `aria-current="step"` on active step. Navigation buttons use `aria-label` for screen readers.

### 4.2 State Machine (`useMigrationWizard.js`)

**Step flow:**

```
source → repoSelect → repoConfig → workItems → wiki → aiReview → schedule → progress → summary
```

Steps `workItems` and `wiki` are skippable (toggle enabled/disabled).

**State shape:**

```javascript
{
  currentStep: 'source',
  source: {
    type: 'azure',
    org: '',
    project: '',
    pat: '',
    validated: false
  },
  repos: [
    {
      name: 'repo-name',
      selected: true,
      targetName: 'repo-name',
      visibility: 'private',
      description: '',
      hasLFS: false,
      hasSubmodules: false,
      size: 45000,
      conflictStatus: null  // null | 'checking' | 'clear' | 'conflict'
    }
  ],
  workItems: {
    enabled: false,
    types: ['Bug', 'User Story'],
    includeComments: true,
    includeAttachments: true,
    includeHistory: false,
    createProjectBoard: false,
    labelMapping: {},
    counts: {}  // fetched from ADO
  },
  wiki: {
    enabled: false,
    wikis: [],           // fetched from ADO
    destinations: {}     // { wikiId: 'wiki' | 'docs' }
  },
  aiPlan: {
    analyzed: false,
    risks: [],
    suggestions: [],
    executionOrder: [],
    estimatedMinutes: 0,
    userOverrides: {}    // user can accept/reject each suggestion
  },
  schedule: {
    mode: 'now',         // 'now' | 'scheduled'
    scheduledAt: null,
    isDryRun: false
  },
  planId: null,
  error: null
}
```

**Validations per step:**

| Step | Validation |
|------|-----------|
| source | org + project required, PAT validated via API |
| repoSelect | at least 1 repo selected |
| repoConfig | target names valid (no duplicates, no invalid chars), conflict check passed |
| workItems | if enabled, at least 1 type selected |
| wiki | if enabled, destination set for each wiki |
| aiReview | user has reviewed plan (scrolled through or clicked "Approve Plan") |
| schedule | if scheduled, date is in the future |

### 4.3 Step Components

#### SourceStep

Same as current ImportWizard step 1 but cleaner:
- Azure org input with validation
- Project dropdown with search (fetched after org validates)
- PAT input with show/hide toggle
- Inline validation feedback (green check / red X)
- "Use server PAT" toggle if `AZURE_PAT` env var configured

#### RepoSelectStep

- List all repos from selected project with checkboxes
- Search/filter by name (instant, client-side)
- Select All / Deselect All / Invert Selection buttons
- Per-repo metadata: size badge, branch count, last commit date, LFS indicator, language
- "Already migrated" badge for repos found in `migration_tasks` history
- Sort by: name, size, last updated

#### RepoConfigStep

Editable table, one row per selected repo:
- **Target name**: pre-filled with sanitized original name, editable
- **Visibility**: toggle (public/private), default from settings
- **Description**: editable text, "✨ AI Suggest" button per row
- **Conflict indicator**: green (clear), yellow (checking), red (conflict exists)
- Bulk actions bar: "Make All Private", "Accept All AI Names", "Check All Conflicts"
- Conflict check runs automatically (debounced 500ms after name change)
- If conflict: inline options (Replace, Rename, Skip) similar to current ConflictPanel

#### WorkItemsStep

- Master toggle: "Migrate Work Items → GitHub Issues"
- If enabled:
  - Checkboxes per type with counts from ADO: Epic (5), Feature (12), User Story (42), Task (67), Bug (18)
  - Options section: Include Comments, Include Attachments, Include History (toggles)
  - Label mapping table: type → label name (editable, defaults provided)
  - "Create GitHub Project Board" toggle
  - Preview: "142 work items will be migrated as 142 GitHub Issues with 5 labels"
  - AI button: "✨ Suggest Label Mapping" — AI analyzes item types and suggests optimal labels

#### WikiStep

- Master toggle: "Migrate Wikis"
- If enabled:
  - List of available wikis (fetched from ADO) with page count and attachment info
  - Per wiki: radio group — "GitHub Wiki" / "Docs Folder"
  - Conversion preview: shows example of how a link transforms
  - Warning if wiki has large attachments (> 10MB total)
  - AI recommendation badge: "AI recommends: Docs Folder (23 pages, good for versioned docs)"

#### AIReviewStep

The AI analyzes everything and presents:

- **Migration Plan** section:
  - Ordered list of tasks with dependency arrows/lines
  - Each task shows: type icon, source → target, estimated duration
  - Drag-to-reorder if user disagrees with AI order

- **Risks** section:
  - Cards with severity badge (High = red, Medium = yellow, Low = blue)
  - Each card: title, description, recommendation, affected repo
  - Dismissible (user acknowledges risk)

- **Suggestions** section:
  - Per-repo cards with AI suggestion (name, visibility, description)
  - Accept / Reject buttons per suggestion
  - "Accept All" / "Reject All" bulk buttons

- **Estimate** section:
  - Total estimated duration
  - Breakdown per task type: repos (~X min), work items (~Y min), wikis (~Z min)

- **"Re-analyze"** button if user made manual changes after analysis
- **"Approve Plan"** button to proceed (required before Next)

- **Without AI**: shows basic validation only (name conflicts, size warnings), no suggestions/risks/ordering

#### ScheduleStep

- Radio group: "Execute Now" / "Schedule for Later"
- If scheduled: DateTimePicker (min = now + 5 minutes)
- Dry-run checkbox: "Simulate migration without creating anything"
- Final summary card:
  - X repositories, Y work items, Z wiki pages
  - Target org: org-name
  - Estimated duration: ~35 min
  - Mode: Immediate / Scheduled for [date] / Dry-Run
- "Start Migration" / "Schedule Migration" button (primary action)

#### ProgressStep

Real-time via SSE (replaces polling):

- Vertical timeline with each task as a row
- Per task:
  - Type icon (repo 📦, work-items 📋, wiki 📖)
  - Source → Target label
  - Progress bar (0-100%)
  - Status badge: Pending (gray), Running (blue pulse), Complete (green), Failed (red), Retrying (yellow), Cancelled (gray strikethrough)
  - Current message: "Cloning bare repository..." / "Creating issue 42/142..."
  - Duration elapsed
  - If failed: error message + "Retry" button
  - Expandable log (click to see detailed messages)
- Global controls:
  - "Pause" button (pauses after current atomic operation completes)
  - "Cancel" button (with confirmation dialog)
  - Overall progress: "5/8 tasks completed"
- Auto-scrolls to active task

#### SummaryStep

Post-migration report:

- Overall score: "7/8 tasks completed successfully" with progress ring
- Per-task results:
  - Status icon + label
  - Duration
  - Key metrics: branches migrated, issues created, wiki pages converted
  - Direct links: repo URL, issues list, wiki URL
  - If failed: error details + suggested resolution
- Actions:
  - "Export Report" (JSON download)
  - "New Migration" (resets wizard)
  - "View in Migration History"
- If dry-run: "This was a simulation. No resources were created." banner + "Run for Real" button

---

## 5. Edge Cases & Robustness

### 5.1 Pre-Flight Validation

Before starting any migration plan, the engine validates:

1. **Git available** — `git --version` (blocks if missing)
2. **Source accessible** — `git ls-remote` with 30s timeout per repo
3. **Target org exists** — GitHub API check, user has repo create permission
4. **Name conflicts** — GitHub API check for each target repo name
5. **Disk space** — estimate required space (sum of repo sizes × 2 for bare clone), warn if < 1GB free
6. **LFS detection** — flag repos with LFS, estimate additional space
7. **Submodule detection** — identify cross-repo dependencies, warn if dependency not in plan
8. **GitHub rate limit** — check `X-RateLimit-Remaining`, warn if < 500
9. **Repo size** — warn if > 2GB, require confirmation if > 10GB
10. **Work item count** — warn if > 500 items (may take significant time)
11. **Wiki size** — warn if attachments > 100MB total

Pre-flight runs during plan validation (before execution or as dry-run).

### 5.2 Retry & Recovery

- **Automatic retry**: max 3 attempts with exponential backoff (5s → 30s → 2min)
- **Smart resume**: if repo clone succeeded but push failed, reuse cached bare clone from `tmp/migrations/{planId}/{taskId}/`
- **Temp dir management**: bare clones stored in `tmp/migrations/{planId}/{taskId}/`, preserved 24h after failure for manual retry, auto-cleaned after success. A background cleanup job runs every hour: deletes temp dirs older than the configured retention period (default 24h, configurable in SettingsModal). Temp dir paths are tracked in `migration_tasks.metadata` JSON for reliable cleanup
- **Rate limit recovery**: reads `Retry-After` header, pauses task, auto-resumes (does not count as retry attempt)
- **Network recovery**: timeout or connection reset triggers immediate retry (counts as attempt)
- **Partial success**: failed tasks don't block other independent tasks; report shows partial results

### 5.3 Cancellation

- "Cancel" button in ProgressStep sets `cancelled` flag on plan
- Each service checks `isCancelled()` between atomic operations
- **During clone**: kill git process, cleanup temp dir
- **During push**: repo left in partial state → rollback (delete GitHub repo)
- **During work items**: issues already created remain (listed in report for manual cleanup)
- **During wiki**: partial wiki content deleted

### 5.4 Rollback

| Task Type | Rollback Behavior |
|-----------|-------------------|
| Repo (push failed) | Delete created GitHub repo (configurable: keep empty vs delete) |
| Repo (clone failed) | Nothing to rollback (no GitHub repo created yet) |
| Work Items | No auto-rollback (list created issues in report for manual review) |
| Wiki (GitHub Wiki) | Delete wiki content |
| Wiki (docs/) | Delete branch/PR if created |

**Dry-run behavior per task type:**

| Task Type  | Dry-Run Actions                                                                  | Dry-Run Skips                     |
| ---------- | -------------------------------------------------------------------------------- | --------------------------------- |
| Repo       | Validate source URL (`git ls-remote`), check target name conflict, estimate size | Clone, create GitHub repo, push   |
| Work Items | Query ADO for item counts per type, validate GitHub Issues API access            | Create issues, upload attachments |
| Wiki       | List wiki pages, validate clone URL, check target wiki/docs access               | Clone, convert, push              |

Dry-run produces a full report showing what *would* be created, with estimated durations and identified risks.

### 5.5 Scheduling

- `scheduled_at` column in `migration_plans`
- Background interval on server: every 30s, checks for `status='scheduled' AND scheduled_at <= now()`
- Transitions to `running` and starts execution
- If server restarts: scheduled plans persist in DB, checked on next interval
- Running plans marked `interrupted` on shutdown, user can manually resume

**Credential persistence for scheduled plans:**

Scheduled migrations execute after the user's browser session may have expired. To handle this:

- When a plan is scheduled, credentials (GitHub access token + Azure PAT) are encrypted and stored in the `migration_plans.credentials_enc` column (added to schema)
- Encryption uses AES-256-GCM with a server-side key derived from `SESSION_SECRET` env var via PBKDF2
- Credentials are decrypted at execution time by the scheduler
- Automatic cleanup: `credentials_enc` is set to NULL immediately after plan execution completes (success, failure, or cancellation)
- TTL safety net: a background job clears any `credentials_enc` older than 48 hours regardless of plan status
- If `SESSION_SECRET` is not set, scheduling is disabled (only "Execute Now" available)
- The ScheduleStep UI shows a notice: "Credentials will be securely stored until the scheduled migration completes"

### 5.6 Limits & Protections

| Limit | Value | Rationale |
|-------|-------|-----------|
| Repos per plan | 20 | Matches current batch limit |
| Work items per task | 500 | Prevents abuse, GitHub API quota |
| Wiki pages per task | 100 | Reasonable wiki size |
| Concurrent repo tasks | 2 | Balances speed vs resource usage |
| Concurrent work-item tasks | 1 | Sequential to respect rate limits |
| Concurrent wiki tasks | 1 | Sequential to avoid conflicts |
| Repo task timeout | 30 min | Covers repos up to ~5GB |
| Work items task timeout | 15 min | ~500 items with comments |
| Wiki task timeout | 10 min | ~100 pages with attachments |
| Total plan timeout | 4 hours | Safety cap |
| Min disk space | 1 GB | Warning threshold |
| Attachment size | 25 MB | GitHub Issues limit |

---

## 6. Context Menu — Cascading Submenus

### 6.1 New Component: `ContextMenu.jsx`

Reusable, replaces inline menu in `RepoList.jsx`.

**Features:**
- Cascading submenus: hover (desktop) or click (mobile) opens child menu
- Viewport-aware positioning: submenu opens right, or left if insufficient space
- Keyboard navigation: ↑↓ navigate items, → opens submenu, ← closes submenu, Enter executes, Escape closes
- Sections with separators and optional headers
- Icons + chevron (▸) for submenu indicators
- Disabled items with tooltip explaining why
- Framer Motion enter/exit animations (scale + opacity)

### 6.2 Single Repo Menu Structure

```
┌─────────────────────────────────┐
│ {repo-name}          {badge}    │
├─────────────────────────────────┤
│ 🔗 Open on GitHub              │
│ 📋 Copy Clone URL          ▸   │─→ HTTPS │ SSH │ GitHub CLI
│ ⚙️ Settings                    │
├─────────────────────────────────┤
│ 🚀 Migration               ▸   │─→ Migrate to GitHub
│                                 │    Migrate Work Items
│                                 │    Migrate Wiki
│                                 │    Migration History
│                                 │    Dry-Run (Simulate)
├─────────────────────────────────┤
│ 🤖 AI                      ▸   │─→ Migration Risk Analysis
│                                 │    Suggest Name & Description
│                                 │    Quality Report
│                                 │    Compare with Existing
│                                 │    Security / Secrets Scan
├─────────────────────────────────┤
│ 📦 Management               ▸   │─→ Transfer to Org
│                                 │    Mirror / Fork
│                                 │    Sync Repository
│                                 │    Export Metadata (JSON)
├─────────────────────────────────┤
│ 🔒 Make Public / Private       │
│ 📁 Archive / Unarchive         │
├─────────────────────────────────┤
│ 🔴 Delete Repository           │
└─────────────────────────────────┘
```

### 6.3 Batch Selection Menu (multiple repos selected)

When 2+ repos are selected, the context menu adapts:

```
┌──────────────────────────────────┐
│ {N} repositories selected        │
├──────────────────────────────────┤
│ 🚀 Migrate All ({N})        ▸   │─→ Repos Only
│                                  │    Repos + Work Items
│                                  │    Repos + Work Items + Wikis
│                                  │    Dry-Run All
├──────────────────────────────────┤
│ 🤖 AI Batch Analysis ({N})  ▸   │─→ Risk Analysis for All
│                                  │    Quality Reports
│                                  │    Generate Migration Plan
├──────────────────────────────────┤
│ 📦 Batch Management         ▸   │─→ Transfer All to Org
│                                  │    Mirror All
│                                  │    Export All Metadata
├──────────────────────────────────┤
│ 🔒 Change Visibility ({N})      │
│ 📁 Archive All ({N})            │
├──────────────────────────────────┤
│ 🔴 Delete All ({N})             │
└──────────────────────────────────┘
```

### 6.4 Disabled States

Items are disabled (grayed, non-clickable) with tooltip when:

| Item | Disabled When | Tooltip |
|------|--------------|---------|
| Migrate Work Items | Source is URL (not Azure) | "Only available for Azure DevOps repos" |
| Migrate Wiki | Source is URL (not Azure) | "Only available for Azure DevOps repos" |
| AI submenu items | AI not configured | "Configure AI API key in Settings" |
| Compare with Existing | No matching repo in target | "No existing repo to compare" |
| Transfer to Org | No org memberships | "Join an organization first" |
| Sync Repository | Not a mirrored repo | "Only available for mirrored repos" |

### 6.5 Keyboard Support

- `Shift+F10` or context menu key opens menu on focused repo
- Full arrow key navigation within menu and submenus
- `Home`/`End` jump to first/last item
- Type-ahead search: typing characters jumps to matching item
- `Escape` closes current level (submenu → parent, parent → close)

---

## 7. AI Integration Across the Application

### 7.1 AI in Migration Wizard Steps

| Step | AI Feature | Trigger |
|------|-----------|---------|
| RepoConfigStep | Suggest target name + description | "✨ AI Suggest" button per row, or "Suggest All" |
| WorkItemsStep | Suggest label mapping | "✨ Suggest Labels" button |
| WikiStep | Recommend wiki vs docs/ destination | Auto badge per wiki |
| AIReviewStep | Full migration plan analysis | Automatic on step entry |
| ProgressStep | Diagnose failures | Inline when task fails |
| SummaryStep | Executive summary | Automatic on completion |

### 7.2 AI in Context Menu

| Action | What It Does |
|--------|-------------|
| Migration Risk Analysis | Opens modal with risk report (size, secrets, dependencies, health) |
| Suggest Name & Description | Popover with AI suggestion, Accept/Reject inline |
| Quality Report | Opens RepoInsightsModal (existing, enhanced) |
| Compare with Existing | Side-by-side modal: ADO repo vs GitHub repo metadata comparison |
| Security / Secrets Scan | Scans repo for exposed API keys, passwords, tokens — report modal |

### 7.3 AI in Existing Features

| Feature | Enhancement |
|---------|-------------|
| CreateRepoModal | AI suggests description based on repo name (existing, keep) |
| TransferModal | AI suggests conflict resolution ("Source is newer → Replace") |
| MigrationHistory | AI generates executive summary of completed migrations |

### 7.4 Fallback Without AI

Every AI feature has a non-AI fallback:

- Wizard works fully without AI — manual configuration only
- AIReviewStep shows basic programmatic validation (conflicts, size warnings)
- Context menu AI items show "disabled" with "Configure AI in Settings"
- No functionality is blocked by missing AI configuration
- Mock mode continues to work for development/testing

---

## 8. Dialog Improvements

### 8.1 TransferModal Enhancements

- SSE for transfer progress (replace polling pattern)
- Pre-flight validation before transfer
- AI-powered conflict resolution suggestions
- Dry-run option (simulate transfer)
- Debounced conflict check (500ms after target org change)

### 8.2 CreateRepoModal Enhancements

- Real-time name validation against GitHub API (debounced 500ms)
- Name availability indicator (green check / red X)
- AI description suggestion (existing feature, keep)

### 8.3 SettingsModal Enhancements

New sections:

- **Migration section**:
  - Default target org selector
  - Default visibility for imports (public/private)
  - Retry policy: max retries (1-5), backoff multiplier
  - Task timeouts: repo (10-60 min), work items (5-30 min), wiki (5-20 min)
  - Cleanup policy: temp dir retention (1h, 24h, 7d, manual)

- **AI section**:
  - API key management (existing, improved)
  - Toggle per AI feature (suggestions, risk analysis, planning, security scan)

### 8.4 MigrationHistory Enhancements

- Shows migration plans (not just individual jobs)
- Plan detail view: expand to see all tasks with status
- Filter by: status, type (repo/work-items/wiki), date range
- Re-run failed plans (creates new plan with same config)
- Export report (JSON)
- Timeline visualization per plan
- Backward compatible: still shows legacy `migration_jobs` entries

---

## 9. API Endpoints

### New Routes (`server/routes/migration.js`)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/migration/plans` | Create a new migration plan |
| `GET` | `/api/migration/plans` | List user's plans (paginated) |
| `GET` | `/api/migration/plans/:id` | Get plan with all tasks |
| `PUT` | `/api/migration/plans/:id` | Update plan (before execution) |
| `DELETE` | `/api/migration/plans/:id` | Delete draft plan |
| `POST` | `/api/migration/plans/:id/validate` | Run pre-flight validation |
| `POST` | `/api/migration/plans/:id/execute` | Start execution |
| `POST` | `/api/migration/plans/:id/cancel` | Cancel running plan |
| `POST` | `/api/migration/plans/:id/pause` | Pause running plan |
| `POST` | `/api/migration/plans/:id/resume` | Resume paused plan |
| `POST` | `/api/migration/plans/:id/tasks/:taskId/retry` | Retry failed task |
| `GET` | `/api/migration/stream/:id` | SSE stream for plan progress |
| `POST` | `/api/migration/analyze` | AI analysis (returns plan suggestions) |
| `GET` | `/api/migration/plans/:id/report` | Export migration report (JSON) |

### Enhanced Existing Routes

| Method | Path | Change |
|--------|------|--------|
| `POST` | `/api/azure/wikis` | **NEW** — List wikis for project |
| `POST` | `/api/azure/work-items/counts` | **NEW** — Count work items by type |
| `POST` | `/api/azure/work-items/preview` | **NEW** — Preview sample work items |

### Validation Schemas (Zod)

New endpoints use Zod schemas consistent with `server/lib/validators.js`:

```javascript
const createPlanSchema = z.object({
  source: z.object({
    type: z.literal('azure'),
    org: z.string().min(1).max(100),
    project: z.string().min(1).max(100),
    pat: z.string().min(1).optional()  // optional if server PAT configured
  }),
  targetOrg: z.string().max(39).optional(),
  tasks: z.array(z.discriminatedUnion('type', [
    z.object({
      type: z.literal('repo'),
      sourceRef: z.string().min(1),
      targetRef: z.string().min(1).max(100),
      config: z.object({
        makePrivate: z.boolean().default(true),
        description: z.string().max(350).default(''),
        rollbackPolicy: z.enum(['delete', 'keep-empty']).default('delete'),
        timeout: z.number().min(60000).max(3600000).default(1800000)
      }).default({})
    }),
    z.object({
      type: z.literal('work-items'),
      sourceRef: z.string().min(1),
      targetRef: z.string().min(1),
      config: z.object({
        types: z.array(z.string()).min(1),
        includeComments: z.boolean().default(true),
        includeAttachments: z.boolean().default(true),
        includeHistory: z.boolean().default(false),
        createProjectBoard: z.boolean().default(false),
        labelMapping: z.record(z.string(), z.string()).default({})
      })
    }),
    z.object({
      type: z.literal('wiki'),
      sourceRef: z.string().min(1),
      targetRef: z.string().min(1),
      config: z.object({
        destination: z.enum(['wiki', 'docs']),
        createPR: z.boolean().default(true),
        branch: z.string().default('docs/wiki-migration')
      })
    })
  ])).min(1).max(60),  // 20 repos × 3 task types
  schedule: z.object({
    mode: z.enum(['now', 'scheduled']).default('now'),
    scheduledAt: z.string().datetime().optional(),
    isDryRun: z.boolean().default(false)
  }).default({})
});

const updatePlanSchema = createPlanSchema.partial();
```

### Backward Compatibility

Existing endpoints (`/api/import/*`, `/api/migrations`) remain functional. The `ImportWizard.jsx` component is kept but deprecated — new migrations use `MigrationWizard`. The old `migration_jobs` table is read-only for history display.

**Known data key mismatch:** The existing `GET /api/migrations` endpoint returns `{ migrations: [...] }` but `MigrationHistory.jsx` reads `data.jobs`. The MigrationHistory enhancement (§8.4) must fix this by reading `data.migrations` for the legacy endpoint and `data.plans` for the new `GET /api/migration/plans` endpoint.

### Export Report Schema

The `GET /api/migration/plans/:id/report` endpoint returns:

```json
{
  "plan": {
    "id": 1,
    "status": "completed",
    "startedAt": "2026-03-21T10:00:00Z",
    "completedAt": "2026-03-21T10:35:00Z",
    "durationSeconds": 2100
  },
  "summary": {
    "total": 8,
    "success": 7,
    "failed": 1,
    "skipped": 0
  },
  "tasks": [
    {
      "id": 1,
      "type": "repo",
      "sourceRef": "org/project/repo-name",
      "targetRef": "github-org/repo-name",
      "status": "completed",
      "durationSeconds": 120,
      "metadata": { "branches": 12, "hasLFS": false, "repoUrl": "https://github.com/..." }
    }
  ],
  "errors": [
    {
      "taskId": 5,
      "type": "work-items",
      "error": "Rate limit exceeded after 342 items",
      "suggestion": "Re-run with remaining 158 items"
    }
  ],
  "generatedAt": "2026-03-21T10:35:01Z"
}
```

---

## 10. Implementation Phases

The spec is implemented in a single coordinated effort, but logically ordered:

### Phase 1: Foundation
- DB schema (migration_plans, migration_tasks)
- MigrationEngine core (create, validate, execute, cancel)
- SSE endpoint
- Basic MigrationWizard shell with SourceStep, RepoSelectStep, RepoConfigStep

### Phase 2: Migration Types
- Work Item Service (ADO → GitHub Issues)
- Wiki Service (ADO → GitHub Wiki / docs)
- WorkItemsStep, WikiStep in wizard
- Pre-flight validation

### Phase 3: Robustness
- Retry with exponential backoff
- Pause/Resume
- Scheduling
- Dry-run mode
- Rollback
- ProgressStep with SSE
- SummaryStep with report export

### Phase 4: AI Integration
- Migration Planner Service
- AIReviewStep
- AI suggestions in RepoConfigStep, WorkItemsStep, WikiStep
- AI failure diagnosis in ProgressStep
- useMigrationPlanner hook

### Phase 5: Context Menu
- ContextMenu.jsx reusable component
- RepoContextMenu.jsx with full submenu structure
- Batch-aware menu
- Keyboard navigation
- Integration with migration and AI features

### Phase 6: Dialog Improvements
- TransferModal SSE + dry-run
- CreateRepoModal name validation
- SettingsModal new sections
- MigrationHistory upgrade

---

## 11. Testing Strategy

### Unit Tests

| Component | Location | Coverage |
|-----------|----------|----------|
| MigrationEngine | `server/__tests__/migration-engine.test.js` | Plan lifecycle, concurrency, retry, cancel |
| WorkItemService | `server/__tests__/work-item-service.test.js` | WIQL, mapping, rate limiting |
| WikiService | `server/__tests__/wiki-service.test.js` | Content conversion, push |
| MigrationPlanner | `server/__tests__/migration-planner.test.js` | AI prompt, fallback |
| useMigrationWizard | `tests/hooks/useMigrationWizard.test.jsx` | State machine, validation |
| ContextMenu | `tests/components/ui/ContextMenu.test.jsx` | Submenus, keyboard nav, positioning |
| Each wizard step | `tests/components/MigrationWizard/*.test.jsx` | Render, validation, interactions |

### E2E Tests

| Flow | File |
|------|------|
| Full migration wizard | `e2e/migration-wizard.spec.js` |
| Context menu actions | `e2e/context-menu.spec.js` |
| Migration history | `e2e/migration-history.spec.js` |

---

## 12. Security Considerations

- **PAT handling**: never stored in DB, only in memory during session. Encrypted in transit (HTTPS).
- **SSRF protection**: existing protections (IP validation, DNS rebinding) apply to all new services
- **Work item content**: HTML sanitized before storing as issue body (DOMPurify or similar)
- **Wiki content**: attachment downloads validated for file type and size
- **Rate limiting**: respects both Azure DevOps and GitHub API rate limits
- **Session validation**: all new endpoints require authentication via existing middleware
- **SSE auth**: validated on connection, closed if session expires
- **Input validation**: all new endpoints use Zod schemas (consistent with existing validators)
