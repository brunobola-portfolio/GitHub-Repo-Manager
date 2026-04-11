import { Router } from 'express'
import { githubApi } from '../../lib/github-api.js'
import { auditLog } from '../../lib/audit.js'

const router = Router()

router.get('/repos/:owner/:repo/export', async (req, res) => {
  const { owner, repo } = req.params
  const token = req.session?.accessToken
  if (!token) return res.status(401).json({ error: 'Not authenticated' })
  try {
    const [repoRes, topicsRes, languagesRes, branchesRes, releasesRes] = await Promise.all([
      githubApi(`/repos/${owner}/${repo}`, token),
      githubApi(`/repos/${owner}/${repo}/topics`, token, {
        headers: { Accept: 'application/vnd.github.mercy-preview+json' }
      }),
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
    await auditLog(req, 'repo.export', 'repo', `${owner}/${repo}`, {
      size: JSON.stringify(payload).length
    })
    res.setHeader('Content-Disposition', `attachment; filename="${repo}-export-${Date.now()}.json"`)
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify(payload, null, 2))
  } catch (err) {
    req.log.error({ err, owner, repo }, 'repo export failed')
    res.status(err.status || 500).json({ error: err.message || 'Export failed' })
  }
})

export default router
