import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, Check, Loader2, AlertCircle, FolderGit2,
  ArrowUpDown, CheckSquare, Square, ToggleLeft,
  GitBranch, Code2, HardDrive, AlertTriangle,
  CheckCircle2, XCircle, ExternalLink, KeyRound,
} from 'lucide-react'

/**
 * Format size in KB to human-readable string (KB / MB / GB).
 */
function formatSize(kb) {
  if (kb >= 1048576) return `${(kb / 1048576).toFixed(1)} GB`
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`
  return `${kb} KB`
}

/**
 * EmptyRepoState — shown when no repos are found.
 * For non-TFVC projects, automatically runs PAT permission diagnostics.
 */
function EmptyRepoState({ isTfvc, source }) {
  const [permissions, setPermissions] = useState(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (isTfvc || !source.org || !source.project) return
    setChecking(true)
    fetch('/api/azure/pat-permissions', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org: source.org, project: source.project, pat: source.pat || undefined }),
    })
      .then((r) => r.json())
      .then((data) => setPermissions(data.permissions || null))
      .catch(() => setPermissions(null))
      .finally(() => setChecking(false))
  }, [isTfvc, source.org, source.project, source.pat])

  if (isTfvc) {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
        <p className="text-sm font-medium text-slate-300">
          This TFVC project has no folders to migrate.
        </p>
        <p className="text-xs text-slate-400 mt-1">
          Check that your PAT has Code (Read) permission.
        </p>
      </div>
    )
  }

  return (
    <div className="py-8 space-y-4">
      <div className="text-center">
        <FolderGit2 className="w-10 h-10 text-slate-400 mx-auto mb-3" />
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
          No repositories found in this project.
        </p>
      </div>

      {/* PAT Diagnostics */}
      {checking ? (
        <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          Checking PAT permissions...
        </div>
      ) : permissions ? (
        <div className="max-w-xs mx-auto space-y-2">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 text-center">
            PAT Permission Check
          </p>
          {[
            { key: 'code', label: 'Code (Read)', required: true },
            { key: 'workItems', label: 'Work Items (Read)', required: false },
            { key: 'wiki', label: 'Wiki (Read)', required: false },
          ].map(({ key, label, required }) => (
            <div key={key} className="flex items-center gap-2 text-sm">
              {permissions[key] ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-red-500 shrink-0" />
              )}
              <span className={permissions[key] ? 'text-slate-600 dark:text-slate-400' : 'text-red-600 dark:text-red-400'}>
                {label}
                {required && !permissions[key] && ' (required)'}
              </span>
            </div>
          ))}

          {!permissions.code && (
            <div className="mt-3 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-400">
              <p>Your PAT does not have <strong>Code (Read)</strong> permission, which is required to list repositories.</p>
              {source.org && (
                <a
                  href={`https://dev.azure.com/${encodeURIComponent(source.org)}/_usersSettings/tokens`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-2 text-indigo-500 hover:text-indigo-400"
                >
                  <KeyRound className="w-3 h-3" />
                  Create a new PAT
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-400 dark:text-slate-500 text-center">
          Check that your PAT has the correct permissions.
        </p>
      )}
    </div>
  )
}

const SORT_OPTIONS = [
  { value: 'name', label: 'Name (A-Z)' },
  { value: 'size', label: 'Size (largest)' },
  { value: 'updated', label: 'Last Updated' },
]

/**
 * RepoSelectStep - Select Azure DevOps repositories for migration.
 *
 * Props:
 *   repos      - array of repo objects (from wizard state)
 *   onSetRepos - (repos) => void  (calls wizard.setRepos)
 *   source     - { org, project, pat }
 */
export default function RepoSelectStep({ repos, onSetRepos, source, onChange }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const [fetched, setFetched] = useState(false)

  // Fetch repos on mount
  useEffect(() => {
    if (fetched || !source.org || !source.project) return

    const fetchRepos = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetch('/api/azure/repos', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            org: source.org,
            project: source.project,
            pat: source.pat || undefined,
          }),
        })
        const data = await res.json()
        if (res.ok && data.repos) {
          // TFVC detection: no Git repos but project uses TFVC
          if (data.repos.length === 0 && data.versionControlType === 'Tfvc') {
            if (onChange) onChange({ versionControlType: 'Tfvc' })
            // Fetch TFVC items
            try {
              const tfvcRes = await fetch('/api/azure/tfvc/items', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ org: source.org, project: source.project, pat: source.pat || undefined }),
              })
              const tfvcData = await tfvcRes.json()
              const items = (tfvcData.items || []).filter(i => i.isFolder)
              const mapped = items.map(item => ({
                name: item.path.split('/').pop(),
                selected: false,
                targetName: item.path.split('/').pop(),
                visibility: 'private',
                description: '',
                size: item.size || 0,
                language: null,
                branches: 0,
                isDisabled: false,
                isFork: false,
                id: item.path,
                tfvcPath: item.path,
                isTfvc: true,
              }))
              onSetRepos(mapped)
              setFetched(true)
            } catch {
              setError('Failed to load TFVC items')
            }
            setLoading(false)
            return
          }

          if (onChange) onChange({ versionControlType: null })
          const mapped = data.repos.map((r) => ({
            name: r.name,
            selected: false,
            targetName: r.name,
            visibility: 'private',
            description: '',
            size: r.size || 0,
            language: r.language || null,
            branches: r.defaultBranch ? 1 : 0,
            isDisabled: r.isDisabled || false,
            isFork: r.isFork || false,
            id: r.id,
          }))
          onSetRepos(mapped)
          setFetched(true)
        } else {
          setError(data.error || 'Failed to load repositories')
        }
      } catch {
        setError('Could not reach server. Check your connection.')
      } finally {
        setLoading(false)
      }
    }

    fetchRepos()
  }, [source.org, source.project, source.pat, onSetRepos, onChange, fetched])

  // Filter by search
  const filteredRepos = useMemo(() => {
    let result = repos
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter((r) => r.name.toLowerCase().includes(q))
    }
    return result
  }, [repos, searchQuery])

  // Sort
  const sortedRepos = useMemo(() => {
    const sorted = [...filteredRepos]
    switch (sortBy) {
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'size':
        sorted.sort((a, b) => b.size - a.size)
        break
      case 'updated':
        // Fallback to name if no updated field
        sorted.sort((a, b) => a.name.localeCompare(b.name))
        break
      default:
        break
    }
    return sorted
  }, [filteredRepos, sortBy])

  const selectedCount = repos.filter((r) => r.selected).length

  const toggleRepo = useCallback(
    (repoName) => {
      const updated = repos.map((r) =>
        r.name === repoName ? { ...r, selected: !r.selected } : r
      )
      onSetRepos(updated)
    },
    [repos, onSetRepos]
  )

  const selectAll = useCallback(() => {
    const updated = repos.map((r) => (r.isDisabled ? r : { ...r, selected: true }))
    onSetRepos(updated)
  }, [repos, onSetRepos])

  const deselectAll = useCallback(() => {
    const updated = repos.map((r) => ({ ...r, selected: false }))
    onSetRepos(updated)
  }, [repos, onSetRepos])

  const invertSelection = useCallback(() => {
    const updated = repos.map((r) =>
      r.isDisabled ? r : { ...r, selected: !r.selected }
    )
    onSetRepos(updated)
  }, [repos, onSetRepos])

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Loading repositories from {source.org}/{source.project}...
        </p>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <div className="p-3 rounded-full bg-red-100 dark:bg-red-900/30">
          <AlertCircle className="w-6 h-6 text-red-500" />
        </div>
        <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
        <button
          type="button"
          onClick={() => {
            setFetched(false)
            setError('')
          }}
          className="text-sm text-indigo-500 hover:text-indigo-400 underline transition-colors"
        >
          Try again
        </button>
      </div>
    )
  }

  const isTfvc = source.versionControlType === 'Tfvc' || repos.some(r => r.isTfvc)

  // Empty state with PAT diagnostics
  if (!loading && repos.length === 0) {
    return <EmptyRepoState isTfvc={isTfvc} source={source} />
  }

  return (
    <div className="space-y-4">
      {/* TFVC info banner */}
      {isTfvc && (
        <div className="p-3 bg-amber-900/20 border border-amber-700/30 rounded-xl">
          <p className="text-xs text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5" />
            This project uses TFVC. Each folder will be converted to a Git repository and pushed to GitHub.
          </p>
        </div>
      )}

      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {isTfvc ? 'Select TFVC Folders' : 'Select Repositories'}
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Choose which {isTfvc ? 'folders' : 'repositories'} to migrate from{' '}
          <span className="font-medium text-slate-700 dark:text-slate-300">
            {source.org}/{source.project}
          </span>
        </p>
      </div>

      {/* Search + Sort row */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search repositories..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
          />
        </div>
        <div className="relative">
          <ArrowUpDown className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="appearance-none pl-8 pr-8 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 transition-colors"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Toolbar: Select All / Deselect All / Invert */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={selectAll}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-indigo-500 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors"
        >
          <CheckSquare className="w-3.5 h-3.5" />
          Select All
        </button>
        <button
          type="button"
          onClick={deselectAll}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-indigo-500 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors"
        >
          <Square className="w-3.5 h-3.5" />
          Deselect All
        </button>
        <button
          type="button"
          onClick={invertSelection}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-indigo-500 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors"
        >
          <ToggleLeft className="w-3.5 h-3.5" />
          Invert
        </button>

        {/* Selection count */}
        <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
          <span className={selectedCount > 0 ? 'text-indigo-500 dark:text-indigo-400 font-medium' : ''}>
            {selectedCount} selected
          </span>{' '}
          of {repos.length}
        </span>
      </div>

      {/* Repo list */}
      <div className="space-y-1.5 max-h-80 overflow-y-auto pr-0.5">
        <AnimatePresence initial={false}>
          {sortedRepos.map((repo) => {
            const isSelected = repo.selected
            return (
              <motion.button
                key={repo.id || repo.name}
                type="button"
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15 }}
                disabled={repo.isDisabled}
                onClick={() => !repo.isDisabled && toggleRepo(repo.name)}
                className={`w-full text-left p-3 rounded-xl border transition-all text-sm
                  ${repo.isDisabled
                    ? 'opacity-40 cursor-not-allowed border-slate-200 dark:border-slate-700'
                    : isSelected
                      ? 'border-indigo-500/60 bg-indigo-950/30 shadow-sm shadow-indigo-500/10'
                      : 'border-slate-200 dark:border-slate-700 hover:border-indigo-400/50 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
              >
                <div className="flex items-center gap-3">
                  {/* Checkbox */}
                  <div
                    className={`w-[18px] h-[18px] rounded flex items-center justify-center shrink-0 border-2 transition-colors
                      ${isSelected
                        ? 'bg-indigo-500 border-indigo-500'
                        : 'border-slate-400 dark:border-slate-600'
                      }`}
                  >
                    {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                  </div>

                  {/* Repo info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {repo.name}
                      </span>
                      {repo.isDisabled && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-500 font-semibold uppercase tracking-wide">
                          Disabled
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Badges */}
                  <div className="flex items-center gap-2 shrink-0">
                    {repo.language && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 font-medium">
                        <Code2 className="w-3 h-3" />
                        {repo.language}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-400 font-medium">
                      <HardDrive className="w-3 h-3" />
                      {formatSize(repo.size)}
                    </span>
                    {repo.branches > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400 font-medium">
                        <GitBranch className="w-3 h-3" />
                        {repo.branches}
                      </span>
                    )}
                  </div>
                </div>
              </motion.button>
            )
          })}
        </AnimatePresence>

        {/* No results from search */}
        {sortedRepos.length === 0 && searchQuery && (
          <div className="text-center py-6 text-sm text-slate-400 dark:text-slate-500">
            No repositories match "{searchQuery}"
          </div>
        )}
      </div>
    </div>
  )
}
