// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.
/*
 * An instance licence must not upgrade a multi-tenant deployment.
 *
 * A licence key says "this deployment is Pro", which is right when the
 * operator and the user are the same person. `getUserTier(userId)` used the
 * userId only for the Stripe lookup and then returned the module-global
 * cached licence tier to ANY caller — including `userId === undefined`, which
 * is every unauthenticated /api/* request, since attachTier runs on all of
 * them. So on a Stripe-billed deployment, the key the operator installed for
 * themselves silently made every signup Pro, including its rate-limit budget.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../db.js', () => ({ default: { prepare: () => ({ get: () => undefined, all: () => [], run: () => ({}) }) } }))
vi.mock('../lib/logger.js', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

const SRC = 'server/middleware/require-tier.js'

describe('the instance licence is scoped to the deployment mode', () => {
    let originalMode

    beforeEach(() => { originalMode = process.env.DEPLOYMENT_MODE })
    afterEach(() => {
        if (originalMode === undefined) delete process.env.DEPLOYMENT_MODE
        else process.env.DEPLOYMENT_MODE = originalMode
    })

    it('reads the mode from the environment, defaulting to self-host', async () => {
        const { readFileSync } = await import('node:fs')
        const src = readFileSync(SRC, 'utf8')
        expect(src).toContain("process.env.DEPLOYMENT_MODE || 'self-host'")
    })

    it('never grants a paid tier to an anonymous caller', async () => {
        const { readFileSync } = await import('node:fs')
        const src = readFileSync(SRC, 'utf8')
        const guard = src.slice(src.indexOf('function instanceLicenceApplies'))
        // The first thing it does is refuse a missing userId.
        expect(guard.slice(0, 200)).toMatch(/if \(!userId\) return false/)
    })

    it('gates the licence branch on the guard, not only on the cache', async () => {
        const { readFileSync } = await import('node:fs')
        const src = readFileSync(SRC, 'utf8')
        expect(src).toMatch(/if \(cachedLicenseTier && PUBLIC_KEY && instanceLicenceApplies\(userId\)\)/)
    })
})

describe('the operator template says how to avoid both traps', () => {
    it('ships DEPLOYMENT_MODE with the safe default', async () => {
        const { readFileSync } = await import('node:fs')
        const env = readFileSync('deploy/iis/production.env.example', 'utf8')
        expect(env).toMatch(/^DEPLOYMENT_MODE=self-host$/m)
        expect(env).toMatch(/Stripe is the only source of a paid tier/)
    })

    it('ships the AI spend cap, which was absent entirely', async () => {
        // The per-user quotas are counts, not money. Without a cap, N throwaway
        // accounts cost N x quota against the operator's provider key.
        const { readFileSync } = await import('node:fs')
        const env = readFileSync('deploy/iis/production.env.example', 'utf8')
        for (const key of ['AI_SPEND_CAP_CENTS_FREE', 'AI_SPEND_CAP_CENTS_PRO', 'AI_SPEND_CAP_CENTS_ENTERPRISE', 'AI_REQUIRE_USER_CONFIG']) {
            expect(env, `${key} missing from the file operators copy`).toContain(key)
        }
        // A cap of 0 disables it — the template must not ship that.
        expect(env).not.toMatch(/^AI_SPEND_CAP_CENTS_FREE=0$/m)
    })
})
