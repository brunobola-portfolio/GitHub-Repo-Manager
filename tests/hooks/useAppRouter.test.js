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

    it('restores the previous top-level view on a Back (popstate) that changed the hash', () => {
        // Browser Back that changes the fragment fires popstate (and hashchange).
        // The router now listens to popstate too, so this alone restores state.
        const p = mkProps()
        renderHook(() => useAppRouter(p))
        p.setActiveView.mockClear()
        act(() => {
            window.location.hash = '#/teams'
            window.dispatchEvent(new Event('popstate'))
        })
        expect(p.setActiveView).toHaveBeenCalledWith('teams')
    })

    it('restores repo-detail on a Back out of pr-review (same-hash popstate)', () => {
        // pr-review keeps the repo hash, so its Back fires popstate WITHOUT a
        // hashchange. Popping re-runs sync() against the repo hash, which routes
        // back to repo-detail and clears the reviewing PR.
        window.location.hash = '#/repo/acme/demo'
        const p = mkProps()
        renderHook(() => useAppRouter(p))
        p.setActiveView.mockClear()
        p.setReviewingPR.mockClear()
        act(() => { window.dispatchEvent(new Event('popstate')) })
        expect(p.setActiveView).toHaveBeenCalledWith('repo-detail')
        expect(p.setReviewingPR).toHaveBeenCalledWith(null)
    })
})

describe('useAppRouter — history push vs replace', () => {
    const repo = { name: 'demo', full_name: 'acme/demo', owner: { login: 'acme' } }

    it('pushes exactly one history entry when drilling into repo-detail', () => {
        const p = mkProps({ activeView: 'repos' })
        const { rerender } = renderHook((props) => useAppRouter(props), { initialProps: p })
        const push = vi.spyOn(window.history, 'pushState')
        const replace = vi.spyOn(window.history, 'replaceState')
        act(() => { rerender({ ...p, activeView: 'repo-detail', selectedRepoDetail: repo }) })
        expect(push).toHaveBeenCalledTimes(1)
        expect(push).toHaveBeenCalledWith(null, '', expect.stringContaining('#/repo/acme/demo'))
        expect(replace).not.toHaveBeenCalled()
        push.mockRestore(); replace.mockRestore()
    })

    it('replaces (no new entry) on a lateral top-level switch', () => {
        const p = mkProps({ activeView: 'dashboard' })
        const { rerender } = renderHook((props) => useAppRouter(props), { initialProps: p })
        const push = vi.spyOn(window.history, 'pushState')
        const replace = vi.spyOn(window.history, 'replaceState')
        act(() => { rerender({ ...p, activeView: 'teams' }) })
        expect(push).not.toHaveBeenCalled()
        expect(replace).toHaveBeenCalledTimes(1)
        expect(window.location.hash).toBe('#/teams')
        push.mockRestore(); replace.mockRestore()
    })

    it('replaces (no push) when only the repo-detail tab changes', () => {
        const p = mkProps({ activeView: 'repos' })
        const { rerender } = renderHook((props) => useAppRouter(props), { initialProps: p })
        // Drill in first (this pushes) so the tab change is a true in-view change.
        act(() => { rerender({ ...p, activeView: 'repo-detail', selectedRepoDetail: repo, repoDetailActiveTab: 'overview' }) })
        const push = vi.spyOn(window.history, 'pushState')
        const replace = vi.spyOn(window.history, 'replaceState')
        act(() => { rerender({ ...p, activeView: 'repo-detail', selectedRepoDetail: repo, repoDetailActiveTab: 'pulls' }) })
        expect(push).not.toHaveBeenCalled()
        expect(replace).toHaveBeenCalledTimes(1)
        expect(window.location.hash).toBe('#/repo/acme/demo/pulls')
        push.mockRestore(); replace.mockRestore()
    })

    it('pushes one entry when entering pr-review, keeping the repo hash', () => {
        window.location.hash = '#/repo/acme/demo'
        const p = mkProps({ activeView: 'repo-detail', selectedRepoDetail: repo })
        const { rerender } = renderHook((props) => useAppRouter(props), { initialProps: p })
        const push = vi.spyOn(window.history, 'pushState')
        const replace = vi.spyOn(window.history, 'replaceState')
        act(() => { rerender({ ...p, activeView: 'pr-review', selectedRepoDetail: repo }) })
        expect(push).toHaveBeenCalledTimes(1)
        expect(replace).not.toHaveBeenCalled()
        expect(window.location.hash).toBe('#/repo/acme/demo') // overlay keeps the repo URL
        push.mockRestore(); replace.mockRestore()
    })

    it('does not push a second entry while staying in pr-review', () => {
        const p = mkProps({ activeView: 'pr-review', selectedRepoDetail: repo })
        const { rerender } = renderHook((props) => useAppRouter(props), { initialProps: p })
        const push = vi.spyOn(window.history, 'pushState')
        // A re-render that stays in pr-review (e.g. an unrelated prop change) must
        // not keep stacking history entries.
        act(() => { rerender({ ...p, activeView: 'pr-review', selectedRepoDetail: { ...repo } }) })
        expect(push).not.toHaveBeenCalled()
        push.mockRestore()
    })

    it('does not touch history on initial mount and preserves a deep-link hash', () => {
        window.location.hash = '#/repo/acme/demo'
        const push = vi.spyOn(window.history, 'pushState')
        const replace = vi.spyOn(window.history, 'replaceState')
        renderHook(() => useAppRouter(mkProps()))
        expect(push).not.toHaveBeenCalled()
        expect(replace).not.toHaveBeenCalled()
        expect(window.location.hash).toBe('#/repo/acme/demo')
        push.mockRestore(); replace.mockRestore()
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
