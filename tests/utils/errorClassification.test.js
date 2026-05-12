import { describe, it, expect } from 'vitest'
import { isExtensionError, shouldIgnoreClientError } from '@/utils/errorClassification'

describe('isExtensionError', () => {
    it('flags errors whose stack lives in chrome-extension://', () => {
        const err = new Error('boom')
        err.stack = 'Error: boom\n    at f (chrome-extension://abcd1234/proxy.js:1:1)'
        expect(isExtensionError(err)).toBe(true)
    })

    it('flags errors whose stack lives in moz-extension://', () => {
        const err = new Error('boom')
        err.stack = 'Error: boom\n    at f (moz-extension://uuid/content.js:1:1)'
        expect(isExtensionError(err)).toBe(true)
    })

    it('flags errors with proxy.js as source', () => {
        expect(isExtensionError(new Error('whatever'), 'proxy.js')).toBe(true)
    })

    it('flags the disconnected-port message regardless of stack', () => {
        expect(isExtensionError(new Error('Attempting to use a disconnected port object'))).toBe(true)
    })

    it('flags "Extension context invalidated"', () => {
        expect(isExtensionError(new Error('Extension context invalidated.'))).toBe(true)
    })

    it('does NOT flag genuine app errors', () => {
        const err = new Error('Cannot read properties of undefined')
        err.stack = 'TypeError\n    at OverviewTab (/src/components/RepoDetail/OverviewTab.jsx:42:1)'
        expect(isExtensionError(err, '/src/components/RepoDetail/OverviewTab.jsx')).toBe(false)
    })
})

describe('shouldIgnoreClientError', () => {
    it('ignores extension noise', () => {
        expect(shouldIgnoreClientError(new Error('Attempting to use a disconnected port object'))).toBe(true)
    })

    it('ignores ResizeObserver loop spam', () => {
        expect(shouldIgnoreClientError(new Error('ResizeObserver loop limit exceeded'))).toBe(true)
        expect(shouldIgnoreClientError(new Error('ResizeObserver loop completed with undelivered notifications.'))).toBe(true)
    })

    it('ignores cross-origin "Script error."', () => {
        expect(shouldIgnoreClientError('Script error.')).toBe(true)
    })

    it('ignores AbortError (StrictMode + route changes)', () => {
        const err = new Error('The user aborted a request.')
        err.name = 'AbortError'
        expect(shouldIgnoreClientError(err)).toBe(true)
    })

    it('ignores empty / null inputs', () => {
        expect(shouldIgnoreClientError(null, null)).toBe(true)
        expect(shouldIgnoreClientError(undefined, undefined)).toBe(true)
    })

    it('does NOT ignore real app errors', () => {
        expect(shouldIgnoreClientError(new Error('useTabData fetch failed'))).toBe(false)
        expect(shouldIgnoreClientError(new TypeError('x.foo is not a function'))).toBe(false)
    })
})
