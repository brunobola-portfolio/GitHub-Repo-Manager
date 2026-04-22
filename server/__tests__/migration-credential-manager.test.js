// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest'
import Database from 'better-sqlite3'
import { createMigrationCredentialManager } from '../lib/migration-credential-manager.js'

// The credential encryption module demands CREDENTIAL_ENCRYPTION_KEY or
// SESSION_SECRET. Set a dev fallback once for the whole suite.
const ORIGINAL_ENV = { ...process.env }
beforeAll(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-credential-key-for-migration-manager-unit-tests'
})
afterAll(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k]
  }
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) process.env[k] = v
})

/**
 * Minimal in-memory `migration_plans` schema — only the columns the
 * credential manager touches. We intentionally keep this narrower than the
 * full engine schema so the test stays focused.
 */
function createTestDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE migration_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'draft',
      scheduled_at TEXT,
      credentials_enc TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  return db
}

function insertPlan(db, { createdAt = null } = {}) {
  if (createdAt) {
    const res = db.prepare(
      `INSERT INTO migration_plans (status, created_at) VALUES ('scheduled', ?)`
    ).run(createdAt)
    return Number(res.lastInsertRowid)
  }
  const res = db.prepare(`INSERT INTO migration_plans (status) VALUES ('scheduled')`).run()
  return Number(res.lastInsertRowid)
}

describe('migration-credential-manager', () => {
  let db
  let manager
  let silentLogger

  beforeEach(() => {
    db = createTestDb()
    silentLogger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
    manager = createMigrationCredentialManager({ db, logger: silentLogger })
  })

  afterEach(() => {
    manager.stopCleanupTimer()
    db.close()
  })

  describe('store / retrieve / forget', () => {
    it('store(planId, cred) encrypts and writes the blob', () => {
      const planId = insertPlan(db)
      const cred = { azurePat: 'azure-secret', githubToken: 'ghp_abc' }

      manager.store(planId, cred)

      const row = db.prepare('SELECT credentials_enc FROM migration_plans WHERE id = ?').get(planId)
      expect(row.credentials_enc).toBeTruthy()
      expect(typeof row.credentials_enc).toBe('string')
      // Must be an encrypted blob, not JSON plaintext
      expect(row.credentials_enc).not.toContain('azure-secret')
      expect(row.credentials_enc).not.toContain('ghp_abc')
    })

    it('retrieve(planId) decrypts and returns the original object', () => {
      const planId = insertPlan(db)
      const cred = {
        azurePat: 'azure-secret',
        githubToken: 'ghp_abc',
        azureOrg: 'contoso',
        azureProject: 'migrate',
      }
      manager.store(planId, cred)

      expect(manager.retrieve(planId)).toEqual(cred)
    })

    it('retrieve(planId) returns null for a non-existent plan', () => {
      expect(manager.retrieve(99999)).toBeNull()
    })

    it('retrieve(planId) returns null for a plan with no stored credentials', () => {
      const planId = insertPlan(db)
      expect(manager.retrieve(planId)).toBeNull()
    })

    it('retrieve(planId) returns null for an expired row', () => {
      // Plan created 49 hours ago, grace period default 48 hours
      const planId = insertPlan(db, { createdAt: "datetime('now', '-49 hours')" })
      // re-insert with explicit old created_at using a raw SQL expr
      db.prepare('DELETE FROM migration_plans WHERE id = ?').run(planId)
      const res = db.prepare(
        `INSERT INTO migration_plans (status, created_at) VALUES ('scheduled', datetime('now', '-49 hours'))`
      ).run()
      const oldId = Number(res.lastInsertRowid)
      manager.store(oldId, { azurePat: 'old-secret' })
      // store() updates `updated_at` but not `created_at`, so created_at is still -49h

      expect(manager.retrieve(oldId)).toBeNull()
    })

    it('retrieve honours a custom gracePeriodHours', () => {
      const res = db.prepare(
        `INSERT INTO migration_plans (status, created_at) VALUES ('scheduled', datetime('now', '-10 hours'))`
      ).run()
      const planId = Number(res.lastInsertRowid)
      manager.store(planId, { azurePat: 'secret' })

      // With a 5h grace, this 10h-old row is expired → null
      expect(manager.retrieve(planId, { gracePeriodHours: 5 })).toBeNull()
      // With default 48h grace, still valid
      expect(manager.retrieve(planId)).toEqual({ azurePat: 'secret' })
    })

    it('retrieve returns null and logs when decryption fails', () => {
      const planId = insertPlan(db)
      db.prepare('UPDATE migration_plans SET credentials_enc = ? WHERE id = ?').run('not-a-valid-hex-blob', planId)

      expect(manager.retrieve(planId)).toBeNull()
      expect(silentLogger.error).toHaveBeenCalled()
    })

    it('forget(planId) clears the credentials column', () => {
      const planId = insertPlan(db)
      manager.store(planId, { azurePat: 'secret' })
      expect(manager.retrieve(planId)).not.toBeNull()

      manager.forget(planId)

      const row = db.prepare('SELECT credentials_enc FROM migration_plans WHERE id = ?').get(planId)
      expect(row.credentials_enc).toBeNull()
      expect(manager.retrieve(planId)).toBeNull()
    })

    it('forget(planId) is idempotent for plans without credentials', () => {
      const planId = insertPlan(db)
      expect(() => manager.forget(planId)).not.toThrow()
      expect(() => manager.forget(99999)).not.toThrow()
    })
  })

  describe('_purgeExpired', () => {
    it('deletes rows older than the grace period and returns the count', () => {
      // One fresh plan, two stale plans
      const fresh = insertPlan(db)
      manager.store(fresh, { azurePat: 'fresh' })

      const stale1 = Number(db.prepare(
        `INSERT INTO migration_plans (status, created_at) VALUES ('scheduled', datetime('now', '-49 hours'))`
      ).run().lastInsertRowid)
      const stale2 = Number(db.prepare(
        `INSERT INTO migration_plans (status, created_at) VALUES ('scheduled', datetime('now', '-72 hours'))`
      ).run().lastInsertRowid)
      manager.store(stale1, { azurePat: 'stale1' })
      manager.store(stale2, { azurePat: 'stale2' })

      const changes = manager._purgeExpired({ gracePeriodHours: 48 })

      expect(changes).toBe(2)
      expect(db.prepare('SELECT credentials_enc FROM migration_plans WHERE id = ?').get(fresh).credentials_enc).toBeTruthy()
      expect(db.prepare('SELECT credentials_enc FROM migration_plans WHERE id = ?').get(stale1).credentials_enc).toBeNull()
      expect(db.prepare('SELECT credentials_enc FROM migration_plans WHERE id = ?').get(stale2).credentials_enc).toBeNull()
    })

    it('returns 0 when no rows are expired', () => {
      const planId = insertPlan(db)
      manager.store(planId, { azurePat: 'secret' })
      expect(manager._purgeExpired({ gracePeriodHours: 48 })).toBe(0)
    })

    it('ignores rows that already have NULL credentials_enc', () => {
      Number(db.prepare(
        `INSERT INTO migration_plans (status, created_at) VALUES ('scheduled', datetime('now', '-72 hours'))`
      ).run().lastInsertRowid)
      // No store() call → credentials_enc is NULL and should not count
      expect(manager._purgeExpired({ gracePeriodHours: 48 })).toBe(0)
    })

    it('honours a custom gracePeriodHours', () => {
      const id = Number(db.prepare(
        `INSERT INTO migration_plans (status, created_at) VALUES ('scheduled', datetime('now', '-10 hours'))`
      ).run().lastInsertRowid)
      manager.store(id, { azurePat: 'secret' })

      expect(manager._purgeExpired({ gracePeriodHours: 24 })).toBe(0)
      expect(manager._purgeExpired({ gracePeriodHours: 5 })).toBe(1)
    })
  })

  describe('startCleanupTimer / stopCleanupTimer', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    it('invokes _purgeExpired on tick; stopCleanupTimer halts it', () => {
      // Insert a stale row so each tick has something to purge
      const stale = Number(db.prepare(
        `INSERT INTO migration_plans (status, created_at) VALUES ('scheduled', datetime('now', '-72 hours'))`
      ).run().lastInsertRowid)
      manager.store(stale, { azurePat: 'stale' })

      const spy = vi.spyOn(manager, '_purgeExpired')
      manager.startCleanupTimer({ intervalMs: 10 })

      vi.advanceTimersByTime(35)
      expect(spy).toHaveBeenCalled()
      const callsAfterAdvance = spy.mock.calls.length

      manager.stopCleanupTimer()
      vi.advanceTimersByTime(1000)
      expect(spy.mock.calls.length).toBe(callsAfterAdvance)
    })

    it('startCleanupTimer is idempotent — second call is a no-op', () => {
      const spy = vi.spyOn(manager, '_purgeExpired')
      manager.startCleanupTimer({ intervalMs: 10 })
      manager.startCleanupTimer({ intervalMs: 10 })

      vi.advanceTimersByTime(25)
      // Only one interval is active: exactly ~2 calls, not ~4
      expect(spy.mock.calls.length).toBeLessThanOrEqual(3)
      manager.stopCleanupTimer()
    })

    it('stopCleanupTimer is idempotent — safe to call when no timer is running', () => {
      expect(() => manager.stopCleanupTimer()).not.toThrow()
      expect(() => {
        manager.startCleanupTimer({ intervalMs: 10 })
        manager.stopCleanupTimer()
        manager.stopCleanupTimer()
      }).not.toThrow()
    })

    it('supervised tick: _purgeExpired throwing does NOT crash the timer', () => {
      // Force _purgeExpired to throw on the first call, then succeed
      let calls = 0
      const throwingManager = createMigrationCredentialManager({ db, logger: silentLogger })
      throwingManager._purgeExpired = () => {
        calls++
        if (calls === 1) throw new Error('simulated purge crash')
        return 0
      }

      throwingManager.startCleanupTimer({ intervalMs: 10 })
      vi.advanceTimersByTime(35)

      expect(calls).toBeGreaterThanOrEqual(2)
      expect(silentLogger.error).toHaveBeenCalled()
      // The error message must be about the credential manager, not a crash
      const [[payload]] = silentLogger.error.mock.calls
      expect(payload).toHaveProperty('err')

      throwingManager.stopCleanupTimer()
    })
  })

  describe('factory arguments', () => {
    it('throws when db is not provided', () => {
      expect(() => createMigrationCredentialManager({})).toThrow(/db is required/)
    })

    it('uses a default logger when none is provided', () => {
      // Just verify it does not throw at construction time.
      const m = createMigrationCredentialManager({ db })
      expect(typeof m.store).toBe('function')
      expect(typeof m.retrieve).toBe('function')
    })
  })
})
