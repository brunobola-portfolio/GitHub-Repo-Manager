import { useMemo } from 'react'
import { AlertOctagon, AlertTriangle, Zap, Clock, Archive, Package, Database, Copy } from 'lucide-react'

const CHIP_DEFS = [
  { id: 'recommended', icon: Zap,           label: 'Recommended', match: (r) => r.risk?.level === 'ok' && !r.isDisabled },
  { id: 'at-risk',     icon: AlertTriangle, label: 'At risk',     match: (r) => r.risk?.level === 'warning' },
  { id: 'blocked',     icon: AlertOctagon,  label: 'Blocked',     match: (r) => r.risk?.level === 'blocker' },
  { id: 'stale',       icon: Clock,         label: 'Stale',       match: (r) => (r.risk?.flags || []).some((f) => f.type === 'stale') },
  { id: 'archived',    icon: Archive,       label: 'Archived',    match: (r) => r.isDisabled },
  { id: 'large',       icon: Package,       label: 'Large',       match: (r) => r.size > 1024 * 1024 * 1024 },
  { id: 'tfvc',        icon: Database,      label: 'TFVC',        match: (r) => r.isTfvc },
  { id: 'conflicts',   icon: Copy,          label: 'Conflicts',   match: (r) => r.risk?.flags?.some((f) => f.type === 'name-conflict') },
]

export function QuickFilters({ repos, active, onToggle }) {
  const counts = useMemo(() => {
    const all = { all: repos.length }
    for (const def of CHIP_DEFS) all[def.id] = repos.filter(def.match).length
    return all
  }, [repos])

  return (
    <div className="flex items-center gap-1.5 flex-wrap" role="toolbar" aria-label="Quick filters">
      <Chip
        active={active.size === 0}
        onClick={() => onToggle(null)}
        label="All"
        count={counts.all}
        tone="indigo"
      />
      {CHIP_DEFS.map((def) => {
        const count = counts[def.id]
        if (!count) return null
        return (
          <Chip
            key={def.id}
            icon={def.icon}
            label={def.label}
            count={count}
            active={active.has(def.id)}
            onClick={() => onToggle(def.id)}
            tone={
              def.id === 'blocked'   ? 'red' :
              def.id === 'at-risk'   ? 'amber' :
              def.id === 'recommended' ? 'emerald' :
              def.id === 'tfvc'      ? 'violet' :
              'slate'
            }
          />
        )
      })}
    </div>
  )
}

function Chip({ icon: Icon, label, count, active, onClick, tone = 'slate' }) {
  const base = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors'
  // /15 opacity pattern (consistent with existing wizard badges) — reads well
  // in both light and dark modes, unlike the previous solid-fill actives.
  const activeCls = {
    indigo:  'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border-indigo-500/40 shadow-sm',
    red:     'bg-red-500/15 text-red-600 dark:text-red-300 border-red-500/40 shadow-sm',
    amber:   'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/40 shadow-sm',
    emerald: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/40 shadow-sm',
    violet:  'bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/40 shadow-sm',
    slate:   'bg-slate-500/15 text-slate-700 dark:text-slate-200 border-slate-500/40 shadow-sm',
  }[tone]
  const inactiveCls = 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${label}: ${count} ${count === 1 ? 'repository' : 'repositories'}`}
      onClick={onClick}
      className={`${base} ${active ? activeCls : inactiveCls}`}
    >
      {Icon && <Icon className="w-3.5 h-3.5" aria-hidden="true" />}
      <span>{label}</span>
      <span className="text-[10px] opacity-80 tabular-nums" aria-hidden="true">{count}</span>
    </button>
  )
}
