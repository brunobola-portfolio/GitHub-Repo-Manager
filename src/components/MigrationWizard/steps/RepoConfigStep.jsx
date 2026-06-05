import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Lock, Unlock, CheckCircle2, XCircle,
  AlertTriangle, RefreshCw, SkipForward, Edit3,
  GitBranch, HardDrive, ChevronDown, ChevronUp,
  Package, MoreHorizontal, Building2, ArrowRight,
  Globe, Sparkles, Server, Plus, Recycle,
} from 'lucide-react'
import { Spinner } from '../../ui/Spinner'
import { EmptyState } from '../../ui/EmptyState'
import { useBranchCache } from '../hooks/useBranchCache'
import { useAzureProjectData } from '../hooks/useAzureProjectData'
import { useRepoNameConflicts } from '../hooks/useRepoNameConflicts'
import { useAiAvailability } from '../hooks/useAiAvailability'
import { Select } from '../../ui/Select'
import { Input, Switch } from '../../ui/form'
import { RiskBadge } from '../ui/repo/RiskBadge'
import { useRepoDescriptionSuggestion } from '../../../hooks/useRepoDescriptionSuggestion'
import TargetModePicker from './RepoConfigStep/TargetModePicker'
import { DescriptionField } from './RepoConfigStep/DescriptionField'
import { RepoMetadataBadges } from './RepoConfigStep/RepoMetadataBadges'
import { formatSize } from './RepoConfigStep/formatSize'

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
  const { expandedBranches, branchCache, loadingBranches, toggleBranchExpand } = useBranchCache(source)
  const [expandedCards, setExpandedCards] = useState({})
  const [quotaNotice, setQuotaNotice] = useState('')
  const [generatingId, setGeneratingId] = useState(null)
  const { aiAvailable, aiNotice, setAiNotice } = useAiAvailability()
  const { suggest } = useRepoDescriptionSuggestion({ aiAvailable })

  const isAzureDevops = source?.azureTargetMode === 'azure-devops'
  const targetProject = source?.targetProject || source?.project || ''

  const { azureProjectRepoNames, azureEmptyRepos, azureProjects, projectsLoading } =
    useAzureProjectData({ isAzureDevops, source, targetProject })

  const { conflicts, setConflicts, checkConflict } =
    useRepoNameConflicts({ source, isAzureDevops, azureProjectRepoNames, repos })

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

  const handleTargetNameChange = (repo, index, value) => {
    onUpdateRepo(index, { targetName: value })
    checkConflict(repo.name, value)
  }

  const handleTargetTypeChange = (repo, index, nextType) => {
    if (nextType === 'existing-empty') {
      // Switching to "existing empty" — clear targetName + existingRepoId,
      // user must pick one from the dropdown. Conflict status becomes idle
      // until they choose.
      onUpdateRepo(index, { targetType: 'existing-empty', existingRepoId: undefined, targetName: '' })
      setConflicts((prev) => ({ ...prev, [repo.name]: 'idle' }))
    } else {
      // Back to "new" — restore the default targetName (the source name) and
      // re-run conflict check.
      const restored = repo.name
      onUpdateRepo(index, { targetType: 'new', existingRepoId: undefined, targetName: restored })
      checkConflict(repo.name, restored)
    }
  }

  const handleExistingRepoPick = (repo, index, existingRepoId) => {
    const picked = azureEmptyRepos.find((r) => r.id === existingRepoId)
    if (!picked) return
    onUpdateRepo(index, {
      targetType: 'existing-empty',
      existingRepoId: picked.id,
      targetName: picked.name,
    })
    setConflicts((prev) => ({ ...prev, [repo.name]: 'clear' }))
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
  }, [onChangeDestination, setConflicts])

  const handleTargetProjectChange = useCallback((projectName) => {
    onChangeSource?.({ targetProject: projectName })
    setConflicts({})
    // Reset per-repo "use existing empty" choices because the available empty
    // repos differ between projects. Each repo falls back to "create new".
    repos.forEach((_, i) => {
      onUpdateRepo(i, { targetType: 'new', existingRepoId: undefined })
    })
  }, [onChangeSource, repos, onUpdateRepo, setConflicts])

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
    tfvcCount: repos.filter((r) => r.isTfvc).length,
    existingInProject: azureProjectRepoNames?.size ?? null,
  }), [repos, azureProjectRepoNames])

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
            <p className="font-medium">Azure credentials not validated</p>
            <p className="text-xs opacity-90 mt-0.5">
              The Azure PAT hasn't been confirmed yet. The migration will fail at the final step if you don't connect first.
            </p>
          </div>
          {onGoToStep && (
            <button
              type="button"
              onClick={() => onGoToStep('azureConnect')}
              className="shrink-0 rounded-md border border-amber-400 bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-200 dark:border-amber-600 dark:bg-amber-900/40 dark:text-amber-100 dark:hover:bg-amber-900/60"
            >
              Go to Connect
            </button>
          )}
        </div>
      )}
      {/* ── Target mode picker (only shown when source is Azure + TFVC) ── */}
      {onChangeSource && (
        <TargetModePicker source={source} selectedRepos={repos} onChange={onChangeSource} />
      )}

      {/* ── AI unavailable banner (shown once after a fatal AI failure) ── */}
      <AnimatePresence>
        {aiNotice && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            role="status"
            className="flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50/80 px-3.5 py-2.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-900/20 dark:text-amber-100"
          >
            <Sparkles className="w-4 h-4 mt-0.5 shrink-0 text-amber-500 dark:text-amber-400" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="font-medium leading-tight">{aiNotice}</p>
              <p className="ds-text-meta opacity-80 mt-0.5">Descriptions and suggestions remain available via a deterministic template.</p>
            </div>
            <button
              type="button"
              onClick={() => setAiNotice('')}
              aria-label="Dispensar"
              className="shrink-0 rounded-md p-1 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40"
            >
              <XCircle className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Dashboard Header ────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="bg-violet-500/10 border border-violet-500/20 rounded-2xl p-5"
      >
        {/* Row 1: Destination + Bulk Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-violet-500/10 ring-1 ring-violet-500/30 flex items-center justify-center shrink-0">
              {isAzureDevops
                ? <Server className="w-5 h-5 text-violet-400" />
                : <Building2 className="w-5 h-5 text-violet-400" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="ds-text-micro font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  {isAzureDevops ? 'Target project' : 'Importing to'}
                </span>
                {isAzureDevops && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-violet-500/15 border border-violet-500/30 text-[9px] font-bold uppercase tracking-wider text-violet-300">
                    in-place
                  </span>
                )}
              </div>
              {isAzureDevops ? (
                <div className="mt-1 flex items-center gap-2 flex-wrap min-w-0">
                  <div className="inline-flex items-center px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800/80 ring-1 ring-slate-200 dark:ring-slate-700 text-sm font-mono font-semibold text-slate-700 dark:text-slate-200 shadow-sm">
                    {source.org}
                  </div>
                  <span className="text-slate-400 dark:text-slate-500 font-mono select-none">/</span>
                  {azureProjects.length > 0 ? (
                    <Select
                      options={azureProjects.map((p) => ({ value: p.name, label: p.name }))}
                      value={targetProject}
                      onChange={handleTargetProjectChange}
                      placeholder={projectsLoading ? 'Loading projects…' : 'Choose a project…'}
                      size="md"
                      label="Destination project"
                      className="min-w-[220px]"
                    />
                  ) : (
                    <div className="inline-flex items-center px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800/80 ring-1 ring-slate-200 dark:ring-slate-700 text-sm font-mono font-semibold text-slate-700 dark:text-slate-200 shadow-sm">
                      {targetProject}
                    </div>
                  )}
                  {azureProjects.length > 0 && (
                    <span className="hidden md:inline ds-text-meta text-slate-400 dark:text-slate-500 font-medium tabular-nums">
                      {azureProjects.length} {azureProjects.length === 1 ? 'project' : 'projects'}
                    </span>
                  )}
                </div>
              ) : orgOptions.length > 0 ? (
                <div className="mt-1 flex items-center gap-2 flex-wrap min-w-0">
                  <Select
                    options={orgOptions}
                    value={source.targetOrg || orgs[0]?.login || ''}
                    onChange={handleDestinationChange}
                    placeholder="Select organization..."
                    size="md"
                    label="Destination organization"
                    className="min-w-[220px]"
                  />
                  <span className="hidden md:inline ds-text-meta text-slate-400 dark:text-slate-500 font-medium tabular-nums">
                    {orgOptions.length} {orgOptions.length === 1 ? 'account' : 'accounts'}
                  </span>
                </div>
              ) : (
                <div className="mt-1 inline-flex items-center px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800/80 ring-1 ring-slate-200 dark:ring-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-200 shadow-sm">
                  {source.targetOrg || source.org || 'Personal Account'}
                </div>
              )}
            </div>
          </div>

          {!isAzureDevops && (
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
          )}
        </div>

        {/* Row 2: Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white/60 dark:bg-slate-900/50 rounded-xl px-4 py-3 text-center">
            <div className="text-xl font-bold text-violet-400">{stats.count}</div>
            <div className="ds-text-micro font-medium uppercase tracking-wider text-slate-500 mt-0.5">Repositories</div>
          </div>
          <div className="bg-white/60 dark:bg-slate-900/50 rounded-xl px-4 py-3 text-center">
            <div className="text-xl font-bold text-cyan-400">{formatSize(stats.totalSize)}</div>
            <div className="ds-text-micro font-medium uppercase tracking-wider text-slate-500 mt-0.5">Total Size</div>
          </div>
          {isAzureDevops ? (
            <>
              <div className="bg-white/60 dark:bg-slate-900/50 rounded-xl px-4 py-3 text-center">
                <div className="text-xl font-bold text-amber-400">{stats.tfvcCount}</div>
                <div className="ds-text-micro font-medium uppercase tracking-wider text-slate-500 mt-0.5">TFVC paths</div>
              </div>
              <div className="bg-white/60 dark:bg-slate-900/50 rounded-xl px-4 py-3 text-center">
                <div className="text-xl font-bold text-slate-500 dark:text-slate-400">
                  {stats.existingInProject === null ? '—' : stats.existingInProject}
                </div>
                <div className="ds-text-micro font-medium uppercase tracking-wider text-slate-500 mt-0.5">Existing in project</div>
              </div>
            </>
          ) : (
            <>
              <div className="bg-white/60 dark:bg-slate-900/50 rounded-xl px-4 py-3 text-center">
                <div className="text-xl font-bold text-emerald-400">{stats.privateCount}</div>
                <div className="ds-text-micro font-medium uppercase tracking-wider text-slate-500 mt-0.5">Private</div>
              </div>
              <div className="bg-white/60 dark:bg-slate-900/50 rounded-xl px-4 py-3 text-center">
                <div className="text-xl font-bold text-orange-400">{stats.publicCount}</div>
                <div className="ds-text-micro font-medium uppercase tracking-wider text-slate-500 mt-0.5">Public</div>
              </div>
            </>
          )}
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
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate" title={repo.name}>
                        {repo.name}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                      {isAzureDevops && repo.isTfvc && (
                        <div
                          className="inline-flex rounded-lg overflow-hidden ring-1 ring-slate-200 dark:ring-slate-700 shadow-sm shrink-0"
                          role="group"
                          aria-label="Target type"
                        >
                          <button
                            type="button"
                            onClick={() => handleTargetTypeChange(repo, index, 'new')}
                            title="Create a new Git repo in this project"
                            className={`inline-flex items-center gap-1 px-2.5 py-1 ds-text-micro font-semibold uppercase tracking-wider transition-all
                              ${(repo.targetType || 'new') === 'new'
                                ? 'bg-gradient-to-br from-violet-500 to-violet-600 text-white shadow-inner'
                                : 'bg-white dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 hover:bg-violet-50 dark:hover:bg-violet-500/10 hover:text-violet-600 dark:hover:text-violet-300'}`}
                          >
                            <Plus className="w-3 h-3" />
                            New
                          </button>
                          <button
                            type="button"
                            onClick={() => handleTargetTypeChange(repo, index, 'existing-empty')}
                            disabled={azureEmptyRepos.length === 0}
                            title={azureEmptyRepos.length === 0
                              ? 'No empty Git repos in this project'
                              : `Reuse an existing empty repo (${azureEmptyRepos.length} available)`}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 ds-text-micro font-semibold uppercase tracking-wider transition-all border-l border-slate-200 dark:border-slate-700
                              ${repo.targetType === 'existing-empty'
                                ? 'bg-gradient-to-br from-violet-500 to-violet-600 text-white shadow-inner'
                                : 'bg-white dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 hover:bg-violet-50 dark:hover:bg-violet-500/10 hover:text-violet-600 dark:hover:text-violet-300 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white dark:disabled:hover:bg-slate-900/60 disabled:hover:text-slate-500 dark:disabled:hover:text-slate-400'}`}
                          >
                            <Recycle className="w-3 h-3" />
                            Existing
                            {azureEmptyRepos.length > 0 && repo.targetType !== 'existing-empty' && (
                              <span className="ml-0.5 px-1 rounded-sm bg-violet-500/15 text-violet-600 dark:text-violet-300 text-[9px] tabular-nums">
                                {azureEmptyRepos.length}
                              </span>
                            )}
                          </button>
                        </div>
                      )}
                      <div className="flex-1 max-w-[220px] min-w-[140px]">
                        {repo.targetType === 'existing-empty' ? (
                          <Select
                            size="sm"
                            options={azureEmptyRepos.map((r) => ({ value: r.id, label: r.name }))}
                            value={repo.existingRepoId || ''}
                            onChange={(v) => handleExistingRepoPick(repo, index, v)}
                            placeholder="Pick empty repo..."
                            label={`Existing empty repo for ${repo.name}`}
                          />
                        ) : (
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
                        )}
                      </div>
                    </div>
                    {/* Metadata badges */}
                    <RepoMetadataBadges
                      language={repo.language}
                      size={repo.size}
                      isTfvc={repo.isTfvc}
                      branches={repo.branches}
                    />
                  </div>

                  {/* Right: visibility + status + expand */}
                  <div className="flex items-center gap-2 shrink-0">
                    <RiskBadge level={repo.risk?.level || 'ok'} flags={repo.risk?.flags || []} />
                    {!isAzureDevops && (
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
                    )}

                    {/* Status dot + label */}
                    <div className="flex items-center gap-1.5 min-w-[70px]">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${
                        conflictStatus === 'clear' ? 'bg-emerald-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]' :
                        conflictStatus === 'checking' ? 'bg-amber-500 animate-pulse shadow-[0_0_6px_rgba(245,158,11,0.5)]' :
                        conflictStatus === 'conflict' ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]' :
                        'bg-slate-300 dark:bg-slate-600'
                      }`} />
                      <span className={`ds-text-meta ${
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
                              <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${expandedBranches[branchKey] ? 'rotate-180' : ''}`} />
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
