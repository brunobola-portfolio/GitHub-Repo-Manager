import { CheckCircle2, Dot } from 'lucide-react'

/**
 * Selectable credential card with clear state semantics.
 *
 * State model (explicit, never ambiguous):
 *   - "active"      → currently selected AND ready to authenticate (big "EM USO" pill)
 *   - "selected"    → selected but not yet ready (missing PAT, OAuth pending, …)
 *   - "available"   → not selected, but configuration is present and could be used
 *   - "unavailable" → cannot be used right now (not configured server-side, etc.)
 *
 * The previous version showed an ambiguous "Configured" pill on every card
 * that had ANY config — making it impossible to tell which one was actually
 * being used at any moment. This version makes the active card visually
 * dominant and labels the others with their precise state.
 */
export default function CredCard({
  mode, icon: Icon, label, subtitle,
  state,            // 'active' | 'selected' | 'available' | 'unavailable'
  hint,             // optional one-line status detail (e.g. "AZURE_PAT detected in .env")
  onSelect,
  children,
}) {
  const selectable = state !== 'unavailable'
  const isPicked = state === 'active' || state === 'selected'
  const handleSelect = () => { if (selectable) onSelect(mode) }
  const tone = toneFor(state)

  return (
    /* eslint-disable jsx-a11y/no-static-element-interactions, jsx-a11y/no-noninteractive-tabindex */
    <div
      role={selectable ? 'button' : undefined}
      tabIndex={selectable ? 0 : undefined}
      aria-pressed={selectable && isPicked ? 'true' : undefined}
      onClick={handleSelect}
      onKeyDown={(e) => {
        if (!selectable) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleSelect()
        }
      }}
      className={`rounded-xl border p-4 transition-all
        ${selectable ? 'cursor-pointer ds-focus-ring' : 'cursor-default opacity-70'}
        ${tone.container}
      `}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className={`p-2 rounded-lg shrink-0 ${tone.iconBg}`}>
          <Icon className={`w-4 h-4 ${tone.iconText}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</span>
            <StatePill state={state} />
          </div>
          {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
          {hint && (
            <p className={`text-xs mt-1 inline-flex items-center gap-1 ${tone.hintText}`}>
              <Dot className="w-3 h-3 -ml-1" /> {hint}
            </p>
          )}
        </div>
        {state === 'active' && (
          <CheckCircle2 className="w-5 h-5 text-emerald-500 dark:text-emerald-400 shrink-0" />
        )}
      </div>
      {/* Show children when the card is picked OR when it's unavailable (to expose setup instructions). */}
      {(isPicked || state === 'unavailable') && children && (
        <div className="mt-3 pt-3 border-t border-slate-200/70 dark:border-slate-700/50">
          {children}
        </div>
      )}
    </div>
  )
}

function StatePill({ state }) {
  const map = {
    active:      { label: 'EM USO',           cls: 'bg-emerald-500 text-white' },
    selected:    { label: 'seleccionado',     cls: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300' },
    available:   { label: 'disponível',       cls: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400' },
    unavailable: { label: 'não configurado',  cls: 'bg-slate-100 dark:bg-slate-800 text-slate-500' },
  }
  const v = map[state]
  if (!v) return null
  return (
    <span className={`ds-text-micro uppercase tracking-wider px-1.5 py-0.5 rounded-md font-semibold ${v.cls}`}>
      {v.label}
    </span>
  )
}

function toneFor(state) {
  switch (state) {
    case 'active':
      return {
        container: 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/70 dark:bg-emerald-900/15 ring-1 ring-emerald-200/50 dark:ring-emerald-800/40',
        iconBg: 'bg-emerald-100 dark:bg-emerald-900/40',
        iconText: 'text-emerald-600 dark:text-emerald-400',
        hintText: 'text-emerald-700 dark:text-emerald-300',
      }
    case 'selected':
      return {
        container: 'border-indigo-300 dark:border-indigo-700 bg-indigo-50/60 dark:bg-indigo-900/15',
        iconBg: 'bg-indigo-100 dark:bg-indigo-900/40',
        iconText: 'text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]',
        hintText: 'text-indigo-700 dark:text-indigo-300',
      }
    case 'available':
      return {
        container: 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600',
        iconBg: 'bg-slate-100 dark:bg-slate-800',
        iconText: 'text-slate-600 dark:text-slate-300',
        hintText: 'text-slate-500 dark:text-slate-400',
      }
    default: // unavailable
      return {
        container: 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30',
        iconBg: 'bg-slate-100 dark:bg-slate-800',
        iconText: 'text-slate-400 dark:text-slate-500',
        hintText: 'text-slate-400 dark:text-slate-500',
      }
  }
}
