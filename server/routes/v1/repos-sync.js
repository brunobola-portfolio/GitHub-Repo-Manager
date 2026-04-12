import { Router } from 'express'
import simpleGit from 'simple-git'
import { tmpdir } from 'os'
import { join } from 'path'
import { rm, mkdtemp, writeFile, chmod } from 'fs/promises'
import db from '../../db.js'
import { auditLog } from '../../lib/audit.js'
import { requireAuth } from '../../middleware/auth.js'
import { requireTier } from '../../middleware/require-tier.js'

const router = Router()

router.post('/repos/:owner/:repo/sync', requireAuth, requireTier('pro'), async (req, res) => {
  const { owner, repo } = req.params
  const token = req.session.accessToken  // requireAuth guarantees this exists
  const job = db.prepare(
    `SELECT source_url FROM migration_jobs
     WHERE target_owner=? AND target_repo=? AND is_mirror=1
     ORDER BY id DESC LIMIT 1`
  ).get(owner, repo)
  if (!job) return res.status(404).json({ error: 'Not a tracked mirror' })

  const workDir = await mkdtemp(join(tmpdir(), 'grm-sync-'))
  const startedAt = Date.now()
  try {
    const git = simpleGit(workDir)
    await git.clone(job.source_url, '.', ['--mirror'])

    // Use GIT_ASKPASS to pass token without embedding it in the URL
    const askpassScript = join(workDir, 'askpass.sh')
    await writeFile(askpassScript, `#!/bin/sh\necho "${token}"`)
    await chmod(askpassScript, 0o700)

    const targetUrl = `https://x-access-token@github.com/${owner}/${repo}.git`
    const pushGit = simpleGit(workDir, {
      config: [`credential.helper=`],
    })
    await pushGit.env('GIT_ASKPASS', askpassScript).push(targetUrl, '--mirror')

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
