/*
 * Isolated unit tests for useRepoDetailNavigation — the repo-detail state +
 * navigation extracted from App.jsx's AppContent (FE-15, 2026-09-04 panel).
 * The App-level App.test.jsx hash-routing suite exercises it through the
 * full tree; this documents each piece in isolation with mock setters so a
 * regression localizes here.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRepoDetailNavigation } from '@/hooks/useRepoDetailNavigation'

function mkProps(over = {}) {
    return {
        setActiveView: vi.fn(),
        patchRepoEverywhere: vi.fn(),
        refresh: vi.fn(),
        ...over,
    }
}

describe('useRepoDetailNavigation — initial state', () => {
    it('starts with no selected repo, overview tabs, empty entities, no reviewing PR', () => {
        const { result } = renderHook(() => useRepoDetailNavigation(mkProps()))
        expect(result.current.selectedRepoDetail).toBeNull()
        expect(result.current.repoDetailInitialTab).toBe('overview')
        expect(result.current.repoDetailActiveTab).toBe('overview')
        expect(result.current.repoDetailEntities).toEqual({ prs: [], branches: [], issues: [] })
        expect(result.current.reviewingPR).toBeNull()
    })
})

describe('useRepoDetailNavigation — handleOpenRepo', () => {
    it('sets the repo, initial/active tab to the default, and switches the view', () => {
        const props = mkProps()
        const { result } = renderHook(() => useRepoDetailNavigation(props))
        const repo = { name: 'demo', full_name: 'acme/demo', owner: { login: 'acme' } }

        act(() => { result.current.handleOpenRepo(repo) })

        expect(result.current.selectedRepoDetail).toEqual(repo)
        expect(result.current.repoDetailInitialTab).toBe('overview')
        expect(result.current.repoDetailActiveTab).toBe('overview')
        expect(props.setActiveView).toHaveBeenCalledWith('repo-detail')
    })

    it('opens directly onto a requested tab', () => {
        const props = mkProps()
        const { result } = renderHook(() => useRepoDetailNavigation(props))
        const repo = { name: 'demo', full_name: 'acme/demo', owner: { login: 'acme' } }

        act(() => { result.current.handleOpenRepo(repo, { tab: 'pulls' }) })

        expect(result.current.repoDetailInitialTab).toBe('pulls')
        expect(result.current.repoDetailActiveTab).toBe('pulls')
    })
})

describe('useRepoDetailNavigation — closeRepoDetail', () => {
    it('clears the selected repo and navigates to the given destination', () => {
        const props = mkProps()
        const { result } = renderHook(() => useRepoDetailNavigation(props))
        act(() => { result.current.handleOpenRepo({ name: 'demo', full_name: 'acme/demo' }) })

        act(() => { result.current.closeRepoDetail('repos') })

        expect(result.current.selectedRepoDetail).toBeNull()
        expect(props.setActiveView).toHaveBeenCalledWith('repos')
    })
})

describe('useRepoDetailNavigation — handleSelectedRepoMutated', () => {
    it('patches the repo everywhere and merges it into selectedRepoDetail when given an updated repo', () => {
        const props = mkProps()
        const { result } = renderHook(() => useRepoDetailNavigation(props))
        const repo = { name: 'demo', full_name: 'acme/demo', description: 'old' }
        act(() => { result.current.handleOpenRepo(repo) })

        const updated = { full_name: 'acme/demo', description: 'new' }
        act(() => { result.current.handleSelectedRepoMutated(updated) })

        expect(props.patchRepoEverywhere).toHaveBeenCalledWith(updated)
        expect(result.current.selectedRepoDetail).toEqual({ ...repo, ...updated })
    })

    it('falls back to a full refresh when no updated repo is provided', () => {
        const props = mkProps()
        const { result } = renderHook(() => useRepoDetailNavigation(props))

        act(() => { result.current.handleSelectedRepoMutated(null) })

        expect(props.refresh).toHaveBeenCalledTimes(1)
        expect(props.patchRepoEverywhere).not.toHaveBeenCalled()
    })

    it('leaves selectedRepoDetail untouched when nothing was ever selected', () => {
        const props = mkProps()
        const { result } = renderHook(() => useRepoDetailNavigation(props))

        act(() => { result.current.handleSelectedRepoMutated({ full_name: 'acme/demo' }) })

        expect(result.current.selectedRepoDetail).toBeNull()
    })
})
