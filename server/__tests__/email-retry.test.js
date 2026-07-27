// @vitest-environment node
/**
 * Tests for email retry + dead-letter queue (P1 resilience fix).
 *
 * Verifies:
 *   1. Happy-path: send succeeds first try → no retry, no DLQ insert.
 *   2. Retry on 5xx: third attempt succeeds → no DLQ insert.
 *   3. Exhausted retries: all 3 attempts 5xx → inserted into DLQ.
 *   4. 4xx is un-retryable: immediate failure, no retry, no DLQ.
 *   5. Retry worker picks up DLQ rows due for retry and resolves them.
 *   6. After 10 attempts, the worker stops retrying and stamps `last_error`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'

// -----------------------------------------------------------------------------
// Shared in-memory DB. We mock `../db.js` to point at this same Database
// instance so both `email.js` and `email-retry-worker.js` write to the same
// store across the test.
// -----------------------------------------------------------------------------
let memDb

function createDeadLetterTable(database) {
    database.exec(`
        CREATE TABLE IF NOT EXISTS email_dead_letter (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            to_address TEXT NOT NULL,
            subject TEXT NOT NULL,
            body_html TEXT,
            body_text TEXT,
            context_json TEXT,
            attempts INTEGER NOT NULL DEFAULT 1,
            last_error TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            next_retry_at DATETIME,
            resolved_at DATETIME
        )
    `)
    database.exec(
        `CREATE INDEX IF NOT EXISTS idx_email_dl_next_retry ON email_dead_letter(next_retry_at) WHERE resolved_at IS NULL`
    )
}

vi.mock('../db.js', () => {
    return {
        default: new Proxy({}, {
            get(_target, prop) {
                // Forward every property access to the current `memDb` instance.
                // This lets us swap DBs between tests without re-mocking.
                const val = memDb?.[prop]
                return typeof val === 'function' ? val.bind(memDb) : val
            },
        }),
    }
})

vi.mock('../lib/logger.js', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        fatal: vi.fn(),
    },
}))

describe('email retry + dead-letter', () => {
    let originalEnv

    beforeEach(() => {
        originalEnv = { ...process.env }
        memDb = new Database(':memory:')
        createDeadLetterTable(memDb)

        process.env.EMAIL_PROVIDER = 'resend'
        process.env.RESEND_API_KEY = 'test_key'
        process.env.EMAIL_FROM = 'noreply@bolalabs.pt'
        // Keep tests fast — real backoff would be 1 s / 3 s / 9 s.
        process.env.EMAIL_RETRY_BASE_DELAY_MS = '5'

        vi.resetModules()
    })

    afterEach(() => {
        try { memDb?.close() } catch { /* noop */ }
        memDb = null

        // Restore env
        for (const key of Object.keys(process.env)) {
            if (!(key in originalEnv)) delete process.env[key]
        }
        Object.assign(process.env, originalEnv)

        vi.restoreAllMocks()
        vi.useRealTimers()
    })

    // -------------------------------------------------------------------------
    // 1. Happy path — first attempt succeeds
    // -------------------------------------------------------------------------
    it('send succeeds first try → no retry, no DLQ insert', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ id: 'res_123' }),
        })
        vi.stubGlobal('fetch', mockFetch)

        const { sendEmail } = await import('../lib/email.js')
        const result = await sendEmail({
            to: 'user@example.com',
            subject: 'Hi',
            html: '<p>body</p>',
        })

        expect(result).toEqual({ ok: true, id: 'res_123' })
        expect(mockFetch).toHaveBeenCalledTimes(1)

        const count = memDb.prepare('SELECT COUNT(*) AS n FROM email_dead_letter').get().n
        expect(count).toBe(0)
    })

    // -------------------------------------------------------------------------
    // 2. 5xx twice, then success — returns ok, no DLQ row
    // -------------------------------------------------------------------------
    it('send fails with 500 twice → retries and eventually succeeds', async () => {
        const mockFetch = vi.fn()
            .mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                json: async () => ({ message: 'transient' }),
            })
            .mockResolvedValueOnce({
                ok: false,
                status: 502,
                statusText: 'Bad Gateway',
                json: async () => ({ message: 'transient' }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ id: 'res_ok' }),
            })
        vi.stubGlobal('fetch', mockFetch)

        const { sendEmail } = await import('../lib/email.js')
        const result = await sendEmail({
            to: 'user@example.com',
            subject: 'Retry me',
            html: '<p>hi</p>',
        })

        expect(result).toEqual({ ok: true, id: 'res_ok' })
        expect(mockFetch).toHaveBeenCalledTimes(3)

        const count = memDb.prepare('SELECT COUNT(*) AS n FROM email_dead_letter').get().n
        expect(count).toBe(0)
    })

    // -------------------------------------------------------------------------
    // 3. All 3 attempts 5xx → DLQ insert + { ok: false, dlqId }
    // -------------------------------------------------------------------------
    it('send fails 3× with 500 → inserts into DLQ, returns { ok: false, dlqId }', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: async () => ({ message: 'upstream' }),
        })
        vi.stubGlobal('fetch', mockFetch)

        const { sendEmail } = await import('../lib/email.js')
        const result = await sendEmail({
            to: 'user@example.com',
            subject: 'License',
            html: '<p>key</p>',
            context: { license_id: 42 },
        })

        expect(result.ok).toBe(false)
        expect(typeof result.dlqId).toBe('number')
        expect(result.error).toBeTruthy()
        expect(mockFetch).toHaveBeenCalledTimes(3)

        const row = memDb.prepare('SELECT * FROM email_dead_letter WHERE id = ?').get(result.dlqId)
        expect(row).toBeDefined()
        expect(row.to_address).toBe('user@example.com')
        expect(row.subject).toBe('License')
        expect(row.attempts).toBe(3)
        expect(row.last_error).toBeTruthy()
        expect(row.resolved_at).toBeNull()
        expect(row.next_retry_at).toBeTruthy()
        expect(JSON.parse(row.context_json)).toEqual({ license_id: 42 })
    })

    // -------------------------------------------------------------------------
    // 4. 4xx — un-retryable, no DLQ
    // -------------------------------------------------------------------------
    it('send fails with 400 → no retry, no DLQ (un-retryable)', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            json: async () => ({ message: 'invalid from address' }),
        })
        vi.stubGlobal('fetch', mockFetch)

        const { sendEmail } = await import('../lib/email.js')
        const result = await sendEmail({
            to: 'user@example.com',
            subject: 'Test',
            html: '<p>x</p>',
        })

        expect(result.ok).toBe(false)
        expect(result.error).toBeTruthy()
        expect(result.dlqId).toBeUndefined()
        expect(mockFetch).toHaveBeenCalledTimes(1)

        const count = memDb.prepare('SELECT COUNT(*) AS n FROM email_dead_letter').get().n
        expect(count).toBe(0)
    })

    // -------------------------------------------------------------------------
    // 5. Retry worker: picks up due DLQ rows + resolves on success
    // -------------------------------------------------------------------------
    it('runEmailRetryOnce picks up due DLQ rows; marks resolved_at on success', async () => {
        // Seed: one DLQ row due for retry (next_retry_at in the past) and
        // one not yet due (next_retry_at far in the future).
        const toSqlite = (d) => d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')
        const pastIso = toSqlite(new Date(Date.now() - 60 * 1000))
        const futureIso = toSqlite(new Date(Date.now() + 24 * 60 * 60 * 1000))
        memDb.prepare(`
            INSERT INTO email_dead_letter (to_address, subject, body_html, body_text, attempts, last_error, next_retry_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run('due@example.com', 'Due Subject', '<p>due</p>', 'due', 3, 'timeout', pastIso)
        memDb.prepare(`
            INSERT INTO email_dead_letter (to_address, subject, body_html, body_text, attempts, last_error, next_retry_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run('later@example.com', 'Later Subject', '<p>later</p>', 'later', 3, 'timeout', futureIso)

        // Stub fetch → succeed for the worker's retry.
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ id: 'worker_ok' }),
        }))

        const { runEmailRetryOnce } = await import('../lib/email-retry-worker.js')
        const summary = await runEmailRetryOnce()

        expect(summary.picked).toBe(1)
        expect(summary.resolved).toBe(1)

        const dueRow = memDb.prepare(`SELECT * FROM email_dead_letter WHERE to_address = ?`).get('due@example.com')
        expect(dueRow.resolved_at).toBeTruthy()

        const laterRow = memDb.prepare(`SELECT * FROM email_dead_letter WHERE to_address = ?`).get('later@example.com')
        expect(laterRow.resolved_at).toBeNull()
    })

    // -------------------------------------------------------------------------
    // 6. After 10 attempts, worker stops retrying; row remains unresolved
    // -------------------------------------------------------------------------
    it('after 10 attempts, worker stops retrying; row stays with resolved_at = NULL', async () => {
        // Seed a row that is already at MAX_ATTEMPTS (10) attempts.
        const toSqlite = (d) => d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')
        const pastIso = toSqlite(new Date(Date.now() - 60 * 1000))
        memDb.prepare(`
            INSERT INTO email_dead_letter (to_address, subject, body_html, body_text, attempts, last_error, next_retry_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run('dead@example.com', 'Dead Subject', '<p>dead</p>', 'dead', 10, 'exhausted', pastIso)

        // Also seed a row at 9 attempts so we can verify it gets picked up and
        // pushed to 10 → "given up".
        memDb.prepare(`
            INSERT INTO email_dead_letter (to_address, subject, body_html, body_text, attempts, last_error, next_retry_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run('almost@example.com', 'Almost Dead', '<p>almost</p>', 'almost', 9, 'fail', pastIso)

        // Fetch always 5xx.
        const mockFetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: async () => ({ message: 'still broken' }),
        })
        vi.stubGlobal('fetch', mockFetch)

        const { runEmailRetryOnce } = await import('../lib/email-retry-worker.js')
        const summary = await runEmailRetryOnce()

        // Only the 9-attempts row is picked up; the 10-attempts row is
        // already past MAX_ATTEMPTS and must not be retried.
        expect(summary.picked).toBe(1)
        expect(mockFetch).toHaveBeenCalledTimes(1)
        expect(summary.givenUp).toBe(1)
        expect(summary.resolved).toBe(0)

        const deadRow = memDb.prepare(`SELECT * FROM email_dead_letter WHERE to_address = ?`).get('dead@example.com')
        expect(deadRow.attempts).toBe(10)
        expect(deadRow.resolved_at).toBeNull()

        const almostRow = memDb.prepare(`SELECT * FROM email_dead_letter WHERE to_address = ?`).get('almost@example.com')
        expect(almostRow.attempts).toBe(10)
        expect(almostRow.resolved_at).toBeNull()
        expect(almostRow.next_retry_at).toBeNull()

        // A second pass must be a no-op (both rows now at MAX_ATTEMPTS).
        const second = await runEmailRetryOnce()
        expect(second.picked).toBe(0)
        expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    // -------------------------------------------------------------------------
    // 7. A dead retry worker must be loud
    // -------------------------------------------------------------------------
    it('logs a failed startup tick at ERROR, matching webhook-retry-worker', async () => {
        // Hand the worker a store whose query result is not iterable, so the
        // tick rejects the way any unforeseen breakage would.
        memDb.close()
        memDb = { prepare: () => ({ all: () => null }), close() {} }

        const logger = (await import('../lib/logger.js')).default
        logger.error.mockClear()
        logger.warn.mockClear()

        const { startEmailRetryWorker, stopEmailRetryWorker } = await import('../lib/email-retry-worker.js')
        try {
            startEmailRetryWorker({ intervalMs: 1_000_000 })
            await new Promise((r) => setImmediate(r))

            const startupMsg = /initial tick failed/
            const erroredStartup = logger.error.mock.calls.some(([, m]) => startupMsg.test(m ?? ''))
            expect(erroredStartup).toBe(true)
            // The startup failure must not be buried at WARN.
            const warnedStartup = logger.warn.mock.calls.some(([, m]) => startupMsg.test(m ?? ''))
            expect(warnedStartup).toBe(false)
        } finally {
            stopEmailRetryWorker()
        }
    })
})
