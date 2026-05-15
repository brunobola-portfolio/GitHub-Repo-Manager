import { useState, useRef, useEffect } from 'react'
import { Sparkles, ChevronDown, Zap, Clock, XCircle, Archive, AlertOctagon, Pencil } from 'lucide-react'
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
  const menuRef = useRef(null)
  const triggerRef = useRef(null)

  // Outside click closes menu.
  useEffect(() => {
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    if (open) document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  // Keyboard: Esc closes, ArrowUp/Down navigate between menuitems.
  useEffect(() => {
    if (!open) return
    const menu = menuRef.current
    if (!menu) return
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]'))
    // Focus first item on open.
    items[0]?.focus()
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
        return
      }
      const currentIdx = items.indexOf(document.activeElement)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        items[(currentIdx + 1) % items.length]?.focus()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        items[(currentIdx - 1 + items.length) % items.length]?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const apply = (preset) => {
    const selected = new Set(repos.filter(preset.predicate).map((r) => r.id))
    onSelect(selected, preset.mode)
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
          bg-indigo-600 dark:bg-indigo-500 text-white shadow-md
          hover:shadow-lg transition-all"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
        Smart Select
        <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Smart selection presets"
          className="absolute right-0 mt-1 w-64 rounded-xl bg-white dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-800 shadow-xl z-20"
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
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none focus:bg-slate-100 dark:focus:bg-slate-800"
                  >
                    <Icon className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" aria-hidden="true" />
                    <span className="flex-1">{p.label}</span>
                    <span className="text-[11px] text-slate-500 tabular-nums">{count}</span>
                  </button>
                </li>
              )
            })}
            <li className="my-1 border-t border-slate-200 dark:border-slate-800" />
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={() => { setPatternOpen(true); setOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none focus:bg-slate-100 dark:focus:bg-slate-800"
              >
                <Pencil className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" aria-hidden="true" />
                Select by pattern…
              </button>
            </li>
          </ul>
        </div>
      )}
      {patternOpen && (
        <PatternSelectModal
          repos={repos}
          onConfirm={(ids) => { onSelect(new Set(ids)); setPatternOpen(false); triggerRef.current?.focus() }}
          onClose={() => { setPatternOpen(false); triggerRef.current?.focus() }}
        />
      )}
    </div>
  )
}
