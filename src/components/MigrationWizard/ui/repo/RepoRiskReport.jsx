import { AlertOctagon, AlertTriangle, Info } from 'lucide-react'

const TONE = {
  blocker: { Icon: AlertOctagon,  bg: 'bg-red-500/10 border-red-500/30 text-red-400' },
  warning: { Icon: AlertTriangle, bg: 'bg-amber-500/10 border-amber-500/30 text-amber-400' },
  info:    { Icon: Info,          bg: 'bg-slate-500/10 border-slate-500/30 text-slate-400' },
}

export function RepoRiskReport({ flags, onAction }) {
  if (!flags?.length) return <p className="text-xs text-emerald-500">No issues detected.</p>
  return (
    <ul className="space-y-2">
      {flags.map((f) => {
        const t = TONE[f.severity] || TONE.info
        const Icon = t.Icon
        return (
          <li key={f.type} className={`p-3 rounded-lg border ${t.bg}`}>
            <div className="flex items-start gap-2">
              <Icon className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold">{f.message}</p>
                {f.suggestion && <p className="text-xs opacity-80 mt-1">{f.suggestion}</p>}
                {f.actions?.length > 0 && onAction && (
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {f.actions.map((a) => (
                      a.href ? (
                        <a
                          key={a.id}
                          href={a.href} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded bg-slate-800 text-slate-200 hover:bg-slate-700"
                        >
                          {a.label}
                        </a>
                      ) : (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => onAction(a.id)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded bg-slate-800 text-slate-200 hover:bg-slate-700"
                        >
                          {a.label}
                        </button>
                      )
                    ))}
                  </div>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
