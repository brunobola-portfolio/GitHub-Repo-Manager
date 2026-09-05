// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
    issueUnsubscribeToken,
    verifyUnsubscribeToken,
    _resetDigestUnsubscribeSecretCache,
} from '../lib/digest-unsubscribe-token.js'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
    process.env.SESSION_SECRET = 'test-secret-for-digest-unsubscribe'
    delete process.env.NODE_ENV
    _resetDigestUnsubscribeSecretCache()
})

afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    _resetDigestUnsubscribeSecretCache()
})

describe('digest unsubscribe token round-trip', () => {
    it('issues a token that verifies back to the same userId', () => {
        const token = issueUnsubscribeToken(42)
        expect(verifyUnsubscribeToken(token)).toBe(42)
    })

    it('round-trips a string userId as a number', () => {
        const token = issueUnsubscribeToken('7')
        expect(verifyUnsubscribeToken(token)).toBe(7)
    })

    it('rejects a token signed with a different secret', () => {
        const token = issueUnsubscribeToken(1)
        process.env.SESSION_SECRET = 'a-different-secret'
        _resetDigestUnsubscribeSecretCache()
        expect(verifyUnsubscribeToken(token)).toBeNull()
    })

    it('rejects a tampered userId segment', () => {
        const token = issueUnsubscribeToken(1)
        const [, sig] = token.split('.')
        const forged = `${Buffer.from('999', 'utf8').toString('base64url')}.${sig}`
        expect(verifyUnsubscribeToken(forged)).toBeNull()
    })

    it('rejects malformed tokens', () => {
        expect(verifyUnsubscribeToken('')).toBeNull()
        expect(verifyUnsubscribeToken(null)).toBeNull()
        expect(verifyUnsubscribeToken('not-a-token')).toBeNull()
        expect(verifyUnsubscribeToken('a.b.c')).toBeNull()
    })

    it('rejects a non-numeric userId payload', () => {
        const fakeUid = Buffer.from('not-a-number', 'utf8').toString('base64url')
        expect(verifyUnsubscribeToken(`${fakeUid}.somesig`)).toBeNull()
    })

    it('has no expiry — a token issued "long ago" still verifies', () => {
        const token = issueUnsubscribeToken(3)
        // Nothing in the token encodes time, so simply re-verifying later
        // (no clock manipulation needed) proves there's no exp check.
        expect(verifyUnsubscribeToken(token)).toBe(3)
    })
})

describe('digest unsubscribe token — production without a secret', () => {
    it('throws instead of silently signing with a guessable default', () => {
        delete process.env.SESSION_SECRET
        delete process.env.GITHUB_CLIENT_SECRET
        process.env.NODE_ENV = 'production'
        _resetDigestUnsubscribeSecretCache()
        expect(() => issueUnsubscribeToken(1)).toThrow(/SESSION_SECRET/)
    })
})
