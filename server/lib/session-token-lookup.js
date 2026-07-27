// Token lookup for the gh-outbox worker.
//
// The outbox runs in the background (no req object), so it has no direct
// access to `req.session.accessToken`. The session store keeps every active
// session as a JSON blob in the `sessions` table; we scan the most recent
// non-expired sessions for a matching `userId` and return its accessToken.
// The token inside that blob is encrypted (lib/session-store.js); `userId` is
// deliberately not, which is what keeps this bulk scan a plain JSON.parse.
//
// The scan is memoized into a single userId -> token index. The worker calls
// this once per outbox row (up to 50 per tick), and each uncached call parsed
// up to 200 session blobs — 10,000 JSON.parse calls of multi-kilobyte objects
// on the main thread, every tick, to answer at most 50 distinct questions. The
// index is rebuilt whenever it is older than CACHE_TTL_MS, which is short
// enough (seconds, against a 60s tick) that a re-login or logout is picked up
// on the next tick rather than being pinned for the process lifetime.
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
import { decryptSessionField } from './credential-encryption.js'
import { ENCRYPTED_TOKEN_FIELD } from './session-store.js'

const CACHE_TTL_MS = 5000
const SESSION_SCAN_LIMIT = 200

/**
 * Build a tokenLookup function bound to the database.
 * @param {object} db better-sqlite3 instance
 * @param {object} [opts]
 * @param {number} [opts.cacheTtlMs] how long a built index may be reused
 * @returns {(userId: number) => Promise<string|null>}
 */
export function createSessionTokenLookup(db, { cacheTtlMs = CACHE_TTL_MS } = {}) {
  let tableExists = null
  let index = null
  let indexBuiltAt = 0

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

  /**
   * Parse every live session blob once into userId -> token holder.
   *
   * Rows arrive furthest-expiry-first and the first token wins, preserving the
   * "most recent session" semantics of the original linear scan.
   *
   * The ciphertext is carried through UNDECRYPTED on purpose. A blob the
   * process has not seen before costs a full PBKDF2-SHA512 @210k derivation
   * (~200ms), so decrypting the whole index eagerly would turn one tick into up
   * to 200 derivations to answer at most 50 questions — usually one or two.
   * Deferring to resolveToken() makes the crypto cost proportional to demand,
   * and credential-encryption's memo makes every repeat free.
   *
   * @returns {Map<number, {plain: string|null, enc: string|null}>}
   */
  function buildIndex() {
    const map = new Map()
    const rows = db.prepare(
      `SELECT data FROM sessions WHERE expires > ? ORDER BY expires DESC LIMIT ?`
    ).all(Date.now(), SESSION_SCAN_LIMIT)
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.data)
        if (parsed?.userId === undefined || parsed?.userId === null) continue
        // Both shapes are live at once: `accessToken` on rows the session store
        // has not re-read since the encryption change, `accessTokenEnc` after.
        const plain = typeof parsed.accessToken === 'string' && parsed.accessToken
          ? parsed.accessToken
          : null
        const encField = parsed[ENCRYPTED_TOKEN_FIELD]
        const enc = typeof encField === 'string' && encField ? encField : null
        if (!plain && !enc) continue
        if (!map.has(parsed.userId)) map.set(parsed.userId, { plain, enc })
      } catch { /* skip malformed blob */ }
    }
    return map
  }

  /** @param {{plain: string|null, enc: string|null}} [entry] */
  function resolveToken(entry, userId) {
    if (!entry) return null
    if (entry.plain) return entry.plain
    try {
      return decryptSessionField(entry.enc)
    } catch (err) {
      logger.warn({ err: err?.message, userId }, '[gh-outbox tokenLookup] session token decrypt failed')
      return null
    }
  }

  return async function tokenLookup(userId) {
    if (!hasSessionsTable()) return null
    try {
      const now = Date.now()
      if (!index || now - indexBuiltAt >= cacheTtlMs) {
        index = buildIndex()
        indexBuiltAt = now
      }
      return resolveToken(index.get(userId), userId)
    } catch (err) {
      logger.warn({ err, userId }, '[gh-outbox tokenLookup] session scan failed')
      return null
    }
  }
}
