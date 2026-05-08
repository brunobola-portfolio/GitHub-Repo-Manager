/*
 * Phase A — useAIPolish covers description-only batch flow.
 * Topics + README columns ship later; tests for those slot in alongside.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const apiCallMock = vi.fn()
const getDescriptionMock = vi.fn()
const updateRepoMock = vi.fn()

vi.mock('../../src/utils/api', async () => {
    const actual = await vi.importActual('../../src/utils/api')
    return { ...actual, apiCall: (...args) => apiCallMock(...args) }
})
vi.mock('../../src/api/ai', () => ({
    aiApi: {
        polish: {
            getDescription: (...args) => getDescriptionMock(...args),
        },
    },
}))
vi.mock('../../src/api/repos', () => ({
    reposApi: {
        updateRepo: (...args) => updateRepoMock(...args),
    },
}))

const { useAIPolish } = await import('../../src/hooks/useAIPolish')

describe('useAIPolish (description-only)', () => {
    beforeEach(() => {
        apiCallMock.mockReset()
        getDescriptionMock.mockReset()
        updateRepoMock.mockReset()
    })

    it('returns no rows for empty input and stays idle', () => {
        const { result } = renderHook(() => useAIPolish([]))
        expect(result.current.rows).toEqual([])
        expect(result.current.phase).toBe('idle')
        expect(result.current.stats.total).toBe(0)
    })

    it('resolves repo metadata, fetches descriptions, transitions to ready', async () => {
        apiCallMock.mockImplementation(async (url) => {
            const m = url.match(/\/api\/repos\/([^/]+)\/([^/]+)$/)
            const repo = m[2]
            const id = repo === 'r1' ? 101 : 102
            return { id, description: `current ${repo}` }
        })
        getDescriptionMock.mockImplementation(async (repoId) => ({
            source: 'ai',
            proposed: { description: `Suggested for repo ${repoId}` },
        }))

        const { result } = renderHook(() => useAIPolish(['acme/r1', 'acme/r2']))

        await waitFor(() => expect(result.current.phase).toBe('ready'))
        const r1 = result.current.rows.find(r => r.fullName === 'acme/r1')
        const r2 = result.current.rows.find(r => r.fullName === 'acme/r2')
        expect(r1.status).toBe('ready')
        expect(r2.status).toBe('ready')
        expect(r1.proposedDescription).toBe('Suggested for repo 101')
        expect(r2.proposedDescription).toBe('Suggested for repo 102')
        expect(r1.currentDescription).toBe('current r1')
    })

    it('apply() PATCHes only included ready rows with non-empty changed proposals + invokes onPatched per success', async () => {
        apiCallMock.mockImplementation(async (url) => {
            const m = url.match(/\/api\/repos\/([^/]+)\/([^/]+)$/)
            const repo = m[2]
            return { id: repo === 'r1' ? 101 : 102, description: '' }
        })
        getDescriptionMock.mockImplementation(async (repoId) => ({
            proposed: { description: `Polished ${repoId}` },
        }))
        updateRepoMock.mockImplementation(async (owner, repo, payload) => ({
            data: { description: payload.description, full_name: `${owner}/${repo}` },
        }))

        const { result } = renderHook(() => useAIPolish(['acme/r1', 'acme/r2']))
        await waitFor(() => expect(result.current.phase).toBe('ready'))

        // Exclude r2 from apply
        act(() => result.current.toggleInclude('acme/r2'))

        const onPatched = vi.fn()
        let applyResult
        await act(async () => { applyResult = await result.current.apply(onPatched) })

        expect(applyResult).toEqual({ applied: 1, failed: 0 })
        expect(updateRepoMock).toHaveBeenCalledTimes(1)
        expect(updateRepoMock).toHaveBeenCalledWith('acme', 'r1', { description: 'Polished 101' })
        expect(onPatched).toHaveBeenCalledTimes(1)
        expect(onPatched).toHaveBeenCalledWith(expect.objectContaining({
            full_name: 'acme/r1',
            description: 'Polished 101',
        }))
        const r1 = result.current.rows.find(r => r.fullName === 'acme/r1')
        expect(r1.status).toBe('done')
    })

    it('a 429 from the AI endpoint marks the row quota and sets quotaHit', async () => {
        apiCallMock.mockResolvedValue({ id: 1, description: '' })
        const tierError = Object.assign(new Error('limit'), { status: 429, tierError: true })
        getDescriptionMock.mockRejectedValueOnce(tierError)
        // Subsequent calls won't matter — runner short-circuits via quotaHitRef

        const { result } = renderHook(() => useAIPolish(['acme/r1']))
        await waitFor(() => expect(result.current.quotaHit).toBe(true))
        const row = result.current.rows.find(r => r.fullName === 'acme/r1')
        expect(row.status).toBe('quota')
    })

    it('setProposedDescription marks the row as edited and is what apply() sends', async () => {
        apiCallMock.mockResolvedValue({ id: 99, description: 'old' })
        getDescriptionMock.mockResolvedValue({ proposed: { description: 'AI proposal' } })
        updateRepoMock.mockResolvedValue({ data: { description: 'My edit' } })

        const { result } = renderHook(() => useAIPolish(['acme/r1']))
        await waitFor(() => expect(result.current.phase).toBe('ready'))

        act(() => result.current.setProposedDescription('acme/r1', 'My edit'))
        const row = result.current.rows.find(r => r.fullName === 'acme/r1')
        expect(row.edited).toBe(true)
        expect(row.proposedDescription).toBe('My edit')

        await act(async () => { await result.current.apply() })
        expect(updateRepoMock).toHaveBeenCalledWith('acme', 'r1', { description: 'My edit' })
    })
})
