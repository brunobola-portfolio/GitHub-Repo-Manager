import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain, Shield, AlertTriangle, CheckCircle2, XCircle, Loader2,
  RefreshCw, ThumbsUp, ThumbsDown, Clock, List, Info, Zap,
} from 'lucide-react'
import { migrationApi } from '../../../api/migration'

const SEVERITY_CONFIG = {
  high: {
    color: 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20',
    icon: XCircle,
    iconColor: 'text-red-500',
    badge: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  },
  medium: {
    color: 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20',
    icon: AlertTriangle,
    iconColor: 'text-amber-500',
    badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  },
  low: {
    color: 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20',
    icon: Info,
    iconColor: 'text-blue-500',
    badge: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  },
}

function RiskCard({ risk }) {
  const config = SEVERITY_CONFIG[risk.severity] || SEVERITY_CONFIG.low
  const Icon = config.icon

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`p-3 rounded-xl border ${config.color}`}
    >
      <div className="flex items-start gap-2">
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${config.iconColor}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {risk.title}
            </span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${config.badge}`}>
              {risk.severity}
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{risk.description}</p>
          {risk.mitigation && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 italic">
              Mitigation: {risk.mitigation}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  )
}

function SuggestionRow({ suggestion, onAccept, onReject }) {
  const isAccepted = suggestion._accepted === true
  const isRejected = suggestion._accepted === false

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
        isAccepted
          ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20'
          : isRejected
            ? 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 opacity-60'
            : 'border-slate-200 dark:border-slate-700'
      }`}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-900 dark:text-slate-100">{suggestion.text}</p>
        {suggestion.repo && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">For: {suggestion.repo}</p>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => onAccept(suggestion.id)}
          className={`p-1.5 rounded-lg transition-colors ${
            isAccepted
              ? 'bg-emerald-500 text-white'
              : 'text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'
          }`}
          aria-label="Accept suggestion"
        >
          <ThumbsUp className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onReject(suggestion.id)}
          className={`p-1.5 rounded-lg transition-colors ${
            isRejected
              ? 'bg-red-500 text-white'
              : 'text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'
          }`}
          aria-label="Reject suggestion"
        >
          <ThumbsDown className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  )
}

export default function AIReviewStep({ aiPlan, onUpdate, wizard }) {
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState(null)
  const [approved, setApproved] = useState(aiPlan?.analyzed || false)

  const analyze = useCallback(async () => {
    setAnalyzing(true)
    setError(null)

    try {
      const selectedRepos = (wizard.repos || []).filter(r => r.selected)
      const context = {
        repos: selectedRepos.map(r => ({
          name: r.name,
          size: r.size || 0,
          targetName: r.targetName || r.name,
          hasLfs: r.hasLfs || false,
        })),
        workItems: wizard.workItems?.enabled ? {
          counts: wizard.workItems.counts || {},
          types: wizard.workItems.types || [],
        } : null,
        wikis: wizard.wiki?.enabled ? (wizard.wiki.wikis || []).map(w => ({
          id: w.id,
          name: w.name,
          pageCount: w.pageCount || 0,
        })) : [],
        target: {
          org: wizard.source?.org || '',
          existingRepos: [], // Would come from GitHub API
        },
        source: {
          type: wizard.source?.type || 'azure',
          org: wizard.source?.org || '',
          project: wizard.source?.project || '',
        },
      }

      const result = await migrationApi.analyze(context)

      // Add IDs and accepted status to suggestions
      const suggestions = (result.suggestions || []).map((s, i) => ({
        ...s,
        id: s.id || `suggestion-${i}`,
        _accepted: undefined,
      }))

      onUpdate({
        analyzed: true,
        risks: result.risks || [],
        suggestions,
        executionOrder: result.executionOrder || [],
        estimatedMinutes: result.estimatedMinutes || 0,
        warnings: result.warnings || [],
      })
    } catch (err) {
      setError(err.message || 'Analysis failed')
    } finally {
      setAnalyzing(false)
    }
  }, [wizard, onUpdate])

  // Auto-analyze on mount if not already analyzed
  useEffect(() => {
    if (!aiPlan?.analyzed && !analyzing) {
      analyze()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAcceptSuggestion = (id) => {
    const updated = (aiPlan.suggestions || []).map(s =>
      s.id === id ? { ...s, _accepted: s._accepted === true ? undefined : true } : s
    )
    onUpdate({ suggestions: updated })
  }

  const handleRejectSuggestion = (id) => {
    const updated = (aiPlan.suggestions || []).map(s =>
      s.id === id ? { ...s, _accepted: s._accepted === false ? undefined : false } : s
    )
    onUpdate({ suggestions: updated })
  }

  const handleApprove = () => {
    setApproved(true)
    onUpdate({ analyzed: true })
  }

  const highRisks = (aiPlan.risks || []).filter(r => r.severity === 'high')
  const mediumRisks = (aiPlan.risks || []).filter(r => r.severity === 'medium')
  const lowRisks = (aiPlan.risks || []).filter(r => r.severity === 'low')

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-500" />
            AI Review
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Analysis and recommendations for your migration plan
          </p>
        </div>
        <button
          type="button"
          onClick={analyze}
          disabled={analyzing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
            text-indigo-600 dark:text-indigo-400
            bg-indigo-50 dark:bg-indigo-900/20
            hover:bg-indigo-100 dark:hover:bg-indigo-900/40
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${analyzing ? 'animate-spin' : ''}`} />
          Re-analyze
        </button>
      </div>

      {/* Loading state */}
      {analyzing && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center py-10 text-center"
        >
          <Loader2 className="w-10 h-10 text-purple-500 animate-spin mb-3" />
          <p className="text-sm text-slate-600 dark:text-slate-300">Analyzing migration plan...</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Checking for risks and optimizations</p>
        </motion.div>
      )}

      {/* Error state */}
      {error && !analyzing && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Results */}
      {!analyzing && aiPlan?.analyzed && (
        <>
          {/* Execution Order */}
          {aiPlan.executionOrder?.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5">
                <List className="w-4 h-4" />
                Execution Order
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {aiPlan.executionOrder.map((name, i) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    <span className="w-4 h-4 rounded-full bg-indigo-500 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                      {i + 1}
                    </span>
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Estimated Duration */}
          {aiPlan.estimatedMinutes > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-sm">
              <Clock className="w-4 h-4 shrink-0" />
              <span>Estimated duration: <strong>~{aiPlan.estimatedMinutes} minutes</strong></span>
            </div>
          )}

          {/* Risk cards */}
          {(aiPlan.risks || []).length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5">
                <Shield className="w-4 h-4" />
                Risks ({highRisks.length} high, {mediumRisks.length} medium, {lowRisks.length} low)
              </h4>
              <div className="space-y-2">
                <AnimatePresence>
                  {[...highRisks, ...mediumRisks, ...lowRisks].map((risk, i) => (
                    <RiskCard key={risk.title + i} risk={risk} />
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}

          {/* No risks */}
          {(aiPlan.risks || []).length === 0 && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-sm">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>No risks detected. Migration looks safe to proceed.</span>
            </div>
          )}

          {/* Suggestions */}
          {(aiPlan.suggestions || []).length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5">
                <Zap className="w-4 h-4" />
                Suggestions
              </h4>
              <div className="space-y-2">
                {aiPlan.suggestions.map(s => (
                  <SuggestionRow
                    key={s.id}
                    suggestion={s}
                    onAccept={handleAcceptSuggestion}
                    onReject={handleRejectSuggestion}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {(aiPlan.warnings || []).length > 0 && (
            <div className="space-y-1.5">
              {aiPlan.warnings.map((w, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400"
                >
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* Approve button */}
          {!approved ? (
            <button
              type="button"
              onClick={handleApprove}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium rounded-xl
                text-white
                bg-gradient-to-r from-emerald-500 to-teal-600
                hover:from-emerald-600 hover:to-teal-700
                shadow-lg shadow-emerald-500/25
                transition-all"
            >
              <CheckCircle2 className="w-4 h-4" />
              Approve Plan
            </button>
          ) : (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-sm">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Plan approved. You can proceed to the next step.</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
