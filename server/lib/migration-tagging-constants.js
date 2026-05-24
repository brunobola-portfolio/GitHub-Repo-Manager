// Single source of truth for migration-tagging naming, enums, and policy
// defaults. Pure functions only — no I/O. Consumed by tagging service,
// writers, routes, and the frontend (mirrored via shared JSON if needed).
import crypto from 'crypto'

export const SCOPES = Object.freeze({
  SOURCE: 'source',
  DESTINATION: 'destination',
  GIT_TAG: 'git-tag'
})

export const TARGET_KINDS = Object.freeze({
  GITHUB_TOPIC: 'github-topic',
  GITHUB_DESCRIPTION: 'github-description',
  GITHUB_CUSTOM_PROPERTY: 'github-custom-property',
  AZURE_PROJECT_PROPERTY: 'azure-project-property',
  AZURE_REPO_DESCRIPTION: 'azure-repo-description',
  GIT_ANNOTATED_TAG: 'git-annotated-tag'
})

export const STATUS = Object.freeze({
  PENDING: 'pending',
  WRITTEN: 'written',
  SKIPPED: 'skipped',
  FAILED: 'failed'
})

export const SKIP_REASONS = Object.freeze({
  POLICY_DISABLED: 'policy-disabled',
  PAT_SCOPE_MISSING: 'pat-scope-missing',
  TOPIC_LIMIT_REACHED: 'topic-limit-reached',
  PERSONAL_ACCOUNT_NO_PROPS: 'personal-account-no-props',
  UNSUPPORTED_SOURCE_TYPE: 'unsupported-source-type',
  ORG_POLICY_BLOCKS_CUSTOM_PROPS: 'org-policy-blocks-custom-props'
})

export const DEFAULT_POLICY = Object.freeze({
  enabled: true,
  writeSource: true,
  writeDestination: true,
  writeGitTag: true,
  hideSourceName: false
})

export const GITHUB_MAX_TOPICS = 20
export const GITHUB_MAX_TOPIC_LEN = 50
export const DESCRIPTION_SUFFIX_REGEX = / \[Migrated from .+? on \d{4}-\d{2}-\d{2}\]$/

export function slugify(value, { max = 40 } = {}) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
}

export function shortHash(value, len = 8) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, len)
}

export function githubTopics({ sourceType, sourceProject, hideSourceName }) {
  const kindTopic = `from-${slugify(sourceType, { max: 30 })}`
  const slugTopic = hideSourceName
    ? `mig-${shortHash(sourceProject)}`
    : `mig-${slugify(sourceProject)}`
  return ['migrated', kindTopic, slugTopic].filter(t => t && t.length > 0 && t.length <= GITHUB_MAX_TOPIC_LEN)
}

export function descriptionSuffix({ sourceUrl, dateIso, hideSourceName }) {
  const src = hideSourceName ? '<redacted>' : sourceUrl
  return ` [Migrated from ${src} on ${dateIso}]`
}

export function azureProjectProperties({ targetUrl, dateIso, planId, status = 'completed' }) {
  return [
    { op: 'add', path: '/Migration.Target', value: targetUrl || '' },
    { op: 'add', path: '/Migration.Date', value: dateIso },
    { op: 'add', path: '/Migration.PlanId', value: String(planId) },
    { op: 'add', path: '/Migration.Status', value: status }
  ]
}

export function gitTagName({ planId, dateIso }) {
  return `migration/${dateIso}-${planId}`
}

export function gitTagMessage({ planId, source, target, dateIso, executedBy }) {
  return JSON.stringify({
    planId,
    source,
    target,
    date: dateIso,
    executedBy: executedBy || null
  })
}

export function parsePolicy(raw) {
  if (!raw) return { ...DEFAULT_POLICY }
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return { ...DEFAULT_POLICY, ...parsed }
  } catch {
    return { ...DEFAULT_POLICY }
  }
}
