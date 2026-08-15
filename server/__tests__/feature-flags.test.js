// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * Wave 6 (2026-07-18 community-launch WOW) — feature-flags coverage for the
 * 3 new per-tier quota keys added in Slice 1 (Foundation): diagramGenPerMonth,
 * agentRulesPerMonth, securityPostureAIPerMonth. Free ships a generous finite
 * cap; Pro/Enterprise are unlimited, matching every other per-feature AI quota
 * in this file.
 */
import { describe, it, expect } from 'vitest'
import { getFeatures } from '../lib/feature-flags.js'

describe('feature-flags — Wave 6 metering keys', () => {
    it('Free tier: diagramGenPerMonth=15, agentRulesPerMonth=20, securityPostureAIPerMonth=75', () => {
        const free = getFeatures('free')
        expect(free.diagramGenPerMonth).toBe(15)
        expect(free.agentRulesPerMonth).toBe(20)
        expect(free.securityPostureAIPerMonth).toBe(75)
    })

    it('Pro tier: all 3 new keys are unlimited', () => {
        const pro = getFeatures('pro')
        expect(pro.diagramGenPerMonth).toBe(Infinity)
        expect(pro.agentRulesPerMonth).toBe(Infinity)
        expect(pro.securityPostureAIPerMonth).toBe(Infinity)
    })

    it('Enterprise tier: all 3 new keys are unlimited', () => {
        const enterprise = getFeatures('enterprise')
        expect(enterprise.diagramGenPerMonth).toBe(Infinity)
        expect(enterprise.agentRulesPerMonth).toBe(Infinity)
        expect(enterprise.securityPostureAIPerMonth).toBe(Infinity)
    })

    it('every tier defines all 3 new keys (no undefined gaps)', () => {
        for (const tier of ['free', 'pro', 'enterprise']) {
            const features = getFeatures(tier)
            expect(features.diagramGenPerMonth).not.toBeUndefined()
            expect(features.agentRulesPerMonth).not.toBeUndefined()
            expect(features.securityPostureAIPerMonth).not.toBeUndefined()
        }
    })

    it('unknown tier falls back to free (still exposes the new keys)', () => {
        const fallback = getFeatures('nonexistent-tier')
        expect(fallback.diagramGenPerMonth).toBe(15)
        expect(fallback.agentRulesPerMonth).toBe(20)
        expect(fallback.securityPostureAIPerMonth).toBe(75)
    })

    // These are numeric quota values, not boolean gates. The old canAccess()
    // helper coerced them with `!!`, so a cap of 5 and a cap of 500 were both
    // "true" — which is why it was deleted rather than kept as a convenience.
    // Enforcement goes through checkUsageLimit, which compares the number.
    it('the per-feature keys are numeric caps, never booleans', () => {
        const free = getFeatures('free')
        for (const key of ['diagramGenPerMonth', 'agentRulesPerMonth', 'securityPostureAIPerMonth']) {
            expect(typeof free[key], `${key} must stay a number`).toBe('number')
            expect(free[key]).toBeGreaterThan(0)
        }
    })
})
