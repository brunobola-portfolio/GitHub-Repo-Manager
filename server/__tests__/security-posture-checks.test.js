import { describe, it, expect } from 'vitest'
import { buildChecks, scoreChecks, CHECK_STATUS } from '../lib/security-posture-checks.js'

function baseSignals(overrides = {}) {
    return {
        branchProtection: { status: 'protected', requiresReview: true, allowsForcePush: false, allowsDeletion: false },
        alerts: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
        secretScanning: { status: 'enabled' },
        secretScanningPushProtection: { status: 'enabled' },
        dependabotSecurityUpdates: { status: 'enabled' },
        codeScanning: { configured: true },
        securityMd: { exists: true },
        workflowPermissions: { status: 'read' },
        org: { applicable: true, twoFactorRequired: true },
        visibility: 'public',
        ...overrides,
    }
}

function byId(checks, id) {
    return checks.find((c) => c.id === id)
}

describe('security-posture-checks — buildChecks', () => {
    it('produces exactly 10 checks, all passing for a fully-locked-down admin view', () => {
        const checks = buildChecks(baseSignals())
        expect(checks).toHaveLength(10)
        for (const c of checks) {
            expect(c.status).toBe(CHECK_STATUS.PASS)
            expect(c.severity).toBeNull()
        }
    })

    describe('check 1/2 — branch protection', () => {
        it('fails both when unprotected (real fail, not unknown)', () => {
            const checks = buildChecks(baseSignals({ branchProtection: { status: 'unprotected' } }))
            expect(byId(checks, 'branch_protection_review').status).toBe(CHECK_STATUS.FAIL)
            expect(byId(checks, 'branch_protection_review').severity).toBe('critical')
            expect(byId(checks, 'branch_protection_force_push').status).toBe(CHECK_STATUS.FAIL)
            expect(byId(checks, 'branch_protection_force_push').severity).toBe('high')
        })

        it('renders unknown (not fail) when the caller cannot see protection state', () => {
            const checks = buildChecks(baseSignals({ branchProtection: { status: 'unknown' } }))
            expect(byId(checks, 'branch_protection_review').status).toBe(CHECK_STATUS.UNKNOWN)
            expect(byId(checks, 'branch_protection_review').severity).toBeNull()
            expect(byId(checks, 'branch_protection_force_push').status).toBe(CHECK_STATUS.UNKNOWN)
        })

        it('fails force-push check when protected but force-push/deletion still allowed', () => {
            const checks = buildChecks(baseSignals({
                branchProtection: { status: 'protected', requiresReview: true, allowsForcePush: true, allowsDeletion: false },
            }))
            expect(byId(checks, 'branch_protection_review').status).toBe(CHECK_STATUS.PASS)
            expect(byId(checks, 'branch_protection_force_push').status).toBe(CHECK_STATUS.FAIL)
        })
    })

    describe('check 3 — alerts, visibility-gated on the security_events token scope', () => {
        it('fails critical over high when both present', () => {
            const checks = buildChecks(baseSignals({ alerts: { critical: 1, high: 2, medium: 0, low: 0, total: 3 } }))
            const c = byId(checks, 'alerts_clear')
            expect(c.status).toBe(CHECK_STATUS.FAIL)
            expect(c.severity).toBe('critical')
        })

        it('fails high severity when only high alerts present', () => {
            const checks = buildChecks(baseSignals({ alerts: { critical: 0, high: 3, medium: 0, low: 0, total: 3 } }))
            const c = byId(checks, 'alerts_clear')
            expect(c.status).toBe(CHECK_STATUS.FAIL)
            expect(c.severity).toBe('high')
        })

        it('passes when only medium/low alerts are open', () => {
            const checks = buildChecks(baseSignals({ alerts: { critical: 0, high: 0, medium: 5, low: 5, total: 10 } }))
            expect(byId(checks, 'alerts_clear').status).toBe(CHECK_STATUS.PASS)
        })

        it('passes when zero alerts and at least one source was reachable (available defaults truthy)', () => {
            const checks = buildChecks(baseSignals({ alerts: { critical: 0, high: 0, medium: 0, low: 0, total: 0, available: true } }))
            expect(byId(checks, 'alerts_clear').status).toBe(CHECK_STATUS.PASS)
        })

        it('renders unknown (not pass) when none of the three alert sources were reachable', () => {
            const checks = buildChecks(baseSignals({ alerts: { critical: 0, high: 0, medium: 0, low: 0, total: 0, available: false } }))
            const c = byId(checks, 'alerts_clear')
            expect(c.status).toBe(CHECK_STATUS.UNKNOWN)
            expect(c.severity).toBeNull()
        })
    })

    describe('check 4 — secret scanning + GHAS-unavailable nuance', () => {
        it('unknown when security_and_analysis is absent (non-admin)', () => {
            const checks = buildChecks(baseSignals({ secretScanning: { status: 'unknown' } }))
            expect(byId(checks, 'secret_scanning').status).toBe(CHECK_STATUS.UNKNOWN)
        })

        it('fails (high) when disabled on a PUBLIC repo — an actual toggle to flip', () => {
            const checks = buildChecks(baseSignals({ secretScanning: { status: 'disabled' }, visibility: 'public' }))
            const c = byId(checks, 'secret_scanning')
            expect(c.status).toBe(CHECK_STATUS.FAIL)
            expect(c.severity).toBe('high')
        })

        it('renders informational (not fail) when disabled on a PRIVATE repo — GHAS plan limitation', () => {
            const checks = buildChecks(baseSignals({ secretScanning: { status: 'disabled' }, visibility: 'private' }))
            const c = byId(checks, 'secret_scanning')
            expect(c.status).toBe(CHECK_STATUS.INFORMATIONAL)
            expect(c.severity).toBe('informational')
        })
    })

    describe('checks 5/6 — push protection + Dependabot security updates', () => {
        it('unknown when absent, fail(medium) when disabled, pass when enabled', () => {
            const unknown = buildChecks(baseSignals({ secretScanningPushProtection: { status: 'unknown' } }))
            expect(byId(unknown, 'secret_scanning_push_protection').status).toBe(CHECK_STATUS.UNKNOWN)

            const failing = buildChecks(baseSignals({ dependabotSecurityUpdates: { status: 'disabled' } }))
            const c = byId(failing, 'dependabot_security_updates')
            expect(c.status).toBe(CHECK_STATUS.FAIL)
            expect(c.severity).toBe('medium')
        })

        it('fails (medium) push protection when disabled on a PUBLIC repo — an actual toggle to flip', () => {
            const checks = buildChecks(baseSignals({ secretScanningPushProtection: { status: 'disabled' }, visibility: 'public' }))
            const c = byId(checks, 'secret_scanning_push_protection')
            expect(c.status).toBe(CHECK_STATUS.FAIL)
            expect(c.severity).toBe('medium')
        })

        it('renders push protection informational (not fail) when disabled on a PRIVATE repo — GHAS plan limitation, same nuance as check 4', () => {
            const checks = buildChecks(baseSignals({ secretScanningPushProtection: { status: 'disabled' }, visibility: 'private' }))
            const c = byId(checks, 'secret_scanning_push_protection')
            expect(c.status).toBe(CHECK_STATUS.INFORMATIONAL)
            expect(c.severity).toBe('informational')
        })

        it('Dependabot security updates keeps a hard fail on a PRIVATE repo — the feature does not require GHAS', () => {
            const checks = buildChecks(baseSignals({ dependabotSecurityUpdates: { status: 'disabled' }, visibility: 'private' }))
            const c = byId(checks, 'dependabot_security_updates')
            expect(c.status).toBe(CHECK_STATUS.FAIL)
            expect(c.severity).toBe('medium')
        })
    })

    describe('checks 7/8 — code scanning + SECURITY.md, never admin-gated', () => {
        it('fail(medium) when not configured / missing, never unknown', () => {
            const checks = buildChecks(baseSignals({ codeScanning: { configured: false }, securityMd: { exists: false } }))
            expect(byId(checks, 'code_scanning').status).toBe(CHECK_STATUS.FAIL)
            expect(byId(checks, 'code_scanning').severity).toBe('medium')
            expect(byId(checks, 'security_md').status).toBe(CHECK_STATUS.FAIL)
            expect(byId(checks, 'security_md').severity).toBe('medium')
        })
    })

    describe('check 9 — workflow permissions', () => {
        it('unknown/not_applicable/pass/fail map correctly', () => {
            expect(byId(buildChecks(baseSignals({ workflowPermissions: { status: 'unknown' } })), 'workflow_permissions').status).toBe(CHECK_STATUS.UNKNOWN)
            expect(byId(buildChecks(baseSignals({ workflowPermissions: { status: 'not_applicable' } })), 'workflow_permissions').status).toBe(CHECK_STATUS.NOT_APPLICABLE)
            expect(byId(buildChecks(baseSignals({ workflowPermissions: { status: 'read' } })), 'workflow_permissions').status).toBe(CHECK_STATUS.PASS)
            const failing = byId(buildChecks(baseSignals({ workflowPermissions: { status: 'write' } })), 'workflow_permissions')
            expect(failing.status).toBe(CHECK_STATUS.FAIL)
            expect(failing.severity).toBe('medium')
        })
    })

    describe('check 10 — org 2FA', () => {
        it('not_applicable for a personal-account repo', () => {
            const checks = buildChecks(baseSignals({ org: { applicable: false, twoFactorRequired: null } }))
            expect(byId(checks, 'org_two_factor').status).toBe(CHECK_STATUS.NOT_APPLICABLE)
        })

        it('unknown when applicable but the caller cannot see the org policy', () => {
            const checks = buildChecks(baseSignals({ org: { applicable: true, twoFactorRequired: null } }))
            expect(byId(checks, 'org_two_factor').status).toBe(CHECK_STATUS.UNKNOWN)
        })

        it('fails (low) when the org exists but does not require 2FA', () => {
            const checks = buildChecks(baseSignals({ org: { applicable: true, twoFactorRequired: false } }))
            const c = byId(checks, 'org_two_factor')
            expect(c.status).toBe(CHECK_STATUS.FAIL)
            expect(c.severity).toBe('low')
        })
    })

    it('edge case: zero admin access — checks 1,2,4,5,6,9 unknown; 3,7,8 still compute; 10 not_applicable for personal repo', () => {
        const checks = buildChecks(baseSignals({
            branchProtection: { status: 'unknown' },
            secretScanning: { status: 'unknown' },
            secretScanningPushProtection: { status: 'unknown' },
            dependabotSecurityUpdates: { status: 'unknown' },
            workflowPermissions: { status: 'unknown' },
            org: { applicable: false, twoFactorRequired: null },
        }))
        const unknownIds = ['branch_protection_review', 'branch_protection_force_push', 'secret_scanning', 'secret_scanning_push_protection', 'dependabot_security_updates', 'workflow_permissions']
        for (const id of unknownIds) {
            expect(byId(checks, id).status).toBe(CHECK_STATUS.UNKNOWN)
        }
        expect(byId(checks, 'alerts_clear').status).toBe(CHECK_STATUS.PASS)
        expect(byId(checks, 'code_scanning').status).toBe(CHECK_STATUS.PASS)
        expect(byId(checks, 'security_md').status).toBe(CHECK_STATUS.PASS)
        expect(byId(checks, 'org_two_factor').status).toBe(CHECK_STATUS.NOT_APPLICABLE)
    })
})

describe('security-posture-checks — scoreChecks', () => {
    it('scores 100 when everything passes', () => {
        const checks = buildChecks(baseSignals())
        const score = scoreChecks(checks)
        expect(score.score).toBe(100)
        expect(score.passing).toBe(10)
        expect(score.partialVisibility).toBe(false)
    })

    it('excludes unknown checks from both numerator and denominator (partial visibility)', () => {
        // Zero-admin-access edge case: 6 unknown, 1 not_applicable, 3 pass.
        const checks = buildChecks(baseSignals({
            branchProtection: { status: 'unknown' },
            secretScanning: { status: 'unknown' },
            secretScanningPushProtection: { status: 'unknown' },
            dependabotSecurityUpdates: { status: 'unknown' },
            workflowPermissions: { status: 'unknown' },
            org: { applicable: false, twoFactorRequired: null },
        }))
        const score = scoreChecks(checks)
        expect(score.unknown).toBe(6)
        expect(score.notApplicable).toBe(1)
        expect(score.passing).toBe(3)
        // visible = 10 - 6 unknown - 1 NA = 3, all 3 passing -> 100, but flagged partial.
        expect(score.visible).toBe(3)
        expect(score.score).toBe(100)
        expect(score.partialVisibility).toBe(true)
    })

    it('a failing critical check still contributes to a lower score, not a crash', () => {
        const checks = buildChecks(baseSignals({ branchProtection: { status: 'unprotected' } }))
        const score = scoreChecks(checks)
        expect(score.failing).toBe(2)
        expect(score.score).toBeLessThan(100)
    })

    it('informational checks count in the denominator but not the numerator', () => {
        const checks = buildChecks(baseSignals({ secretScanning: { status: 'disabled' }, visibility: 'private' }))
        const score = scoreChecks(checks)
        expect(score.informational).toBe(1)
        expect(score.visible).toBe(10)
        expect(score.passing).toBe(9)
        expect(score.score).toBe(90)
    })

    it('an unreachable alert source (check 3 unknown) is excluded from the score like any other visibility gap', () => {
        const checks = buildChecks(baseSignals({ alerts: { critical: 0, high: 0, medium: 0, low: 0, total: 0, available: false } }))
        const score = scoreChecks(checks)
        expect(score.unknown).toBe(1)
        expect(score.passing).toBe(9)
        expect(score.visible).toBe(9)
        expect(score.score).toBe(100)
        expect(score.partialVisibility).toBe(true)
    })

    it('both GHAS-informational checks (4 and 5) count in the denominator but not the numerator', () => {
        const checks = buildChecks(baseSignals({
            secretScanning: { status: 'disabled' },
            secretScanningPushProtection: { status: 'disabled' },
            visibility: 'private',
        }))
        const score = scoreChecks(checks)
        expect(score.informational).toBe(2)
        expect(score.visible).toBe(10)
        expect(score.passing).toBe(8)
        expect(score.score).toBe(80)
    })
})
