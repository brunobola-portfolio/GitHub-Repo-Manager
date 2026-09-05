// @vitest-environment node
/**
 * G7 — digest e-mail delivery.
 *
 *  - runDigestPassOnce() skips entirely (never even queries) when
 *    isEmailDeliveryConfigured() is false.
 *  - findDueDigestUsers() sends once per period per user: a user with a
 *    recent digest_last_sent_at for their frequency is NOT due; one whose
 *    period has elapsed (or who has never been sent one) IS due.
 *  - sendDigestEmail() only records digest_last_sent_at on a successful send.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../config.js', () => ({ config: { frontendUrl: 'https://app.example.test' } }))

let users = []
const dbGetAll = vi.fn(() => users)
const dbRun = vi.fn()
vi.mock('../db.js', () => ({
    default: {
        prepare: vi.fn((sql) => ({
            all: (...a) => dbGetAll(sql, ...a),
            run: (...a) => dbRun(sql, ...a),
        })),
    },
}))

vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

let emailConfigured = true
const sendEmailMock = vi.fn(async () => ({ ok: true, id: 'msg-1' }))
vi.mock('../lib/email.js', () => ({
    sendEmail: (...a) => sendEmailMock(...a),
    isEmailDeliveryConfigured: () => emailConfigured,
}))

const buildDigestMock = vi.fn(() => ({
    since: '2026-08-01T00:00:00.000Z',
    now: '2026-09-01T00:00:00.000Z',
    totals: { reviews: 1, issues: 0, failed_migrations: 0, stale_pinned: 0 },
    items: { reviews: [{ repo: 'acme/api', prNumber: 5, title: 'Fix bug' }], issues: [], failed_migrations: [], stale_pinned: [] },
}))
vi.mock('../lib/notifications-digest.js', () => ({
    buildNotificationsDigest: (...a) => buildDigestMock(...a),
}))

vi.mock('../lib/digest-unsubscribe-token.js', () => ({
    issueUnsubscribeToken: (userId) => `token-for-${userId}`,
}))

const {
    findDueDigestUsers,
    sendDigestEmail,
    runDigestPassOnce,
    buildDigestEmailHtml,
    buildDigestEmailText,
} = await import('../lib/digest-mailer.js')

function user(overrides = {}) {
    return {
        id: 1, username: 'alice', email: 'alice@example.com',
        digest_frequency: 'daily', digest_last_sent_at: null,
        notifications_last_seen_at: null,
        ...overrides,
    }
}

beforeEach(() => {
    vi.clearAllMocks()
    emailConfigured = true
    users = []
    dbGetAll.mockImplementation(() => users)
})

describe('runDigestPassOnce — skips when email is not configured', () => {
    it('never queries for due users when isEmailDeliveryConfigured() is false', async () => {
        emailConfigured = false
        users = [user()]
        const result = await runDigestPassOnce()
        expect(result).toEqual({ skipped: true, reason: 'email_not_configured', sent: 0, checked: 0 })
        expect(dbGetAll).not.toHaveBeenCalled()
        expect(sendEmailMock).not.toHaveBeenCalled()
    })

    it('proceeds normally when email IS configured', async () => {
        users = [user()]
        const result = await runDigestPassOnce({ now: new Date('2026-09-01T00:00:00Z') })
        expect(result.skipped).toBe(false)
        expect(result.sent).toBe(1)
        expect(sendEmailMock).toHaveBeenCalledTimes(1)
    })
})

describe('findDueDigestUsers — once per period per user', () => {
    const NOW = new Date('2026-09-08T00:00:00Z')

    it('a user who has never received a digest is due', () => {
        users = [user({ digest_last_sent_at: null })]
        expect(findDueDigestUsers(NOW)).toHaveLength(1)
    })

    it('a daily user sent 12h ago is NOT due again yet', () => {
        users = [user({ digest_frequency: 'daily', digest_last_sent_at: '2026-09-07T12:00:00.000Z' })]
        expect(findDueDigestUsers(NOW)).toHaveLength(0)
    })

    it('a daily user sent 25h ago IS due again', () => {
        users = [user({ digest_frequency: 'daily', digest_last_sent_at: '2026-09-06T23:00:00.000Z' })]
        expect(findDueDigestUsers(NOW)).toHaveLength(1)
    })

    it('a weekly user sent 3 days ago is NOT due yet', () => {
        users = [user({ digest_frequency: 'weekly', digest_last_sent_at: '2026-09-05T00:00:00.000Z' })]
        expect(findDueDigestUsers(NOW)).toHaveLength(0)
    })

    it('a weekly user sent 8 days ago IS due', () => {
        users = [user({ digest_frequency: 'weekly', digest_last_sent_at: '2026-08-31T00:00:00.000Z' })]
        expect(findDueDigestUsers(NOW)).toHaveLength(1)
    })

    it('the SQL query already excludes off/no-email users — trusts the WHERE clause', () => {
        users = [user()]
        findDueDigestUsers(NOW)
        expect(dbGetAll.mock.calls[0][0]).toMatch(/digest_frequency IN \('daily', 'weekly'\)/)
        expect(dbGetAll.mock.calls[0][0]).toMatch(/email IS NOT NULL/)
    })
})

describe('sendDigestEmail', () => {
    it('records digest_last_sent_at only on a successful send', async () => {
        sendEmailMock.mockResolvedValueOnce({ ok: true, id: 'x' })
        const ok = await sendDigestEmail(user(), { now: new Date('2026-09-01T00:00:00Z') })
        expect(ok).toBe(true)
        expect(dbRun).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE users SET digest_last_sent_at'),
            '2026-09-01T00:00:00.000Z', 1,
        )
    })

    it('does NOT record digest_last_sent_at when the send fails', async () => {
        sendEmailMock.mockResolvedValueOnce({ ok: false, error: 'boom' })
        const ok = await sendDigestEmail(user(), { now: new Date('2026-09-01T00:00:00Z') })
        expect(ok).toBe(false)
        expect(dbRun).not.toHaveBeenCalled()
    })

    it('builds an unsubscribe link with no session/auth requirement baked into the URL', async () => {
        await sendDigestEmail(user())
        const call = sendEmailMock.mock.calls[0][0]
        expect(call.html).toContain('https://app.example.test/api/v1/notifications/digest/unsubscribe?token=token-for-1')
        expect(call.text).toContain('https://app.example.test/api/v1/notifications/digest/unsubscribe?token=token-for-1')
    })

    it('subject reflects the item count from the digest', async () => {
        await sendDigestEmail(user())
        expect(sendEmailMock.mock.calls[0][0].subject).toMatch(/1 item/)
    })
})

describe('digest email rendering', () => {
    const digest = {
        since: '2026-08-01T00:00:00.000Z',
        totals: { reviews: 1, issues: 0, failed_migrations: 0, stale_pinned: 0 },
        items: { reviews: [{ repo: 'acme/api', prNumber: 5, title: 'Fix <bug>' }], issues: [], failed_migrations: [], stale_pinned: [] },
    }

    it('HTML escapes user-controlled content (repo/title) to prevent injection', () => {
        const html = buildDigestEmailHtml(digest, { username: 'alice', unsubscribeUrl: 'https://x/unsub' })
        expect(html).not.toContain('<bug>')
        expect(html).toContain('&lt;bug&gt;')
    })

    it('text rendering lists the review item plainly', () => {
        const text = buildDigestEmailText(digest, { username: 'alice', unsubscribeUrl: 'https://x/unsub' })
        expect(text).toContain('acme/api #5')
    })
})
