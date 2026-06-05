import { motion } from 'framer-motion'
import { EASE } from '../../../ui/motion'
import { ArrowRight } from 'lucide-react'
import { AzureIcon, GitHubIcon } from './PlatformIcons'

/* ═══════════════════════════════════════════
   MIGRATION ROUTE — source → destination
   ═══════════════════════════════════════════ */

const SOURCE_LABELS = { azure: 'Azure DevOps', github: 'GitHub', url: 'Git URL' }

export function MigrationRouteCard({ wizard, delay = 0 }) {
  const sourceType = wizard.source?.type || 'azure'
  const sourceOrg = wizard.source?.org || ''
  const sourceProject = wizard.source?.project || ''
  const targetOrg = wizard.source?.targetOrg || sourceOrg
  const repoCount = (wizard.repos || []).filter(r => r.selected).length
  const SourceIcon = sourceType === 'azure' ? AzureIcon : GitHubIcon

  // Destination mode: in-place TFVC→Git (same Azure server, project of choice)
  // vs default GitHub push. The Configure step sets `azureTargetMode`.
  const isAzureDevopsTarget = wizard.source?.azureTargetMode === 'azure-devops'
  const targetProject = wizard.source?.targetProject || sourceProject
  const sourceHost = wizard.source?.host || ''
  // For Azure-in-place, the destination "org" is the same Azure org as the
  // source; for GitHub it's the chosen GitHub org/user.
  const destOrg = isAzureDevopsTarget ? sourceOrg : (targetOrg || 'GitHub')
  const destSubLabel = isAzureDevopsTarget ? targetProject : 'github.com'
  const DestIcon = isAzureDevopsTarget ? AzureIcon : GitHubIcon
  const destIconClasses = isAzureDevopsTarget
    ? 'bg-blue-100 dark:bg-blue-500/15'
    : 'bg-slate-100 dark:bg-white/10'
  const destIconColor = isAzureDevopsTarget
    ? 'text-blue-600 dark:text-blue-400'
    : 'text-slate-700 dark:text-slate-300'

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5, ease: EASE.emphasized }}
      className="relative overflow-hidden rounded-xl border border-slate-200/80 dark:border-white/10 bg-gradient-to-br from-white via-white to-slate-50 dark:from-white/[0.04] dark:via-white/[0.02] dark:to-white/[0.01]"
    >
      {/* Top gradient accent */}
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-indigo-500 opacity-70" />

      <div className="p-4">
        {/* Source → Destination row */}
        <div className="flex items-center gap-3">
          {/* Source */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5">
              <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
                sourceType === 'azure'
                  ? 'bg-blue-100 dark:bg-blue-500/15'
                  : 'bg-slate-100 dark:bg-white/10'
              }`}>
                <SourceIcon className={`w-5 h-5 ${
                  sourceType === 'azure' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'
                }`} />
              </div>
              <div className="min-w-0">
                <p className="ds-text-meta font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Source
                </p>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {sourceOrg}
                </p>
                {sourceProject && (
                  <p className="ds-text-meta text-slate-500 dark:text-slate-400 truncate ds-font-mono">
                    {sourceProject}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Arrow */}
          <div className="shrink-0 flex flex-col items-center gap-0.5 px-1">
            <motion.div
              className="w-9 h-9 rounded-full bg-[color:var(--ds-accent-brand)] dark:bg-[color:var(--ds-accent-brand-fill-dark)] flex items-center justify-center shadow-md"
              animate={{ x: [0, 2, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            >
              <ArrowRight className="w-4 h-4 text-white" />
            </motion.div>
            <span className="ds-text-micro font-bold text-indigo-500 dark:text-[color:var(--ds-accent-brand-dark)] tabular-nums">
              {repoCount} {repoCount === 1 ? 'repo' : 'repos'}
            </span>
          </div>

          {/* Destination */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 justify-end">
              <div className="min-w-0 text-right">
                <div className="flex items-center justify-end gap-1.5">
                  <p className="ds-text-meta font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Destination
                  </p>
                  {isAzureDevopsTarget && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-violet-500/15 border border-violet-500/30 text-[9px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-300">
                      in-place
                    </span>
                  )}
                </div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {destOrg}
                </p>
                <p className="ds-text-meta text-slate-500 dark:text-slate-400 ds-font-mono truncate">
                  {destSubLabel}
                </p>
                {isAzureDevopsTarget && sourceHost && (
                  <p className="ds-text-micro text-slate-400 dark:text-slate-500 ds-font-mono truncate">
                    {sourceHost}
                  </p>
                )}
              </div>
              <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${destIconClasses}`}>
                <DestIcon className={`w-5 h-5 ${destIconColor}`} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
