// src/components/MigrationWizard/steps/RepoSelectStep/autoFixRules.js
import { RESERVED_NAMES } from './riskRules.js'

const VALID_NAME_RE = /^[A-Za-z0-9._-]+$/
const INVALID_RUN_RE = /[^A-Za-z0-9._-]+/g

export function fixInvalidChars(repo) {
  const name = repo.name
  if (VALID_NAME_RE.test(name)) return null
  const collapsed = name.replace(INVALID_RUN_RE, '-')
  // Strip both ends only when the result opens with a hyphen (the original
  // name started with an invalid char); otherwise the trailing hyphen is
  // intentional output (e.g. "my repo!" → "my-repo-").
  // For all-invalid names like '!!!', the collapsed form is '-' or '--' which
  // is not a valid GitHub repo name. The UI validates `to` before apply, so
  // the user sees an inline error rather than a broken push.
  const to = collapsed.startsWith('-')
    ? collapsed.replace(/^-+/, '').replace(/-+$/, '') || collapsed
    : collapsed
  return {
    type: 'invalid-chars',
    from: name,
    to,
    reason: 'Replaced characters GitHub does not accept.',
  }
}

export function fixReserved(repo) {
  if (!RESERVED_NAMES.includes(repo.name.toLowerCase())) return null
  return {
    type: 'reserved-name',
    from: repo.name,
    to: `${repo.name}-repo`,
    reason: 'GitHub reserves this name; added "-repo" suffix.',
  }
}

export function fixDuplicates(repo, ctx) {
  if (!repo.selected) return null
  const selected = (ctx.allRepos || []).filter((r) => r.selected)
  const sameName = selected.filter((r) => r.name === repo.name)
  if (sameName.length < 2) return null
  const position = sameName.findIndex((r) => r.id === repo.id)
  if (position <= 0) return null
  return {
    type: 'duplicate-in-batch',
    from: repo.name,
    to: `${repo.name}-${position}`,
    reason: 'Numeric suffix applied to avoid collision with another selected repo.',
  }
}

export function fixNameConflict(repo, ctx) {
  if (!ctx.conflicts?.[repo.name]) return null
  const prefix = ctx.azureProject || 'proj'
  return {
    type: 'name-conflict',
    from: repo.name,
    to: `${prefix}-${repo.name}`,
    reason: 'Prefixed with Azure project name to avoid target-org collision.',
  }
}

const ORDERED_FIXES = [fixInvalidChars, fixReserved, fixNameConflict, fixDuplicates]

export function buildDeterministicPlan(repos, ctx) {
  const plan = []
  for (let i = 0; i < repos.length; i++) {
    const repo = repos[i]
    for (const fn of ORDERED_FIXES) {
      const result = fn(repo, ctx)
      if (result) {
        plan.push({ repoIndex: i, ...result })
        // Single fix per repo: the risk engine re-evaluates after apply, so a repo
        // that matches multiple rules (e.g. '!api' → invalid + reserved) resurfaces
        // its remaining issue on the next drawer open.
        break
      }
    }
  }
  return plan
}
