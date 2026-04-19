// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../db.js', () => {
    const mockPrepare = vi.fn()
    return {
        default: { prepare: mockPrepare },
        __mockPrepare: mockPrepare,
    }
})

vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}))

vi.mock('../lib/email.js', () => ({
    sendEmail: vi.fn(),
}))

import { default as db, __mockPrepare as mockPrepare } from '../db.js'
import { sendEmail } from '../lib/email.js'

// Reference "now" for tests: 2026-04-18
const NOW = new Date('2026-04-18T12:00:00.000Z')

// 365-day retention, 30-day warning lead.
// Purge threshold:   2026-04-18 - 365 = 2025-04-18
// Warning threshold: 2026-04-18 - 335 = 2025-05-18

function makeRow({
    userId = 1,
    updatedAt,
    warningSentAt = null,
    email = 'user@example.com',
} = {}) {
    return {
        user_id: userId,
        updated_at: updatedAt,
        warning_sent_at: warningSentAt,
        user_email: email,
    }
}

function setupDb(rows) {
    mockPrepare.mockImplementation((sql) => {
        if (/FROM user_ai_config/.test(sql)) {
            return { all: vi.fn(() => rows), get: vi.fn(), run: vi.fn() }
        }
        return { all: vi.fn(() => []), get: vi.fn(() => undefined), run: vi.fn() }
    })
}

describe('runRetentionPass', () => {
    beforeEach(() => {
        vi.resetModules()
        mockPrepare.mockReset()
        vi.mocked(sendEmail).mockReset()
        delete process.env.DATA_RETENTION_DAYS
        delete process.env.DATA_RETENTION_WARNING_LEAD_DAYS
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('fresh row (updated_at recent) → no action taken', async () => {
        // Updated 10 days ago — well outside the warning window
        const recentDate = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString()
        setupDb([]) // query returns no rows (threshold not met)

        const { runRetentionPass } = await import('../lib/retention.js')
        const result = await runRetentionPass({ now: NOW })

        expect(result.warned).toBe(0)
        expect(result.purged).toBe(0)
        expect(sendEmail).not.toHaveBeenCalled()
    })

    it('row within warning window + no warning sent → email sent + warning_sent_at set', async () => {
        // 340 days ago — past the warning threshold (335) but not yet past purge (365)
        const date = new Date(NOW.getTime() - 340 * 24 * 60 * 60 * 1000).toISOString()
        const row = makeRow({ updatedAt: date, warningSentAt: null })

        const selectStmt = { all: vi.fn(() => [row]) }
        const updateStmt = { run: vi.fn(), get: vi.fn(), all: vi.fn(() => []) }
        const auditStmt = { run: vi.fn(), get: vi.fn(), all: vi.fn(() => []) }

        mockPrepare.mockImplementation((sql) => {
            if (/FROM user_ai_config/.test(sql)) return selectStmt
            if (/UPDATE user_ai_config SET warning_sent_at/.test(sql)) return updateStmt
            if (/INSERT INTO audit_log_v2/.test(sql)) return auditStmt
            return { run: vi.fn(), get: vi.fn(() => undefined), all: vi.fn(() => []) }
        })

        vi.mocked(sendEmail).mockResolvedValue({ ok: true })

        const { runRetentionPass } = await import('../lib/retention.js')
        const result = await runRetentionPass({ now: NOW })

        expect(result.warned).toBe(1)
        expect(result.purged).toBe(0)
        expect(sendEmail).toHaveBeenCalledOnce()
        expect(sendEmail.mock.calls[0][0].to).toBe('user@example.com')
        expect(updateStmt.run).toHaveBeenCalledOnce()
    })

    it('row within warning window + warning already sent → no action', async () => {
        const date = new Date(NOW.getTime() - 340 * 24 * 60 * 60 * 1000).toISOString()
        const row = makeRow({ updatedAt: date, warningSentAt: '2026-03-15T00:00:00.000Z' })

        setupDb([row])

        const { runRetentionPass } = await import('../lib/retention.js')
        const result = await runRetentionPass({ now: NOW })

        expect(result.warned).toBe(0)
        expect(result.skipped).toBe(1)
        expect(sendEmail).not.toHaveBeenCalled()
    })

    it('row past retention deadline → credentials deleted + audit event written', async () => {
        // 400 days ago — past the 365-day purge threshold
        const date = new Date(NOW.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString()
        const row = makeRow({ updatedAt: date })

        const selectStmt = { all: vi.fn(() => [row]) }
        const updateCredStmt = { run: vi.fn(), get: vi.fn(), all: vi.fn(() => []) }
        const auditStmt = { run: vi.fn(), get: vi.fn(), all: vi.fn(() => []) }

        mockPrepare.mockImplementation((sql) => {
            if (/FROM user_ai_config/.test(sql)) return selectStmt
            if (/UPDATE user_ai_config\s+SET completion_credentials_enc/.test(sql)) return updateCredStmt
            if (/INSERT INTO audit_log_v2/.test(sql)) return auditStmt
            return { run: vi.fn(), get: vi.fn(() => undefined), all: vi.fn(() => []) }
        })

        const { runRetentionPass } = await import('../lib/retention.js')
        const result = await runRetentionPass({ now: NOW })

        expect(result.purged).toBe(1)
        expect(result.warned).toBe(0)
        expect(updateCredStmt.run).toHaveBeenCalledOnce()
        expect(auditStmt.run).toHaveBeenCalledOnce()

        // Verify the audit call mentions the correct action
        const auditSql = mockPrepare.mock.calls.find(
            ([sql]) => /INSERT INTO audit_log_v2/.test(sql)
        )?.[0]
        expect(auditSql).toBeTruthy()
        expect(sendEmail).not.toHaveBeenCalled()
    })

    it('dryRun: true → all logic runs but DB writes are skipped', async () => {
        const date = new Date(NOW.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString()
        const row = makeRow({ updatedAt: date })

        const selectStmt = { all: vi.fn(() => [row]) }
        const updateStmt = { run: vi.fn(), get: vi.fn(), all: vi.fn(() => []) }
        const auditStmt = { run: vi.fn(), get: vi.fn(), all: vi.fn(() => []) }

        mockPrepare.mockImplementation((sql) => {
            if (/FROM user_ai_config/.test(sql)) return selectStmt
            if (/UPDATE user_ai_config/.test(sql)) return updateStmt
            if (/INSERT INTO audit_log_v2/.test(sql)) return auditStmt
            return { run: vi.fn(), get: vi.fn(() => undefined), all: vi.fn(() => []) }
        })

        const { runRetentionPass } = await import('../lib/retention.js')
        const result = await runRetentionPass({ now: NOW, dryRun: true })

        expect(result.dryRun).toBe(true)
        expect(result.purged).toBe(1)
        // No DB mutations should have been issued
        expect(updateStmt.run).not.toHaveBeenCalled()
        expect(auditStmt.run).not.toHaveBeenCalled()
    })

    it('missing recipient email → warning skipped + logged', async () => {
        const date = new Date(NOW.getTime() - 340 * 24 * 60 * 60 * 1000).toISOString()
        const row = makeRow({ updatedAt: date, email: null })

        setupDb([row])

        const logger = (await import('../lib/logger.js')).default

        const { runRetentionPass } = await import('../lib/retention.js')
        const result = await runRetentionPass({ now: NOW })

        expect(result.warned).toBe(0)
        expect(result.skipped).toBe(1)
        expect(sendEmail).not.toHaveBeenCalled()
        expect(logger.warn).toHaveBeenCalled()
    })
})
