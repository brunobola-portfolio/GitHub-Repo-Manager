/*
 * GitHub Repo Manager - Repo Security Routes
 *
 * Endpoints:
 *   GET  /repos/:owner/:repo/security          — alert sources + 10-check
 *                                                 deterministic posture report
 *                                                 card ("Security Posture" panel)
 *   POST /repos/:owner/:repo/security/summary  — cached AI summary of the
 *                                                 posture check results
 *
 * The alerts fetch + the 10 deterministic checks are Free-tier, unmetered —
 * every GitHub API call here runs against the caller's own token, same as
 * before the 2026-07-18 rebalance. Only the AI summary is quota-gated.
 *
 * Spec: docs/specs/2026-07-18-community-wow-wave6.md (Feature 4 — Security
 * Posture Panel). Research: .dev/prod-premium/2026-07-18/r4-security-posture.md.
 */
import { Router } from 'express'
import { githubApi } from '../../lib/github-api.js'
import { auditLog } from '../../lib/audit.js'
import { requireAuth } from '../../middleware/auth.js'
import { requireScope } from '../../middleware/api-key-auth.js'
import { validateBody } from '../../middleware/validate-request.js'
import { securityPostureSummarySchema } from '../../lib/validators.js'
import { applyOwnerRepoParamValidators } from '../repos/_shared.js'
import { communityHealthService } from '../../community-health-service.js'
import { buildChecks, scoreChecks } from '../../lib/security-posture-checks.js'
import {
  buildPrompt as buildSecuritySummaryPrompt,
  shapeSummary,
  readCachedSummary,
  writeCachedSummary,
  SECURITY_POSTURE_SUMMARY_LIMITS,
} from '../../lib/security-posture-summary.js'
import { checkAIFeatureLimit, incrementAIUsage, quotaExceededResponse } from '../../lib/usage-meter.js'
import { requireAI, guardedGenerate, handleAIError } from '../ai/shared.js'
import { safeJsonParse } from '../../lib/utils.js'

const router = Router()
// Reject malformed :owner/:repo before they reach githubApi() — same guard
// the server/routes/repos/*.js sub-routers register.
applyOwnerRepoParamValidators(router)

function parseSettled(settled) {
  if (settled.status === 'fulfilled') {
    return { available: true, alerts: settled.value.data || [] }
  }
  const status = settled.reason?.status
  if (status === 403 || status === 404) {
    return { available: false, reason: 'Unavailable or insufficient token scope (security_events)' }
  }
  return { available: false, reason: settled.reason?.message || 'Unknown error' }
}

function bumpSeverity(summary, sev) {
  const key = (sev || '').toLowerCase()
  if (key === 'critical') summary.critical++
  else if (key === 'high' || key === 'error') summary.high++
  else if (key === 'medium' || key === 'warning') summary.medium++
  else if (key === 'low' || key === 'note') summary.low++
  else summary.medium++
  summary.total++
}

function computeSummary(result) {
  const summary = { critical: 0, high: 0, medium: 0, low: 0, total: 0 }
  if (result.secretScanning.available) {
    for (const _ of result.secretScanning.alerts) bumpSeverity(summary, 'high')
  }
  if (result.codeScanning.available) {
    for (const a of result.codeScanning.alerts) bumpSeverity(summary, a.rule?.severity)
  }
  if (result.dependabot.available) {
    for (const a of result.dependabot.alerts) bumpSeverity(summary, a.security_advisory?.severity)
  }
  // Zero across the board is only meaningful ("clean") if at least one of the
  // three sources was actually reachable — otherwise it's "we can't see
  // anything", which check #3 (alerts_clear) must render as unknown, not pass.
  summary.available = result.secretScanning.available || result.codeScanning.available || result.dependabot.available
  result.summary = summary
}

// ---------------------------------------------------------------------------
// Signal fetchers for the 10-check report card. Each is tolerant of every
// failure mode GitHub can throw at a non-admin/no-GHAS/no-Pro caller — none
// of these ever reject; they resolve to a 'unknown'/'not_applicable' shaped
// signal instead, so the route handler never needs its own try/catch per
// signal. This is the honesty-critical boundary: "I can't see it" must never
// collapse into "it's broken".
// ---------------------------------------------------------------------------

/** GET /repos/{owner}/{repo} — default_branch, private, owner.type, security_and_analysis. */
async function fetchRepoMeta(owner, repo, token) {
  try {
    const { data } = await githubApi(`/repos/${owner}/${repo}`, token)
    return data && typeof data === 'object' ? data : null
  } catch {
    return null
  }
}

/**
 * Branch protection signal for checks #1/#2. 404 means "genuinely
 * unprotected" (an admin can see that fine) — a real fail, not unknown. Any
 * other failure (403 non-admin, 403 GITHUB_PRO_REQUIRED, network hiccup)
 * degrades to 'unknown' rather than guessing.
 */
async function fetchBranchProtectionSignal(owner, repo, branch, token) {
  if (!branch) return { status: 'unknown' }
  try {
    const { data } = await githubApi(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}/protection`, token)
    if (!data || data.protected === false) return { status: 'unprotected' }
    return {
      status: 'protected',
      requiresReview: !!data.required_pull_request_reviews,
      allowsForcePush: !!data.allow_force_pushes?.enabled || data.allow_force_pushes === true,
      allowsDeletion: !!data.allow_deletions?.enabled || data.allow_deletions === true,
    }
  } catch (err) {
    if (err?.status === 404) return { status: 'unprotected' }
    return { status: 'unknown' }
  }
}

/** GET /repos/{owner}/{repo}/actions/permissions/workflow — check #9, admin-gated. */
async function fetchWorkflowPermissionsSignal(owner, repo, token) {
  try {
    const { data } = await githubApi(`/repos/${owner}/${repo}/actions/permissions/workflow`, token)
    const perm = data?.default_workflow_permissions
    if (perm === 'read' || perm === 'write') return { status: perm }
    return { status: 'unknown' }
  } catch (err) {
    // 404: Actions isn't enabled/used on this repo — genuinely not applicable,
    // not a visibility gap.
    if (err?.status === 404) return { status: 'not_applicable' }
    return { status: 'unknown' }
  }
}

/** GET /orgs/{org} → two_factor_requirement_enabled — check #10, best-effort. */
async function fetchOrgTwoFactorSignal(ownerLogin, ownerType, token) {
  if (ownerType !== 'Organization' || !ownerLogin) {
    return { applicable: false, twoFactorRequired: null }
  }
  try {
    const { data } = await githubApi(`/orgs/${ownerLogin}`, token)
    const val = data?.two_factor_requirement_enabled
    return { applicable: true, twoFactorRequired: typeof val === 'boolean' ? val : null }
  } catch {
    // The field is org-owner-only; a 403/404 here doesn't necessarily mean
    // the org doesn't exist, just that this caller can't see the policy.
    return { applicable: true, twoFactorRequired: null }
  }
}

/** security_and_analysis sub-object → checks #4/#5/#6. Absent entirely for non-admins. */
function secretsSignalFromRepoData(repoData) {
  const sa = repoData?.security_and_analysis
  const statusOf = (obj) => (obj?.status === 'enabled' || obj?.status === 'disabled' ? obj.status : 'unknown')
  if (!sa) {
    return {
      secretScanning: { status: 'unknown' },
      secretScanningPushProtection: { status: 'unknown' },
      dependabotSecurityUpdates: { status: 'unknown' },
    }
  }
  return {
    secretScanning: { status: statusOf(sa.secret_scanning) },
    secretScanningPushProtection: { status: statusOf(sa.secret_scanning_push_protection) },
    dependabotSecurityUpdates: { status: statusOf(sa.dependabot_security_updates) },
  }
}

// Repo security scan (secret-scanning / code-scanning / dependabot alerts) —
// moved off the Pro paywall to Free (2026-07-18 rebalance). Read-only, no
// marginal cost — the GitHub API calls run against the caller's own token.
//
// Extended (Wave 6, Feature 4) to also aggregate the 10-check deterministic
// "Security Posture" report card alongside the existing 3 alert sources.
router.get('/repos/:owner/:repo/security', requireAuth, async (req, res) => {
  const { owner, repo } = req.params
  const token = req.session.accessToken
  const [secretScanning, codeScanning, dependabot] = await Promise.allSettled([
    githubApi(`/repos/${owner}/${repo}/secret-scanning/alerts?state=open&per_page=100`, token),
    githubApi(`/repos/${owner}/${repo}/code-scanning/alerts?state=open&per_page=100`, token),
    githubApi(`/repos/${owner}/${repo}/dependabot/alerts?state=open&per_page=100`, token)
  ])
  const result = {
    secretScanning: parseSettled(secretScanning),
    codeScanning: parseSettled(codeScanning),
    dependabot: parseSettled(dependabot),
    summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 }
  }
  computeSummary(result)

  // Deterministic 10-check report card. Every fetch above is independently
  // tolerant (see the fetcher comments), so no try/catch is needed here —
  // worst case, individual checks degrade to 'unknown'/'not_applicable'.
  const [repoData, communityFiles] = await Promise.all([
    fetchRepoMeta(owner, repo, token),
    communityHealthService.checkCommunityFiles(owner, repo, token).catch(() => ({})),
  ])
  const [branchProtection, workflowPermissions, org] = await Promise.all([
    fetchBranchProtectionSignal(owner, repo, repoData?.default_branch, token),
    fetchWorkflowPermissionsSignal(owner, repo, token),
    fetchOrgTwoFactorSignal(repoData?.owner?.login || owner, repoData?.owner?.type, token),
  ])

  const signals = {
    branchProtection,
    alerts: result.summary,
    ...secretsSignalFromRepoData(repoData),
    codeScanning: { configured: result.codeScanning.available },
    securityMd: { exists: !!communityFiles?.['SECURITY.md']?.exists },
    workflowPermissions,
    org,
    visibility: repoData?.private ? 'private' : 'public',
  }

  const checks = buildChecks(signals)
  result.checks = checks
  result.score = scoreChecks(checks)

  auditLog(req, 'repo.security-scan', 'repo', `${owner}/${repo}`, { total: result.summary.total, checksPassing: result.score.passing })
  res.json(result)
})

// AI summary of the posture report card — single guardedGenerate call,
// cached per (user, repo, check-result-hash) so re-opening the panel without
// a posture change doesn't re-bill the AI provider. The client submits back
// the SAME 10 checks GET /security just returned (validated + whitelisted by
// securityPostureSummarySchema) — never raw alert bodies.
//
// requireScope('ai') is NOT paired with an AI_GENERATION_ROUTE_PATHS entry:
// this route lives outside the server/routes/ai/* barrel that the parity test
// in ai-key-scope-enforcement.test.js walks, so it falls outside that
// allowlist's carve-out mechanism entirely (mirrors migration.js's /analyze
// and actions-community.js's /agent-rules/generate). The practical effect is
// fail-closed: only session users and admin-scoped API keys reach this route.
router.post('/repos/:owner/:repo/security/summary', requireAuth, requireScope('ai'), validateBody(securityPostureSummarySchema), requireAI, async (req, res) => {
  const userId = req.session.userId
  const { repo, checks } = req.validatedBody

  const cached = readCachedSummary({ userId, repoFullName: repo.full_name, checks })
  if (cached) {
    return res.json({ ...cached, cached: true })
  }

  const check = checkAIFeatureLimit(userId, 'ai_security_posture')
  if (!check.allowed) return res.status(429).json(quotaExceededResponse(check))

  try {
    const prompt = buildSecuritySummaryPrompt({ repo, checks })
    const { text, parsed } = await guardedGenerate(req, {
      prompt,
      generationConfig: { maxOutputTokens: SECURITY_POSTURE_SUMMARY_LIMITS.maxOutputTokens },
    }, { feature: 'security_posture' })

    const payload = parsed || safeJsonParse(text)
    const shaped = shapeSummary(payload)

    writeCachedSummary({ userId, repoFullName: repo.full_name, checks }, shaped)
    incrementAIUsage(userId, 'ai_security_posture')
    auditLog(req, 'ai.security_posture_summary', 'ai', null, { repo: repo.full_name, topActionCount: shaped.topActions.length })

    res.json({ ...shaped, cached: false })
  } catch (error) {
    req.log.error({ err: error, repo: repo.full_name }, 'AI security-posture summary failed')
    handleAIError(res, error, 'Failed to generate the security summary. Please try again later.')
  }
})

export default router
