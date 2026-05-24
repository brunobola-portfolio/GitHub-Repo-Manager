// Read-only HTTP API for migration marks. Frontend uses these endpoints to
// surface the "Migrated" pill, the badge in MigrationHistory, and the
// provenance card on RepoDetail.
import express from 'express'

function safeJson(s) {
  try { return JSON.parse(s) } catch { return s }
}

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
