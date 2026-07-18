import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'
import { Spinner } from '../../ui/Spinner'
import { AIErrorState } from '../../ui/AIErrorState'
import { motion, AnimatePresence } from 'framer-motion'
import { normalizeRiskLevel, riskFillClass, riskTextClass, riskTintClass } from '../../../utils/riskTokens'

function RiskPill({ level }) {
  if (!level) return null
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-white text-xs font-semibold uppercase tracking-wide ${riskFillClass(normalizeRiskLevel(level))}`}
    >
      {level}
    </span>
  )
}

/**
 * Collapsible panel showing an AI-generated review summary. Used verbatim
 * by both PR review (useReviewAI) and single-commit summaries (useCommitAI)
 * — it's fully decoupled from PR-specific state, taking plain props.
 *
 * @param {object|null} summary          - AI summary object from useReviewAI / useCommitAI
 * @param {boolean}     loading          - True while AI is fetching
 * @param {string|null} error            - Error message if AI fetch failed
 * @param {boolean}     collapsed        - Whether the panel body is collapsed
 * @param {Function}    onToggle         - Toggle collapsed state
 * @param {Function}    onRetry          - Retry AI fetch
 * @param {Function}    onFileClick      - Called with filename when a file risk entry is clicked
 * @param {string}      [headerLabel]    - Header text (default: "AI Review Summary")
 * @param {string}      [loadingLabel]   - Loading copy (default: "Analyzing PR...")
 * @param {string}      [errorContext]   - Context string handed to AIErrorState (default: "PR review")
 */
export function AISummaryPanel({
  summary, loading, error, collapsed, onToggle, onRetry, onFileClick,
  headerLabel = 'AI Review Summary',
  loadingLabel = 'Analyzing PR...',
  errorContext = 'PR review',
}) {
  // Don't render if there is nothing to show
  if (!summary && !loading && !error) return null

  const overallRisk = summary?.overallRisk ?? summary?.riskLevel ?? null
  const ChevronIcon = collapsed ? ChevronRight : ChevronDown
  const topFileRisks = Array.isArray(summary?.fileRisks) ? summary.fileRisks.slice(0, 5) : []

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden text-sm">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-left"
        aria-expanded={!collapsed}
      >
        <ChevronIcon size={14} className="shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true" />
        <AlertTriangle size={14} className="shrink-0 text-yellow-500 dark:text-yellow-400" aria-hidden="true" />
        <span className="flex-1 font-semibold text-slate-700 dark:text-slate-200">
          {headerLabel}
        </span>
        {overallRisk && <RiskPill level={overallRisk} />}
      </button>

      {/* Animated body */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="ai-summary-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div className="px-3 py-3 space-y-3 bg-white dark:bg-slate-900">

              {/* Loading state */}
              {loading && (
                <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                  <Spinner size="sm" className="shrink-0" />
                  <span>{loadingLabel}</span>
                </div>
              )}

              {/* Error state */}
              {error && !loading && (
                <AIErrorState
                  error={typeof error === 'string' ? { message: error } : error}
                  onRetry={onRetry}
                  context={errorContext}
                  variant="inline"
                />
              )}

              {/* Summary content */}
              {summary && !loading && (
                <>
                  {/* Overview */}
                  {summary.overview && (
                    <p className="text-slate-700 dark:text-slate-300 leading-snug">
                      {summary.overview}
                    </p>
                  )}

                  {/* Key changes */}
                  {Array.isArray(summary.keyChanges) && summary.keyChanges.length > 0 && (
                    <div>
                      <h4 className="font-semibold text-slate-600 dark:text-slate-400 mb-1 text-xs uppercase tracking-wide">
                        Key Changes
                      </h4>
                      <ul className="space-y-0.5 list-disc list-inside text-slate-700 dark:text-slate-300">
                        {summary.keyChanges.map((change, i) => (
                          <li key={i}>{change}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Top file risks */}
                  {topFileRisks.length > 0 && (
                    <div>
                      <h4 className="font-semibold text-slate-600 dark:text-slate-400 mb-1 text-xs uppercase tracking-wide">
                        High-Risk Files
                      </h4>
                      <div className="space-y-1">
                        {topFileRisks.map((entry, i) => {
                          const level = normalizeRiskLevel(entry.level ?? entry.risk ?? 'medium')
                          const fname = entry.filename ?? entry.file
                          return (
                            <button
                              key={i}
                              onClick={() => onFileClick?.(fname)}
                              className={`w-full flex items-center gap-2 px-2 py-1 rounded text-left transition-colors ${riskTintClass(level)}`}
                              title={fname}
                            >
                              <span className={`shrink-0 text-xs font-semibold uppercase ${riskTextClass(level)}`}>
                                {level}
                              </span>
                              <span className="flex-1 truncate font-mono text-xs text-slate-700 dark:text-slate-300">
                                {fname}
                              </span>
                              {entry.reason && (
                                <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400 truncate max-w-[140px]">
                                  {entry.reason}
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Estimated review time */}
                  {summary.estimatedReviewTime && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Estimated review time:{' '}
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {summary.estimatedReviewTime}
                      </span>
                    </p>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
