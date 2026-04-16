// src/components/MigrationWizard/steps/RepoSelectStep/AutoFixDrawer.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Wand2, AlertTriangle } from 'lucide-react'
import { useAutoFixPlan } from './useAutoFixPlan.js'
import { FixPlanItem } from './FixPlanItem.jsx'
import { SizeStrategyCard } from './SizeStrategyCard.jsx'
import { SIZE_CRITICAL_KB } from './riskRules.js'
import { isValidRepoName } from './autoFixRules.js'
import { useFocusTrap } from '../../../../hooks/useFocusTrap.js'
import { useBodyScrollLock } from '../../../../hooks/useBodyScrollLock.js'

export function AutoFixDrawer({
  open,
  repos,
  allRepos,
  targetOrg,
  azureProject,
  aiAvailable,
  onClose,
  onApply,
}) {
  const selected = useMemo(() => repos.filter((r) => r.selected), [repos])
  const { plan, conflictStatuses, rawDuplicates, aiSuggestions, isValidating, isAILoading, error } = useAutoFixPlan({
    repos: selected,
    allRepos,
    targetOrg,
    azureProject,
    aiAvailable: aiAvailable && open,
  })

  const sizeCritical = useMemo(
    () => selected.filter((r) => r.size > SIZE_CRITICAL_KB),
    [selected],
  )

  // Local edit state: overrides the planned `to` value when the user edits inline.
  const [edits, setEdits] = useState({}) // { [repoIndex]: newName }
  const [checks, setChecks] = useState({}) // { [repoIndex]: boolean }
  const [strategies, setStrategies] = useState({}) // { [repoId]: 'exclude' | 'lfs-migrate' }

  // Critical 1 — Focus trap, Escape handler, body scroll lock
  const drawerRef = useFocusTrap(open, onClose)
  useBodyScrollLock(open)

  // Critical 2 — Reset local state on open transition
  const prevOpenRef = useRef(false)
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setEdits({})
      setChecks({})
      setStrategies({})
    }
    prevOpenRef.current = open
  }, [open])

  // Important 4 — Translate repoIndex: selected subset → allRepos
  const selectedToAllRepos = useMemo(
    () => selected.map((r) => allRepos.findIndex((x) => x.id === r.id)),
    [selected, allRepos],
  )

  const effectivePlan = useMemo(
    () => plan.map((p) => ({ ...p, to: edits[p.repoIndex] ?? p.to })),
    [plan, edits],
  )

  const applySet = useMemo(() => {
    // Important 4 — use selected[p.repoIndex] for conflict lookup, selectedToAllRepos for output
    const renameChanges = effectivePlan
      .filter((p) => {
        const checked = checks[p.repoIndex] ?? true
        const repoId = selected[p.repoIndex]?.id
        const conflict =
          conflictStatuses[repoId] === 'conflict' || !!rawDuplicates[p.to]
        return checked && !conflict && isValidRepoName(p.to)
      })
      .map((p) => ({
        repoIndex: selectedToAllRepos[p.repoIndex],
        patch: { targetName: p.to, conflictAction: 'rename' },
      }))

    const strategyChanges = sizeCritical
      .filter((r) => strategies[r.id])
      .map((r) => {
        const repoIndex = allRepos.findIndex((x) => x.id === r.id)
        return { repoIndex, patch: { sizeStrategy: strategies[r.id] } }
      })

    return [...renameChanges, ...strategyChanges]
  }, [effectivePlan, checks, conflictStatuses, rawDuplicates, sizeCritical, strategies, allRepos, selected, selectedToAllRepos])

  const handleApply = () => {
    if (applySet.length === 0) return
    onApply(applySet)
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="autofix-drawer-title"
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-xl flex-col bg-slate-900 shadow-2xl"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 220 }}
          >
            <header className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
              <div className="flex items-center gap-2 text-slate-100">
                <Wand2 className="h-5 w-5 text-indigo-400" />
                <h2 id="autofix-drawer-title" className="text-lg font-semibold">Fix issues</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            {error?.type === 'auth' && (
              <div className="m-4 rounded-md border border-red-500/40 bg-red-950/30 p-3 text-sm text-red-200">
                {error.message}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {plan.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-slate-200">Renames</h3>
                  <div className="space-y-2">
                    {plan.map((item) => {
                      // Important 4 — use selected[item.repoIndex] for conflict lookup
                      const repoId = selected[item.repoIndex]?.id
                      return (
                        <FixPlanItem
                          key={`${item.repoIndex}-${item.type}`}
                          item={{ ...item, to: edits[item.repoIndex] ?? item.to }}
                          checked={checks[item.repoIndex] ?? true}
                          conflictStatus={isValidating ? 'checking' : (conflictStatuses[repoId] ?? null)}
                          onToggle={(it, c) => setChecks((prev) => ({ ...prev, [it.repoIndex]: c }))}
                          onEdit={(it, v) => setEdits((prev) => ({ ...prev, [it.repoIndex]: v }))}
                        />
                      )
                    })}
                  </div>
                </section>
              )}

              {sizeCritical.length > 0 && (
                <section>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200">
                    Large repositories
                    {isAILoading && <span className="text-xs text-slate-400">(AI analyzing…)</span>}
                  </h3>
                  {!aiAvailable && (
                    <div className="mb-2 flex items-start gap-2 rounded-md border border-slate-700 bg-slate-800/40 p-2 text-xs text-slate-300">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                      AI suggestions unavailable — pick a strategy manually.
                    </div>
                  )}
                  {error?.type === 'ai-quota' && (
                    <div className="mb-2 rounded-md border border-amber-500/40 bg-amber-950/20 p-2 text-xs text-amber-200">
                      {error.message}
                    </div>
                  )}
                  <div className="space-y-2">
                    {sizeCritical.map((r) => (
                      <SizeStrategyCard
                        key={r.id}
                        repo={r}
                        aiSuggestion={aiSuggestions[r.id]}
                        selectedStrategy={strategies[r.id]}
                        onSelect={(repo, strategy) =>
                          setStrategies((prev) => ({ ...prev, [repo.id]: strategy }))
                        }
                      />
                    ))}
                  </div>
                </section>
              )}

              {plan.length === 0 && sizeCritical.length === 0 && (
                <p className="text-sm text-slate-400">No issues to fix.</p>
              )}
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-slate-700 px-5 py-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={applySet.length === 0}
                className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-indigo-400"
              >
                Apply selected ({applySet.length})
              </button>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
