import { useMigrationMarksFor } from '../../hooks/useMigrationMarks.js'

/**
 * Premium pill rendered next to a repo's name when the repo carries any
 * migration mark. Tooltip surfaces date + source for at-a-glance provenance.
 * Renders nothing while loading or when there are no marks.
 */
export function MigratedPill({ fullName }) {
  const { marks, loading } = useMigrationMarksFor(fullName)
  if (loading || !marks.length) return null

  const writtenAt = marks.find(m => m.status === 'written')?.written_at
  const date = writtenAt ? writtenAt.slice(0, 10) : null

  return (
    <span
      title={`Migrated${date ? ` on ${date}` : ''}`}
      aria-label="repo migrated"
      className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-1 ring-inset ring-violet-500/30 px-2 py-0.5 ds-text-micro font-medium uppercase tracking-wider"
    >
      <span aria-hidden>✦</span>migrated
    </span>
  )
}
