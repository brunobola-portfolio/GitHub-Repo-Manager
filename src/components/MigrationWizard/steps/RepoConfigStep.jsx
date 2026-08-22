import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle, HardDrive, Package, Sparkles, XCircle } from 'lucide-react'
import { EmptyState } from '../../ui/EmptyState'
import { useBranchCache } from '../hooks/useBranchCache'
import { useAzureProjectData } from '../hooks/useAzureProjectData'
import { useRepoNameConflicts } from '../hooks/useRepoNameConflicts'
import { useAiAvailability } from '../hooks/useAiAvailability'
import { useRepoDescriptionSuggestion } from '../../../hooks/useRepoDescriptionSuggestion'
import { getOrgRepoCount } from '../../../utils/orgRepoCount'
import TargetModePicker from './RepoConfigStep/TargetModePicker'
import { DashboardHeader } from './RepoConfigStep/DashboardHeader'
import { RepoCard } from './RepoConfigStep/RepoCard'
import { ReplaceConfirmModal } from './RepoConfigStep/ReplaceConfirmModal'

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
  const [replaceTarget, setReplaceTarget] = useState(null)
  // Per-row provenance of the last generated description ('ai' | 'template'),
  // so the card can show a transparent badge instead of leaving the user
  // wondering whether AI actually ran. Cleared when the user edits the text.
  const [descriptionModes, setDescriptionModes] = useState({})
  const { aiAvailable, aiNotice, setAiNotice } = useAiAvailability()
  const { suggest } = useRepoDescriptionSuggestion({ aiAvailable })

  const isAzureDevops = source?.azureTargetMode === 'azure-devops'
  const targetProject = source?.targetProject || source?.project || ''
  // Mirror the engine's destination owner: targetOrg, else the user's personal
  // account (empty → ScheduleStep/import target just the repo name). Never the
  // Azure source.org, which is not a GitHub owner.
  const targetOwner = source?.targetOrg || ''

  const { azureProjectRepoNames, azureEmptyRepos, azureProjects, projectsLoading } =
    useAzureProjectData({ isAzureDevops, source, targetProject })

  const { conflicts, setConflicts, checkConflict } =
    useRepoNameConflicts({ source, isAzureDevops, azureProjectRepoNames, repos })

  const handleGenerateDescription = useCallback(async (repo, index) => {
    const key = repo.id ?? index
    setGeneratingId(key)
    try {
      const { description, mode, quotaExceeded } = await suggest({ repo, source })
      onUpdateRepo(index, { description })
      setDescriptionModes((prev) => ({ ...prev, [index]: mode }))
      if (quotaExceeded) {
        setQuotaNotice('AI quota reached for this hour — used a template instead.')
        setTimeout(() => setQuotaNotice(''), 4000)
      }
    } finally {
      setGeneratingId(null)
    }
  }, [suggest, source, onUpdateRepo])

  const handleTargetNameChange = (repo, index, value) => {
    // Editing the name invalidates a prior confirmed Replace — the destructive
    // intent was confirmed for a specific name and must not silently carry over.
    onUpdateRepo(index, {
      targetName: value,
      ...(repo.conflictAction === 'replace' ? { conflictAction: undefined } : {}),
    })
    if (repo.conflictAction === 'replace') {
      setConflicts((prev) => ({ ...prev, [repo.name]: 'idle' }))
    }
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
    // A manual edit invalidates the "AI-generated / Template" provenance badge.
    setDescriptionModes((prev) => (prev[index] ? { ...prev, [index]: undefined } : prev))
  }

  const handleReplace = (repo, index) => {
    setReplaceTarget({ repo, index })
  }

  const confirmReplace = () => {
    if (!replaceTarget) return
    const { repo, index } = replaceTarget
    setConflicts((prev) => ({ ...prev, [repo.name]: 'will-replace' }))
    onUpdateRepo(index, { conflictAction: 'replace', hasConflict: false })
    setReplaceTarget(null)
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

  // Auto-enable LFS wherever markers were detected (.gitattributes), once per
  // repo. Keeps large-file pointers preserved by default — the same outcome the
  // AutoFix drawer produces — so the user never has to hunt for the toggle. We
  // only seed when the flag is still untouched (undefined); an explicit toggle
  // off sets it to `false` and is respected.
  const lfsSeededRef = useRef(new Set())
  useEffect(() => {
    repos.forEach((repo, index) => {
      const key = repo.id ?? repo.name ?? index
      if (repo.hasLfsMarker && repo.lfsEnabled === undefined && !lfsSeededRef.current.has(key)) {
        lfsSeededRef.current.add(key)
        onUpdateRepo(index, { lfsEnabled: true })
      }
    })
  }, [repos, onUpdateRepo])

  // Mirror live conflict detection onto repo state so the wizard shell can
  // block "Next" while any selected repo has an unresolved conflict. Guarded
  // so it only writes on a real change (no render loop).
  useEffect(() => {
    repos.forEach((repo, index) => {
      const isConflict = conflicts[repo.name] === 'conflict'
      if (!!repo.hasConflict !== isConflict) {
        onUpdateRepo(index, { hasConflict: isConflict })
      }
    })
  }, [conflicts, repos, onUpdateRepo])

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
      badge: org.isPersonal ? 'Personal' : `${getOrgRepoCount(org)} repos`,
    })),
    [orgs]
  )

  const toggleCardExpand = (repoName) => {
    setExpandedCards((prev) => ({ ...prev, [repoName]: !prev[repoName] }))
  }

  // Bundled per-card callbacks passed to <RepoCard> as a single prop to keep
  // its surface small. The functions close over this component's hooks/state.
  const cardHandlers = {
    onTargetTypeChange: handleTargetTypeChange,
    onExistingRepoPick: handleExistingRepoPick,
    onTargetNameChange: handleTargetNameChange,
    onVisibilityToggle: handleVisibilityToggle,
    onToggleExpand: toggleCardExpand,
    onReplace: handleReplace,
    onRename: handleRename,
    onSkip: handleSkip,
    onGenerateDescription: handleGenerateDescription,
    onDescriptionChange: handleDescriptionChange,
    onToggleBranchExpand: toggleBranchExpand,
    onUpdateRepo,
  }

  // ── Empty state ──────────────────────────────────────────────────
  if (repos.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="No repositories selected"
        description="Go back and select repositories to configure."
        action={onGoToStep
          ? { label: 'Back to Selection', onClick: () => onGoToStep('repoSelect') }
          : undefined}
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
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
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
      <DashboardHeader
        isAzureDevops={isAzureDevops}
        source={source}
        azureProjects={azureProjects}
        targetProject={targetProject}
        projectsLoading={projectsLoading}
        orgOptions={orgOptions}
        orgs={orgs}
        stats={stats}
        onSelectProject={handleTargetProjectChange}
        onSelectDestination={handleDestinationChange}
        onAllPrivate={makeAllPrivate}
        onAllPublic={makeAllPublic}
      />

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
            const isExpanded = expandedCards[repo.name]
            const branchKey = repo.id || repo.name

            return (
              <RepoCard
                key={repo.name}
                repo={repo}
                index={index}
                conflictStatus={conflictStatus}
                isExpanded={!!isExpanded}
                isAzureDevops={isAzureDevops}
                azureEmptyRepos={azureEmptyRepos}
                aiAvailable={aiAvailable}
                isGenerating={generatingId === (repo.id ?? index)}
                descriptionMode={descriptionModes[index]}
                branchExpanded={!!expandedBranches[branchKey]}
                branchList={branchCache[branchKey] || []}
                branchLoading={!!loadingBranches[branchKey]}
                handlers={cardHandlers}
              />
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
      {/* targetName is set whenever a conflict was detected; repo.name is a safe fallback */}
      <ReplaceConfirmModal
        isOpen={!!replaceTarget}
        repoFullName={replaceTarget
          ? `${targetOwner ? `${targetOwner}/` : ''}${replaceTarget.repo.targetName || replaceTarget.repo.name}`
          : ''}
        onCancel={() => setReplaceTarget(null)}
        onConfirm={confirmReplace}
      />
    </div>
  )
}
