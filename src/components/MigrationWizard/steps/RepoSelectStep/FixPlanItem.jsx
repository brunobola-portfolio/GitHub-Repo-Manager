// src/components/MigrationWizard/steps/RepoSelectStep/FixPlanItem.jsx
import { ArrowRight, Check, AlertCircle, Loader2 } from 'lucide-react'
import { Spinner } from '../../../ui/Spinner'
import { Input, Checkbox } from '../../../ui/form'

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
        ${disabled ? 'border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-950/10' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/40'}`}
    >
      <Checkbox
        checked={checked && !disabled}
        disabled={disabled}
        onChange={(e) => onToggle(item, e.target.checked)}
        aria-label={`Apply fix for ${item.from}`}
      />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-slate-500 line-through dark:text-slate-400">{item.from}</span>
        <ArrowRight className="h-3 w-3 shrink-0 text-slate-500" />
        <div className="min-w-0 flex-1">
          <Input
            type="text"
            size="sm"
            value={item.to}
            onChange={(e) => onEdit(item, e.target.value)}
            disabled={disabled}
            aria-label={`Rename target for ${item.from}`}
            className="font-mono text-xs"
          />
        </div>
      </div>
      <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 ds-text-micro uppercase tracking-wide text-slate-600 dark:bg-slate-700 dark:text-slate-300">
        {TYPE_LABEL[item.type] || item.type}
      </span>
      <ConflictIcon status={conflictStatus} />
    </div>
  )
}

function ConflictIcon({ status }) {
  if (status === 'checking') return <Spinner size="md" tone="muted" label="Checking target" />
  if (status === 'clear') return <Check className="h-4 w-4 text-emerald-500" aria-label="Clear" />
  if (status === 'conflict') return <AlertCircle className="h-4 w-4 text-rose-500" aria-label="Conflict" />
  if (status === 'unchecked') return <AlertCircle className="h-4 w-4 text-amber-500" aria-label="Unchecked" />
  return null
}
