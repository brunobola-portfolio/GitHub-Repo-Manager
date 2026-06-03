import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Route, ArrowRight, FolderGit2, Recycle } from 'lucide-react'
import { GitHubIcon, AzureIcon } from './PlatformIcons'

/* ═══════════════════════════════════════════
   EXECUTION PIPELINE — source → target flow
   ═══════════════════════════════════════════ */

export function ExecutionPipeline({ order, repos, source }) {
  const isAzureDevopsTarget = source?.azureTargetMode === 'azure-devops'
  const targetProject = source?.targetProject || source?.project || ''
  const TargetIcon = isAzureDevopsTarget ? AzureIcon : GitHubIcon
  const targetIconClass = isAzureDevopsTarget
    ? 'text-blue-500 dark:text-blue-400'
    : 'text-slate-400'
  const repoMap = useMemo(() => {
    const map = {}
    ;(repos || []).filter(r => r.selected).forEach(r => {
      map[r.name] = r
    })
    return map
  }, [repos])

  if (!order?.length) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.25, duration: 0.5 }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Route className="w-4 h-4 text-slate-500 dark:text-slate-400" />
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Execution Order
        </h4>
        <span className="ds-text-meta text-slate-400 dark:text-slate-500">
          ({order.length} {order.length === 1 ? 'step' : 'steps'})
        </span>
      </div>

      <div className="space-y-1.5">
        {order.map((name, i) => {
          const repo = repoMap[name]
          const targetName = repo?.targetName || name
          const isTfvc = repo?.isTfvc
          const hasLfs = repo?.hasLfs
          const sizeMb = repo?.size ? (repo.size / (1024 * 1024)).toFixed(1) : null
          const usesExisting = isAzureDevopsTarget && repo?.targetType === 'existing-empty'
          // For Azure in-place, render the destination as "project/repoName" so
          // it's obvious where the new Git repo lands; default GitHub mode
          // keeps the plain repoName the user typed.
          const displayTarget = isAzureDevopsTarget && targetProject
            ? `${targetProject}/${targetName}`
            : targetName

          return (
            <motion.div
              key={name}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.06, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl
                bg-white dark:bg-white/[0.03]
                border border-slate-200/70 dark:border-white/8
                hover:border-indigo-300/60 dark:hover:border-indigo-500/30
                hover:shadow-sm
                transition-all duration-200 group"
            >
              {/* Step number */}
              <span className="shrink-0 w-6 h-6 rounded-md bg-[color:var(--ds-accent-brand)] dark:bg-[color:var(--ds-accent-brand-fill-dark)] text-white flex items-center justify-center ds-text-meta font-bold shadow-sm">
                {i + 1}
              </span>

              {/* Source name */}
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <FolderGit2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200 truncate ds-font-mono">
                  {name}
                </span>
              </div>

              {/* Arrow */}
              <ArrowRight className="w-3.5 h-3.5 text-indigo-400 dark:text-indigo-500 shrink-0 group-hover:translate-x-0.5 transition-transform" />

              {/* Target name */}
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <TargetIcon className={`w-3.5 h-3.5 shrink-0 ${targetIconClass}`} />
                <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200 truncate ds-font-mono" title={displayTarget}>
                  {displayTarget}
                </span>
              </div>

              {/* Badges */}
              <div className="flex items-center gap-1 shrink-0">
                {usesExisting && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400" title="Reusing an existing empty repo in the target project">
                    <Recycle className="w-2.5 h-2.5" />
                    Existing
                  </span>
                )}
                {isTfvc && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-violet-100 dark:bg-violet-500/15 text-violet-600 dark:text-violet-400">
                    TFVC
                  </span>
                )}
                {hasLfs && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-cyan-100 dark:bg-cyan-500/15 text-cyan-600 dark:text-cyan-400">
                    LFS
                  </span>
                )}
                {sizeMb && parseFloat(sizeMb) > 0 && (
                  <span className="ds-text-micro text-slate-400 dark:text-slate-500 tabular-nums whitespace-nowrap">
                    {sizeMb} MB
                  </span>
                )}
              </div>
            </motion.div>
          )
        })}
      </div>
    </motion.div>
  )
}
