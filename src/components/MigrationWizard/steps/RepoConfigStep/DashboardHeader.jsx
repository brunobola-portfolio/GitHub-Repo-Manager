import { motion } from 'framer-motion'
import { Server, Building2, Lock, Globe } from 'lucide-react'
import { Select } from '../../../ui/Select'
import { formatSize } from './formatSize'

/**
 * RepoConfigStep dashboard header — destination picker (GitHub org Select or
 * Azure project Select), bulk visibility actions (GitHub only) and the summary
 * stats grid. Purely presentational; the parent owns the data + handlers.
 *
 * @param {object} props
 * @param {boolean} props.isAzureDevops
 * @param {object}  props.source
 * @param {Array}   props.azureProjects
 * @param {string}  props.targetProject
 * @param {boolean} props.projectsLoading
 * @param {Array}   props.orgOptions
 * @param {Array}   props.orgs
 * @param {object}  props.stats
 * @param {(projectName: string) => void} props.onSelectProject
 * @param {(orgLogin: string) => void}    props.onSelectDestination
 * @param {() => void} props.onAllPrivate
 * @param {() => void} props.onAllPublic
 */
export function DashboardHeader({
  isAzureDevops,
  source,
  azureProjects,
  targetProject,
  projectsLoading,
  orgOptions,
  orgs,
  stats,
  onSelectProject,
  onSelectDestination,
  onAllPrivate,
  onAllPublic,
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="bg-brand-500/10 border border-brand-500/20 rounded-2xl p-5"
    >
      {/* Row 1: Destination + Bulk Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500/20 to-brand-500/10 ring-1 ring-brand-500/30 flex items-center justify-center shrink-0">
            {isAzureDevops
              ? <Server className="w-5 h-5 text-brand-400" />
              : <Building2 className="w-5 h-5 text-brand-400" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="ds-text-micro font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                {isAzureDevops ? 'Target project' : 'Importing to'}
              </span>
              {isAzureDevops && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-brand-50 border border-brand-200 text-[9px] font-bold uppercase tracking-wider text-brand-700 dark:bg-brand-500/15 dark:border-brand-500/30 dark:text-brand-300">
                  in-place
                </span>
              )}
            </div>
            {isAzureDevops ? (
              <div className="mt-1 flex items-center gap-2 flex-wrap min-w-0">
                <div className="inline-flex items-center px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800/80 ring-1 ring-slate-200 dark:ring-slate-700 text-sm font-mono font-semibold text-slate-700 dark:text-slate-200 shadow-sm">
                  {source.org}
                </div>
                <span className="text-slate-500 dark:text-slate-400 font-mono select-none">/</span>
                {azureProjects.length > 0 ? (
                  <Select
                    options={azureProjects.map((p) => ({ value: p.name, label: p.name }))}
                    value={targetProject}
                    onChange={onSelectProject}
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
                  <span className="hidden md:inline ds-text-meta text-slate-500 dark:text-slate-400 font-medium tabular-nums">
                    {azureProjects.length} {azureProjects.length === 1 ? 'project' : 'projects'}
                  </span>
                )}
              </div>
            ) : orgOptions.length > 0 ? (
              <div className="mt-1 flex items-center gap-2 flex-wrap min-w-0">
                <Select
                  options={orgOptions}
                  value={source.targetOrg || orgs[0]?.login || ''}
                  onChange={onSelectDestination}
                  placeholder="Select organization..."
                  size="md"
                  label="Destination organization"
                  className="min-w-[220px]"
                />
                <span className="hidden md:inline ds-text-meta text-slate-500 dark:text-slate-400 font-medium tabular-nums">
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
              onClick={onAllPrivate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
                bg-brand-500/15 text-brand-400 dark:text-brand-300 border border-brand-500/20
                hover:bg-brand-500/25 transition-colors"
            >
              <Lock className="w-3.5 h-3.5" />
              All Private
            </button>
            <button
              type="button"
              onClick={onAllPublic}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
                bg-brand-500/15 text-brand-400 dark:text-brand-300 border border-brand-500/20
                hover:bg-brand-500/25 transition-colors"
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
          <div className="text-xl font-bold text-brand-400">{stats.count}</div>
          <div className="ds-text-micro font-medium uppercase tracking-wider text-slate-500 mt-0.5">Repositories</div>
        </div>
        <div className="bg-white/60 dark:bg-slate-900/50 rounded-xl px-4 py-3 text-center">
          <div className="text-xl font-bold text-brand-400">{formatSize(stats.totalSize)}</div>
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
              <div className="text-xl font-bold text-amber-400">{stats.publicCount}</div>
              <div className="ds-text-micro font-medium uppercase tracking-wider text-slate-500 mt-0.5">Public</div>
            </div>
          </>
        )}
      </div>
    </motion.div>
  )
}
