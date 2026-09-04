import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { azurePost } from '@/api/azure'
import { _resetCsrfTokenForTests } from '@/utils/api'

function makeResponse(status, body, { ok = status >= 200 && status < 300 } = {}) {
    return {
        ok,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
        headers: { get: (k) => (k?.toLowerCase?.() === 'content-type' ? 'application/json' : null) },
    }
}

describe('azurePost', () => {
    let mockFetch

    beforeEach(() => {
        mockFetch = vi.fn()
        vi.stubGlobal('fetch', mockFetch)
        _resetCsrfTokenForTests()
        if (typeof navigator !== 'undefined') {
            Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
        }
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('fetches a CSRF token and sends it as X-CSRF-Token on the POST', async () => {
        mockFetch
            .mockResolvedValueOnce(makeResponse(200, { token: 'tok-1' }))
            .mockResolvedValueOnce(makeResponse(200, { repos: [] }))

        await azurePost('/azure/repos', { host: 'dev.azure.com', pat: 'p' }, { org: 'acme', project: 'demo' })

        expect(mockFetch).toHaveBeenCalledTimes(2)
        const [url, opts] = mockFetch.mock.calls[1]
        expect(url).toBe('/api/azure/repos')
        expect(opts.method).toBe('POST')
        expect(opts.headers['X-CSRF-Token']).toBe('tok-1')
        expect(opts.headers['Content-Type']).toBe('application/json')
    })

    it('merges extra fields with azureCredPayload(source), credential fields last', async () => {
        mockFetch
            .mockResolvedValueOnce(makeResponse(200, { token: 'tok-2' }))
            .mockResolvedValueOnce(makeResponse(200, { ok: true }))

        await azurePost(
            '/azure/branches',
            { host: 'dev.azure.com', credentialMode: 'personalPat', pat: 'secret-pat' },
            { org: 'acme', project: 'demo', repoId: 'r1' },
        )

        const [, opts] = mockFetch.mock.calls[1]
        expect(JSON.parse(opts.body)).toEqual({
            org: 'acme',
            project: 'demo',
            repoId: 'r1',
            host: 'dev.azure.com',
            pat: 'secret-pat',
        })
    })

    it('prefers savedCredentialId over a raw pat, matching azureCredPayload', async () => {
        mockFetch
            .mockResolvedValueOnce(makeResponse(200, { token: 'tok-3' }))
            .mockResolvedValueOnce(makeResponse(200, { ok: true }))

        await azurePost(
            '/azure/wikis',
            { host: 'tfs.internal', credentialMode: 'personalPat', pat: 'ignored', savedCredentialId: 42 },
            { org: 'acme', project: 'demo' },
        )

        const [, opts] = mockFetch.mock.calls[1]
        expect(JSON.parse(opts.body)).toEqual({
            org: 'acme',
            project: 'demo',
            host: 'tfs.internal',
            savedCredentialId: 42,
        })
    })

    it('resolves with the parsed JSON body on success', async () => {
        mockFetch
            .mockResolvedValueOnce(makeResponse(200, { token: 'tok-4' }))
            .mockResolvedValueOnce(makeResponse(200, { wikis: [{ id: 'w1' }] }))

        const data = await azurePost('/azure/wikis', { host: 'dev.azure.com' }, { org: 'acme', project: 'demo' })
        expect(data).toEqual({ wikis: [{ id: 'w1' }] })
    })

    it('retries once on a 403 csrf_invalid response, with a freshly fetched token', async () => {
        mockFetch
            .mockResolvedValueOnce(makeResponse(200, { token: 'stale' }))
            .mockResolvedValueOnce(makeResponse(403, { error: 'Invalid CSRF token', code: 'csrf_invalid' }))
            .mockResolvedValueOnce(makeResponse(200, { token: 'fresh' }))
            .mockResolvedValueOnce(makeResponse(200, { repos: [] }))

        const data = await azurePost('/azure/repos', { host: 'dev.azure.com' }, { org: 'acme', project: 'demo' })

        expect(data).toEqual({ repos: [] })
        expect(mockFetch).toHaveBeenCalledTimes(4)
        const lastCall = mockFetch.mock.calls[3]
        expect(lastCall[0]).toBe('/api/azure/repos')
        expect(lastCall[1].headers['X-CSRF-Token']).toBe('fresh')
    })

    it('does not retry a second time when csrf_invalid persists, and throws an ApiError', async () => {
        mockFetch
            .mockResolvedValueOnce(makeResponse(200, { token: 'a' }))
            .mockResolvedValueOnce(makeResponse(403, { error: 'Invalid CSRF token', code: 'csrf_invalid' }))
            .mockResolvedValueOnce(makeResponse(200, { token: 'b' }))
            .mockResolvedValueOnce(makeResponse(403, { error: 'Invalid CSRF token', code: 'csrf_invalid' }))

        await expect(
            azurePost('/azure/repos', { host: 'dev.azure.com' }, { org: 'acme', project: 'demo' })
        ).rejects.toMatchObject({ name: 'ApiError' })

        expect(mockFetch).toHaveBeenCalledTimes(4)
    })

    it('throws an ApiError (not a plain Error) on a non-CSRF failure', async () => {
        mockFetch
            .mockResolvedValueOnce(makeResponse(200, { token: 'tok-5' }))
            .mockResolvedValueOnce(makeResponse(404, { error: 'not found' }))

        await expect(
            azurePost('/azure/repos', { host: 'dev.azure.com' }, { org: 'acme', project: 'demo' })
        ).rejects.toMatchObject({ name: 'ApiError' })
    })

    it('lets the caller pass an AbortSignal through opts', async () => {
        mockFetch
            .mockResolvedValueOnce(makeResponse(200, { token: 'tok-6' }))
            .mockResolvedValueOnce(makeResponse(200, { ok: true }))

        const controller = new AbortController()
        await azurePost('/azure/repos', { host: 'dev.azure.com' }, { org: 'acme' }, { signal: controller.signal })

        const [, opts] = mockFetch.mock.calls[1]
        expect(opts.signal).toBeInstanceOf(AbortSignal)
    })
})
