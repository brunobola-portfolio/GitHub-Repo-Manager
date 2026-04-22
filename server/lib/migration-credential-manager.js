import { encryptCredentials, decryptCredentials } from './credential-encryption.js'
import defaultLogger from './logger.js'

/**
 * Factory that builds a credential manager bound to a `better-sqlite3`
 * database instance. All credential lifecycle concerns for migration plans
 * (encrypt/store, retrieve/decrypt, forget, periodic purge) live here so
 * `MigrationEngine` can stay focused on plan/task orchestration.
 *
 * The manager owns:
 *   - encryption/decryption through `credential-encryption.js`
 *   - a supervised cleanup interval (try/catch around each tick so a single
 *     bad row does not silently kill the loop)
 *   - a `timer.unref()` on the interval so lingering managers never block
 *     process shutdown in tests
 *
 * @param {{
 *   db: import('better-sqlite3').Database,
 *   logger?: { error: Function, warn?: Function, info?: Function, debug?: Function }
 * }} deps
 */
export function createMigrationCredentialManager({ db, logger = defaultLogger }) {
  if (!db) throw new Error('createMigrationCredentialManager: db is required')

  let cleanupInterval = null
  // `api` is the returned object; the cleanup timer dispatches through it so
  // tests (and callers) can monkey-patch / spy on `_purgeExpired` and still
  // see the override fire from the interval tick.
  let api

  /**
   * Encrypts and persists credentials for the given plan by writing to
   * `migration_plans.credentials_enc`. Returns the encrypted blob string.
   */
  function store(planId, credentials) {
    const encrypted = encryptCredentials(credentials)
    db.prepare(
      `UPDATE migration_plans SET credentials_enc = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(encrypted, planId)
    return encrypted
  }

  /**
   * Returns the decrypted credentials for a plan, or `null` when:
   *   - the plan does not exist
   *   - the plan has no stored credentials
   *   - the stored credentials are older than `gracePeriodHours` (defence
   *     in depth alongside the periodic purge)
   */
  function retrieve(planId, { gracePeriodHours = 48 } = {}) {
    const row = db.prepare(
      `SELECT credentials_enc, created_at,
              CAST((julianday('now') - julianday(created_at)) * 24 AS REAL) AS age_hours
         FROM migration_plans WHERE id = ?`
    ).get(planId)

    if (!row || !row.credentials_enc) return null
    if (row.age_hours != null && row.age_hours > gracePeriodHours) return null

    try {
      return decryptCredentials(row.credentials_enc)
    } catch (err) {
      logger.error({ err, planId }, 'migration-credential-manager: failed to decrypt credentials')
      return null
    }
  }

  /**
   * Clears stored credentials for a plan. Idempotent — calling on a plan
   * with no credentials (or a non-existent plan) is a no-op.
   */
  function forget(planId) {
    db.prepare(
      `UPDATE migration_plans SET credentials_enc = NULL WHERE id = ?`
    ).run(planId)
  }

  /**
   * Clears encrypted credentials older than `gracePeriodHours` to limit
   * exposure on scheduled plans that never fire (crashed worker, stuck
   * runner, etc). Returns the number of rows affected.
   */
  function _purgeExpired({ gracePeriodHours = 48 } = {}) {
    const result = db.prepare(
      `UPDATE migration_plans
         SET credentials_enc = NULL
       WHERE credentials_enc IS NOT NULL
         AND created_at < datetime('now', ?)`
    ).run(`-${gracePeriodHours} hours`)
    return result.changes || 0
  }

  /**
   * Starts the periodic purge interval. The tick body is wrapped in
   * try/catch (supervision pattern — B3 fix) so a single failed iteration
   * logs and continues rather than taking the whole loop down.
   *
   * @param {{ intervalMs?: number, gracePeriodHours?: number }} [opts]
   */
  function startCleanupTimer({ intervalMs = 3600000, gracePeriodHours = 48 } = {}) {
    if (cleanupInterval) return
    cleanupInterval = setInterval(() => {
      try {
        // Dispatch through `api` so callers/tests that replace `_purgeExpired`
        // on the returned object see their override take effect.
        api._purgeExpired({ gracePeriodHours })
      } catch (err) {
        logger.error({ err }, 'migration-credential-manager: purge iteration failed; will retry next tick')
      }
    }, intervalMs)
    // Never block process shutdown just because the cleanup timer is alive.
    if (typeof cleanupInterval.unref === 'function') cleanupInterval.unref()
  }

  /** Stops the periodic purge interval. Idempotent. */
  function stopCleanupTimer() {
    if (cleanupInterval) {
      clearInterval(cleanupInterval)
      cleanupInterval = null
    }
  }

  api = {
    store,
    retrieve,
    forget,
    _purgeExpired,
    startCleanupTimer,
    stopCleanupTimer,
  }
  return api
}
