// @vitest-environment node
/**
 * attachTier runs app-wide, before any route-level apiKeyAuth. A bearer
 * request therefore looked anonymous to it: every API key was gated and
 * rate-budgeted as Free, so an Enterprise key got 403 on Enterprise routes.
 */
import { describe, it, expect, vi } from 'vitest'

const OWNER = 42

vi.mock('../db.js', () => ({
    default: {
        prepare: (sql) => ({
            get: (userId) => (/FROM user_subscriptions/.test(sql) && userId === OWNER ? { tier: 'enterprise' } : null),
            all: () => [],
            run: () => ({ changes: 0 }),
        }),
        transaction: (fn) => fn,
        exec: () => {},
        pragma: () => {},
    },
}))

vi.mock('../middleware/api-key-auth.js', async (io) => ({
    ...(await io()),
    resolveBearerKeyOwner: (req) => (req.headers?.authorization === 'Bearer grm_live_real' ? OWNER : null),
}))

const { attachTier } = await import('../middleware/require-tier.js')

function run(headers) {
    const req = { headers, session: {} }
    attachTier(req, {}, () => {})
    return req.userTier
}

describe('attachTier with an API key', () => {
    it("uses the key owner's tier for a live key", () => {
        expect(run({ authorization: 'Bearer grm_live_real' })).toBe('enterprise')
    })
    it('treats a forged key as anonymous', () => {
        expect(run({ authorization: 'Bearer grm_live_forged' })).toBe('free')
    })
})
