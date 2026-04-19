// @vitest-environment node
/**
 * Actions webhook handler — verifies signature handshake and the recently
 * tightened error-propagation contract.
 *
 * Behaviour under test:
 *  - Missing / wrong signature → 401 (actionsService NOT called)
 *  - Malformed JSON → 400
 *  - Missing required fields → 400
 *  - Happy path: 200 + actionsService writes
 *  - DB persistence failure → 500 (so GitHub retries). Previously this
 *    returned 200 with a logged error, silently losing the event.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const mockVerifySignature = vi.fn()
const mockStoreWorkflowRun = vi.fn()
const mockUpdateWorkflowMeta = vi.fn()

vi.mock('../middleware/auth.js', () => ({
    verifyWebhookSignature: (...a) => mockVerifySignature(...a),
    errorResponse: (res, status, message) => res.status(status).json({ error: message }),
}))

vi.mock('../actions-service.js', () => ({
    actionsService: {
        storeWorkflowRun: (...a) => mockStoreWorkflowRun(...a),
        updateWorkflowMeta: (...a) => mockUpdateWorkflowMeta(...a),
    },
}))

vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { actionsWebhookHandler } = await import('../routes/webhooks.js')

function makeApp() {
    const app = express()
    // The real deployment mounts this BEFORE express.json() and uses
    // express.raw so req.body is a Buffer for HMAC verification. Replicate
    // that shape here — supertest will send a raw body as we supply.
    app.use(express.raw({ type: '*/*' }))
    app.post('/webhook', actionsWebhookHandler)
    app.use((err, _req, res, _next) => {
        res.status(500).json({ error: 'unhandled', message: err.message })
    })
    return app
}

beforeEach(() => {
    mockVerifySignature.mockReset().mockReturnValue(true)
    mockStoreWorkflowRun.mockReset()
    mockUpdateWorkflowMeta.mockReset()
})

const VALID_PAYLOAD = {
    action: 'completed',
    workflow_run: { id: 999, workflow_id: 42, status: 'completed' },
    repository: { id: 100, full_name: 'acme/app' },
}

describe('actionsWebhookHandler', () => {
    it('rejects request with invalid signature (401) and never touches the DB', async () => {
        mockVerifySignature.mockReturnValue(false)
        const res = await request(makeApp())
            .post('/webhook')
            .set('Content-Type', 'application/json')
            .set('X-Hub-Signature-256', 'sha256=bogus')
            .send(JSON.stringify(VALID_PAYLOAD))
        expect(res.status).toBe(401)
        expect(mockStoreWorkflowRun).not.toHaveBeenCalled()
        expect(mockUpdateWorkflowMeta).not.toHaveBeenCalled()
    })

    it('rejects malformed JSON (400)', async () => {
        const res = await request(makeApp())
            .post('/webhook')
            .set('Content-Type', 'application/json')
            .send('{not-json')
        expect(res.status).toBe(400)
        expect(mockStoreWorkflowRun).not.toHaveBeenCalled()
    })

    it('rejects payload missing repository.id (400)', async () => {
        const broken = { ...VALID_PAYLOAD, repository: { full_name: 'acme/app' } }
        const res = await request(makeApp())
            .post('/webhook')
            .set('Content-Type', 'application/json')
            .send(JSON.stringify(broken))
        expect(res.status).toBe(400)
        expect(mockStoreWorkflowRun).not.toHaveBeenCalled()
    })

    it('happy path — 200 and both service writes executed', async () => {
        const res = await request(makeApp())
            .post('/webhook')
            .set('Content-Type', 'application/json')
            .set('X-Hub-Signature-256', 'sha256=good')
            .send(JSON.stringify(VALID_PAYLOAD))
        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(mockStoreWorkflowRun).toHaveBeenCalledWith(VALID_PAYLOAD.workflow_run)
        expect(mockUpdateWorkflowMeta).toHaveBeenCalledWith(100, 42)
    })

    it('ignores events without workflow_run (e.g. ping) and still 200s', async () => {
        const pingPayload = { zen: 'keep it simple', hook_id: 1 }
        const res = await request(makeApp())
            .post('/webhook')
            .set('Content-Type', 'application/json')
            .set('X-Hub-Signature-256', 'sha256=good')
            .send(JSON.stringify(pingPayload))
        expect(res.status).toBe(200)
        expect(mockStoreWorkflowRun).not.toHaveBeenCalled()
        expect(mockUpdateWorkflowMeta).not.toHaveBeenCalled()
    })

    it('propagates a DB persistence failure as 500 so GitHub retries', async () => {
        mockStoreWorkflowRun.mockImplementation(() => {
            throw new Error('SQLITE_BUSY')
        })
        const res = await request(makeApp())
            .post('/webhook')
            .set('Content-Type', 'application/json')
            .set('X-Hub-Signature-256', 'sha256=good')
            .send(JSON.stringify(VALID_PAYLOAD))
        expect(res.status).toBe(500)
        // Critical: we NO LONGER return 200 on persistence failure. This test
        // pins that contract so a future regression stands out.
        expect(res.body.success).toBeUndefined()
    })
})
