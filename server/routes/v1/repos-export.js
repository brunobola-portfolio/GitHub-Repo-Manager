import { Router } from 'express'
import { githubApi } from '../../lib/github-api.js'
import { auditLog } from '../../lib/audit.js'
import { requireAuth, safeError } from '../../middleware/auth.js'
import { applyOwnerRepoParamValidators } from '../repos/_shared.js'


const router = Router()
// Reject malformed :owner/:repo before they reach githubApi() — same guard
// the server/routes/repos/*.js sub-routers register.
applyOwnerRepoParamValidators(router)

router.get('/repos/:owner/:repo/export', requireAuth, async (req, res) => {
  const { owner, repo } = req.params
  const token = req.session.accessToken  // requireAuth guarantees this exists
  try {
    const [repoRes, topicsRes, languagesRes, branchesRes, releasesRes] = await Promise.all([
      githubApi(`/repos/${owner}/${repo}`, token),
      githubApi(`/repos/${owner}/${repo}/topics`, token),
      githubApi(`/repos/${owner}/${repo}/languages`, token),
      githubApi(`/repos/${owner}/${repo}/branches?per_page=100`, token),
      githubApi(`/repos/${owner}/${repo}/releases?per_page=30`, token)
    ])
    const payload = {
      exportedAt: new Date().toISOString(),
      exportedBy: req.session.user?.login || null,
      schemaVersion: 1,
      repository: repoRes.data,
      topics: topicsRes.data?.names || [],
      languages: languagesRes.data || {},
      branches: {
        count: Array.isArray(branchesRes.data) ? branchesRes.data.length : 0,
        default: repoRes.data?.default_branch || null
      },
      releases: releasesRes.data || []
    }
    const body = JSON.stringify(payload, null, 2)
    auditLog(req, 'repo.export', 'repo', `${owner}/${repo}`, { size: body.length })
    const safeRepo = repo.replace(/[^\w.-]/g, '_').slice(0, 100)
    res.setHeader('Content-Disposition', `attachment; filename="${safeRepo}-export-${Date.now()}.json"`)
    res.setHeader('Content-Type', 'application/json')
    res.send(body)
  } catch (err) {
    req.log.error({ err, owner, repo }, 'repo export failed')
    // Never leak err.message — third-party API errors may embed temp file
    // paths, credential URIs, or internal hostnames. safeError() returns
    // a generic fallback in production.
    res.status(err.status || 500).json({ error: safeError(err, 'Export failed') })
  }
})

export default router
