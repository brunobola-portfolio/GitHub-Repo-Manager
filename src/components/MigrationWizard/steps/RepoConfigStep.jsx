import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Lock, Unlock, Loader2, CheckCircle2, XCircle,
  AlertTriangle, RefreshCw, SkipForward, Edit3,
  Settings2, ChevronDown, ChevronUp, GitBranch, HardDrive,
} from 'lucide-react'

/**
 * RepoConfigStep - Configure target settings for selected repos.
 *
 * Props:
 *   repos        - array of selected repos (already filtered to selected only)
 *   onUpdateRepo - (index, updates) => void  (calls wizard.updateRepo with original index)
 *   source       - { org, project, pat }
 */
export default function RepoConfigStep({ repos, onUpdateRepo, source }) {
  // Conflict status per repo: { [repoName]: 'idle' | 'checking' | 'clear' | 'conflict' }
  const [conflicts, setConflicts] = useState({})
  const debounceTimers = useRef({})
  // Branch filtering: expanded repos and cached branches
  const [expandedBranches, setExpandedBranches] = useState({})
  const [branchCache, setBranchCache] = useState({})   // { [repoId]: branches[] }
  const [loadingBranches, setLoadingBranches] = useState({})

  const toggleBranchExpand = useCallback(async (repo, index) => {
    const key = repo.id || repo.name
    const isExpanded = expandedBranches[key]

    setExpandedBranches((prev) => ({ ...prev, [key]: !isExpanded }))

    // Fetch branches if not cached
    if (!isExpanded && !branchCache[key]) {
      setLoadingBranches((prev) => ({ ...prev, [key]: true }))
      try {
        const res = await fetch('/api/azure/branches', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            org: source.org,
            project: source.project,
            repoId: repo.id,
            pat: source.pat || undefined,
          }),
        })
        const data = await res.json()
        if (res.ok && data.branches) {
          setBranchCache((prev) => ({ ...prev, [key]: data.branches }))
        }
      } catch { /* ignore */ }
      setLoadingBranches((prev) => ({ ...prev, [key]: false }))
    }
  }, [expandedBranches, branchCache, source.org, source.project, source.pat])

  const hasLfsEnabled = repos.some((r) => r.lfsEnabled)

  // Debounced conflict check when targetName changes
  const checkConflict = useCallback(
    (repoName, targetName) => {
      // Clear existing timer
      if (debounceTimers.current[repoName]) {
        clearTimeout(debounceTimers.current[repoName])
      }

      if (!targetName?.trim()) {
        setConflicts((prev) => ({ ...prev, [repoName]: 'idle' }))
        return
      }

      setConflicts((prev) => ({ ...prev, [repoName]: 'checking' }))

      debounceTimers.current[repoName] = setTimeout(async () => {
        try {
          const res = await fetch('/api/import/check-duplicates', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              repos: [targetName],
              targetOwner: source.org,
            }),
          })
          const data = await res.json()
          if (res.ok && data.duplicates) {
            setConflicts((prev) => ({
              ...prev,
              [repoName]: data.duplicates[targetName] ? 'conflict' : 'clear',
            }))
          } else {
            setConflicts((prev) => ({ ...prev, [repoName]: 'idle' }))
          }
        } catch {
          setConflicts((prev) => ({ ...prev, [repoName]: 'idle' }))
        }
      }, 500)
    },
    [source.org]
  )

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = debounceTimers.current
    return () => {
      Object.values(timers).forEach(clearTimeout)
    }
  }, [])

  // Trigger conflict checks on initial mount for all repos
  useEffect(() => {
    repos.forEach((repo) => {
      if (repo.targetName?.trim()) {
        checkConflict(repo.name, repo.targetName)
      }
    })
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleTargetNameChange = (repo, index, value) => {
    onUpdateRepo(index, { targetName: value })
    checkConflict(repo.name, value)
  }

  const handleVisibilityToggle = (index, currentVisibility) => {
    onUpdateRepo(index, {
      visibility: currentVisibility === 'private' ? 'public' : 'private',
    })
  }

  const handleDescriptionChange = (index, value) => {
    onUpdateRepo(index, { description: value })
  }

  // Conflict resolution actions
  const handleReplace = (repo, index) => {
    // Mark as "will replace" by keeping the same name
    setConflicts((prev) => ({ ...prev, [repo.name]: 'clear' }))
    onUpdateRepo(index, { conflictAction: 'replace' })
  }

  const handleRename = (repo, index) => {
    const newName = `${repo.targetName}-migrated`
    onUpdateRepo(index, { targetName: newName, conflictAction: 'rename' })
    checkConflict(repo.name, newName)
  }

  const handleSkip = (repo, index) => {
    onUpdateRepo(index, { selected: false, conflictAction: 'skip' })
  }

  // Bulk actions
  const makeAllPrivate = () => {
    repos.forEach((_, i) => onUpdateRepo(i, { visibility: 'private' }))
  }

  const makeAllPublic = () => {
    repos.forEach((_, i) => onUpdateRepo(i, { visibility: 'public' }))
  }

  if (repos.length === 0) {
    return (
      <div className="text-center py-12">
        <Settings2 className="w-10 h-10 text-slate-400 mx-auto mb-3" />
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No repositories selected. Go back and select repositories to configure.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Configure Repositories
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Configuring{' '}
            <span className="font-medium text-indigo-500 dark:text-indigo-400">
              {repos.length}
            </span>{' '}
            {repos.length === 1 ? 'repository' : 'repositories'}
          </p>
        </div>

        {/* Bulk actions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={makeAllPrivate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-indigo-500 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors"
          >
            <Lock className="w-3.5 h-3.5" />
            All Private
          </button>
          <button
            type="button"
            onClick={makeAllPublic}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-indigo-500 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors"
          >
            <Unlock className="w-3.5 h-3.5" />
            All Public
          </button>
        </div>
      </div>

      {/* LFS Warning Banner */}
      {hasLfsEnabled && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm">
          <HardDrive className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <span className="text-amber-700 dark:text-amber-400">
            Git LFS objects will be included. Large repositories may take significantly longer to migrate.
          </span>
        </div>
      )}

      {/* Config table */}
      <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[1fr_1fr_80px_1fr_auto] gap-3 px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          <span>Source</span>
          <span>Target Name</span>
          <span className="text-center">Visibility</span>
          <span>Description</span>
          <span className="w-6" />
        </div>

        {/* Table rows */}
        <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-96 overflow-y-auto">
          <AnimatePresence initial={false}>
            {repos.map((repo, index) => {
              const conflictStatus = conflicts[repo.name] || 'idle'
              const isPrivate = repo.visibility === 'private'

              return (
                <motion.div
                  key={repo.name}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <div className="grid grid-cols-[1fr_1fr_80px_1fr_auto] gap-3 px-4 py-3 items-center">
                    {/* Source name (read-only) */}
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">
                        {repo.name}
                      </span>
                    </div>

                    {/* Target name (editable) */}
                    <div className="relative">
                      <input
                        type="text"
                        value={repo.targetName || ''}
                        onChange={(e) =>
                          handleTargetNameChange(repo, index, e.target.value)
                        }
                        className={`w-full px-3 py-1.5 text-sm border rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors
                          ${conflictStatus === 'conflict'
                            ? 'border-red-400 dark:border-red-600'
                            : 'border-slate-300 dark:border-slate-600'
                          }`}
                      />
                      {/* Conflict indicator */}
                      <div className="absolute right-2 top-1/2 -translate-y-1/2">
                        {conflictStatus === 'checking' && (
                          <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" />
                        )}
                        {conflictStatus === 'clear' && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                        )}
                        {conflictStatus === 'conflict' && (
                          <XCircle className="w-3.5 h-3.5 text-red-500" />
                        )}
                      </div>
                    </div>

                    {/* Visibility toggle */}
                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={() => handleVisibilityToggle(index, repo.visibility)}
                        className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg transition-colors
                          ${isPrivate
                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/50'
                            : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/50'
                          }`}
                        title={isPrivate ? 'Private' : 'Public'}
                      >
                        {isPrivate ? (
                          <Lock className="w-3 h-3" />
                        ) : (
                          <Unlock className="w-3 h-3" />
                        )}
                        <span className="hidden sm:inline">
                          {isPrivate ? 'Private' : 'Public'}
                        </span>
                      </button>
                    </div>

                    {/* Description (editable) */}
                    <input
                      type="text"
                      value={repo.description || ''}
                      onChange={(e) =>
                        handleDescriptionChange(index, e.target.value)
                      }
                      placeholder="Optional description..."
                      className="w-full px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                    />

                    {/* Status dot */}
                    <div className="w-6 flex justify-center">
                      {conflictStatus === 'clear' && (
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" title="Name available" />
                      )}
                      {conflictStatus === 'checking' && (
                        <div className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" title="Checking..." />
                      )}
                      {conflictStatus === 'conflict' && (
                        <div className="w-2.5 h-2.5 rounded-full bg-red-500" title="Conflict detected" />
                      )}
                      {conflictStatus === 'idle' && (
                        <div className="w-2.5 h-2.5 rounded-full bg-slate-300 dark:bg-slate-600" title="Not checked" />
                      )}
                    </div>
                  </div>

                  {/* Conflict resolution row */}
                  {conflictStatus === 'conflict' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="px-4 pb-3"
                    >
                      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-900/15 border border-red-200 dark:border-red-800/50">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                        <span className="text-xs text-red-600 dark:text-red-400 mr-auto">
                          A repository with this name already exists
                        </span>
                        <button
                          type="button"
                          onClick={() => handleReplace(repo, index)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Replace
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRename(repo, index)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
                        >
                          <Edit3 className="w-3 h-3" />
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSkip(repo, index)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-slate-100 dark:bg-slate-700/50 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600/50 transition-colors"
                        >
                          <SkipForward className="w-3 h-3" />
                          Skip
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {/* LFS and Branch options row */}
                  <div className="px-4 pb-3 flex items-center gap-4">
                    {/* LFS Toggle */}
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={!!repo.lfsEnabled}
                        onClick={() => onUpdateRepo(index, { lfsEnabled: !repo.lfsEnabled })}
                        className={`relative w-8 h-5 rounded-full transition-colors shrink-0
                          ${repo.lfsEnabled ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform
                          ${repo.lfsEnabled ? 'translate-x-3' : 'translate-x-0'}`} />
                      </button>
                      <span className="text-xs text-slate-600 dark:text-slate-400">
                        <HardDrive className="w-3 h-3 inline mr-1" />
                        LFS
                      </span>
                    </label>

                    {/* Branch filter toggle */}
                    <button
                      type="button"
                      onClick={() => toggleBranchExpand(repo, index)}
                      className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors"
                    >
                      <GitBranch className="w-3 h-3" />
                      {repo.branchFilter === 'selected'
                        ? `${(repo.selectedBranches || []).length} branches`
                        : 'All branches'}
                      {expandedBranches[repo.id || repo.name]
                        ? <ChevronUp className="w-3 h-3" />
                        : <ChevronDown className="w-3 h-3" />}
                    </button>
                  </div>

                  {/* Branch filtering expanded section */}
                  {expandedBranches[repo.id || repo.name] && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="px-4 pb-3"
                    >
                      <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-2">
                        {/* Mirror all toggle */}
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
                            className="rounded border-slate-300 dark:border-slate-600 text-indigo-500 focus:ring-indigo-500"
                          />
                          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                            Mirror all branches
                          </span>
                        </label>

                        {/* Individual branch list */}
                        {repo.branchFilter === 'selected' && (
                          <div className="space-y-1 max-h-32 overflow-y-auto">
                            {loadingBranches[repo.id || repo.name] ? (
                              <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Loading branches...
                              </div>
                            ) : (branchCache[repo.id || repo.name] || []).length > 0 ? (
                              (branchCache[repo.id || repo.name] || []).map((branch) => (
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
                                    className="rounded border-slate-300 dark:border-slate-600 text-indigo-500 focus:ring-indigo-500"
                                  />
                                  <span className="text-xs text-slate-600 dark:text-slate-400">{branch.name}</span>
                                </label>
                              ))
                            ) : (
                              <p className="text-xs text-slate-400 py-1">No branches found</p>
                            )}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
