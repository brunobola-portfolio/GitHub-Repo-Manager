import { CheckCircle2 } from 'lucide-react'

/**
 * Selectable credential card used inside the SourceStep credentials list.
 * Renders icon, label, status chip ("Configured" / "Not configured"),
 * and optional children when active or when the card is not selectable.
 */
export default function CredCard({ mode, icon: Icon, label, subtitle, available, active, onSelect, children, extra }) {
  const selectable = available !== false
  return (
    <div
      onClick={() => selectable && onSelect(mode)}
      className={`rounded-xl border p-4 transition-all
        ${selectable ? 'cursor-pointer' : 'cursor-default opacity-60'}
        ${active && selectable
          ? 'border-indigo-400 dark:border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}
      `}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 shrink-0">
          <Icon className="w-4 h-4 text-slate-600 dark:text-slate-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{label}</span>
            {available === true && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">Configured</span>
            )}
            {available === false && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">Not configured</span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
          {extra && <div className="mt-0.5">{extra}</div>}
        </div>
        {active && selectable && <CheckCircle2 className="w-4 h-4 text-indigo-500 shrink-0" />}
      </div>
      {(!selectable || active) && children && (
        <div className="mt-3">{children}</div>
      )}
    </div>
  )
}
