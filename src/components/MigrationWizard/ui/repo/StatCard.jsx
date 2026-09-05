import { Card } from '../../../ui/Card'

const TONE_MAP = {
  indigo:  'text-brand-400',
  violet:  'text-brand-400',
  cyan:    'text-brand-400',
  emerald: 'text-emerald-400',
  amber:   'text-amber-400',
  orange:  'text-amber-400',
  red:     'text-rose-400',
  slate:   'text-slate-400',
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
      <div className={`text-xl font-bold ${toneClass} tabular-nums`}>{value}</div>
      <div className="ds-eyebrow text-slate-500 mt-0.5">
        {label}
      </div>
    </Card>
  )
}
