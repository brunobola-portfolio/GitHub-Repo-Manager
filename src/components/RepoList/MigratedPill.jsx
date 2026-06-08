import { useMigratedRepos } from '../../hooks/useMigratedRepos.js'

/**
 * Premium pill rendered next to a repo's name when the repo carries any
 * migration mark. Tooltip surfaces date for at-a-glance provenance. Renders
 * nothing while loading or when the repo isn't migrated.
 *
 * Reads from the shared {@link useMigratedRepos} batch (one request for the
 * whole grid) instead of fetching per card — fixes the prior N+1.
 */
export function MigratedPill({ fullName }) {
  const { get, loading } = useMigratedRepos()
  const entry = get(fullName)
  if (loading || !entry) return null

  const date = entry.writtenAt ? entry.writtenAt.slice(0, 10) : null

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
