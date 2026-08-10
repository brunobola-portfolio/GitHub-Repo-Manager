/*
 * sanitizeOutput runs on captured child-process output — git and tf command
 * stderr — on its way to an API response, an SSE stream and the logs. That is
 * input whose length someone else chooses, which makes the cost of the
 * patterns part of their correctness.
 *
 * The lookahead form this replaced rescanned the remainder of the input from
 * every start position: 32 KB of 'A' took most of a second, and 200 KB was
 * unusable. The scrubbing behaviour is asserted alongside the budget so a
 * future "simplification" back to lookaheads has to fail one of the two.
 */
import { describe, it, expect } from 'vitest'
import { sanitizeOutput } from '../lib/env/sanitize.js'

describe('sanitizeOutput still scrubs what it is for', () => {
    it('masks URL userinfo', () => {
        expect(sanitizeOutput('cloning https://bruno:ghp_secret@github.com/o/r.git'))
            .toBe('cloning https://***@github.com/o/r.git')
    })

    it('masks Authorization headers and GitHub token families', () => {
        expect(sanitizeOutput('Authorization: Bearer abc.def')).toBe('Authorization: Bearer ***')
        expect(sanitizeOutput('ghp_' + 'a'.repeat(30))).toBe('***')
    })

    it('masks long mixed-alphabet blobs, and only those', () => {
        // '=' is inside the run's alphabet, so 'k=<blob>' is a single run — a
        // base64 payload is exactly that shape, which is the point.
        expect(sanitizeOutput('key abc123DEF456ghi789JKL012mno345pq')).toBe('key ***')
        // 36 letters, no digit: a word, not a credential.
        expect(sanitizeOutput('a'.repeat(36))).toBe('a'.repeat(36))
        // Under the 32-character floor.
        expect(sanitizeOutput('abc123')).toBe('abc123')
    })
})

describe('and does it in time that does not depend on the attacker', () => {
    // Generous by an order of magnitude: the linear form does 200 KB in tens of
    // milliseconds, the quadratic one did 32 KB in ~900 ms. Anything between
    // those is a regression, and nothing that passes here is close to flaky.
    it.each([
        ['32 KB', 32_000],
        ['200 KB', 200_000],
    ])('handles %s of a single repeated character', (_label, size) => {
        const started = performance.now()
        sanitizeOutput('A'.repeat(size))
        expect(performance.now() - started).toBeLessThan(500)
    })

    it('handles a long run that nearly matches the userinfo pattern', () => {
        // Reaches for the '@' that never arrives — the shape the bounded
        // repetitions exist for.
        const started = performance.now()
        sanitizeOutput(`https://${'u'.repeat(50_000)}:${'p'.repeat(50_000)}`)
        expect(performance.now() - started).toBeLessThan(500)
    })
})
