// src/components/MigrationWizard/steps/RepoSelectStep/FixPlanItem.jsx
import { ArrowRight, Check, AlertCircle, Loader2 } from 'lucide-react'

const TYPE_LABEL = {
  'invalid-chars': 'Invalid chars',
  'reserved-name': 'Reserved',
  'duplicate-in-batch': 'Duplicate',
  'name-conflict': 'Target conflict',
}

export function FixPlanItem({ item, checked, conflictStatus, onToggle, onEdit }) {
  const disabled = conflictStatus === 'conflict'
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm
        ${disabled ? 'border-red-500/40 bg-red-950/10' : 'border-slate-700 bg-slate-800/40'}`}
    >
      <input
        type="checkbox"
        checked={checked && !disabled}
        disabled={disabled}
        onChange={(e) => onToggle(item, e.target.checked)}
        aria-label={`Apply fix for ${item.from}`}
      />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-slate-400 line-through">{item.from}</span>
        <ArrowRight className="h-3 w-3 shrink-0 text-slate-500" />
        <input
          type="text"
          value={item.to}
          onChange={(e) => onEdit(item, e.target.value)}
          disabled={disabled}
          aria-label={`Rename target for ${item.from}`}
          className={`min-w-0 flex-1 rounded bg-slate-900 px-2 py-1 font-mono text-xs outline-none ring-1
            ${disabled
              ? 'cursor-not-allowed text-slate-500 ring-slate-800'
              : 'text-slate-100 ring-slate-700 focus:ring-indigo-500'
            }`}
        />
      </div>
      <span className="shrink-0 rounded bg-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
        {TYPE_LABEL[item.type] || item.type}
      </span>
      <ConflictIcon status={conflictStatus} />
    </div>
  )
}

function ConflictIcon({ status }) {
  if (status === 'checking') return <Loader2 className="h-4 w-4 animate-spin text-slate-500" aria-label="Checking target" />
  if (status === 'clear') return <Check className="h-4 w-4 text-emerald-500" aria-label="Clear" />
  if (status === 'conflict') return <AlertCircle className="h-4 w-4 text-red-500" aria-label="Conflict" />
  if (status === 'unchecked') return <AlertCircle className="h-4 w-4 text-amber-500" aria-label="Unchecked" />
  return null
}
