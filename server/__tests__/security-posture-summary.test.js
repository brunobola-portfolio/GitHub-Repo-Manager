import { describe, it, expect, beforeEach } from 'vitest'
import {
    hashChecks, buildCacheKey,
    readCachedSummary, writeCachedSummary, clearSecurityPostureSummaryCache,
    buildPrompt, shapeSummary, SECURITY_POSTURE_SUMMARY_LIMITS,
} from '../lib/security-posture-summary.js'

const CHECKS = [
    { id: 'branch_protection_review', label: 'Default branch requires PR review before merge', status: 'fail', severity: 'critical' },
    { id: 'security_md', label: 'SECURITY.md present', status: 'pass', severity: null },
]

describe('security-posture-summary lib', () => {
    beforeEach(() => clearSecurityPostureSummaryCache())

    describe('hashChecks + buildCacheKey', () => {
        it('hashes deterministically regardless of input order', () => {
            const reordered = [CHECKS[1], CHECKS[0]]
            expect(hashChecks(CHECKS)).toBe(hashChecks(reordered))
        })

        it('changes when a status changes', () => {
            const changed = [{ ...CHECKS[0], status: 'pass' }, CHECKS[1]]
            expect(hashChecks(CHECKS)).not.toBe(hashChecks(changed))
        })

        it('isolates by user and repo', () => {
            const a = buildCacheKey({ userId: 1, repoFullName: 'alice/hello', checks: CHECKS })
            const b = buildCacheKey({ userId: 2, repoFullName: 'alice/hello', checks: CHECKS })
            const c = buildCacheKey({ userId: 1, repoFullName: 'alice/other', checks: CHECKS })
            expect(a).not.toBe(b)
            expect(a).not.toBe(c)
        })
    })

    describe('cache round-trip', () => {
        it('stores and retrieves a summary', () => {
            const args = { userId: 1, repoFullName: 'alice/hello', checks: CHECKS }
            writeCachedSummary(args, { summary: 's', topActions: [] })
            expect(readCachedSummary(args)).toEqual({ summary: 's', topActions: [] })
        })

        it('clearSecurityPostureSummaryCache wipes everything', () => {
            const args = { userId: 1, repoFullName: 'alice/hello', checks: CHECKS }
            writeCachedSummary(args, { summary: 's', topActions: [] })
            clearSecurityPostureSummaryCache()
            expect(readCachedSummary(args)).toBeUndefined()
        })
    })

    describe('buildPrompt', () => {
        it('embeds repo name, visibility, and check lines', () => {
            const prompt = buildPrompt({ repo: { full_name: 'alice/hello', private: true }, checks: CHECKS })
            expect(prompt).toContain('alice/hello')
            expect(prompt).toContain('private')
            expect(prompt).toContain('Default branch requires PR review before merge: fail (critical)')
            expect(prompt).toContain('SECURITY.md present: pass')
            expect(prompt).toContain('JSON only')
        })

        it('only recommends fixing checks marked fail, per prompt instructions', () => {
            const prompt = buildPrompt({ repo: { full_name: 'a/b' }, checks: CHECKS })
            expect(prompt).toMatch(/only.*"fail"/i)
        })

        it('never leaks raw alert content — only whitelisted id/label/status/severity fields interpolate', () => {
            const withExtraFields = [{
                id: 'security_md', label: 'x', status: 'fail', severity: 'medium',
                // Anything beyond these 4 fields must never reach the prompt.
                rawAlertBody: 'ghp_SECRET_TOKEN_SHOULD_NOT_APPEAR',
            }]
            const prompt = buildPrompt({ repo: { full_name: 'a/b' }, checks: withExtraFields })
            expect(prompt).not.toContain('ghp_SECRET_TOKEN_SHOULD_NOT_APPEAR')
        })
    })

    describe('shapeSummary', () => {
        it('passes through a clean payload', () => {
            const out = shapeSummary({
                summary: 'Two checks need attention.',
                topActions: [{ title: 'Enable branch protection', why: 'Prevents unreviewed merges', severity: 'critical' }],
            })
            expect(out.summary).toBe('Two checks need attention.')
            expect(out.topActions).toHaveLength(1)
            expect(out.topActions[0].severity).toBe('critical')
        })

        it('drops actions without a title and caps at maxTopActions', () => {
            const out = shapeSummary({
                summary: 's',
                topActions: [
                    { title: 'A', why: '', severity: 'high' },
                    { title: '', why: 'no title, dropped', severity: 'high' },
                    { title: 'B', why: '', severity: 'medium' },
                    { title: 'C', why: '', severity: 'low' },
                    { title: 'D', why: '', severity: 'low' },
                ],
            })
            expect(out.topActions.length).toBeLessThanOrEqual(SECURITY_POSTURE_SUMMARY_LIMITS.maxTopActions)
            expect(out.topActions.every((a) => a.title)).toBe(true)
        })

        it('defaults an invalid severity to medium rather than dropping the action', () => {
            const out = shapeSummary({ summary: 's', topActions: [{ title: 'X', severity: 'BOGUS' }] })
            expect(out.topActions[0].severity).toBe('medium')
        })

        it('returns empty shape for non-object / garbage input', () => {
            expect(shapeSummary(null)).toEqual({ summary: '', topActions: [] })
            expect(shapeSummary(undefined)).toEqual({ summary: '', topActions: [] })
            expect(shapeSummary('not json')).toEqual({ summary: '', topActions: [] })
        })

        it('truncates an overlong summary', () => {
            const out = shapeSummary({ summary: 'x'.repeat(1000), topActions: [] })
            expect(out.summary.length).toBe(400)
        })
    })
})
