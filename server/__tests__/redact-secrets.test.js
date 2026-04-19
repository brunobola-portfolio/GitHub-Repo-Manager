// @vitest-environment node
/**
 * Tests for server/lib/redact-secrets.js
 */

import { describe, it, expect } from 'vitest'
import { redactSecrets } from '../lib/redact-secrets.js'

describe('redactSecrets()', () => {
    // -------------------------------------------------------------------------
    // No-op on clean strings
    // -------------------------------------------------------------------------

    it('returns the input unchanged when no secrets are present', () => {
        expect(redactSecrets('Hello world, no secrets here.')).toBe('Hello world, no secrets here.')
    })

    it('returns an empty string for an empty input', () => {
        expect(redactSecrets('')).toBe('')
    })

    // -------------------------------------------------------------------------
    // null / undefined handling
    // -------------------------------------------------------------------------

    it('returns empty string for null', () => {
        expect(redactSecrets(null)).toBe('')
    })

    it('returns empty string for undefined', () => {
        expect(redactSecrets(undefined)).toBe('')
    })

    // -------------------------------------------------------------------------
    // sk-* prefix (OpenAI / Anthropic / OpenRouter)
    // -------------------------------------------------------------------------

    it('redacts sk-* keys (OpenAI style)', () => {
        const result = redactSecrets('Authorization: Bearer sk-abc12345ABCD')
        expect(result).toBe('Authorization: Bearer sk-[REDACTED]')
        expect(result).not.toContain('sk-abc12345ABCD')
    })

    it('redacts sk-ant-* keys (Anthropic style)', () => {
        const result = redactSecrets('key is sk-ant-ExampleKeyValue123')
        expect(result).toBe('key is sk-[REDACTED]')
    })

    it('does NOT redact sk- strings shorter than 8 chars after prefix', () => {
        // 'sk-abc' is only 3 chars after the prefix — too short to be a real key
        const short = 'sk-abc'
        expect(redactSecrets(short)).toBe(short)
    })

    // -------------------------------------------------------------------------
    // key_* prefix
    // -------------------------------------------------------------------------

    it('redacts key_* keys', () => {
        const result = redactSecrets('token=key_abcdefghij1234')
        expect(result).toBe('token=key_[REDACTED]')
    })

    it('does NOT redact key_ strings shorter than 8 chars after prefix', () => {
        const short = 'key_abc'
        expect(redactSecrets(short)).toBe(short)
    })

    // -------------------------------------------------------------------------
    // Google / Gemini (AIza...)
    // -------------------------------------------------------------------------

    it('redacts Gemini/Google AIza... API keys', () => {
        const result = redactSecrets('api_key=AIzaSyExampleKey1234567890abcdefghij')
        expect(result).toBe('api_key=AIza[REDACTED]')
    })

    it('does NOT redact AIza strings shorter than 20 chars after prefix', () => {
        // Only 5 chars after 'AIza' — too short
        const short = 'AIzaShrt'
        expect(redactSecrets(short)).toBe(short)
    })

    // -------------------------------------------------------------------------
    // URL-embedded basic-auth credentials
    // -------------------------------------------------------------------------

    it('redacts https URLs with embedded credentials', () => {
        const result = redactSecrets('Connecting to https://user:password@example.com/repo')
        expect(result).toBe('Connecting to https://[REDACTED]@example.com/repo')
        expect(result).not.toContain('user:password')
    })

    it('redacts http URLs with embedded credentials', () => {
        const result = redactSecrets('http://admin:secret@192.168.1.1/api')
        expect(result).toBe('http://[REDACTED]@192.168.1.1/api')
    })

    it('does NOT alter plain URLs without credentials', () => {
        const url = 'https://example.com/api/endpoint'
        expect(redactSecrets(url)).toBe(url)
    })

    // -------------------------------------------------------------------------
    // Multiple secrets in one string (defense in depth)
    // -------------------------------------------------------------------------

    it('redacts multiple secrets in a single string', () => {
        const input = 'sk-openai123456789 and key_mykey12345 and AIzaSyExampleKey1234567890abcde'
        const result = redactSecrets(input)
        expect(result).toBe('sk-[REDACTED] and key_[REDACTED] and AIza[REDACTED]')
    })

    // -------------------------------------------------------------------------
    // Non-string inputs are coerced to string
    // -------------------------------------------------------------------------

    it('coerces numbers to string', () => {
        expect(redactSecrets(42)).toBe('42')
    })

    it('coerces objects to string', () => {
        expect(redactSecrets({ toString: () => 'sk-objectvalue1234' })).toBe('sk-[REDACTED]')
    })
})
