import { describe, it, expect } from 'vitest'
import { computeBranchHygiene } from '../../src/utils/branchHygiene'

const b = (name, protectedFlag = false) => ({ name, protected: protectedFlag, commit: { sha: 'abc' } })

describe('computeBranchHygiene', () => {
    it('returns zeroed shape on empty/falsy input', () => {
        const out = computeBranchHygiene(null)
        expect(out.total).toBe(0)
        expect(out.protected).toBe(0)
        expect(out.protectedRatio).toBe(0)
        expect(out.prefixes).toEqual([])
        expect(out.suspicious).toEqual([])
        expect(out.hasDefaultBranch).toBe(false)
    })

    it('counts total + protected and computes ratio', () => {
        const out = computeBranchHygiene([
            b('main', true),
            b('feat/a'),
            b('feat/b', true),
            b('feat/c'),
        ])
        expect(out.total).toBe(4)
        expect(out.protected).toBe(2)
        expect(out.protectedRatio).toBe(0.5)
    })

    it('flags hasDefaultBranch when the default is present', () => {
        expect(computeBranchHygiene([b('main')]).hasDefaultBranch).toBe(true)
        expect(computeBranchHygiene([b('main')], { defaultBranch: 'develop' }).hasDefaultBranch).toBe(false)
    })

    it('groups prefixes that have ≥3 branches and skips small clusters', () => {
        const out = computeBranchHygiene([
            b('main'),
            b('feat/login'),
            b('feat/signup'),
            b('feat/profile'),
            b('feat/cart'),
            b('chore/lint'),
            b('chore/types'),
        ])
        expect(out.prefixes).toHaveLength(1)
        expect(out.prefixes[0].prefix).toBe('feat')
        expect(out.prefixes[0].count).toBe(4)
        expect(out.prefixes[0].names).toEqual(expect.arrayContaining(['feat/login', 'feat/cart']))
    })

    it('orders prefixes by count desc and caps the names sample at 6', () => {
        const branches = ['feat/a', 'feat/b', 'feat/c', 'feat/d', 'feat/e', 'feat/f', 'feat/g', 'feat/h']
            .map((n) => b(n))
        branches.push(b('chore/a'), b('chore/b'), b('chore/c'))
        const out = computeBranchHygiene(branches)
        expect(out.prefixes[0].prefix).toBe('feat')
        expect(out.prefixes[0].count).toBe(8)
        expect(out.prefixes[0].names).toHaveLength(6)
        expect(out.prefixes[1].prefix).toBe('chore')
    })

    it('flags throwaway placeholder names', () => {
        const out = computeBranchHygiene([b('main'), b('wip'), b('tmp'), b('test'), b('foo')])
        const names = out.suspicious.map((s) => s.name)
        expect(names).toEqual(expect.arrayContaining(['wip', 'tmp', 'test', 'foo']))
        for (const s of out.suspicious) {
            expect(s.reason).toBe('placeholder-name')
        }
    })

    it('flags single-letter and pure-number branch names', () => {
        const out = computeBranchHygiene([b('a'), b('1234')])
        const names = out.suspicious.map((s) => s.name)
        expect(names).toEqual(expect.arrayContaining(['a', '1234']))
    })

    it('flags transient patterns like "test-3" and "fix-typo"', () => {
        const out = computeBranchHygiene([b('test-3'), b('fix-typo'), b('backup-2'), b('wip2')])
        expect(out.suspicious.length).toBe(4)
        for (const s of out.suspicious) {
            expect(s.reason).toBe('transient-pattern')
        }
    })

    it('does not flag legitimate names like "feat/login" or "release-2025"', () => {
        const out = computeBranchHygiene([b('feat/login'), b('release-2025'), b('hotfix/security')])
        expect(out.suspicious).toEqual([])
    })

    it('never flags the default branch even if it matches a pattern', () => {
        // Edge case: a repo whose default is literally "test" should still
        // not surface that branch as suspicious.
        const out = computeBranchHygiene([b('test'), b('feat/x')], { defaultBranch: 'test' })
        const names = out.suspicious.map((s) => s.name)
        expect(names).not.toContain('test')
    })

    it('handles malformed entries gracefully', () => {
        const out = computeBranchHygiene([null, undefined, {}, b('main')])
        expect(out.total).toBe(4)   // includes the malformed entries in count
        expect(out.suspicious).toEqual([])
        expect(out.protected).toBe(0)
    })
})
