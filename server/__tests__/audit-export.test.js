// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const rows = [
    {
        id: 42, created_at: '2026-07-27T10:00:00Z', action: 'repo.delete',
        resource_type: 'repo', resource_id: 'acme/api',
        details: '{"reason":"cleanup, urgent"}', ip_address: '10.0.0.1',
        user_agent: 'Mozilla/5.0 "Test"', prev_hash: 'aaa', row_hash: 'bbb',
    },
    {
        id: 41, created_at: '2026-07-26T09:00:00Z', action: 'ai.generate',
        resource_type: 'ai', resource_id: null,
        details: 'line one\nline two', ip_address: null,
        user_agent: null, prev_hash: 'ccc', row_hash: 'ddd',
    },
]

const all = vi.fn(() => rows)
vi.mock('../db.js', () => ({
    default: { prepare: vi.fn(() => ({ all: (...a) => all(...a), get: () => ({ total: rows.length }) })) },
}))

vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, _res, next) => { req.session = { userId: 7 }; next() },
}))

let currentTier = 'enterprise'
vi.mock('../middleware/require-tier.js', () => ({
    requireTier: () => (req, res, next) => (
        currentTier === 'enterprise' ? next() : res.status(403).json({ error: 'Tier required' })
    ),
    getUserTier: () => currentTier,
}))

let features = { auditExport: true }
vi.mock('../lib/feature-flags.js', () => ({ getFeatures: () => features }))

const auditLog = vi.fn()
vi.mock('../lib/audit.js', () => ({ auditLog: (...a) => auditLog(...a) }))

const { default: auditRouter } = await import('../routes/audit.js')

function makeApp() {
    const app = express()
    app.use('/audit', auditRouter)
    return app
}

beforeEach(() => {
    vi.clearAllMocks()
    all.mockReturnValue(rows)
    currentTier = 'enterprise'
    features = { auditExport: true }
})

describe('GET /audit/export', () => {
    it('returns CSV with a header row and an attachment filename by default', async () => {
        const res = await request(makeApp()).get('/audit/export')
        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toMatch(/text\/csv/)
        expect(res.headers['content-disposition']).toMatch(/attachment; filename="audit-log-\d{4}-\d{2}-\d{2}\.csv"/)
        const [header, ...body] = res.text.trim().split('\r\n')
        expect(header).toBe('id,created_at,action,resource_type,resource_id,details,ip_address,user_agent,prev_hash,row_hash')
        expect(body).toHaveLength(2)
    })

    it('quotes and escapes cells that would otherwise break the CSV structure', async () => {
        const res = await request(makeApp()).get('/audit/export')
        // Comma inside details, embedded double quotes, and an embedded newline
        // must all survive as ONE field each.
        expect(res.text).toContain('"{""reason"":""cleanup, urgent""}"')
        expect(res.text).toContain('"Mozilla/5.0 ""Test"""')
        expect(res.text).toContain('"line one\nline two"')
    })

    it('renders empty cells for nulls rather than the string "null"', async () => {
        const res = await request(makeApp()).get('/audit/export')
        const lastRow = res.text.trim().split('\r\n').at(-1)
        expect(lastRow.startsWith('41,')).toBe(true)
        expect(lastRow).not.toContain('null')
    })

    it('serves JSON when asked, with a keyset cursor', async () => {
        const res = await request(makeApp()).get('/audit/export?format=json&limit=2')
        expect(res.status).toBe(200)
        expect(res.body.count).toBe(2)
        // A full page means there may be more — the cursor is the last id seen.
        expect(res.body.nextBefore).toBe(41)
    })

    it('reports no cursor when the page is not full', async () => {
        all.mockReturnValue([rows[0]])
        const res = await request(makeApp()).get('/audit/export?format=json&limit=2')
        expect(res.body.nextBefore).toBeNull()
    })

    it('scopes every query to the session user', async () => {
        await request(makeApp()).get('/audit/export')
        expect(all.mock.calls[0][0]).toBe(7)
    })

    it('rejects a non-numeric before cursor instead of binding it', async () => {
        const res = await request(makeApp()).get('/audit/export?before=1;DROP')
        expect(res.status).toBe(400)
        expect(all).not.toHaveBeenCalled()
    })

    it('rejects malformed dates', async () => {
        expect((await request(makeApp()).get('/audit/export?from=nonsense')).status).toBe(400)
        expect((await request(makeApp()).get('/audit/export?to=nonsense')).status).toBe(400)
    })

    it('clamps limit to the export ceiling', async () => {
        await request(makeApp()).get('/audit/export?limit=999999')
        expect(all.mock.calls[0].at(-1)).toBe(10000)
    })

    it('is refused for a non-Enterprise tier', async () => {
        currentTier = 'pro'
        const res = await request(makeApp()).get('/audit/export')
        expect(res.status).toBe(403)
        expect(all).not.toHaveBeenCalled()
    })

    // The flag is what the commercial licence actually promises, so it gates
    // the route on its own — not just the tier name.
    it('is refused when auditExport is off even for Enterprise', async () => {
        features = { auditExport: false }
        const res = await request(makeApp()).get('/audit/export')
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('TIER_REQUIRED_ENTERPRISE')
        expect(all).not.toHaveBeenCalled()
    })

    it('audits the export itself', async () => {
        await request(makeApp()).get('/audit/export')
        expect(auditLog).toHaveBeenCalledWith(
            expect.anything(), 'audit.export', 'audit', null,
            expect.objectContaining({ format: 'csv', rows: 2 }),
        )
    })
})
