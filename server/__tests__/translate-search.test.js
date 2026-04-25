import { describe, it, expect, beforeEach } from 'vitest'
import {
    hashQuery, buildCacheKey,
    readCachedTranslation, writeCachedTranslation, clearTranslateSearchCache,
    buildPrompt, shapeTranslation, TRANSLATE_SEARCH_LIMITS,
} from '../lib/translate-search.js'

describe('translate-search lib', () => {
    beforeEach(() => clearTranslateSearchCache())

    describe('hashQuery + buildCacheKey', () => {
        it('hashes deterministically + isolates by user', () => {
            expect(hashQuery('foo')).toBe(hashQuery('foo'))
            expect(hashQuery('foo')).not.toBe(hashQuery('bar'))
            const a = buildCacheKey({ userId: 1, q: 'foo' })
            const b = buildCacheKey({ userId: 2, q: 'foo' })
            expect(a).not.toBe(b)
        })
    })

    describe('cache round-trip', () => {
        it('stores and retrieves a translation', () => {
            const args = { userId: 1, q: 'PRs touching payment' }
            writeCachedTranslation(args, { summary: 's', queries: [], fallback: false })
            expect(readCachedTranslation(args)).toEqual({ summary: 's', queries: [], fallback: false })
        })

        it('clearTranslateSearchCache wipes everything', () => {
            const args = { userId: 1, q: 'x' }
            writeCachedTranslation(args, { summary: 's', queries: [] })
            clearTranslateSearchCache()
            expect(readCachedTranslation(args)).toBeUndefined()
        })
    })

    describe('buildPrompt', () => {
        it('embeds the user query and the schema constraint', () => {
            const prompt = buildPrompt({ q: 'show me my open PRs' })
            expect(prompt).toContain('show me my open PRs')
            expect(prompt).toContain('JSON only')
            expect(prompt).toContain('@me')
        })
    })

    describe('shapeTranslation', () => {
        it('passes through a clean payload of two queries', () => {
            const out = shapeTranslation({
                summary: 'PRs you need to review',
                queries: [
                    { type: 'pr', ghQuery: 'is:pr review-requested:@me state:open' },
                    { type: 'issue', ghQuery: 'is:issue assignee:@me state:open' },
                ],
            })
            expect(out.queries).toHaveLength(2)
            expect(out.fallback).toBe(false)
        })

        it('drops malformed queries and caps at maxQueries', () => {
            const out = shapeTranslation({
                summary: 'caps at two',
                queries: [
                    { type: 'pr', ghQuery: 'is:pr' },
                    { type: 'BANANA', ghQuery: 'invalid' },
                    { type: 'issue', ghQuery: 'is:issue' },
                    { type: 'repo', ghQuery: 'language:js' },
                ],
            })
            expect(out.queries).toHaveLength(TRANSLATE_SEARCH_LIMITS.maxQueries)
            for (const q of out.queries) {
                expect(['pr', 'issue', 'repo']).toContain(q.type)
            }
        })

        it('returns fallback=true when nothing parses', () => {
            const out = shapeTranslation({ summary: 'nope', queries: [{ type: 'X', ghQuery: '' }] })
            expect(out.queries).toEqual([])
            expect(out.fallback).toBe(true)
        })

        it('returns fallback for non-object input', () => {
            expect(shapeTranslation(null).fallback).toBe(true)
            expect(shapeTranslation(undefined).fallback).toBe(true)
            expect(shapeTranslation('string').fallback).toBe(true)
        })

        it('truncates a long summary to 240 chars', () => {
            const out = shapeTranslation({ summary: 'x'.repeat(500), queries: [{ type: 'pr', ghQuery: 'is:pr' }] })
            expect(out.summary.length).toBe(240)
        })
    })
})
