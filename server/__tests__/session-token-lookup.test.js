import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createSessionTokenLookup } from '../lib/session-token-lookup.js'

function makeDb({ withSessionsTable = true } = {}) {
  const db = new Database(':memory:')
  if (withSessionsTable) {
    db.exec(`CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires INTEGER NOT NULL
    )`)
  }
  return db
}

function seedSession(db, sid, userId, accessToken, { expires } = {}) {
  db.prepare(`INSERT INTO sessions (id, data, expires) VALUES (?, ?, ?)`).run(
    sid,
    JSON.stringify({ userId, accessToken }),
    expires ?? Date.now() + 60_000
  )
}

describe('createSessionTokenLookup', () => {
  let db

  beforeEach(() => { db = null })

  it('returns the accessToken for a userId with a live session', async () => {
    db = makeDb()
    seedSession(db, 'sid1', 42, 'gho_abc')
    const lookup = createSessionTokenLookup(db)
    expect(await lookup(42)).toBe('gho_abc')
  })

  it('returns null when no session matches userId', async () => {
    db = makeDb()
    seedSession(db, 'sid1', 99, 'gho_other')
    const lookup = createSessionTokenLookup(db)
    expect(await lookup(42)).toBe(null)
  })

  it('ignores expired sessions', async () => {
    db = makeDb()
    seedSession(db, 'sid1', 42, 'gho_old', { expires: Date.now() - 1000 })
    const lookup = createSessionTokenLookup(db)
    expect(await lookup(42)).toBe(null)
  })

  it('returns null when sessions table does not exist (Redis mode)', async () => {
    db = makeDb({ withSessionsTable: false })
    const lookup = createSessionTokenLookup(db)
    expect(await lookup(42)).toBe(null)
  })

  it('skips malformed session blobs without throwing', async () => {
    db = makeDb()
    db.prepare(`INSERT INTO sessions (id, data, expires) VALUES (?, ?, ?)`).run('bad', 'not json {', Date.now() + 60_000)
    seedSession(db, 'good', 42, 'gho_ok')
    const lookup = createSessionTokenLookup(db)
    expect(await lookup(42)).toBe('gho_ok')
  })

  it('returns most recent token when multiple sessions exist for same user', async () => {
    db = makeDb()
    seedSession(db, 'old', 42, 'gho_old', { expires: Date.now() + 30_000 })
    seedSession(db, 'new', 42, 'gho_new', { expires: Date.now() + 60_000 })
    const lookup = createSessionTokenLookup(db)
    expect(await lookup(42)).toBe('gho_new')
  })
})
