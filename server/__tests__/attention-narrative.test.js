import { describe, it, expect, beforeEach } from 'vitest'
import {
    hashSignal, buildCacheKey,
    readCachedNarrative, writeCachedNarrative, clearNarrativeCache,
    buildPrompt, shapeNarrative, ATTENTION_NARRATIVE_LIMITS,
} from '../lib/attention-narrative.js'

describe('attention-narrative lib', () => {
    beforeEach(() => clearNarrativeCache())

    describe('hashSignal', () => {
        it('returns a stable hash for equal payloads', () => {
            expect(hashSignal({ a: 1, b: 2 })).toBe(hashSignal({ a: 1, b: 2 }))
        })

        it('changes when the payload changes', () => {
            expect(hashSignal({ a: 1 })).not.toBe(hashSignal({ a: 2 }))
        })

        it('treats null/undefined as the empty signal', () => {
            const empty = hashSignal({})
            expect(hashSignal(null)).toBe(empty)
            expect(hashSignal(undefined)).toBe(empty)
        })
    })

    describe('buildCacheKey', () => {
        it('isolates by user, repo, kind and signal-hash', () => {
            const a = buildCacheKey({ userId: 1, repo: 'o/r', kind: 'hot', signal: { x: 1 } })
            const b = buildCacheKey({ userId: 2, repo: 'o/r', kind: 'hot', signal: { x: 1 } })
            const c = buildCacheKey({ userId: 1, repo: 'o/q', kind: 'hot', signal: { x: 1 } })
            const d = buildCacheKey({ userId: 1, repo: 'o/r', kind: 'abandoned', signal: { x: 1 } })
            const e = buildCacheKey({ userId: 1, repo: 'o/r', kind: 'hot', signal: { x: 2 } })
            expect(new Set([a, b, c, d, e]).size).toBe(5)
        })
    })

    describe('cache read/write', () => {
        it('round-trips a value', () => {
            const args = { userId: 1, repo: 'o/r', kind: 'hot', signal: { a: 1 } }
            writeCachedNarrative(args, { narrative: 'hi', model: 'gemini-2.5-flash' })
            const got = readCachedNarrative(args)
            expect(got).toEqual({ narrative: 'hi', model: 'gemini-2.5-flash' })
        })

        it('busts the entry when the signal changes', () => {
            const base = { userId: 1, repo: 'o/r', kind: 'hot' }
            writeCachedNarrative({ ...base, signal: { v: 1 } }, { narrative: 'A', model: 'm' })
            expect(readCachedNarrative({ ...base, signal: { v: 2 } })).toBeUndefined()
        })

        it('clearNarrativeCache wipes everything', () => {
            const args = { userId: 1, repo: 'o/r', kind: 'hot', signal: {} }
            writeCachedNarrative(args, { narrative: 'A', model: 'm' })
            clearNarrativeCache()
            expect(readCachedNarrative(args)).toBeUndefined()
        })
    })

    describe('buildPrompt', () => {
        it('includes the repo, kind label and signal payload', () => {
            const prompt = buildPrompt({
                repo: 'acme/api',
                kind: 'failed_migration',
                signal: { jobId: 'abc' },
            })
            expect(prompt).toContain('acme/api')
            expect(prompt).toContain('migration that failed')
            expect(prompt).toContain('jobId')
            expect(prompt).toContain('Maximum 240 characters')
        })

        it('falls back gracefully on an unknown kind', () => {
            const prompt = buildPrompt({ repo: 'a/b', kind: 'banana', signal: {} })
            expect(prompt).toContain('attention is needed')
        })
    })

    describe('shapeNarrative', () => {
        it('returns the empty string for non-strings', () => {
            expect(shapeNarrative(undefined)).toBe('')
            expect(shapeNarrative(null)).toBe('')
            expect(shapeNarrative(42)).toBe('')
        })

        it('strips wrapping quotes and collapses newlines', () => {
            expect(shapeNarrative('"\nHello world.\n"')).toBe('Hello world.')
            expect(shapeNarrative('`single quoted`')).toBe('single quoted')
        })

        it('truncates at the last word boundary when over the limit', () => {
            const long = 'word '.repeat(80).trim() + ' final-word'
            const out = shapeNarrative(long)
            expect(out.length).toBeLessThanOrEqual(ATTENTION_NARRATIVE_LIMITS.maxChars)
            expect(out.endsWith('…')).toBe(true)
        })

        it('leaves short text untouched', () => {
            expect(shapeNarrative('Two stale PRs from your team.')).toBe('Two stale PRs from your team.')
        })
    })
})
