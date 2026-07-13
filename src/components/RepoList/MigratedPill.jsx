import { Badge } from '../ui/Badge'
import { useMigratedRepos } from '../../hooks/useMigratedRepos.js'

/**
 * Premium pill rendered next to a repo's name when the repo carries any
 * migration mark. Tooltip surfaces date for at-a-glance provenance. Renders
 * nothing while loading or when the repo isn't migrated.
 *
 * Reads from the shared {@link useMigratedRepos} batch (one request for the
 * whole grid) instead of fetching per card — fixes the prior N+1.
 *
 * Renders via the canonical <Badge> (tone="violet") instead of hand-rolling
 * the tone+ring combination, so it inherits Badge's AA-contrast palette.
 */
export function MigratedPill({ fullName }) {
  const { get, loading } = useMigratedRepos()
  const entry = get(fullName)
  if (loading || !entry) return null

  const date = entry.writtenAt ? entry.writtenAt.slice(0, 10) : null

  return (
    <Badge
      tone="violet"
      size="xs"
      ring
      icon={<span aria-hidden>✦</span>}
      title={`Migrated${date ? ` on ${date}` : ''}`}
      aria-label="repo migrated"
      className="uppercase tracking-wider"
    >
      migrated
    </Badge>
  )
}
