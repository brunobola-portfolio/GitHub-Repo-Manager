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

/**
 * The outbox worker calls tokenLookup once per row (up to 50 a tick) and each
 * uncached call parsed up to 200 session blobs — 10,000 JSON.parse calls per
 * tick to answer at most 50 distinct questions. The index is built once and
 * reused for a short, explicit TTL.
 */
describe('createSessionTokenLookup — memoization', () => {
  /** Wrap a db so every prepare().all() is counted. */
  function countingDb(base) {
    const calls = { all: 0 }
    return {
      calls,
      prepare(sql) {
        const stmt = base.prepare(sql)
        return {
          get: (...a) => stmt.get(...a),
          all: (...a) => { calls.all++; return stmt.all(...a) },
        }
      },
    }
  }

  it('scans the sessions table once for a whole burst of lookups', async () => {
    const base = makeDb()
    for (let i = 0; i < 20; i++) seedSession(base, `sid${i}`, i, `gho_${i}`)
    const counting = countingDb(base)
    const lookup = createSessionTokenLookup(counting)

    for (let i = 0; i < 20; i++) {
      expect(await lookup(i)).toBe(`gho_${i}`)
    }
    // 1 session scan (the sqlite_master probe uses .get(), not .all()).
    expect(counting.calls.all).toBe(1)
  })

  it('a cache miss inside the TTL does not trigger a rescan', async () => {
    const base = makeDb()
    seedSession(base, 'sid1', 42, 'gho_abc')
    const counting = countingDb(base)
    const lookup = createSessionTokenLookup(counting)

    expect(await lookup(42)).toBe('gho_abc')
    expect(await lookup(999)).toBe(null)
    expect(await lookup(999)).toBe(null)
    expect(counting.calls.all).toBe(1)
  })

  it('picks up a token change once the TTL has elapsed', async () => {
    const base = makeDb()
    seedSession(base, 'sid1', 42, 'gho_old')
    const lookup = createSessionTokenLookup(base, { cacheTtlMs: 20 })

    expect(await lookup(42)).toBe('gho_old')

    base.prepare('DELETE FROM sessions').run()
    seedSession(base, 'sid2', 42, 'gho_rotated')
    // Still inside the TTL — the index is intentionally a moment behind.
    expect(await lookup(42)).toBe('gho_old')

    await new Promise((r) => setTimeout(r, 30))
    expect(await lookup(42)).toBe('gho_rotated')
  })

  it('sees a logout (session deleted) after the TTL', async () => {
    const base = makeDb()
    seedSession(base, 'sid1', 42, 'gho_abc')
    const lookup = createSessionTokenLookup(base, { cacheTtlMs: 20 })
    expect(await lookup(42)).toBe('gho_abc')

    base.prepare('DELETE FROM sessions').run()
    await new Promise((r) => setTimeout(r, 30))
    expect(await lookup(42)).toBe(null)
  })
})
