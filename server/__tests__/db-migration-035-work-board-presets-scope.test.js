// @vitest-environment node
/**
 * G5 — migration 35 widens work_board_presets' UNIQUE(user_id, name) to
 * UNIQUE(user_id, scope, name) via a table rebuild (SQLite can't ALTER a
 * UNIQUE constraint in place). Covers: existing rows survive tagged
 * 'work-board', the new scope isolation actually works, and the rebuild is
 * idempotent (safe to run against an already-migrated DB).
 */
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { MIGRATIONS } from '../lib/db-migrations.js'

const migration = (v) => MIGRATIONS.find((m) => m.version === v)

function seedPreMigrationDb() {
    const db = new Database(':memory:')
    // The FK target: SQLite allows CREATE TABLE with a forward FK reference,
    // but validates the parent table exists as soon as a row is touched.
    db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY)`)
    db.prepare('INSERT INTO users (id) VALUES (1), (2)').run()
    db.exec(`
        CREATE TABLE work_board_presets (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL,
            name       TEXT    NOT NULL,
            filters    TEXT    NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (user_id, name)
        )
    `)
    db.prepare(`INSERT INTO work_board_presets (user_id, name, filters) VALUES (?, ?, ?)`)
        .run(1, 'My review queue', '{"repos":["acme/x"]}')
    db.prepare(`INSERT INTO work_board_presets (user_id, name, filters) VALUES (?, ?, ?)`)
        .run(2, 'Another user preset', '{}')
    return db
}

describe('migration 35 — work_board_presets scope column', () => {
    it('is registered right after 34, keeping versions contiguous', () => {
        expect(migration(35)).toBeDefined()
        const versions = MIGRATIONS.map((m) => m.version).sort((a, b) => a - b)
        for (let i = 1; i < versions.length; i++) expect(versions[i]).toBe(versions[i - 1] + 1)
    })

    it('tags every pre-existing row with scope "work-board" and preserves data', () => {
        const db = seedPreMigrationDb()
        migration(35).up(db)

        const rows = db.prepare('SELECT user_id, scope, name, filters FROM work_board_presets ORDER BY user_id').all()
        expect(rows).toEqual([
            { user_id: 1, scope: 'work-board', name: 'My review queue', filters: '{"repos":["acme/x"]}' },
            { user_id: 2, scope: 'work-board', name: 'Another user preset', filters: '{}' },
        ])
    })

    it('widens the UNIQUE constraint so the same name works across scopes', () => {
        const db = seedPreMigrationDb()
        migration(35).up(db)

        // Same user, same name, different scope must now be allowed.
        expect(() => db.prepare(
            `INSERT INTO work_board_presets (user_id, scope, name, filters) VALUES (?, ?, ?, ?)`
        ).run(1, 'repos', 'My review queue', '{}')).not.toThrow()

        // Same user, same scope, same name must still collide.
        expect(() => db.prepare(
            `INSERT INTO work_board_presets (user_id, scope, name, filters) VALUES (?, ?, ?, ?)`
        ).run(1, 'work-board', 'My review queue', '{}')).toThrow(/UNIQUE/i)
    })

    it('is idempotent — a second run against an already-migrated DB is a no-op', () => {
        const db = seedPreMigrationDb()
        migration(35).up(db)
        expect(() => migration(35).up(db)).not.toThrow()
        const count = db.prepare('SELECT COUNT(*) c FROM work_board_presets').get().c
        expect(count).toBe(2)
    })

    it('leaves an already-scoped table untouched', () => {
        const db = new Database(':memory:')
        db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY)`)
        db.prepare('INSERT INTO users (id) VALUES (1)').run()
        db.exec(`
            CREATE TABLE work_board_presets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                scope TEXT NOT NULL DEFAULT 'work-board',
                name TEXT NOT NULL,
                filters TEXT NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (user_id, scope, name)
            )
        `)
        db.prepare(`INSERT INTO work_board_presets (user_id, scope, name, filters) VALUES (?, ?, ?, ?)`)
            .run(1, 'repos', 'Already scoped', '{}')
        expect(() => migration(35).up(db)).not.toThrow()
        expect(db.prepare('SELECT scope, name FROM work_board_presets').get()).toEqual({ scope: 'repos', name: 'Already scoped' })
    })
})
