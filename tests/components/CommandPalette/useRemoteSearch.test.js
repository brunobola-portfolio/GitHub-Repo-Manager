import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const github = vi.fn()
const translate = vi.fn()
vi.mock('../../../src/api/search', () => ({ searchApi: { github: (...a) => github(...a) } }))
vi.mock('../../../src/api/translateSearch', () => ({ translateSearch: (...a) => translate(...a) }))

const { useDebouncedGitHubSearch, useDebouncedTranslateSearch, parseAskMode } =
    await import('../../../src/components/CommandPalette/useRemoteSearch')

beforeEach(() => {
    github.mockReset()
    translate.mockReset()
})

describe('useDebouncedGitHubSearch', () => {
    it('never lets an answer to an older query land over a newer one', async () => {
        const answers = {}
        github.mockImplementation((q, { signal }) => new Promise((resolve, reject) => {
            answers[q] = () => resolve({ repos: [{ name: q }] })
            signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
        }))
        const { result, rerender } = renderHook(({ q }) => useDebouncedGitHubSearch(q, true), { initialProps: { q: 'react' } })
        await waitFor(() => expect(github).toHaveBeenCalledTimes(1))
        rerender({ q: 'redux' })
        await waitFor(() => expect(github).toHaveBeenCalledTimes(2))

        await act(async () => { answers.react(); answers.redux() })
        await waitFor(() => expect(result.current.loading).toBe(false))
        expect(result.current.data.repos).toEqual([{ name: 'redux' }])
    })

    it('does not search below two characters', async () => {
        renderHook(() => useDebouncedGitHubSearch(' a ', true))
        await new Promise((r) => setTimeout(r, 400))
        expect(github).not.toHaveBeenCalled()
    })

    it('reports a failed search and keeps what it had', async () => {
        github.mockRejectedValue(Object.assign(new Error('boom'), { code: 'RATE_LIMITED' }))
        const { result } = renderHook(() => useDebouncedGitHubSearch('react', true))
        await waitFor(() => expect(result.current.error).toBe('RATE_LIMITED'))
        expect(result.current.data).toEqual({ prs: [], issues: [], repos: [] })
    })
})

describe('useDebouncedTranslateSearch', () => {
    it('treats an empty translation as a failure', async () => {
        translate.mockResolvedValue(null)
        const { result } = renderHook(() => useDebouncedTranslateSearch('open prs of mine', true))
        await waitFor(() => expect(result.current.error).toBe('TRANSLATE_FAILED'))
        expect(result.current.data).toBeNull()
    })
})

describe('parseAskMode', () => {
    it('strips the leading ? and trims', () => {
        expect(parseAskMode('  ? stale prs ')).toEqual({ askMode: true, askQuery: 'stale prs' })
        expect(parseAskMode('repos')).toEqual({ askMode: false, askQuery: '' })
    })
})
