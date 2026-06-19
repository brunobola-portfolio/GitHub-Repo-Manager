// src/components/MigrationWizard/steps/RepoSelectStep/riskRules.js

export const RESERVED_NAMES = [
  '.git', '.github', 'www', 'api',
  'settings', 'login', 'logout',
  'admin', 'sponsors', 'topics',
]

// Azure DevOps GitRepository.size is reported in bytes.
const GB_IN_BYTES = 1024 * 1024 * 1024
export const SIZE_CRITICAL_BYTES = 10 * GB_IN_BYTES
const SIZE_WARN_BYTES = 5 * GB_IN_BYTES
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
    if (repo.size <= SIZE_WARN_BYTES || repo.size > SIZE_CRITICAL_BYTES) return null
    return {
      type: 'size-warning',
      severity: 'warning',
      message: 'Repository size exceeds 5 GB.',
      suggestion: 'Clone/push may take a while. Consider LFS for binaries.',
    }
  },
  function ruleSizeCritical(repo) {
    if (repo.size <= SIZE_CRITICAL_BYTES) return null
    // User has acknowledged the size and chosen a mitigation in the Fix
    // issues drawer (lfs-migrate or exclude); no longer a blocker.
    if (repo.sizeStrategy) return null
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
    // Resolved-by-replace: keep it visible but non-blocking so the user can
    // advance, with an Undo escape hatch. The destructive intent is carried by
    // repo.conflictAction === 'replace' all the way to the importer.
    if (repo.conflictAction === 'replace') {
      return {
        type: 'will-replace',
        severity: 'info',
        message: 'Will replace (delete) the existing repo',
        suggestion: 'The existing repo on GitHub will be deleted and recreated from the source.',
        actions: [{ id: 'undo-replace', label: 'Undo' }],
      }
    }
    return {
      type: 'name-conflict',
      severity: 'blocker',
      message: `A repository named "${name}" already exists in ${ctx.targetOrg || 'the target org'}.`,
      suggestion: 'Resolve it here: Replace (delete & recreate), Rename, or Skip.',
      actions: [
        { id: 'replace', label: 'Replace' },
        { id: 'rename', label: 'Rename' },
        { id: 'skip', label: 'Skip' },
      ],
    }
  },
  function ruleEmptyTargetReuse(repo, ctx) {
    const name = effectiveName(repo)
    const detail = ctx.conflictDetails?.[name]
    // Only surface when target exists AND is empty — that's the "reuse"
    // path the import-service falls through to. If the conflict rule above
    // already fired (non-empty target), this stays silent to avoid noise.
    if (!detail?.exists || !detail.empty) return null
    return {
      type: 'empty-target-reuse',
      severity: 'info',
      message: `Will push into existing empty repo in ${ctx.targetOrg || 'the target org'}.`,
      suggestion: 'GitHub already has a repo with this name but it has no commits — the migration will reuse it instead of creating a new one.',
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
