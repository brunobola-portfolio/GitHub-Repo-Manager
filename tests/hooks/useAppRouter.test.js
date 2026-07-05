/*
 * Isolated unit tests for useAppRouter — the bidirectional hash<->activeView
 * router extracted from App.jsx. The App-level App.test.jsx hash suite covers
 * it through the full tree; this documents each direction in isolation with
 * mock setters so a regression localizes here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAppRouter } from '@/hooks/useAppRouter'

function mkProps(over = {}) {
    return {
        activeView: 'dashboard',
        setActiveView: vi.fn(),
        selectedRepoDetail: null,
        setSelectedRepoDetail: vi.fn(),
        setRepoDetailInitialTab: vi.fn(),
        repoDetailActiveTab: 'overview',
        setRepoDetailActiveTab: vi.fn(),
        setReviewingPR: vi.fn(),
        ...over,
    }
}

beforeEach(() => {
    window.history.replaceState(null, '', window.location.pathname)
    window.location.hash = ''
})

describe('useAppRouter — hash -> state', () => {
    it('routes a static hash to its view on mount and clears repo/PR state', () => {
        window.location.hash = '#/pricing'
        const p = mkProps()
        renderHook(() => useAppRouter(p))
        expect(p.setActiveView).toHaveBeenCalledWith('pricing')
        expect(p.setSelectedRepoDetail).toHaveBeenCalledWith(null)
        expect(p.setReviewingPR).toHaveBeenCalledWith(null)
    })

    it('routes an empty hash to the dashboard', () => {
        window.location.hash = ''
        const p = mkProps()
        renderHook(() => useAppRouter(p))
        expect(p.setActiveView).toHaveBeenCalledWith('dashboard')
    })

    it('deep-links a repo hash to repo-detail with the tab, seeding a stub repo', () => {
        window.location.hash = '#/repo/acme/demo/pulls'
        const p = mkProps()
        renderHook(() => useAppRouter(p))
        expect(p.setRepoDetailInitialTab).toHaveBeenCalledWith('pulls')
        expect(p.setRepoDetailActiveTab).toHaveBeenCalledWith('pulls')
        expect(p.setReviewingPR).toHaveBeenCalledWith(null)
        expect(p.setActiveView).toHaveBeenCalledWith('repo-detail')
        // selectedRepoDetail is set via an updater that seeds a minimal stub
        // when no rich object is loaded yet.
        const updater = p.setSelectedRepoDetail.mock.calls.at(-1)[0]
        expect(updater(null)).toEqual({ name: 'demo', full_name: 'acme/demo', owner: { login: 'acme' } })
    })

    it('keeps the already-loaded rich repo object when the hash matches it', () => {
        window.location.hash = '#/repo/acme/demo'
        const rich = { name: 'demo', full_name: 'acme/demo', owner: { login: 'acme' }, description: 'rich' }
        const p = mkProps()
        renderHook(() => useAppRouter(p))
        const updater = p.setSelectedRepoDetail.mock.calls.at(-1)[0]
        expect(updater(rich)).toBe(rich) // same reference — no needless reset
    })

    it('responds to a later hashchange', () => {
        const p = mkProps()
        renderHook(() => useAppRouter(p))
        p.setActiveView.mockClear()
        act(() => {
            window.location.hash = '#/teams'
            window.dispatchEvent(new Event('hashchange'))
        })
        expect(p.setActiveView).toHaveBeenCalledWith('teams')
    })
})

describe('useAppRouter — state -> hash', () => {
    it('skips the first sync, then mirrors a later activeView into the hash', () => {
        const p = mkProps({ activeView: 'dashboard' })
        const { rerender } = renderHook((props) => useAppRouter(props), { initialProps: p })
        act(() => { rerender({ ...p, activeView: 'pricing' }) })
        expect(window.location.hash).toBe('#/pricing')
    })

    it('strips the hash to home when activeView returns to dashboard', () => {
        window.location.hash = '#/pricing'
        const p = mkProps({ activeView: 'pricing' })
        const { rerender } = renderHook((props) => useAppRouter(props), { initialProps: p })
        act(() => { rerender({ ...p, activeView: 'dashboard' }) })
        expect(window.location.hash).toBe('')
    })
})

describe('useAppRouter — document.title', () => {
    it('sets a per-view title for an authenticated view', () => {
        const p = mkProps({ activeView: 'work-board', isAuthenticated: true })
        renderHook(() => useAppRouter(p))
        expect(document.title).toBe('Work Board — GitHub Repo Manager')
    })

    it('uses the repo full_name in repo-detail', () => {
        const p = mkProps({
            activeView: 'repo-detail',
            isAuthenticated: true,
            selectedRepoDetail: { name: 'demo', full_name: 'acme/demo', owner: { login: 'acme' } },
        })
        renderHook(() => useAppRouter(p))
        expect(document.title).toBe('acme/demo — GitHub Repo Manager')
    })

    it('keeps the marketing title when logged out', () => {
        const p = mkProps({ activeView: 'dashboard', isAuthenticated: false })
        renderHook(() => useAppRouter(p))
        expect(document.title).toBe('GitHub Repo Manager — AI-Powered Repository Management')
    })

    it('updates the title when the view changes', () => {
        const p = mkProps({ activeView: 'dashboard', isAuthenticated: true })
        const { rerender } = renderHook((props) => useAppRouter(props), { initialProps: p })
        expect(document.title).toBe('Dashboard — GitHub Repo Manager')
        act(() => { rerender({ ...p, activeView: 'teams' }) })
        expect(document.title).toBe('Teams — GitHub Repo Manager')
    })
})
