// Read-only HTTP API for migration marks. Frontend uses these endpoints to
// surface the "Migrated" pill, the badge in MigrationHistory, and the
// provenance card on RepoDetail.
import express from 'express'
import { safeJson } from '../lib/safe-json.js'

export function createMarksRouter({ db }) {
  const router = express.Router()

  // GET /api/migration/marks?targetFullName=foo/bar&targetKind=github-topic
  router.get('/', (req, res) => {
    const { targetFullName, targetKind } = req.query
    const where = []
    const args = []
    if (targetFullName) {
      where.push('(target_id = ? OR target_id LIKE ?)')
      args.push(String(targetFullName), `${String(targetFullName)}#%`)
    }
    if (targetKind) {
      where.push('target_kind = ?')
      args.push(String(targetKind))
    }
    const sql = `SELECT * FROM migration_marks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 200`
    const rows = db.prepare(sql).all(...args)
    res.json({ marks: rows.map(r => ({ ...r, payload: safeJson(r.payload) })) })
  })

  // GET /api/migration/marks/mine — every repo the CURRENT user has migrated.
  // Batched replacement for the per-card `?targetFullName=` fetch: MigratedPill
  // rendered one request per repo card (~30/grid page). This returns the whole
  // set in a single round-trip. User-scoped via the owning plan so it never
  // leaks another tenant's marks (the per-name route below is not user-scoped —
  // tracked as a follow-up). Returns { migrated: { "owner/repo": { writtenAt } } }
  // where writtenAt is the latest 'written' timestamp (for the pill tooltip).
  router.get('/mine', (req, res) => {
    const userId = req.session?.userId
    if (!userId) return res.status(401).json({ error: 'auth required' })
    const rows = db.prepare(
      `SELECT m.target_id, m.status, m.written_at
         FROM migration_marks m
         JOIN migration_plans p ON p.id = m.plan_id
        WHERE p.user_id = ?
        ORDER BY m.created_at DESC`
    ).all(userId)
    const migrated = {}
    for (const r of rows) {
      // target_id is "owner/repo" or "owner/repo#variant" — collapse to the repo.
      const repo = String(r.target_id).split('#')[0]
      if (!migrated[repo]) migrated[repo] = { writtenAt: null }
      if (r.status === 'written' && r.written_at && !migrated[repo].writtenAt) {
        migrated[repo].writtenAt = r.written_at
      }
    }
    res.json({ migrated })
  })

  // GET /api/migration/marks/plan/:id
  router.get('/plan/:id', (req, res) => {
    const planId = Number(req.params.id)
    if (!Number.isFinite(planId)) {
      return res.status(400).json({ error: 'invalid plan id' })
    }
    const rows = db.prepare(
      `SELECT * FROM migration_marks WHERE plan_id = ? ORDER BY created_at`
    ).all(planId)
    const byScope = { source: [], destination: [], 'git-tag': [] }
    for (const r of rows) {
      const parsed = { ...r, payload: safeJson(r.payload) }
      if (byScope[r.scope]) byScope[r.scope].push(parsed)
    }
    res.json({
      planId,
      byScope,
      marks: rows.map(r => ({ ...r, payload: safeJson(r.payload) }))
    })
  })

  return router
}
