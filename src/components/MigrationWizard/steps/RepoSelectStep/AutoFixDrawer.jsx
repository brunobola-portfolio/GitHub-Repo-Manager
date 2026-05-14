// src/components/MigrationWizard/steps/RepoSelectStep/AutoFixDrawer.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { Wand2, AlertTriangle } from 'lucide-react'
import { useAutoFixPlan } from './useAutoFixPlan.js'
import { FixPlanItem } from './FixPlanItem.jsx'
import { SizeStrategyCard } from './SizeStrategyCard.jsx'
import { SIZE_CRITICAL_BYTES } from './riskRules.js'
import { isValidRepoName } from './autoFixRules.js'
import { Drawer } from '../../../ui/Drawer'

export function AutoFixDrawer({
  open,
  repos,
  allRepos,
  targetOrg,
  azureProject,
  conflicts,
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
    conflicts,
    aiAvailable: aiAvailable && open,
  })

  const sizeCritical = useMemo(
    () => selected.filter((r) => r.size > SIZE_CRITICAL_BYTES),
    [selected],
  )

  // Local edit state: overrides the planned `to` value when the user edits inline.
  const [edits, setEdits] = useState({}) // { [repoIndex]: newName }
  const [checks, setChecks] = useState({}) // { [repoIndex]: boolean }
  const [strategies, setStrategies] = useState({}) // { [repoId]: 'exclude' | 'lfs-migrate' }

  // Critical 2 — Reset local state on open transition. The previously
  // persisted `repo.sizeStrategy` is honored at read-time via a fallback
  // (see `effectiveStrategy` below), so no seeding state update is needed.
  const prevOpenRef = useRef(false)
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setEdits({})
      setChecks({})
      setStrategies({})
    }
    prevOpenRef.current = open
  }, [open])

  // The active strategy for a repo is the user's in-drawer click if any,
  // otherwise the persisted value from a previous Apply.
  const effectiveStrategy = (repo) => strategies[repo.id] ?? repo.sizeStrategy

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
      .filter((r) => strategies[r.id] && strategies[r.id] !== r.sizeStrategy)
      .map((r) => {
        const repoIndex = allRepos.findIndex((x) => x.id === r.id)
        const strategy = strategies[r.id]
        // lfs-migrate produces LFS objects post-migration, so pre-enable
        // the Configure-step LFS toggle to keep the wizard self-consistent.
        const patch = strategy === 'lfs-migrate'
          ? { sizeStrategy: strategy, lfsEnabled: true }
          : { sizeStrategy: strategy }
        return { repoIndex, patch }
      })

    return [...renameChanges, ...strategyChanges]
  }, [effectivePlan, checks, conflictStatuses, rawDuplicates, sizeCritical, strategies, allRepos, selected, selectedToAllRepos])

  const handleApply = () => {
    if (applySet.length === 0) return
    onApply(applySet)
  }

  const footer = (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onClose}
        className="rounded-md px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
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
    </div>
  )

  return (
    <Drawer
      isOpen={open}
      onClose={onClose}
      side="right"
      title="Fix issues"
      icon={Wand2}
      width={576}
      closeOnBackdrop={false}
      footer={footer}
    >
      {error?.type === 'auth' && (
        <div className="m-4 rounded-md border border-red-500/40 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-200">
          {error.message}
        </div>
      )}

      <div className="p-5 space-y-6">
        {plan.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Renames</h3>
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
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              Large repositories
              {isAILoading && <span className="text-xs text-slate-400">(AI analyzing…)</span>}
            </h3>
            {!aiAvailable && (
              <div className="mb-2 flex items-start gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-2 text-xs text-slate-600 dark:text-slate-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                AI suggestions unavailable — pick a strategy manually.
              </div>
            )}
            {error?.type === 'ai-quota' && (
              <div className="mb-2 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 p-2 text-xs text-amber-700 dark:text-amber-200">
                {error.message}
              </div>
            )}
            <div className="space-y-2">
              {sizeCritical.map((r) => (
                <SizeStrategyCard
                  key={r.id}
                  repo={r}
                  aiSuggestion={aiSuggestions[r.id]}
                  selectedStrategy={effectiveStrategy(r)}
                  onSelect={(repo, strategy) =>
                    setStrategies((prev) => ({ ...prev, [repo.id]: strategy }))
                  }
                />
              ))}
            </div>
          </section>
        )}

        {plan.length === 0 && sizeCritical.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">No issues to fix.</p>
        )}
      </div>
    </Drawer>
  )
}
