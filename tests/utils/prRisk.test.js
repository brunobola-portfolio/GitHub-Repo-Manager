import { describe, it, expect } from 'vitest'
import { computePRRisks, highestSeverity } from '../../src/utils/prRisk'

const NOW = new Date('2026-04-25T12:00:00Z')

function pr(overrides = {}) {
    return {
        id: 1,
        number: 1,
        title: 'Update foo',
        body: 'This change adds better handling for foo when bar happens.',
        state: 'open',
        draft: false,
        created_at: NOW.toISOString(),
        requested_reviewers: [{ login: 'alice' }],
        requested_teams: [],
        assignees: [],
        ...overrides,
    }
}

function riskIds(risks) {
    return risks.map((r) => r.id)
}

describe('computePRRisks', () => {
    it('returns empty for closed PRs', () => {
        expect(computePRRisks(pr({ state: 'closed' }), NOW)).toEqual([])
    })

    it('returns empty for fresh well-described open PR with reviewers', () => {
        expect(riskIds(computePRRisks(pr(), NOW))).toEqual([])
    })

    it('flags stale PRs after 7 days as warning', () => {
        const created = new Date(NOW.getTime() - 9 * 24 * 60 * 60 * 1000)
        const risks = computePRRisks(pr({ created_at: created.toISOString() }), NOW)
        expect(riskIds(risks)).toContain('stale')
        const stale = risks.find((r) => r.id === 'stale')
        expect(stale.tone).toBe('warning')
        expect(stale.label).toMatch(/9d/)
    })

    it('escalates to "very stale" past 21 days with danger tone', () => {
        const created = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000)
        const risks = computePRRisks(pr({ created_at: created.toISOString() }), NOW)
        expect(riskIds(risks)).toContain('very-stale')
        expect(risks.find((r) => r.id === 'very-stale').tone).toBe('danger')
    })

    it('flags missing description', () => {
        const risks = computePRRisks(pr({ body: '' }), NOW)
        expect(riskIds(risks)).toContain('no-description')
    })

    it('flags very short description as info', () => {
        const risks = computePRRisks(pr({ body: 'fix it' }), NOW)
        expect(riskIds(risks)).toContain('short-description')
        expect(risks.find((r) => r.id === 'short-description').tone).toBe('info')
    })

    it('does not flag missing description on draft PRs', () => {
        const risks = computePRRisks(pr({ body: '', draft: true }), NOW)
        expect(riskIds(risks)).not.toContain('no-description')
    })

    it('flags breaking-change keywords in title', () => {
        const risks = computePRRisks(pr({ title: 'BREAKING CHANGE: rewrite auth' }), NOW)
        expect(riskIds(risks)).toContain('breaking')
        expect(risks.find((r) => r.id === 'breaking').tone).toBe('danger')
    })

    it('flags breaking-change keywords in body', () => {
        const risks = computePRRisks(pr({ body: 'This breaks the API contract for callers older than v2.' }), NOW)
        expect(riskIds(risks)).toContain('breaking')
    })

    it('does not over-trigger breaking on benign words like "broken"', () => {
        const risks = computePRRisks(pr({ body: 'Fixes a broken link in the README that was reported yesterday.' }), NOW)
        expect(riskIds(risks)).not.toContain('breaking')
    })

    it('flags unassigned non-draft PRs older than 1 day', () => {
        const created = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000)
        const risks = computePRRisks(pr({
            created_at: created.toISOString(),
            requested_reviewers: [],
            assignees: [],
        }), NOW)
        expect(riskIds(risks)).toContain('unassigned')
    })

    it('does NOT flag unassigned for draft PRs', () => {
        const created = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000)
        const risks = computePRRisks(pr({
            created_at: created.toISOString(),
            requested_reviewers: [],
            assignees: [],
            draft: true,
        }), NOW)
        expect(riskIds(risks)).not.toContain('unassigned')
    })

    it('flags too-many-reviewers as info (bystander effect)', () => {
        const created = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000)
        const risks = computePRRisks(pr({
            created_at: created.toISOString(),
            requested_reviewers: [{ login: 'a' }, { login: 'b' }, { login: 'c' }, { login: 'd' }, { login: 'e' }],
        }), NOW)
        const r = risks.find((x) => x.id === 'reviewer-bystander')
        expect(r).toBeTruthy()
        expect(r.tone).toBe('info')
        expect(r.label).toMatch(/5 reviewers/)
    })

    it('exposes a "Draft" badge for draft PRs', () => {
        const risks = computePRRisks(pr({ draft: true }), NOW)
        expect(riskIds(risks)).toContain('draft')
        expect(risks.find((r) => r.id === 'draft').tone).toBe('neutral')
    })

    it('handles malformed input gracefully', () => {
        expect(computePRRisks(null, NOW)).toEqual([])
        expect(computePRRisks(undefined, NOW)).toEqual([])
        expect(computePRRisks({}, NOW)).toEqual([])
    })
})

describe('highestSeverity', () => {
    it('returns the danger badge when present', () => {
        const risks = [
            { id: 'stale', tone: 'warning' },
            { id: 'breaking', tone: 'danger' },
            { id: 'short-description', tone: 'info' },
        ]
        expect(highestSeverity(risks).id).toBe('breaking')
    })

    it('falls through warning → info → neutral when no danger present', () => {
        expect(highestSeverity([{ id: 'a', tone: 'info' }, { id: 'b', tone: 'warning' }]).id).toBe('b')
        expect(highestSeverity([{ id: 'a', tone: 'neutral' }, { id: 'b', tone: 'info' }]).id).toBe('b')
    })

    it('returns null on empty/falsy input', () => {
        expect(highestSeverity([])).toBeNull()
        expect(highestSeverity(null)).toBeNull()
    })
})
