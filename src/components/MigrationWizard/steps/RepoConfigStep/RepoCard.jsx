import { motion, AnimatePresence } from 'framer-motion'
import {
  Package, ArrowRight, Plus, Recycle, Lock, Unlock,
  MoreHorizontal, CheckCircle2, XCircle, GitBranch, HardDrive, ChevronDown, Sparkles, AlertTriangle,
} from 'lucide-react'
import { Spinner } from '../../../ui/Spinner'
import { Select } from '../../../ui/Select'
import { Input, Switch } from '../../../ui/form'
import { RiskBadge } from '../../ui/repo/RiskBadge'
import { RepoMetadataBadges } from './RepoMetadataBadges'
import { ConflictResolutionPanel } from './ConflictResolutionPanel'
import { DescriptionField } from './DescriptionField'

/**
 * A single configurable repo row in the migration wizard's RepoConfigStep:
 * source → target name (or Azure new/existing toggle), metadata badges,
 * risk/visibility/status, and an expandable section (conflict resolution,
 * description, LFS + branch selection).
 *
 * Purely presentational. All side effects flow through the `handlers` bundle
 * (kept as one prop to stay under the per-prop threshold); branch + AI state
 * is passed in pre-resolved for this row.
 *
 * @param {object} props
 * @param {object}  props.repo
 * @param {number}  props.index
 * @param {string}  props.conflictStatus  — 'idle' | 'checking' | 'clear' | 'conflict' | 'will-replace'
 * @param {boolean} props.isExpanded
 * @param {boolean} props.isAzureDevops
 * @param {Array}   props.azureEmptyRepos
 * @param {boolean} props.aiAvailable
 * @param {boolean} props.isGenerating
 * @param {boolean} props.branchExpanded
 * @param {Array}   props.branchList
 * @param {boolean} props.branchLoading
 * @param {object}  props.handlers
 */
export function RepoCard({
  repo,
  index,
  conflictStatus,
  isExpanded,
  isAzureDevops,
  azureEmptyRepos,
  aiAvailable,
  isGenerating,
  descriptionMode,
  branchExpanded,
  branchList,
  branchLoading,
  handlers,
}) {
  const isPrivate = repo.visibility === 'private'

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.2, delay: index * 0.05 }}
      className={`relative bg-slate-50 dark:bg-slate-800 border rounded-xl overflow-hidden transition-colors
        ${(conflictStatus === 'conflict' || repo.conflictAction === 'replace')
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
                  onClick={() => handlers.onTargetTypeChange(repo, index, 'new')}
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
                  onClick={() => handlers.onTargetTypeChange(repo, index, 'existing-empty')}
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
                  onChange={(v) => handlers.onExistingRepoPick(repo, index, v)}
                  placeholder="Pick empty repo..."
                  label={`Existing empty repo for ${repo.name}`}
                />
              ) : (
                <Input
                  type="text"
                  size="sm"
                  value={repo.targetName || ''}
                  onChange={(e) => handlers.onTargetNameChange(repo, index, e.target.value)}
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
          {repo.conflictAction === 'replace' && (
            <span role="status" className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded ds-text-micro font-semibold uppercase tracking-wide bg-red-500/10 text-red-600 dark:text-red-400">
              <AlertTriangle className="w-2.5 h-2.5" />
              Will replace (delete) existing repo
            </span>
          )}
        </div>

        {/* Right: visibility + status + expand */}
        <div className="flex items-center gap-2 shrink-0">
          <RiskBadge level={repo.risk?.level || 'ok'} flags={repo.risk?.flags || []} />
          {!isAzureDevops && (
            <button
              type="button"
              onClick={() => handlers.onVisibilityToggle(index, repo.visibility)}
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
              repo.conflictAction === 'replace' ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]' :
              conflictStatus === 'clear' ? 'bg-emerald-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]' :
              conflictStatus === 'checking' ? 'bg-amber-500 animate-pulse shadow-[0_0_6px_rgba(245,158,11,0.5)]' :
              conflictStatus === 'conflict' ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]' :
              'bg-slate-300 dark:bg-slate-600'
            }`} />
            <span className={`ds-text-meta ${
              repo.conflictAction === 'replace' ? 'text-red-600 dark:text-red-400' :
              conflictStatus === 'clear' ? 'text-emerald-600 dark:text-emerald-400' :
              conflictStatus === 'checking' ? 'text-amber-600 dark:text-amber-400' :
              conflictStatus === 'conflict' ? 'text-red-600 dark:text-red-400' :
              'text-slate-500 dark:text-slate-400'
            }`}>
              {repo.conflictAction === 'replace' ? 'Will replace' :
               conflictStatus === 'clear' ? 'Ready' :
               conflictStatus === 'checking' ? 'Checking...' :
               conflictStatus === 'conflict' ? 'Conflict' : ''}
            </span>
          </div>

          {/* Expand button */}
          <button
            type="button"
            onClick={() => handlers.onToggleExpand(repo.name)}
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
                <ConflictResolutionPanel
                  onReplace={() => handlers.onReplace(repo, index)}
                  onRename={() => handlers.onRename(repo, index)}
                  onSkip={() => handlers.onSkip(repo, index)}
                />
              )}

              {/* Description */}
              <DescriptionField
                repo={repo}
                index={index}
                aiAvailable={aiAvailable}
                isGenerating={isGenerating}
                mode={descriptionMode}
                onChange={(value) => handlers.onDescriptionChange(index, value)}
                onGenerate={() => handlers.onGenerateDescription(repo, index)}
              />

              {/* LFS + Branch row */}
              <div className="flex flex-wrap items-center gap-3">
                {/* Git LFS — premium control, surfaces auto-detection */}
                <div className="inline-flex items-center gap-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 pl-2.5 pr-3 py-1.5">
                  <Switch
                    checked={!!repo.lfsEnabled}
                    onChange={(next) => handlers.onUpdateRepo(index, { lfsEnabled: next })}
                    label="Git LFS"
                    tone="amber"
                    size="sm"
                  />
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                    <HardDrive className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" aria-hidden="true" />
                    Git LFS
                  </span>
                  {repo.hasLfsMarker && (
                    <span
                      title="LFS pointers were detected in .gitattributes — enabled automatically"
                      className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 ds-text-micro font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400"
                    >
                      <Sparkles className="w-2.5 h-2.5" aria-hidden="true" />
                      Auto-detected
                    </span>
                  )}
                </div>

                {!repo.isTfvc && (
                  <button
                    type="button"
                    onClick={() => handlers.onToggleBranchExpand(repo, index)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400
                      hover:border-indigo-300 dark:hover:border-indigo-500/40 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                  >
                    <GitBranch className="w-3.5 h-3.5" aria-hidden="true" />
                    {repo.branchFilter === 'selected'
                      ? `${(repo.selectedBranches || []).length} branch${(repo.selectedBranches || []).length === 1 ? '' : 'es'}`
                      : 'All branches'}
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${branchExpanded ? 'rotate-180' : ''}`} />
                  </button>
                )}
              </div>

              {/* Branch list (Git only) */}
              {!repo.isTfvc && branchExpanded && (
                <div className="p-3 rounded-lg bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={repo.branchFilter !== 'selected'}
                      onChange={(e) => {
                        handlers.onUpdateRepo(index, {
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
                      {branchLoading ? (
                        <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
                          <Spinner size="xs" />
                          Loading branches...
                        </div>
                      ) : (branchList || []).length > 0 ? (
                        (branchList || []).map((branch) => (
                          <label key={branch.name} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={(repo.selectedBranches || []).includes(branch.name)}
                              onChange={(e) => {
                                const current = repo.selectedBranches || []
                                const next = e.target.checked
                                  ? [...current, branch.name]
                                  : current.filter((b) => b !== branch.name)
                                handlers.onUpdateRepo(index, { selectedBranches: next })
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
}
