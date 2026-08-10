import { motion } from 'framer-motion'
import { Sparkles, Calendar, GitBranch, Cloud } from 'lucide-react'
import { useMigrationMarksFor } from '../../hooks/useMigrationMarks.js'

/**
 * "Migration provenance" card surfaced on the RepoDetail Overview when the
 * repo has any migration marks. Renders nothing for non-migrated repos so
 * the overview stays uncluttered.
 */
export function MigrationProvenanceCard({ fullName }) {
  const { marks, loading } = useMigrationMarksFor(fullName)
  if (loading || !marks.length) return null

  const writtenMarks = marks.filter(m => m.status === 'written')
  const planId = marks[0]?.plan_id
  const writtenAt = writtenMarks[0]?.written_at
  const date = writtenAt ? writtenAt.slice(0, 10) : '—'
  const sourceMark = marks.find(m => m.target_kind === 'azure-project-property')
  const tagMark = marks.find(m => m.target_kind === 'git-annotated-tag')

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-5 border border-brand-200/60 dark:border-brand-500/20 bg-gradient-to-br from-brand-50/80 to-brand-50/40 dark:from-brand-950/30 dark:to-brand-950/20"
      aria-label="Migration provenance"
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-flex p-1.5 rounded-lg bg-brand-500/15 text-brand-600 dark:text-brand-300">
          <Sparkles className="w-3.5 h-3.5" aria-hidden />
        </span>
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Migration provenance
        </h3>
        <span className="ml-auto text-xs text-slate-500 dark:text-slate-400 ds-font-mono">
          plan #{planId}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
          <Calendar className="w-3 h-3" aria-hidden /> Date
        </dt>
        <dd className="text-slate-900 dark:text-slate-100 ds-font-mono">{date}</dd>

        <dt className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
          <Sparkles className="w-3 h-3" aria-hidden /> Marks
        </dt>
        <dd className="text-slate-900 dark:text-slate-100">
          {writtenMarks.length} / {marks.length} written
        </dd>

        {sourceMark && (
          <>
            <dt className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <Cloud className="w-3 h-3" aria-hidden /> Source
            </dt>
            <dd className="text-slate-900 dark:text-slate-100 ds-font-mono truncate" title={sourceMark.target_id}>
              {sourceMark.target_id}
            </dd>
          </>
        )}

        {tagMark && (
          <>
            <dt className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <GitBranch className="w-3 h-3" aria-hidden /> Git tag
            </dt>
            <dd className="text-slate-900 dark:text-slate-100 ds-font-mono truncate" title={tagMark.target_id}>
              {tagMark.target_id}
            </dd>
          </>
        )}
      </dl>
    </motion.section>
  )
}
