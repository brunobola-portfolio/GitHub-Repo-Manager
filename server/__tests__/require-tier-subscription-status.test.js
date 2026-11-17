// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/*
 * Which Stripe subscription statuses keep the paid tier on the hosted app.
 * A first declined renewal (past_due) must not drop the customer to Free while
 * Stripe is still retrying; a refund or dispute hold, or a cancelled
 * subscription, must.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeIntegrationDb } from './helpers/integration-db.js'

const { initDB: realInitDB } = await vi.importActual('../db.js')
const testDb = makeIntegrationDb(realInitDB)
vi.mock('../db.js', () => ({ default: testDb }))
vi.mock('../lib/logger.js', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

const { getUserTier } = await import('../middleware/require-tier.js')

function subscribe(userId, status) {
    testDb.prepare('INSERT INTO users (id, username) VALUES (?, ?) ON CONFLICT(id) DO NOTHING').run(userId, `u${userId}`)
    testDb.prepare(`
        INSERT INTO user_subscriptions (user_id, tier, status, stripe_subscription_id) VALUES (?, 'pro', ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET status = excluded.status
    `).run(userId, status, `sub_${userId}`)
}

beforeEach(() => {
    process.env.DEPLOYMENT_MODE = 'saas'
})

describe('paid tier by subscription status', () => {
    it.each(['active', 'trialing', 'past_due'])('%s keeps Pro', (status) => {
        const id = 7000 + ['active', 'trialing', 'past_due'].indexOf(status)
        subscribe(id, status)
        expect(getUserTier(id)).toBe('pro')
    })

    it.each(['cancelled', 'unpaid', 'refunded', 'disputed', 'incomplete', 'incomplete_expired'])('%s is Free', (status) => {
        const id = 7100 + ['cancelled', 'unpaid', 'refunded', 'disputed', 'incomplete', 'incomplete_expired'].indexOf(status)
        subscribe(id, status)
        expect(getUserTier(id)).toBe('free')
    })
})
