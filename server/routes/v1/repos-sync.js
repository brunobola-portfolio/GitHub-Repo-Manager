import { Router } from 'express'
import simpleGit from 'simple-git'
import { tmpdir } from 'os'
import { join } from 'path'
import { rm, mkdtemp } from 'fs/promises'
import db from '../../db.js'
import { auditLog } from '../../lib/audit.js'
import { requireAuth } from '../../middleware/auth.js'
import { requireTier } from '../../middleware/require-tier.js'

const router = Router()

router.post('/repos/:owner/:repo/sync', requireAuth, requireTier('pro'), async (req, res) => {
  const { owner, repo } = req.params
  const token = req.session.accessToken  // requireAuth guarantees this exists
  // Scope the lookup to the caller's own mirror jobs. Without the user_id
  // predicate, any Pro user with write access to owner/repo could trigger a
  // sync that a DIFFERENT user configured — disclosing that user's source_url
  // (response + audit log) and force-pushing the target from an upstream the
  // caller never set. migration_jobs.user_id is the same id written at mirror
  // creation time (see bulk.js mirror INSERT).
  const job = db.prepare(
    `SELECT source_url FROM migration_jobs
     WHERE target_owner=? AND target_repo=? AND is_mirror=1 AND user_id=?
     ORDER BY id DESC LIMIT 1`
  ).get(owner, repo, req.session.userId)
  if (!job) return res.status(404).json({ error: 'Not a tracked mirror' })

  const workDir = await mkdtemp(join(tmpdir(), 'grm-sync-'))
  const startedAt = Date.now()
  try {
    const git = simpleGit(workDir)
    await git.clone(job.source_url, '.', ['--mirror'])

    const targetUrl = `https://x-access-token:${encodeURIComponent(token)}@github.com/${owner}/${repo}.git`
    const pushGit = simpleGit(workDir)
    await pushGit.push(targetUrl, '--mirror')

    const duration = Date.now() - startedAt
    auditLog(req, 'repo.sync', 'repo', `${owner}/${repo}`, {
      sourceUrl: job.source_url,
      duration
    })
    res.json({
      syncedAt: new Date().toISOString(),
      duration,
      sourceUrl: job.source_url
    })
  } catch (err) {
    // Sanitize token from error message in case it leaks through child process output
    const safeMessage = (err.message || 'Sync failed').replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '***')
    req.log.error({ err: { ...err, message: safeMessage }, owner, repo }, 'mirror sync failed')
    res.status(500).json({ error: safeMessage })
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
})

export default router
