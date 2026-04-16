import { useState, useRef, useEffect } from 'react'
import { Sparkles, ChevronDown, Zap, Clock, XCircle, Archive, AlertOctagon, Pencil, Save } from 'lucide-react'
import { PatternSelectModal } from './PatternSelectModal'

const PRESETS = [
  { id: 'recommended', icon: Zap,         label: 'Recommended',          predicate: (r) => r.risk?.level === 'ok' && !r.isDisabled },
  { id: 'active-1y',   icon: Clock,       label: 'Active in last year',  predicate: (r) => {
      if (!r.lastCommitDate) return false
      return (Date.now() - new Date(r.lastCommitDate).getTime()) < 365 * 86400_000
    } },
  { id: 'excl-arch',   icon: Archive,     label: 'Exclude archived',     predicate: (r) => !r.isDisabled, mode: 'exclude' },
  { id: 'excl-stale',  icon: XCircle,     label: 'Exclude stale',        predicate: (r) => !(r.risk?.flags || []).some((f) => f.type === 'stale'), mode: 'exclude' },
  { id: 'excl-block',  icon: AlertOctagon,label: 'Exclude blockers',     predicate: (r) => r.risk?.level !== 'blocker', mode: 'exclude' },
]

export function SmartSelectMenu({ repos, onSelect }) {
  const [open, setOpen] = useState(false)
  const [patternOpen, setPatternOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    if (open) document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  const apply = (preset) => {
    const selected = new Set(repos.filter(preset.predicate).map((r) => r.id))
    onSelect(selected, preset.mode)
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
          bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-md shadow-indigo-500/25
          hover:shadow-lg transition-all"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Sparkles className="w-3.5 h-3.5" />
        Smart Select
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-64 rounded-xl bg-slate-900/95 backdrop-blur-xl border border-slate-800 shadow-xl z-20"
        >
          <ul className="py-1">
            {PRESETS.map((p) => {
              const count = repos.filter(p.predicate).length
              const Icon = p.icon
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => apply(p)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
                  >
                    <Icon className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="flex-1">{p.label}</span>
                    <span className="text-[11px] text-slate-500 tabular-nums">{count}</span>
                  </button>
                </li>
              )
            })}
            <li className="my-1 border-t border-slate-800" />
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={() => { setPatternOpen(true); setOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
              >
                <Pencil className="w-3.5 h-3.5 text-indigo-400" />
                Select by pattern…
              </button>
            </li>
            <li>
              <button
                type="button"
                role="menuitem"
                disabled
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-slate-500 opacity-50 cursor-not-allowed"
                title="Coming soon"
              >
                <Save className="w-3.5 h-3.5" />
                Save as preset… (soon)
              </button>
            </li>
          </ul>
        </div>
      )}
      {patternOpen && (
        <PatternSelectModal
          repos={repos}
          onConfirm={(ids) => { onSelect(new Set(ids)); setPatternOpen(false) }}
          onClose={() => setPatternOpen(false)}
        />
      )}
    </div>
  )
}
