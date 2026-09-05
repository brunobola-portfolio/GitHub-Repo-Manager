// @vitest-environment node
/**
 * G7 — migration 36 adds users.digest_frequency (default 'off') and
 * users.digest_last_sent_at (nullable), backing the opt-in digest e-mail.
 */
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { MIGRATIONS } from '../lib/db-migrations.js'

const migration = (v) => MIGRATIONS.find((m) => m.version === v)

function seedUsersTable() {
    const db = new Database(':memory:')
    db.exec(`
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL,
            email TEXT
        )
    `)
    db.prepare('INSERT INTO users (id, username, email) VALUES (?, ?, ?)').run(1, 'alice', 'alice@example.com')
    return db
}

describe('migration 36 — users.digest_frequency + digest_last_sent_at', () => {
    it('is registered right after 35, keeping versions contiguous', () => {
        expect(migration(36)).toBeDefined()
        const versions = MIGRATIONS.map((m) => m.version).sort((a, b) => a - b)
        for (let i = 1; i < versions.length; i++) expect(versions[i]).toBe(versions[i - 1] + 1)
    })

    it('adds digest_frequency defaulting to "off" for existing rows', () => {
        const db = seedUsersTable()
        migration(36).up(db)
        const row = db.prepare('SELECT digest_frequency, digest_last_sent_at FROM users WHERE id = 1').get()
        expect(row.digest_frequency).toBe('off')
        expect(row.digest_last_sent_at).toBeNull()
    })

    it('is idempotent — a second run does not error or reset existing values', () => {
        const db = seedUsersTable()
        migration(36).up(db)
        db.prepare("UPDATE users SET digest_frequency = 'weekly', digest_last_sent_at = '2026-09-01 00:00:00' WHERE id = 1").run()
        expect(() => migration(36).up(db)).not.toThrow()
        const row = db.prepare('SELECT digest_frequency, digest_last_sent_at FROM users WHERE id = 1').get()
        expect(row.digest_frequency).toBe('weekly')
        expect(row.digest_last_sent_at).toBe('2026-09-01 00:00:00')
    })
})
