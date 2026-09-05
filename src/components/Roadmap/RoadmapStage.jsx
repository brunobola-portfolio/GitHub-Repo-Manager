import { motion } from 'framer-motion'
import { EASE, DURATION } from '../ui/motion'
import { RoadmapItem } from './RoadmapItem'

const STAGE_STYLES = {
  next: {
    header: 'bg-amber-500/10 dark:bg-amber-500/15 border-amber-500/20',
    dot: 'bg-amber-500',
    badge: 'text-amber-700 dark:text-amber-400',
    label: 'Next',
    period: 'Q3 2026',
  },
  later: {
    header: 'bg-blue-500/10 dark:bg-blue-500/15 border-blue-500/20',
    dot: 'bg-blue-500',
    badge: 'text-blue-700 dark:text-blue-400',
    label: 'Later',
    period: 'Q4 2026+',
  },
  shipped: {
    header: 'bg-brand-500/10 dark:bg-brand-500/15 border-brand-500/20',
    dot: 'bg-brand-500',
    badge: 'text-brand-700 dark:text-[color:var(--ds-accent-brand-dark)]',
    label: 'Recently Shipped',
    period: 'May–July 2026',
  },
}

export function RoadmapStage({ stage, items, index = 0 }) {
  const style = STAGE_STYLES[stage] || STAGE_STYLES.later

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: DURATION.ambient, delay: index * 0.1, ease: EASE.emphasized }}
      className="flex flex-col"
    >
      {/* Stage header */}
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border mb-4 ${style.header}`}>
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${style.dot}`} />
        <div className="flex-1 min-w-0">
          <span className={`text-sm font-bold ${style.badge}`}>{style.label}</span>
          <span className="ml-2 text-xs text-slate-500 dark:text-slate-400 font-medium">{style.period}</span>
        </div>
      </div>

      {/* Items */}
      <div className="flex flex-col gap-3">
        {items.map((item, i) => (
          <RoadmapItem
            key={item.title}
            title={item.title}
            description={item.description}
            tier={item.tier}
            index={i}
          />
        ))}
      </div>
    </motion.div>
  )
}
