# Configure Repositories — Premium Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Configure Repositories step (step 4) with a dashboard header + compact card-rows layout and a global destination org selector.

**Architecture:** Full visual rewrite of `RepoConfigStep.jsx` — same business logic (conflict detection, branch filtering, LFS toggle, bulk actions), new UI shell. `MigrationWizard.jsx` passes two new props (`orgs`, `onChangeDestination`). No new files, hooks, or API endpoints needed.

**Tech Stack:** React 19, Framer Motion, Tailwind CSS v4, Lucide icons, existing `Select.jsx` component.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/components/MigrationWizard/steps/RepoConfigStep.jsx` | Rewrite | Full layout rewrite: dashboard header, card-rows, expand/collapse |
| `src/components/MigrationWizard/MigrationWizard.jsx` | Modify (3 lines) | Pass `orgs` + `onChangeDestination` to RepoConfigStep |

---

## Task 1: Wire orgs prop through MigrationWizard

**Files:**
- Modify: `src/components/MigrationWizard/MigrationWizard.jsx:395-406`

- [ ] **Step 1: Add orgs and onChangeDestination props to RepoConfigStep render**

In `MigrationWizard.jsx`, find the `case 'repoConfig':` block (around line 395) and replace it:

```jsx
case 'repoConfig':
  return (
    <RepoConfigStep
      repos={selectedRepos}
      onUpdateRepo={(selectedIndex, updates) => {
        const originalIndex = repos.findIndex(
          (r) => r.name === selectedRepos[selectedIndex]?.name
        )
        if (originalIndex !== -1) updateRepo(originalIndex, updates)
      }}
      source={source}
      orgs={orgs}
      onChangeDestination={(orgLogin) => updateSource({ targetOrg: orgLogin })}
    />
  )
```

- [ ] **Step 2: Verify the app builds**

Run: `npx vite build 2>&1 | head -20`

Expected: Build succeeds (the new props are optional, so no breakage).

- [ ] **Step 3: Commit**

```bash
git add src/components/MigrationWizard/MigrationWizard.jsx
git commit -m "feat(wizard): pass orgs and onChangeDestination to RepoConfigStep"
```

---

## Task 2: Rewrite RepoConfigStep — Dashboard Header

**Files:**
- Modify: `src/components/MigrationWizard/steps/RepoConfigStep.jsx:1-170`

This task replaces the imports, props signature, all hook/state/handler code, and the top portion of the JSX (empty state + dashboard header). The repo card-rows are in Task 3.

- [ ] **Step 1: Replace imports and component signature**

Replace the entire file from line 1 through the end with the new implementation. Start with imports, props, state, and all handler functions — preserve all existing business logic but update the component signature to accept the new props:

```jsx
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Lock, Unlock, Loader2, CheckCircle2, XCircle,
  AlertTriangle, RefreshCw, SkipForward, Edit3,
  GitBranch, HardDrive, ChevronDown, ChevronUp,
  Package, MoreHorizontal, Building2, ArrowRight,
  Globe,
} from 'lucide-react'
import { Select } from '../../ui/Select'

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

export default function RepoConfigStep({ repos, onUpdateRepo, source, orgs = [], onChangeDestination }) {
  const [conflicts, setConflicts] = useState({})
  const debounceTimers = useRef({})
  const [expandedBranches, setExpandedBranches] = useState({})
  const [branchCache, setBranchCache] = useState({})
  const [loadingBranches, setLoadingBranches] = useState({})
  const [expandedCards, setExpandedCards] = useState({})

  // ... (all existing handler code stays exactly the same — see Step 2)
```

- [ ] **Step 2: Preserve all existing handler functions unchanged**

Keep these functions exactly as they are in the current file (they don't change):
- `toggleBranchExpand` (lines 26-54)
- `checkConflict` (lines 59-99) — but update `source.org` to use `source.targetOrg || source.org` for the `targetOwner` field
- cleanup `useEffect` (lines 102-107)
- initial conflict check `useEffect` (lines 110-118)
- `handleTargetNameChange` (lines 120-123)
- `handleVisibilityToggle` (lines 125-129)
- `handleDescriptionChange` (lines 131-133)
- `handleReplace` (lines 136-139)
- `handleRename` (lines 142-146)
- `handleSkip` (lines 148-150)
- `makeAllPrivate` (lines 153-155)
- `makeAllPublic` (lines 157-159)

Add this new handler for destination org change that also re-runs conflict checks:

```jsx
  const handleDestinationChange = useCallback((orgLogin) => {
    onChangeDestination?.(orgLogin)
    // Clear all conflicts and re-check after org change
    setConflicts({})
    setTimeout(() => {
      repos.forEach((repo) => {
        if (repo.targetName?.trim()) {
          checkConflict(repo.name, repo.targetName)
        }
      })
    }, 100)
  }, [onChangeDestination, repos, checkConflict])
```

Update `checkConflict` — change the `targetOwner` from `source.org` to `source.targetOrg || source.org`:

```jsx
body: JSON.stringify({
  repos: [targetName],
  targetOwner: source.targetOrg || source.org,
}),
```

And update the dependency array of `checkConflict` to `[source.targetOrg, source.org]`.

- [ ] **Step 3: Add computed stats**

Add this after the handlers, before the return:

```jsx
  const hasLfsEnabled = repos.some((r) => r.lfsEnabled)

  const stats = useMemo(() => ({
    count: repos.length,
    totalSize: repos.reduce((sum, r) => sum + (r.size || 0), 0),
    privateCount: repos.filter((r) => r.visibility === 'private').length,
    publicCount: repos.filter((r) => r.visibility === 'public').length,
  }), [repos])

  const orgOptions = useMemo(() =>
    orgs.map((org) => ({
      value: org.login,
      label: org.login,
      badge: org.isPersonal ? 'Personal' : `${(org.public_repos || 0) + (org.total_private_repos || 0)} repos`,
    })),
    [orgs]
  )

  const toggleCardExpand = (repoName) => {
    setExpandedCards((prev) => ({ ...prev, [repoName]: !prev[repoName] }))
  }
```

- [ ] **Step 4: Write the empty state and dashboard header JSX**

```jsx
  if (repos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
          <Package className="w-8 h-8 text-slate-400" />
        </div>
        <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-1">
          No repositories selected
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Go back and select repositories to configure.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Dashboard Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="bg-gradient-to-br from-violet-500/10 to-indigo-500/10 border border-violet-500/20 rounded-2xl p-5"
      >
        {/* Row 1: Destination + Bulk Actions */}
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-violet-500/15 flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5 text-violet-400" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Importing to
              </div>
              {orgOptions.length > 0 ? (
                <Select
                  options={orgOptions}
                  value={source.targetOrg || orgs[0]?.login || ''}
                  onChange={handleDestinationChange}
                  placeholder="Select organization..."
                  size="sm"
                  label="Destination organization"
                  className="mt-0.5 min-w-[180px]"
                />
              ) : (
                <div className="text-sm font-semibold text-slate-200">
                  {source.targetOrg || source.org || 'Personal Account'}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={makeAllPrivate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
                bg-violet-500/15 text-violet-300 border border-violet-500/20
                hover:bg-violet-500/25 transition-colors"
            >
              <Lock className="w-3.5 h-3.5" />
              All Private
            </button>
            <button
              type="button"
              onClick={makeAllPublic}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
                bg-cyan-500/15 text-cyan-300 border border-cyan-500/20
                hover:bg-cyan-500/25 transition-colors"
            >
              <Globe className="w-3.5 h-3.5" />
              All Public
            </button>
          </div>
        </div>

        {/* Row 2: Stats Grid */}
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-slate-900/50 rounded-xl px-4 py-3 text-center">
            <div className="text-xl font-bold text-violet-400">{stats.count}</div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 mt-0.5">Repositories</div>
          </div>
          <div className="bg-slate-900/50 rounded-xl px-4 py-3 text-center">
            <div className="text-xl font-bold text-cyan-400">{formatSize(stats.totalSize)}</div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 mt-0.5">Total Size</div>
          </div>
          <div className="bg-slate-900/50 rounded-xl px-4 py-3 text-center">
            <div className="text-xl font-bold text-emerald-400">{stats.privateCount}</div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 mt-0.5">Private</div>
          </div>
          <div className="bg-slate-900/50 rounded-xl px-4 py-3 text-center">
            <div className="text-xl font-bold text-orange-400">{stats.publicCount}</div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 mt-0.5">Public</div>
          </div>
        </div>
      </motion.div>

      {/* LFS Warning Banner */}
      {hasLfsEnabled && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm">
          <HardDrive className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-amber-300 text-xs">
            LFS repositories detected — migration may take longer for large files
          </span>
        </div>
      )}

      {/* Repo Card-Rows — rendered in Task 3 */}
    </div>
  )
```

- [ ] **Step 5: Verify the app builds (partial — card rows placeholder)**

Run: `npx vite build 2>&1 | head -20`

Expected: Build succeeds. The step will render the header but no repos yet (Task 3 adds them).

- [ ] **Step 6: Commit**

```bash
git add src/components/MigrationWizard/steps/RepoConfigStep.jsx
git commit -m "feat(wizard): dashboard header with org selector and live stats"
```

---

## Task 3: Rewrite RepoConfigStep — Card-Rows with Expand/Collapse

**Files:**
- Modify: `src/components/MigrationWizard/steps/RepoConfigStep.jsx` (continue from Task 2)

This task adds the repo card-rows list inside the `return` JSX, after the LFS warning banner.

- [ ] **Step 1: Add the card-rows list after the LFS banner**

Replace the `{/* Repo Card-Rows — rendered in Task 3 */}` placeholder with:

```jsx
      {/* Repo Card-Rows */}
      <div className="space-y-3 max-h-[calc(100vh-420px)] overflow-y-auto pr-1 custom-scrollbar">
        <AnimatePresence initial={false}>
          {repos.map((repo, index) => {
            const conflictStatus = conflicts[repo.name] || 'idle'
            const isPrivate = repo.visibility === 'private'
            const isExpanded = expandedCards[repo.name]
            const branchKey = repo.id || repo.name

            return (
              <motion.div
                key={repo.name}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.2, delay: index * 0.05 }}
                className={`relative bg-slate-800 border rounded-xl overflow-hidden transition-colors
                  ${conflictStatus === 'conflict'
                    ? 'border-red-500/30'
                    : 'border-slate-700 hover:border-slate-600'
                  }`}
              >
                {/* Gradient left border accent */}
                <div className="absolute top-0 left-0 bottom-0 w-[3px] rounded-l-xl bg-gradient-to-b from-violet-500 to-cyan-500" />

                {/* Main row */}
                <div className="flex items-center gap-3 pl-4 pr-3 py-3">
                  {/* Repo icon */}
                  <div className="w-8 h-8 rounded-lg bg-violet-500/15 flex items-center justify-center shrink-0">
                    <Package className="w-4 h-4 text-violet-400" />
                  </div>

                  {/* Source → Target */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-200 truncate">
                        {repo.name}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <div className="relative flex-1 max-w-[200px]">
                        <input
                          type="text"
                          value={repo.targetName || ''}
                          onChange={(e) => handleTargetNameChange(repo, index, e.target.value)}
                          className={`w-full px-2.5 py-1 text-sm rounded-lg bg-slate-900 text-slate-100
                            focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-colors
                            ${conflictStatus === 'conflict'
                              ? 'border border-red-500/50'
                              : 'border border-slate-700'
                            }`}
                        />
                        <div className="absolute right-2 top-1/2 -translate-y-1/2">
                          {conflictStatus === 'checking' && (
                            <Loader2 className="w-3 h-3 text-amber-500 animate-spin" />
                          )}
                          {conflictStatus === 'clear' && (
                            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                          )}
                          {conflictStatus === 'conflict' && (
                            <XCircle className="w-3 h-3 text-red-500" />
                          )}
                        </div>
                      </div>
                    </div>
                    {/* Metadata badges */}
                    <div className="flex items-center gap-1.5 mt-1.5">
                      {repo.language && (
                        <span className="text-[10px] bg-slate-900 text-slate-500 px-1.5 py-0.5 rounded">
                          {repo.language}
                        </span>
                      )}
                      <span className="text-[10px] bg-slate-900 text-slate-500 px-1.5 py-0.5 rounded">
                        {formatSize(repo.size)}
                      </span>
                      {repo.isTfvc ? (
                        <span className="text-[10px] bg-amber-500/15 text-amber-400 px-1.5 py-0.5 rounded">
                          TFVC
                        </span>
                      ) : (
                        repo.branches > 0 && (
                          <span className="text-[10px] bg-slate-900 text-slate-500 px-1.5 py-0.5 rounded">
                            {repo.branches} {repo.branches === 1 ? 'branch' : 'branches'}
                          </span>
                        )
                      )}
                    </div>
                  </div>

                  {/* Right: visibility + status + expand */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleVisibilityToggle(index, repo.visibility)}
                      aria-label={`Toggle visibility: currently ${repo.visibility}`}
                      aria-pressed={isPrivate}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors
                        ${isPrivate
                          ? 'bg-violet-500/15 text-violet-300 border border-violet-500/20'
                          : 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/20'
                        }`}
                    >
                      {isPrivate ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                      {isPrivate ? 'Private' : 'Public'}
                    </button>

                    {/* Status dot + label */}
                    <div className="flex items-center gap-1.5 min-w-[70px]">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${
                        conflictStatus === 'clear' ? 'bg-emerald-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]' :
                        conflictStatus === 'checking' ? 'bg-amber-500 animate-pulse shadow-[0_0_6px_rgba(245,158,11,0.5)]' :
                        conflictStatus === 'conflict' ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]' :
                        'bg-slate-600'
                      }`} />
                      <span className={`text-[11px] ${
                        conflictStatus === 'clear' ? 'text-emerald-400' :
                        conflictStatus === 'checking' ? 'text-amber-400' :
                        conflictStatus === 'conflict' ? 'text-red-400' :
                        'text-slate-500'
                      }`}>
                        {conflictStatus === 'clear' ? 'Ready' :
                         conflictStatus === 'checking' ? 'Checking...' :
                         conflictStatus === 'conflict' ? 'Conflict' : ''}
                      </span>
                    </div>

                    {/* Expand button */}
                    <button
                      type="button"
                      onClick={() => toggleCardExpand(repo.name)}
                      aria-expanded={isExpanded}
                      aria-label="Toggle advanced options"
                      className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-700 transition-colors"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Expanded section */}
                <AnimatePresence>
                  {(isExpanded || conflictStatus === 'conflict') && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="border-t border-slate-700/50"
                    >
                      <div className="px-4 py-3 pl-8 space-y-3">
                        {/* Conflict resolution */}
                        {conflictStatus === 'conflict' && (
                          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
                            <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                            <span className="text-xs text-red-300 mr-auto">
                              A repository with this name already exists
                            </span>
                            <button
                              type="button"
                              onClick={() => handleReplace(repo, index)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md
                                bg-red-500/15 text-red-300 hover:bg-red-500/25 transition-colors"
                            >
                              <RefreshCw className="w-3 h-3" />
                              Replace
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRename(repo, index)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md
                                bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 transition-colors"
                            >
                              <Edit3 className="w-3 h-3" />
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSkip(repo, index)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md
                                bg-slate-700/50 text-slate-400 hover:bg-slate-600/50 transition-colors"
                            >
                              <SkipForward className="w-3 h-3" />
                              Skip
                            </button>
                          </div>
                        )}

                        {/* Description */}
                        <div>
                          <label className="text-[10px] font-medium uppercase tracking-wider text-slate-500 mb-1 block">
                            Description
                          </label>
                          <input
                            type="text"
                            value={repo.description || ''}
                            onChange={(e) => handleDescriptionChange(index, e.target.value)}
                            placeholder="Optional description..."
                            className="w-full px-3 py-1.5 text-sm bg-slate-900 border border-slate-700 rounded-lg
                              text-slate-100 placeholder-slate-600
                              focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-colors"
                          />
                        </div>

                        {/* LFS + Branch row */}
                        <div className="flex items-center gap-4">
                          {/* LFS toggle */}
                          <label className="inline-flex items-center gap-2 cursor-pointer">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={!!repo.lfsEnabled}
                              onClick={() => onUpdateRepo(index, { lfsEnabled: !repo.lfsEnabled })}
                              className={`relative w-8 h-5 rounded-full transition-colors shrink-0
                                ${repo.lfsEnabled ? 'bg-indigo-500' : 'bg-slate-600'}`}
                            >
                              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform
                                ${repo.lfsEnabled ? 'translate-x-3' : 'translate-x-0'}`} />
                            </button>
                            <span className="text-xs text-slate-400">
                              <HardDrive className="w-3 h-3 inline mr-1" />
                              LFS
                            </span>
                          </label>

                          {/* Branch filter (Git only) */}
                          {!repo.isTfvc && (
                            <button
                              type="button"
                              onClick={() => toggleBranchExpand(repo, index)}
                              className="inline-flex items-center gap-1.5 text-xs text-slate-400
                                hover:text-indigo-400 transition-colors"
                            >
                              <GitBranch className="w-3 h-3" />
                              {repo.branchFilter === 'selected'
                                ? `${(repo.selectedBranches || []).length} branches`
                                : 'All branches'}
                              {expandedBranches[branchKey]
                                ? <ChevronUp className="w-3 h-3" />
                                : <ChevronDown className="w-3 h-3" />}
                            </button>
                          )}
                        </div>

                        {/* Branch list (Git only) */}
                        {!repo.isTfvc && expandedBranches[branchKey] && (
                          <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-700 space-y-2">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={repo.branchFilter !== 'selected'}
                                onChange={(e) => {
                                  onUpdateRepo(index, {
                                    branchFilter: e.target.checked ? 'all' : 'selected',
                                    ...(e.target.checked ? { selectedBranches: [] } : {}),
                                  })
                                }}
                                className="rounded border-slate-600 text-indigo-500 focus:ring-indigo-500"
                              />
                              <span className="text-xs font-medium text-slate-300">Mirror all branches</span>
                            </label>

                            {repo.branchFilter === 'selected' && (
                              <div className="space-y-1 max-h-32 overflow-y-auto">
                                {loadingBranches[branchKey] ? (
                                  <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    Loading branches...
                                  </div>
                                ) : (branchCache[branchKey] || []).length > 0 ? (
                                  (branchCache[branchKey] || []).map((branch) => (
                                    <label key={branch.name} className="flex items-center gap-2 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={(repo.selectedBranches || []).includes(branch.name)}
                                        onChange={(e) => {
                                          const current = repo.selectedBranches || []
                                          const next = e.target.checked
                                            ? [...current, branch.name]
                                            : current.filter((b) => b !== branch.name)
                                          onUpdateRepo(index, { selectedBranches: next })
                                        }}
                                        className="rounded border-slate-600 text-indigo-500 focus:ring-indigo-500"
                                      />
                                      <span className="text-xs text-slate-400">{branch.name}</span>
                                    </label>
                                  ))
                                ) : (
                                  <p className="text-xs text-slate-500 py-1">No branches found</p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
```

- [ ] **Step 2: Verify the app builds**

Run: `npx vite build 2>&1 | head -20`

Expected: Build succeeds with no errors.

- [ ] **Step 3: Manual visual test**

Run: `npx vite dev`

1. Open the Migration Wizard
2. Go through Azure flow to step 4 (Configure)
3. Verify: dashboard header shows with org selector, stats grid, bulk action buttons
4. Verify: repos display as card-rows with gradient left border
5. Verify: clicking ⋯ expands the advanced section
6. Verify: changing visibility updates stats in real-time
7. Verify: conflict detection still works (change a target name to an existing repo)

- [ ] **Step 4: Commit**

```bash
git add src/components/MigrationWizard/steps/RepoConfigStep.jsx
git commit -m "feat(wizard): premium card-rows layout with expand/collapse for repo config"
```

---

## Task 4: Polish and Final Verification

**Files:**
- Modify: `src/components/MigrationWizard/steps/RepoConfigStep.jsx` (minor adjustments)

- [ ] **Step 1: Test edge cases**

Test in the running dev server:
1. **Empty state**: Deselect all repos in step 3, go to step 4 — should show empty state with icon
2. **LFS banner**: Enable LFS on a repo in the expanded section — banner should appear
3. **Org change**: Change destination org in the dropdown — conflicts should re-check
4. **Long repo names**: Test with a very long repo name — should truncate with ellipsis
5. **TFVC repos**: If available, verify TFVC badge shows and branch filter is hidden
6. **Bulk actions**: Click "All Private" then "All Public" — stats should update

- [ ] **Step 2: Fix any visual issues found during testing**

Common adjustments:
- If the Select dropdown appears behind other elements, add `z-50` to its container
- If card-rows overflow, adjust `max-h-[calc(100vh-420px)]` value
- If stats text is too large on mobile, add responsive text sizes

- [ ] **Step 3: Final commit**

```bash
git add src/components/MigrationWizard/steps/RepoConfigStep.jsx
git commit -m "fix(wizard): polish configure step edge cases and responsive layout"
```
