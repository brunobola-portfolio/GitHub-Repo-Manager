// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest'
import Database from 'better-sqlite3'
import { createMigrationCredentialManager } from '../lib/migration-credential-manager.js'
import { handlePlanComplete } from '../lib/migration-plan-complete.js'

// The credential encryption module demands CREDENTIAL_ENCRYPTION_KEY or
// SESSION_SECRET. Set a dev fallback once for the whole suite.
const ORIGINAL_ENV = { ...process.env }
beforeAll(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-credential-key-for-plan-complete-unit-tests'
})
afterAll(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k]
  }
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) process.env[k] = v
})

// Minimal `migration_plans` schema — only the columns the credential manager
// touches. Mirrors the credential-manager unit test's fixture.
function createTestDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE migration_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'draft',
      credentials_enc TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  return db
}

function insertPlanWithCreds(db, manager, credentials, status = 'completed') {
  const res = db.prepare(`INSERT INTO migration_plans (status) VALUES (?)`).run(status)
  const planId = Number(res.lastInsertRowid)
  manager.store(planId, credentials)
  return planId
}

describe('handlePlanComplete — credential forget (defense-in-depth)', () => {
  let db
  let credentials
  let logger

  beforeEach(() => {
    db = createTestDb()
    logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
    credentials = createMigrationCredentialManager({ db, logger })
  })

  afterEach(() => {
    credentials.stopCleanupTimer()
    db.close()
  })

  it('clears credentials_enc after tagging settles when status is completed', async () => {
    const planId = insertPlanWithCreds(db, credentials, { azurePat: 'pat', githubToken: 'ghp' })
    const taggingService = { applyTaggingForPlan: vi.fn().mockResolvedValue() }

    await handlePlanComplete({ planId, status: 'completed' }, { taggingService, credentials, logger })

    expect(taggingService.applyTaggingForPlan).toHaveBeenCalledWith(planId)
    const row = db.prepare(`SELECT credentials_enc FROM migration_plans WHERE id = ?`).get(planId)
    expect(row.credentials_enc).toBeNull()
  })

  it('still forgets credentials even when tagging rejects', async () => {
    const planId = insertPlanWithCreds(db, credentials, { azurePat: 'pat' })
    const taggingService = { applyTaggingForPlan: vi.fn().mockRejectedValue(new Error('boom')) }

    await handlePlanComplete({ planId, status: 'completed' }, { taggingService, credentials, logger })

    const row = db.prepare(`SELECT credentials_enc FROM migration_plans WHERE id = ?`).get(planId)
    expect(row.credentials_enc).toBeNull()
    // tagging failure is logged, never thrown
    expect(logger.error).toHaveBeenCalled()
  })

  it('does NOT tag or forget when status is not completed', async () => {
    const planId = insertPlanWithCreds(db, credentials, { azurePat: 'pat' }, 'failed')
    const taggingService = { applyTaggingForPlan: vi.fn() }
    const forgetSpy = vi.spyOn(credentials, 'forget')

    await handlePlanComplete({ planId, status: 'failed' }, { taggingService, credentials, logger })

    expect(taggingService.applyTaggingForPlan).not.toHaveBeenCalled()
    expect(forgetSpy).not.toHaveBeenCalled()
    const row = db.prepare(`SELECT credentials_enc FROM migration_plans WHERE id = ?`).get(planId)
    expect(row.credentials_enc).not.toBeNull()
  })
})
