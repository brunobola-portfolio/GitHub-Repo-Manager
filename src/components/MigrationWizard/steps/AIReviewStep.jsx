import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Shield, AlertTriangle, CheckCircle2,
  RefreshCw, Clock, Zap,
  Sparkles, ShieldCheck, ArrowRight,
  CircleAlert,
} from 'lucide-react'
import { migrationApi } from '../../../api/migration'

import { AnalysisLoadingState } from './AIReview/AnalysisLoadingState'
import { MigrationRouteCard } from './AIReview/MigrationRouteCard'
import { MetricCard } from './AIReview/MetricCard'
import { ExecutionPipeline } from './AIReview/ExecutionPipeline'
import { RiskCard } from './AIReview/RiskCard'
import { SuggestionRow } from './AIReview/SuggestionRow'

/* ═══════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════ */

export default function AIReviewStep({ aiPlan, onUpdate, wizard }) {
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState(null)
  const [approved, setApproved] = useState(aiPlan?.analyzed || false)

  const analyze = useCallback(async () => {
    setApproved(false)
    setAnalyzing(true)
    setError(null)

    try {
      const selectedRepos = (wizard.repos || []).filter(r => r.selected)
      const context = {
        repos: selectedRepos.map(r => ({
          name: r.name,
          size: r.size || 0,
          targetName: r.targetName || r.name,
          hasLfs: r.hasLfs || r.hasLfsMarker || false,
          isTfvc: r.isTfvc || false,
          // Deterministic risk flags pre-computed by the Select step's risk engine.
          // Backend AI analyzer can merge these with its LLM insights instead of
          // re-deriving obvious issues (size, name-conflict, LFS, archived, stale).
          clientRisk: r.risk ? { level: r.risk.level, flags: r.risk.flags } : null,
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
          existingRepos: [],
        },
        source: {
          type: wizard.source?.type || 'azure',
          org: wizard.source?.org || '',
          project: wizard.source?.project || '',
          versionControlType: wizard.source?.versionControlType || null,
        },
      }

      const result = await migrationApi.analyze(context)

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

  useEffect(() => {
    if (!aiPlan?.analyzed && !analyzing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot AI plan bootstrap; analyze() owns its own loading flag and writes to wizard state via onUpdate
      analyze()
    }
  }, [analyze, aiPlan?.analyzed, analyzing])

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

  const highRisks = useMemo(() => (aiPlan?.risks || []).filter(r => r.severity === 'high'), [aiPlan?.risks])
  const mediumRisks = useMemo(() => (aiPlan?.risks || []).filter(r => r.severity === 'medium'), [aiPlan?.risks])
  const lowRisks = useMemo(() => (aiPlan?.risks || []).filter(r => r.severity === 'low'), [aiPlan?.risks])
  const allRisks = useMemo(() => [...highRisks, ...mediumRisks, ...lowRisks], [highRisks, mediumRisks, lowRisks])
  const acceptedCount = useMemo(() =>
    (aiPlan?.suggestions || []).filter(s => s._accepted === true).length,
    [aiPlan?.suggestions]
  )
  const _repoCount = useMemo(() =>
    (wizard.repos || []).filter(r => r.selected).length,
    [wizard.repos]
  )

  return (
    <div className="space-y-5">
      {/* Re-analyze button */}
      {!analyzing && aiPlan?.analyzed && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center justify-end"
        >
          <motion.button
            type="button"
            onClick={analyze}
            disabled={analyzing}
            whileTap={{ scale: 0.98 }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
              text-violet-600 dark:text-violet-400
              bg-violet-50 dark:bg-violet-500/10
              hover:bg-violet-100 dark:hover:bg-violet-500/20
              border border-violet-200/60 dark:border-violet-500/20
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-all duration-200"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Re-analyze
          </motion.button>
        </motion.div>
      )}

      {/* ── LOADING ── */}
      <AnimatePresence mode="wait">
        {analyzing && <AnalysisLoadingState key="loading" />}
      </AnimatePresence>

      {/* ── ERROR ── */}
      {error && !analyzing && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 p-4 rounded-xl bg-red-50/60 dark:bg-red-500/[0.04] border border-red-200/80 dark:border-red-500/20"
        >
          <div className="shrink-0 w-8 h-8 rounded-lg bg-red-100 dark:bg-red-500/15 flex items-center justify-center">
            <AlertTriangle className="w-4 h-4 text-red-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-700 dark:text-red-400">Analysis failed</p>
            <p className="text-xs text-red-600/80 dark:text-red-400/60 mt-0.5">{error}</p>
          </div>
          <button
            type="button"
            onClick={analyze}
            className="shrink-0 text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 underline underline-offset-2"
          >
            Retry
          </button>
        </motion.div>
      )}

      {/* ── RESULTS ── */}
      <AnimatePresence>
        {!analyzing && aiPlan?.analyzed && (
          <motion.div
            key="results"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-5"
          >
            {/* ── MIGRATION ROUTE ── */}
            <MigrationRouteCard wizard={wizard} delay={0} />

            {/* ── METRICS ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <MetricCard
                icon={Shield}
                label="Risks Found"
                value={allRisks.length}
                iconColor={highRisks.length > 0 ? 'text-red-500' : 'text-emerald-500'}
                iconBg={highRisks.length > 0 ? 'bg-red-100 dark:bg-red-500/15' : 'bg-emerald-100 dark:bg-emerald-500/15'}
                delay={0.08}
              />
              <MetricCard
                icon={Clock}
                label="Est. Duration"
                value={aiPlan.estimatedMinutes || 0}
                unit="min"
                iconColor="text-indigo-500"
                iconBg="bg-indigo-100 dark:bg-indigo-500/15"
                delay={0.14}
              />
              <MetricCard
                icon={Zap}
                label="Suggestions"
                value={(aiPlan.suggestions || []).length}
                iconColor="text-violet-500"
                iconBg="bg-violet-100 dark:bg-violet-500/15"
                delay={0.2}
              />
              <MetricCard
                icon={CheckCircle2}
                label="Accepted"
                value={acceptedCount}
                unit={`/ ${(aiPlan.suggestions || []).length}`}
                iconColor="text-emerald-500"
                iconBg="bg-emerald-100 dark:bg-emerald-500/15"
                delay={0.26}
              />
            </div>

            {/* ── EXECUTION ORDER ── */}
            {aiPlan.executionOrder?.length > 0 && (
              <ExecutionPipeline order={aiPlan.executionOrder} repos={wizard.repos} source={wizard.source} />
            )}

            {/* ── RISKS ── */}
            {allRisks.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                    <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                      Risk Assessment
                    </h4>
                  </div>
                  <div className="flex items-center gap-1">
                    {highRisks.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-red-500 text-white shadow-sm">
                        {highRisks.length} high
                      </span>
                    )}
                    {mediumRisks.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-500 text-white shadow-sm">
                        {mediumRisks.length} med
                      </span>
                    )}
                    {lowRisks.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-sky-500 text-white shadow-sm">
                        {lowRisks.length} low
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-2.5">
                  <AnimatePresence>
                    {allRisks.map((risk, i) => (
                      <RiskCard key={risk.title + i} risk={risk} index={i} />
                    ))}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}

            {/* ── NO RISKS ── */}
            {allRisks.length === 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 }}
                className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50/40 dark:bg-emerald-500/[0.04] border border-emerald-200/70 dark:border-emerald-500/20"
              >
                <div className="shrink-0 w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5 text-emerald-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">No risks detected</p>
                  <p className="text-xs text-emerald-600/60 dark:text-emerald-400/50 mt-0.5">Migration plan looks safe to proceed.</p>
                </div>
              </motion.div>
            )}

            {/* ── SUGGESTIONS ── */}
            {(aiPlan.suggestions || []).length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-4 h-4 text-violet-500 dark:text-violet-400" />
                  <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    Optimization Suggestions
                  </h4>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">
                    ({acceptedCount}/{(aiPlan.suggestions || []).length} accepted)
                  </span>
                </div>

                <div className="space-y-2">
                  {aiPlan.suggestions.map((s, i) => (
                    <SuggestionRow
                      key={s.id}
                      suggestion={s}
                      index={i}
                      onAccept={handleAcceptSuggestion}
                      onReject={handleRejectSuggestion}
                    />
                  ))}
                </div>
              </motion.div>
            )}

            {/* ── WARNINGS ── */}
            {(aiPlan.warnings || []).length > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="rounded-xl border border-amber-200/60 dark:border-amber-500/15 bg-amber-50/30 dark:bg-amber-500/[0.03] overflow-hidden"
              >
                <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-amber-200/40 dark:border-amber-500/10">
                  <CircleAlert className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                    Warnings ({aiPlan.warnings.length})
                  </span>
                </div>
                <div className="divide-y divide-amber-200/30 dark:divide-amber-500/10">
                  {aiPlan.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2.5 px-3.5 py-2.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500/70 mt-0.5 shrink-0" />
                      <span className="text-xs text-amber-700 dark:text-amber-300/80 leading-relaxed">{w}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* ── APPROVE ── */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
            >
              {!approved ? (
                <motion.button
                  type="button"
                  onClick={handleApprove}
                  whileTap={{ scale: 0.99 }}
                  className="relative w-full overflow-hidden inline-flex items-center justify-center gap-2.5 px-5 py-3.5 text-sm font-semibold rounded-xl
                    text-white
                    bg-emerald-600 dark:bg-emerald-500
                    hover:bg-emerald-700 dark:hover:bg-emerald-600
                    shadow-lg
                    transition-colors duration-200"
                >
                  <CheckCircle2 className="w-4.5 h-4.5" />
                  Approve Migration Plan
                  <ArrowRight className="w-4 h-4 ml-1" />
                </motion.button>
              ) : (
                <motion.div
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                  className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50/40 dark:bg-emerald-500/[0.04] border border-emerald-200/60 dark:border-emerald-500/20"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 15, delay: 0.1 }}
                    className="shrink-0 w-9 h-9 rounded-lg bg-emerald-500 flex items-center justify-center shadow-md shadow-emerald-500/25"
                  >
                    <CheckCircle2 className="w-5 h-5 text-white" />
                  </motion.div>
                  <div>
                    <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Plan approved</p>
                    <p className="text-xs text-emerald-600/60 dark:text-emerald-400/50 mt-0.5">You can proceed to the next step.</p>
                  </div>
                </motion.div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
