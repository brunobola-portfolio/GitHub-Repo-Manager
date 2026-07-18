import { AlertOctagon, AlertTriangle, Info } from 'lucide-react'

// Light-first classes + dark: variants — the -400 text weights read fine on a
// dark surface but are materially lower contrast on a white light-mode card.
// Matches the app's own convention used one file over in SummaryStep's LFS
// pills (`text-red-600 dark:text-red-400`, `text-amber-600 dark:text-amber-400`).
const LEVEL_STYLE = {
  blocker: {
    icon: AlertOctagon,
    cls:  'bg-red-50 text-red-600 border-red-300 dark:bg-red-500/15 dark:text-red-400 dark:border-red-500/30',
    aria: 'blocker',
  },
  warning: {
    icon: AlertTriangle,
    cls:  'bg-amber-50 text-amber-600 border-amber-300 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/30',
    aria: 'warning',
  },
  info: {
    icon: Info,
    cls:  'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-500/15 dark:text-slate-400 dark:border-slate-500/30',
    aria: 'info',
  },
}

export function RiskBadge({ level, flags, size = 'sm', onClick }) {
  if (level === 'ok') return null
  const style = LEVEL_STYLE[level]
  if (!style) return null
  const Icon = style.icon
  const count = flags?.length || 0
  const label = `${count} ${style.aria}${count === 1 ? '' : 's'}`
  const padding = size === 'sm' ? 'px-1.5 py-0.5 ds-text-micro' : 'px-2 py-1 text-xs'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`inline-flex items-center gap-1 ${padding} rounded border font-medium ${style.cls}`}
    >
      <Icon className="w-3 h-3" aria-hidden="true" />
      {count > 0 && <span>{count}</span>}
    </button>
  )
}
