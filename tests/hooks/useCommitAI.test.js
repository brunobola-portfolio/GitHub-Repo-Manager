import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const apiCallMock = vi.fn()

vi.mock('../../src/utils/api', async () => {
    const actual = await vi.importActual('../../src/utils/api')
    return { ...actual, apiCall: (...args) => apiCallMock(...args) }
})

const { useCommitAI } = await import('../../src/hooks/useCommitAI')

const FILES = [
    { filename: 'server/auth/middleware.js', additions: 40, deletions: 5, status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' },
    { filename: 'README.md', additions: 2, deletions: 0, status: 'modified', patch: '@@ -1 +1 @@\n-x\n+y' },
]

describe('useCommitAI', () => {
    beforeEach(() => {
        apiCallMock.mockReset()
        localStorage.clear()
    })

    it('does not fetch on mount — generate() is on-demand', () => {
        renderHook(() => useCommitAI('acme', 'repo', 'sha1', FILES, 'feat: thing'))
        expect(apiCallMock).not.toHaveBeenCalled()
    })

    it('generate() posts a single-commit manifest with array-shaped topFilePatches', async () => {
        apiCallMock.mockResolvedValue({ summary: { overview: 'ok', fileRisks: [] } })
        const { result } = renderHook(() => useCommitAI('acme', 'repo', 'sha1', FILES, 'feat: thing'))

        await act(async () => { await result.current.generate() })

        expect(apiCallMock).toHaveBeenCalledTimes(1)
        const [url, options] = apiCallMock.mock.calls[0]
        expect(url).toBe('/api/ai/review-summary')
        const body = JSON.parse(options.body)
        expect(Array.isArray(body.fileManifest)).toBe(true)
        expect(body.fileManifest).toHaveLength(2)
        // topFilePatches must be an array of { filename, patch } objects (the
        // server's zod schema shape) — not a concatenated string.
        expect(Array.isArray(body.topFilePatches)).toBe(true)
        expect(body.topFilePatches[0]).toEqual(
            expect.objectContaining({ filename: expect.any(String), patch: expect.any(String) })
        )
        expect(body.prMetadata.repo).toBe('acme/repo')

        expect(result.current.hasRequested).toBe(true)
        expect(result.current.summary).toEqual({ overview: 'ok', fileRisks: [] })
        expect(result.current.loading).toBe(false)
        expect(result.current.error).toBeNull()
    })

    it('caches the summary by SHA and skips the network on a second call', async () => {
        apiCallMock.mockResolvedValue({ summary: { overview: 'cached-me', fileRisks: [] } })
        const { result } = renderHook(() => useCommitAI('acme', 'repo', 'sha1', FILES, 'feat: thing'))

        await act(async () => { await result.current.generate() })
        expect(apiCallMock).toHaveBeenCalledTimes(1)

        await act(async () => { await result.current.generate() })
        expect(apiCallMock).toHaveBeenCalledTimes(1)
        expect(result.current.summary).toEqual({ overview: 'cached-me', fileRisks: [] })
    })

    it('a second hook instance for the same SHA reads the cache without calling the API', async () => {
        apiCallMock.mockResolvedValue({ summary: { overview: 'first', fileRisks: [] } })
        const first = renderHook(() => useCommitAI('acme', 'repo', 'sha1', FILES, 'feat: thing'))
        await act(async () => { await first.result.current.generate() })
        expect(apiCallMock).toHaveBeenCalledTimes(1)

        const second = renderHook(() => useCommitAI('acme', 'repo', 'sha1', FILES, 'feat: thing'))
        await act(async () => { await second.result.current.generate() })

        expect(apiCallMock).toHaveBeenCalledTimes(1)
        expect(second.result.current.summary).toEqual({ overview: 'first', fileRisks: [] })
    })

    it('surfaces a failed request as .error without throwing', async () => {
        const err = new Error('quota exceeded')
        err.status = 429
        apiCallMock.mockRejectedValue(err)
        const { result } = renderHook(() => useCommitAI('acme', 'repo', 'sha1', FILES, 'feat: thing'))

        await act(async () => { await result.current.generate() })

        expect(result.current.error).toBe(err)
        expect(result.current.loading).toBe(false)
        expect(result.current.summary).toBeNull()
    })

    it('is a no-op when there are no files', async () => {
        const { result } = renderHook(() => useCommitAI('acme', 'repo', 'sha1', [], 'feat: thing'))
        await act(async () => { await result.current.generate() })
        expect(apiCallMock).not.toHaveBeenCalled()
        expect(result.current.hasRequested).toBe(false)
    })

    it('scopes the cache per SHA — a different commit does not reuse another commit\'s summary', async () => {
        apiCallMock.mockResolvedValue({ summary: { overview: 'sha1-summary', fileRisks: [] } })
        const first = renderHook(() => useCommitAI('acme', 'repo', 'sha1', FILES, 'feat: thing'))
        await act(async () => { await first.result.current.generate() })

        apiCallMock.mockResolvedValue({ summary: { overview: 'sha2-summary', fileRisks: [] } })
        const second = renderHook(() => useCommitAI('acme', 'repo', 'sha2', FILES, 'feat: other thing'))
        await act(async () => { await second.result.current.generate() })

        expect(apiCallMock).toHaveBeenCalledTimes(2)
        expect(second.result.current.summary).toEqual({ overview: 'sha2-summary', fileRisks: [] })
    })
})
