// src/components/MigrationWizard/steps/RepoSelectStep/riskRules.js

export const RESERVED_NAMES = [
  '.git', '.github', 'www', 'api',
  'settings', 'login', 'logout',
  'admin', 'sponsors', 'topics',
]

const GB_IN_KB = 1024 * 1024
const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000
const VALID_NAME_RE = /^[A-Za-z0-9._-]+$/

function effectiveName(repo) {
  return (repo.targetName && repo.targetName.trim()) || repo.name
}

const rules = [
  function ruleArchived(repo) {
    if (!repo.isDisabled) return null
    return {
      type: 'archived',
      severity: 'info',
      message: 'Repository is archived/disabled in Azure DevOps.',
      suggestion: 'Consider excluding — migrated archives rarely see traffic.',
    }
  },
  function ruleStale(repo) {
    if (!repo.lastCommitDate) return null
    const age = Date.now() - new Date(repo.lastCommitDate).getTime()
    if (age < TWO_YEARS_MS) return null
    return {
      type: 'stale',
      severity: 'info',
      message: 'No commits in the last 2 years.',
      suggestion: 'Likely a candidate to exclude from active migration.',
    }
  },
  function ruleEmpty(repo) {
    if (repo.size !== 0 || repo.branches !== 0 || repo.isTfvc) return null
    return {
      type: 'empty',
      severity: 'info',
      message: 'Repository is empty.',
      suggestion: 'Migration will create an empty repo on GitHub.',
    }
  },
  function ruleSizeWarning(repo) {
    if (repo.size <= 5 * GB_IN_KB || repo.size > 10 * GB_IN_KB) return null
    return {
      type: 'size-warning',
      severity: 'warning',
      message: 'Repository size exceeds 5 GB.',
      suggestion: 'Clone/push may take a while. Consider LFS for binaries.',
    }
  },
  function ruleSizeCritical(repo) {
    if (repo.size <= 10 * GB_IN_KB) return null
    return {
      type: 'size-critical',
      severity: 'blocker',
      message: 'Repository size exceeds 10 GB.',
      suggestion: 'GitHub may reject pushes over 10 GB. Split history or migrate LFS first.',
    }
  },
  function ruleLfsSuggested(repo) {
    if (!repo.hasLfsMarker || repo.lfsEnabled) return null
    return {
      type: 'lfs-suggested',
      severity: 'warning',
      message: 'LFS markers detected in .gitattributes.',
      suggestion: 'Enable LFS on target to preserve large-file pointers.',
    }
  },
  function ruleNameConflict(repo, ctx) {
    const name = effectiveName(repo)
    if (!ctx.conflicts?.[name]) return null
    return {
      type: 'name-conflict',
      severity: 'blocker',
      message: `A repository named "${name}" already exists in ${ctx.targetOrg || 'the target org'}.`,
      suggestion: 'The Configure step lets you rename or skip this repo before migration.',
      // No inline actions: the Configure step owns rename/skip. Showing
      // buttons here without wiring them would be a broken affordance.
    }
  },
  function ruleDuplicateInBatch(repo, ctx) {
    // Only flag when THIS repo is selected AND another selected repo shares
    // its name. Two unselected repos with the same name is not a blocker —
    // they won't both be migrated.
    if (!repo.selected) return null
    const name = effectiveName(repo)
    const dupes = (ctx.allRepos || []).filter((r) => r.selected && effectiveName(r) === name)
    if (dupes.length < 2) return null
    return {
      type: 'duplicate-in-batch',
      severity: 'blocker',
      message: 'Another selected item has the same target name.',
      suggestion: 'Rename one on the Configure step.',
    }
  },
  function ruleInvalidChars(repo) {
    const name = effectiveName(repo)
    if (VALID_NAME_RE.test(name)) return null
    return {
      type: 'invalid-chars',
      severity: 'blocker',
      message: 'Name contains characters GitHub does not accept.',
      suggestion: 'Only letters, numbers, dots, hyphens and underscores are allowed.',
    }
  },
  function ruleReservedName(repo) {
    const name = effectiveName(repo)
    if (!RESERVED_NAMES.includes(name.toLowerCase())) return null
    return {
      type: 'reserved-name',
      severity: 'blocker',
      message: 'Name is reserved by GitHub.',
      suggestion: `Choose a different target name (${name} is a GitHub-reserved path).`,
    }
  },
]

export function evaluateRepo(repo, ctx) {
  const flags = rules
    .map((rule) => rule(repo, ctx))
    .filter(Boolean)
  const level = flags.some((f) => f.severity === 'blocker') ? 'blocker'
              : flags.some((f) => f.severity === 'warning') ? 'warning'
              : flags.some((f) => f.severity === 'info')    ? 'info'
              : 'ok'
  return { level, flags }
}

export function aggregateRisk(repos) {
  let blockers = 0, warnings = 0, infos = 0
  for (const r of repos) {
    for (const f of r.risk?.flags || []) {
      if (f.severity === 'blocker') blockers++
      else if (f.severity === 'warning') warnings++
      else if (f.severity === 'info') infos++
    }
  }
  return { blockers, warnings, infos }
}
