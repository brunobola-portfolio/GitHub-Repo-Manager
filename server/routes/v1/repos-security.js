import { Router } from 'express'
import { githubApi } from '../../lib/github-api.js'
import { auditLog } from '../../lib/audit.js'
import { requireAuth } from '../../middleware/auth.js'
import { requireTier } from '../../middleware/require-tier.js'
import { applyOwnerRepoParamValidators } from '../repos/_shared.js'

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
  result.summary = summary
}

router.get('/repos/:owner/:repo/security', requireAuth, requireTier('pro'), async (req, res) => {
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
  auditLog(req, 'repo.security-scan', 'repo', `${owner}/${repo}`, { total: result.summary.total })
  res.json(result)
})

export default router
