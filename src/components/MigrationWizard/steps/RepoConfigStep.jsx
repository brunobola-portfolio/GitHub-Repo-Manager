import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Lock, Unlock, Loader2, CheckCircle2, XCircle,
  AlertTriangle, RefreshCw, SkipForward, Edit3,
  GitBranch, HardDrive, ChevronDown, ChevronUp,
  Package, MoreHorizontal, Building2, ArrowRight,
  Globe, Sparkles,
} from 'lucide-react'
import { Spinner } from '../../ui/Spinner'
import { EmptyState } from '../../ui/EmptyState'
import { getCsrfToken } from '../../../utils/api'
import { azureCredPayload } from '../../../utils/azureRequestPayload'
import { Select } from '../../ui/Select'
import { Input, Textarea, Switch } from '../../ui/form'
import { formatFileSize } from '../../../utils/format'
import { RiskBadge } from '../ui/repo/RiskBadge'
import { REPO_DESCRIPTION_MAX } from '../../../utils/migrationDescription'
import { useRepoDescriptionSuggestion } from '../../../hooks/useRepoDescriptionSuggestion'
import TargetModePicker from './RepoConfigStep/TargetModePicker'

// Wrapper kept to preserve "0 B" empty-state copy and the "0 decimals for B"
// rendering the wizard expects.
function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B'
  return formatFileSize(bytes, bytes < 1024 ? 0 : 1).replace('Bytes', 'B')
}

/**
 * RepoConfigStep - Configure target settings for selected repos.
 * Premium dashboard + card-rows layout.
 *
 * Props:
 *   repos               - array of selected repos (already filtered to selected only)
 *   onUpdateRepo        - (index, updates) => void
 *   source              - { org, project, pat, targetOrg, credentialMode }
 *   orgs                - array of GitHub orgs from useOrgs
 *   onChangeDestination - (orgLogin) => void
 */
export default function RepoConfigStep({ repos, onUpdateRepo, source, orgs = [], onChangeDestination, onChangeSource, onGoToStep }) {
  const [conflicts, setConflicts] = useState({})
  const debounceTimers = useRef({})
  const [expandedBranches, setExpandedBranches] = useState({})
  const [branchCache, setBranchCache] = useState({})
  const [loadingBranches, setLoadingBranches] = useState({})
  const [expandedCards, setExpandedCards] = useState({})
  const [aiAvailable, setAiAvailable] = useState(false)
  const [quotaNotice, setQuotaNotice] = useState('')
  const [generatingId, setGeneratingId] = useState(null)
  const { suggest } = useRepoDescriptionSuggestion({ aiAvailable })

  useEffect(() => {
    let cancelled = false
    fetch('/api/config/ai-status', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { configured: false }))
      .then((d) => { if (!cancelled) setAiAvailable(!!d?.configured) })
      .catch(() => { if (!cancelled) setAiAvailable(false) })
    return () => { cancelled = true }
  }, [])

  const handleGenerateDescription = useCallback(async (repo, index) => {
    const key = repo.id ?? index
    setGeneratingId(key)
    try {
      const { description, quotaExceeded } = await suggest({ repo, source })
      onUpdateRepo(index, { description })
      if (quotaExceeded) {
        setQuotaNotice('AI quota reached for this hour — used a template instead.')
        setTimeout(() => setQuotaNotice(''), 4000)
      }
    } finally {
      setGeneratingId(null)
    }
  }, [suggest, source, onUpdateRepo])

  const toggleBranchExpand = useCallback(async (repo, _index) => {
    const key = repo.id || repo.name
    const isExpanded = expandedBranches[key]

    setExpandedBranches((prev) => ({ ...prev, [key]: !isExpanded }))

    if (!isExpanded && !branchCache[key]) {
      setLoadingBranches((prev) => ({ ...prev, [key]: true }))
      try {
        const csrfToken = await getCsrfToken().catch(() => null)
        const res = await fetch('/api/azure/branches', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
          },
          body: JSON.stringify({
            org: source.org,
            project: source.project,
            repoId: repo.id,
            ...azureCredPayload(source),
          }),
        })
        const data = await res.json()
        if (res.ok && data.branches) {
          setBranchCache((prev) => ({ ...prev, [key]: data.branches }))
        }
      } catch { /* ignore */ }
      setLoadingBranches((prev) => ({ ...prev, [key]: false }))
    }
  }, [expandedBranches, branchCache, source])

  const checkConflict = useCallback(
    (repoName, targetName) => {
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
          const csrfToken = await getCsrfToken().catch(() => null)
          const res = await fetch('/api/import/check-duplicates', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
            },
            body: JSON.stringify({
              repos: [targetName],
              targetOwner: source.targetOrg || source.org,
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
    [source.targetOrg, source.org]
  )

  useEffect(() => {
    const timers = debounceTimers.current
    return () => {
      Object.values(timers).forEach(clearTimeout)
    }
  }, [])

  // Seed conflict state from cached repo.risk flags (set by Select step).
  // Only run a live check when user edits a targetName (existing debounced logic in handleTargetNameChange).
  useEffect(() => {
    const seeded = {}
    repos.forEach((repo) => {
      if (repo.risk?.flags?.some((f) => f.type === 'name-conflict')) seeded[repo.name] = 'conflict'
      else if (repo.targetName?.trim()) seeded[repo.name] = 'clear'
    })
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConflicts(seeded)
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

  const handleReplace = (repo, index) => {
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

  const makeAllPrivate = () => {
    repos.forEach((_, i) => onUpdateRepo(i, { visibility: 'private' }))
  }

  const makeAllPublic = () => {
    repos.forEach((_, i) => onUpdateRepo(i, { visibility: 'public' }))
  }

  const handleDestinationChange = useCallback((orgLogin) => {
    onChangeDestination?.(orgLogin)
    setConflicts({})
  }, [onChangeDestination])

  // Re-run conflict checks when destination org changes
  const prevTargetOrg = useRef(source.targetOrg)
  useEffect(() => {
    if (source.targetOrg && source.targetOrg !== prevTargetOrg.current) {
      repos.forEach((repo) => {
        if (repo.targetName?.trim()) {
          checkConflict(repo.name, repo.targetName)
        }
      })
    }
    prevTargetOrg.current = source.targetOrg
  }, [source.targetOrg, repos, checkConflict])

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

  // ── Empty state ──────────────────────────────────────────────────
  if (repos.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="No repositories selected"
        description="Go back and select repositories to configure."
        action={{ label: 'Back to Selection', onClick: () => window.history.back() }}
      />
    )
  }

  // ── Main layout ──────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {source?.sourceType === 'azure' && source?.validated === false && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="font-medium">Credenciais Azure por validar</p>
            <p className="text-xs opacity-90 mt-0.5">
              O PAT da Azure ainda não foi confirmado. A migração vai falhar no passo final se não ligares primeiro.
            </p>
          </div>
          {onGoToStep && (
            <button
              type="button"
              onClick={() => onGoToStep('azureConnect')}
              className="shrink-0 rounded-md border border-amber-400 bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-200 dark:border-amber-600 dark:bg-amber-900/40 dark:text-amber-100 dark:hover:bg-amber-900/60"
            >
              Ir para Connect
            </button>
          )}
        </div>
      )}
      {/* ── Target mode picker (only shown when source is Azure + TFVC) ── */}
      {onChangeSource && (
        <TargetModePicker source={source} selectedRepos={repos} onChange={onChangeSource} />
      )}

      {/* ── Dashboard Header ────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="bg-violet-500/10 border border-violet-500/20 rounded-2xl p-5"
      >
        {/* Row 1: Destination + Bulk Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-4">
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
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {source.targetOrg || source.org || 'Personal Account'}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 sm:shrink-0 flex-wrap">
            <button
              type="button"
              onClick={makeAllPrivate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
                bg-violet-500/15 text-violet-400 dark:text-violet-300 border border-violet-500/20
                hover:bg-violet-500/25 transition-colors"
            >
              <Lock className="w-3.5 h-3.5" />
              All Private
            </button>
            <button
              type="button"
              onClick={makeAllPublic}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
                bg-cyan-500/15 text-cyan-400 dark:text-cyan-300 border border-cyan-500/20
                hover:bg-cyan-500/25 transition-colors"
            >
              <Globe className="w-3.5 h-3.5" />
              All Public
            </button>
          </div>
        </div>

        {/* Row 2: Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white/60 dark:bg-slate-900/50 rounded-xl px-4 py-3 text-center">
            <div className="text-xl font-bold text-violet-400">{stats.count}</div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 mt-0.5">Repositories</div>
          </div>
          <div className="bg-white/60 dark:bg-slate-900/50 rounded-xl px-4 py-3 text-center">
            <div className="text-xl font-bold text-cyan-400">{formatSize(stats.totalSize)}</div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 mt-0.5">Total Size</div>
          </div>
          <div className="bg-white/60 dark:bg-slate-900/50 rounded-xl px-4 py-3 text-center">
            <div className="text-xl font-bold text-emerald-400">{stats.privateCount}</div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 mt-0.5">Private</div>
          </div>
          <div className="bg-white/60 dark:bg-slate-900/50 rounded-xl px-4 py-3 text-center">
            <div className="text-xl font-bold text-orange-400">{stats.publicCount}</div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 mt-0.5">Public</div>
          </div>
        </div>
      </motion.div>

      {/* ── LFS Warning Banner ──────────────────────────────────── */}
      {hasLfsEnabled && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm">
          <HardDrive className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-amber-400 dark:text-amber-300 text-xs">
            LFS repositories detected — migration may take longer for large files
          </span>
        </div>
      )}

      {/* ── Repo Card-Rows ──────────────────────────────────────── */}
      <div className="space-y-3 max-h-[calc(100vh-420px)] overflow-y-auto pr-1 ds-scrollbar">
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
                className={`relative bg-slate-50 dark:bg-slate-800 border rounded-xl overflow-hidden transition-colors
                  ${conflictStatus === 'conflict'
                    ? 'border-red-500/30'
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
              >
                {/* Gradient left border accent */}
                <div className="absolute top-0 left-0 bottom-0 w-[3px] rounded-l-xl bg-violet-500" />

                {/* ── Main row ──────────────────────────────────── */}
                <div className="flex items-center gap-3 pl-4 pr-3 py-3">
                  {/* Repo icon */}
                  <div className="w-8 h-8 rounded-lg bg-violet-500/15 flex items-center justify-center shrink-0">
                    <Package className="w-4 h-4 text-violet-400" />
                  </div>

                  {/* Source → Target */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate" title={repo.name}>
                        {repo.name}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                      <div className="flex-1 max-w-[200px]">
                        <Input
                          type="text"
                          size="sm"
                          value={repo.targetName || ''}
                          onChange={(e) => handleTargetNameChange(repo, index, e.target.value)}
                          aria-label={`Target repository name for ${repo.name}`}
                          status={conflictStatus === 'conflict' ? 'error' : 'idle'}
                          trailing={
                            <>
                              {conflictStatus === 'checking' && (
                                <Spinner size="xs" tone="warning" />
                              )}
                              {conflictStatus === 'clear' && (
                                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                              )}
                              {conflictStatus === 'conflict' && (
                                <XCircle className="w-3 h-3 text-red-500" />
                              )}
                            </>
                          }
                        />
                      </div>
                    </div>
                    {/* Metadata badges */}
                    <div className="flex items-center gap-1.5 mt-1.5">
                      {repo.language && (
                        <span className="text-[10px] bg-slate-200 dark:bg-slate-900 text-slate-600 dark:text-slate-500 px-1.5 py-0.5 rounded">
                          {repo.language}
                        </span>
                      )}
                      <span className="text-[10px] bg-slate-200 dark:bg-slate-900 text-slate-600 dark:text-slate-500 px-1.5 py-0.5 rounded">
                        {formatSize(repo.size)}
                      </span>
                      {repo.isTfvc ? (
                        <span className="text-[10px] bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded">
                          TFVC
                        </span>
                      ) : (
                        repo.branches > 0 && (
                          <span className="text-[10px] bg-slate-200 dark:bg-slate-900 text-slate-600 dark:text-slate-500 px-1.5 py-0.5 rounded">
                            {repo.branches} {repo.branches === 1 ? 'branch' : 'branches'}
                          </span>
                        )
                      )}
                    </div>
                  </div>

                  {/* Right: visibility + status + expand */}
                  <div className="flex items-center gap-2 shrink-0">
                    <RiskBadge level={repo.risk?.level || 'ok'} flags={repo.risk?.flags || []} />
                    <button
                      type="button"
                      onClick={() => handleVisibilityToggle(index, repo.visibility)}
                      aria-label={`Toggle visibility: currently ${repo.visibility}`}
                      aria-pressed={isPrivate}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors
                        ${isPrivate
                          ? 'bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-500/20'
                          : 'bg-cyan-100 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-500/20'
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
                        'bg-slate-300 dark:bg-slate-600'
                      }`} />
                      <span className={`text-[11px] ${
                        conflictStatus === 'clear' ? 'text-emerald-600 dark:text-emerald-400' :
                        conflictStatus === 'checking' ? 'text-amber-600 dark:text-amber-400' :
                        conflictStatus === 'conflict' ? 'text-red-600 dark:text-red-400' :
                        'text-slate-400 dark:text-slate-500'
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
                      aria-expanded={isExpanded || conflictStatus === 'conflict'}
                      aria-label="Toggle advanced options"
                      className="p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* ── Expanded section ──────────────────────────── */}
                <AnimatePresence>
                  {(isExpanded || conflictStatus === 'conflict') && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="border-t border-slate-200 dark:border-slate-700/50"
                    >
                      <div className="px-4 py-3 pl-8 space-y-3">
                        {/* Conflict resolution */}
                        {conflictStatus === 'conflict' && (
                          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
                            <AlertTriangle className="w-3.5 h-3.5 text-red-500 dark:text-red-400 shrink-0" />
                            <span className="text-xs text-red-700 dark:text-red-300 mr-auto">
                              A repository with this name already exists
                            </span>
                            <button
                              type="button"
                              onClick={() => handleReplace(repo, index)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md
                                bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-500/25 transition-colors"
                            >
                              <RefreshCw className="w-3 h-3" />
                              Replace
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRename(repo, index)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md
                                bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-500/25 transition-colors"
                            >
                              <Edit3 className="w-3 h-3" />
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSkip(repo, index)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md
                                bg-slate-100 dark:bg-slate-700/50 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600/50 transition-colors"
                            >
                              <SkipForward className="w-3 h-3" />
                              Skip
                            </button>
                          </div>
                        )}

                        {/* Description */}
                        <DescriptionField
                          repo={repo}
                          index={index}
                          aiAvailable={aiAvailable}
                          isGenerating={generatingId === (repo.id ?? index)}
                          onChange={(value) => handleDescriptionChange(index, value)}
                          onGenerate={() => handleGenerateDescription(repo, index)}
                        />

                        {/* LFS + Branch row */}
                        <div className="flex items-center gap-4">
                          <div className="inline-flex items-center gap-2">
                            <Switch
                              checked={!!repo.lfsEnabled}
                              onChange={(next) => onUpdateRepo(index, { lfsEnabled: next })}
                              label="LFS"
                              size="sm"
                            />
                            <span className="text-xs text-slate-600 dark:text-slate-400">
                              <HardDrive className="w-3 h-3 inline mr-1" />
                              LFS
                            </span>
                          </div>

                          {!repo.isTfvc && (
                            <button
                              type="button"
                              onClick={() => toggleBranchExpand(repo, index)}
                              className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400
                                hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
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
                          <div className="p-3 rounded-lg bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 space-y-2">
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
                              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Mirror all branches</span>
                            </label>

                            {repo.branchFilter === 'selected' && (
                              <div className="space-y-1 max-h-32 overflow-y-auto">
                                {loadingBranches[branchKey] ? (
                                  <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
                                    <Spinner size="xs" />
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
                                        className="rounded border-slate-300 dark:border-slate-600 text-indigo-500 focus:ring-indigo-500"
                                      />
                                      <span className="text-xs text-slate-600 dark:text-slate-400">{branch.name}</span>
                                    </label>
                                  ))
                                ) : (
                                  <p className="text-xs text-slate-500 dark:text-slate-400 py-1">No branches found</p>
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
      <AnimatePresence>
        {quotaNotice && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            role="status"
            className="fixed bottom-6 right-6 z-[var(--ds-z-popover)] px-4 py-2.5 rounded-xl shadow-xl border border-amber-300/60
              bg-amber-50/95 dark:bg-amber-900/40 dark:border-amber-500/30 text-sm text-amber-900 dark:text-amber-100 backdrop-blur"
          >
            {quotaNotice}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function DescriptionField({ repo, index, aiAvailable, isGenerating, onChange, onGenerate }) {
  const value = repo.description || ''
  const length = value.length
  const over = length > REPO_DESCRIPTION_MAX
  const near = !over && length > REPO_DESCRIPTION_MAX - 30

  const counterTone = over
    ? 'text-red-600 dark:text-red-400'
    : near
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-slate-400 dark:text-slate-500'

  const buttonLabel = isGenerating
    ? 'Generating…'
    : aiAvailable ? 'Generate with AI' : 'Suggest'

  const handleChange = (e) => {
    const next = e.target.value.slice(0, REPO_DESCRIPTION_MAX)
    onChange(next)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label
          htmlFor={`repo-desc-${index}`}
          className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400"
        >
          Description
        </label>
        <button
          type="button"
          onClick={onGenerate}
          disabled={isGenerating}
          title={aiAvailable
            ? 'Generate a professional description with AI'
            : 'Template-based — enable Gemini in Settings for AI-generated descriptions'}
          className={`group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium
            transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed
            ${aiAvailable
              ? 'text-white bg-indigo-600 dark:bg-indigo-500 hover:bg-indigo-700 dark:hover:bg-indigo-600 shadow-sm hover:shadow-md'
              : 'text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700/60 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-600/60'
            }`}
        >
          {isGenerating
            ? <Spinner size="xs" />
            : <Sparkles className={`w-3 h-3 ${aiAvailable ? '' : 'text-slate-400 dark:text-slate-500'}`} />
          }
          <span>{buttonLabel}</span>
        </button>
      </div>
      <div className="relative">
        <Textarea
          id={`repo-desc-${index}`}
          rows={2}
          value={value}
          onChange={handleChange}
          maxLength={REPO_DESCRIPTION_MAX}
          placeholder="Optional description..."
          status={over ? 'error' : 'idle'}
        />
        <span className={`pointer-events-none absolute bottom-1.5 right-2 text-[10px] font-mono tabular-nums ${counterTone}`}>
          {length}/{REPO_DESCRIPTION_MAX}
        </span>
      </div>
    </div>
  )
}
