// Token lookup for the gh-outbox worker.
//
// The outbox runs in the background (no req object), so it has no direct
// access to `req.session.accessToken`. The session store keeps every active
// session as a JSON blob in the `sessions` table; we scan the most recent
// non-expired sessions for a matching `userId` and return its accessToken.
//
// Limitations (acceptable for v1):
//   - Works only when SQLite session store is active (Redis mode skips).
//     In Redis deployments, the worker still ticks but tokenLookup returns
//     null and pending outbox rows just stay pending until the user logs in.
//   - The token is only available while the user has at least one live
//     browser session — fine for typical SaaS usage where a user is
//     authenticated for hours/days.
//   - No token refresh logic; GitHub OAuth tokens are long-lived so this
//     rarely matters in practice.

import logger from './logger.js'

/**
 * Build a tokenLookup function bound to the database.
 * @param {object} db better-sqlite3 instance
 * @returns {(userId: number) => Promise<string|null>}
 */
export function createSessionTokenLookup(db) {
  let tableExists = null

  function hasSessionsTable() {
    if (tableExists != null) return tableExists
    try {
      const row = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='sessions' LIMIT 1`
      ).get()
      tableExists = !!row
    } catch {
      tableExists = false
    }
    return tableExists
  }

  return async function tokenLookup(userId) {
    if (!hasSessionsTable()) return null
    try {
      const rows = db.prepare(
        `SELECT data FROM sessions WHERE expires > ? ORDER BY expires DESC LIMIT 200`
      ).all(Date.now())
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.data)
          if (parsed?.userId === userId && parsed?.accessToken) {
            return parsed.accessToken
          }
        } catch { /* skip malformed blob */ }
      }
      return null
    } catch (err) {
      logger.warn({ err, userId }, '[gh-outbox tokenLookup] session scan failed')
      return null
    }
  }
}
