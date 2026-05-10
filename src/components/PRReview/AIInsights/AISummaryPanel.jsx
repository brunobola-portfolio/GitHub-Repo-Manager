import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'
import { Spinner } from '../../ui/Spinner'
import { AIErrorState } from '../../ui/AIErrorState'
import { motion, AnimatePresence } from 'framer-motion'

const RISK_TEXT = {
  low: 'text-green-700 dark:text-green-400',
  medium: 'text-yellow-700 dark:text-yellow-400',
  high: 'text-orange-700 dark:text-orange-400',
  critical: 'text-red-700 dark:text-red-400',
}

const RISK_BG = {
  low: 'bg-green-100 dark:bg-green-900/30 hover:bg-green-200 dark:hover:bg-green-900/50',
  medium: 'bg-yellow-100 dark:bg-yellow-900/30 hover:bg-yellow-200 dark:hover:bg-yellow-900/50',
  high: 'bg-orange-100 dark:bg-orange-900/30 hover:bg-orange-200 dark:hover:bg-orange-900/50',
  critical: 'bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50',
}

const RISK_HEADER_BG = {
  low: 'bg-green-500 dark:bg-green-400',
  medium: 'bg-yellow-500 dark:bg-yellow-400',
  high: 'bg-orange-500 dark:bg-orange-400',
  critical: 'bg-red-500 dark:bg-red-400',
}

function RiskPill({ level }) {
  if (!level) return null
  const bg = RISK_HEADER_BG[level] ?? 'bg-slate-400'
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-white text-xs font-semibold uppercase tracking-wide ${bg}`}
    >
      {level}
    </span>
  )
}

/**
 * Collapsible panel showing AI-generated PR review summary.
 *
 * @param {object|null} summary          - AI summary object from useReviewAI
 * @param {boolean}     loading          - True while AI is fetching
 * @param {string|null} error            - Error message if AI fetch failed
 * @param {boolean}     collapsed        - Whether the panel body is collapsed
 * @param {Function}    onToggle         - Toggle collapsed state
 * @param {Function}    onRetry          - Retry AI fetch
 * @param {Function}    onFileClick      - Called with filename when a file risk entry is clicked
 */
export function AISummaryPanel({ summary, loading, error, collapsed, onToggle, onRetry, onFileClick }) {
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
          AI Review Summary
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
                  <span>Analyzing PR...</span>
                </div>
              )}

              {/* Error state */}
              {error && !loading && (
                <AIErrorState
                  error={typeof error === 'string' ? { message: error } : error}
                  onRetry={onRetry}
                  context="PR review"
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
                          const level = entry.level ?? entry.risk ?? 'medium'
                          const textColor = RISK_TEXT[level] ?? 'text-slate-700 dark:text-slate-300'
                          const bgColor = RISK_BG[level] ?? 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700'
                          const fname = entry.filename ?? entry.file
                          return (
                            <button
                              key={i}
                              onClick={() => onFileClick?.(fname)}
                              className={`w-full flex items-center gap-2 px-2 py-1 rounded text-left transition-colors ${bgColor}`}
                              title={fname}
                            >
                              <span className={`shrink-0 text-xs font-semibold uppercase ${textColor}`}>
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
