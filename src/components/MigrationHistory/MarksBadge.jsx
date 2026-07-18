import { motion } from 'framer-motion'

const VARIANTS = {
  ok: {
    cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
    label: 'all migration marks written',
    icon: '✓'
  },
  partial: {
    cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
    label: 'some migration marks skipped',
    icon: '⚠'
  },
  failed: {
    cls: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
    label: 'migration marks failed',
    icon: '✗'
  },
  none: {
    cls: 'bg-slate-500/10 text-slate-400 ring-slate-500/20',
    label: 'no migration marks',
    icon: '—'
  }
}

function pickVariant(marks) {
  if (!marks.length) return 'none'
  if (marks.some(m => m.status === 'failed')) return 'failed'
  if (marks.some(m => m.status === 'skipped')) return 'partial'
  return 'ok'
}

function summary(marks) {
  if (!marks.length) return 'No tags'
  const w = marks.filter(m => m.status === 'written').length
  return `${w}/${marks.length}`
}

export function MarksBadge({ marks = [], onClick }) {
  const variant = pickVariant(marks)
  const v = VARIANTS[variant]
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={v.label}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${v.cls} transition-colors`}
    >
      <span aria-hidden>{v.icon}</span>
      <span>{summary(marks)}</span>
    </motion.button>
  )
}
