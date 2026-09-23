import { Card } from '../../../ui/Card'

// 400-level tones on a near-white tile measured 1.7:1 (amber) to 3.0:1
// (brand) in light mode — below AA for text. 700 in light, 400 in dark.
const TONE_MAP = {
  indigo:  'text-brand-700 dark:text-brand-400',
  violet:  'text-brand-700 dark:text-brand-400',
  cyan:    'text-brand-700 dark:text-brand-400',
  emerald: 'text-emerald-700 dark:text-emerald-400',
  amber:   'text-amber-700 dark:text-amber-400',
  orange:  'text-amber-700 dark:text-amber-400',
  red:     'text-rose-700 dark:text-rose-400',
  slate:   'text-slate-500 dark:text-slate-400',
}

export function StatCard({ icon: Icon, label, value, tone = 'indigo' }) {
  const toneClass = TONE_MAP[tone] || TONE_MAP.indigo
  return (
    <Card shadow="none" className="rounded-xl px-4 py-3 text-center bg-white/60 dark:bg-slate-900/50 border-0">
      {Icon && (
        <div className="flex justify-center mb-1">
          <Icon className={`w-4 h-4 ${toneClass}`} aria-hidden="true" />
        </div>
      )}
      <div className={`text-xl font-bold ${toneClass} tabular-nums truncate`}>{value}</div>
      <div className="ds-eyebrow text-slate-500 dark:text-slate-400 mt-0.5 truncate">
        {label}
      </div>
    </Card>
  )
}
