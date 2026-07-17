import { Router } from 'express'
import simpleGit from 'simple-git'
import { tmpdir } from 'os'
import { join } from 'path'
import { rm, mkdtemp } from 'fs/promises'
import db from '../../db.js'
import { auditLog } from '../../lib/audit.js'
import { requireAuth } from '../../middleware/auth.js'
import { applyOwnerRepoParamValidators } from '../repos/_shared.js'
import { checkUsageLimit, incrementUsage, quotaExceededResponse } from '../../lib/usage-meter.js'

const router = Router()
// Reject malformed :owner/:repo before they reach githubApi() or the git push
// URL — same guard the server/routes/repos/*.js sub-routers register.
applyOwnerRepoParamValidators(router)

// GET .../sync/preview — read-only sync preview, available on ALL tiers (Free
// included). Returns the tracked mirror's source/target + last-sync metadata
// with NO clone or push. The destructive apply (POST .../sync below) mirrors
// the source over the target and also moved to Free (2026-07-18 rebalance),
// newly metered against syncApplyPerMonth. Same user_id scoping as the apply
// path so the preview never discloses another user's mirror.
router.get('/repos/:owner/:repo/sync/preview', requireAuth, (req, res) => {
  const { owner, repo } = req.params
  const job = db.prepare(
    `SELECT source_url, source_name, target_full_name, status, completed_at, created_at
     FROM migration_jobs
     WHERE target_owner=? AND target_repo=? AND is_mirror=1 AND user_id=?
     ORDER BY id DESC LIMIT 1`
  ).get(owner, repo, req.session.userId)
  if (!job) return res.status(404).json({ error: 'Not a tracked mirror' })
  const quota = checkUsageLimit(req.session.userId, 'sync_apply_executions')
  res.json({
    tracked: true,
    sourceUrl: job.source_url,
    sourceName: job.source_name || null,
    target: job.target_full_name || `${owner}/${repo}`,
    status: job.status || null,
    lastSyncedAt: job.completed_at || null,
    trackedSince: job.created_at || null,
    // Running the sync (mirror clone + force-push) is free on every tier,
    // capped at syncApplyPerMonth (see syncApplyRemaining below).
    syncApplyLimit: quota.limit,
    syncApplyRemaining: quota.remaining,
  })
})

router.post('/repos/:owner/:repo/sync', requireAuth, async (req, res) => {
  const { owner, repo } = req.params
  const token = req.session.accessToken  // requireAuth guarantees this exists
  // Scope the lookup to the caller's own mirror jobs. Without the user_id
  // predicate, any user with write access to owner/repo could trigger a
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

  // Mirror sync apply moved off the Pro paywall to Free (2026-07-18
  // rebalance) — real bandwidth/compute cost like migration, so it's metered
  // against syncApplyPerMonth (mirrors migration.js's requireMigrationQuota
  // pattern) BEFORE the clone/push work starts.
  const quota = checkUsageLimit(req.session.userId, 'sync_apply_executions')
  if (!quota.allowed) {
    return res.status(429).json(quotaExceededResponse({ ...quota, metric: 'sync_apply_executions' }))
  }
  incrementUsage(req.session.userId, 'sync_apply_executions')

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
