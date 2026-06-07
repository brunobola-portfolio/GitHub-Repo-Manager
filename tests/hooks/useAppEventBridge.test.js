/*
 * Isolated unit tests for useAppEventBridge — the APP_EVENTS bus listeners
 * extracted from App.jsx. The App-level App.eventBridge.guard covers wiring
 * through the full tree but with EMPTY repo lists; these exercise the hook
 * directly with POPULATED repos/orgRepos so the repo-lookup `.find()` and the
 * pendingItemRef PR/issue fulfillment (which never ran in the guard) are tested.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAppEventBridge } from '@/hooks/useAppEventBridge'
import { emitAppEvent, onAppEvent, APP_EVENTS } from '@/utils/appEvents'

const ACME = { id: 1, name: 'demo', full_name: 'acme/demo', owner: { login: 'acme' } }

function mkProps(over = {}) {
    return {
        setActiveView: vi.fn(),
        setSelectedRepoDetail: vi.fn(),
        setReviewingPR: vi.fn(),
        setQuotaModal: vi.fn(),
        setTourOpen: vi.fn(),
        setRepoDetailEntities: vi.fn(),
        openModalWithData: vi.fn(),
        repos: [ACME],
        orgRepos: [],
        selectedRepoDetail: null,
        handleOpenRepo: vi.fn(),
        ...over,
    }
}

let p
function mount(over) {
    p = mkProps(over)
    renderHook(() => useAppEventBridge(p))
    return p
}
const fire = (name, detail) => act(() => { emitAppEvent(name, detail) })

beforeEach(() => { vi.clearAllMocks() })

describe('useAppEventBridge — overlays & navigation', () => {
    it('SHOW_QUOTA_EXCEEDED sets the quota modal payload', () => {
        mount(); fire(APP_EVENTS.SHOW_QUOTA_EXCEEDED, { feature: 'AI' })
        expect(p.setQuotaModal).toHaveBeenCalledWith({ feature: 'AI' })
    })
    it('SHOW_ONBOARDING opens the tour', () => {
        mount(); fire(APP_EVENTS.SHOW_ONBOARDING)
        expect(p.setTourOpen).toHaveBeenCalledWith(true)
    })
    it('NAVIGATE_DASHBOARD clears repo/PR and routes home', () => {
        mount(); fire(APP_EVENTS.NAVIGATE_DASHBOARD)
        expect(p.setSelectedRepoDetail).toHaveBeenCalledWith(null)
        expect(p.setReviewingPR).toHaveBeenCalledWith(null)
        expect(p.setActiveView).toHaveBeenCalledWith('dashboard')
    })
    it('NAVIGATE_PRICING and OPEN_BILLING both route to pricing', () => {
        mount(); fire(APP_EVENTS.NAVIGATE_PRICING)
        expect(p.setActiveView).toHaveBeenCalledWith('pricing')
        p.setActiveView.mockClear()
        fire(APP_EVENTS.OPEN_BILLING)
        expect(p.setActiveView).toHaveBeenCalledWith('pricing')
    })
    it('OPEN_SETTINGS opens settings at the requested tab (default general)', () => {
        mount(); fire(APP_EVENTS.OPEN_SETTINGS, { tab: 'ai' })
        expect(p.openModalWithData).toHaveBeenCalledWith('showSettings', { initialTab: 'ai' })
        p.openModalWithData.mockClear()
        fire(APP_EVENTS.OPEN_SETTINGS, {})
        expect(p.openModalWithData).toHaveBeenCalledWith('showSettings', { initialTab: 'general' })
    })
    it('OPEN_AI_POLISH opens the polish modal with the repo list', () => {
        mount(); fire(APP_EVENTS.OPEN_AI_POLISH, { repoFullNames: ['a/b'] })
        expect(p.openModalWithData).toHaveBeenCalledWith('aiPolish', { repoFullNames: ['a/b'] })
    })
})

describe('useAppEventBridge — repo-detail entity lists', () => {
    it('REPO_DETAIL_PRS_LOADED updates the prs entity slice', () => {
        mount(); fire(APP_EVENTS.REPO_DETAIL_PRS_LOADED, [{ number: 1 }])
        const updater = p.setRepoDetailEntities.mock.calls.at(-1)[0]
        expect(updater({ prs: [], branches: [], issues: [] })).toEqual({ prs: [{ number: 1 }], branches: [], issues: [] })
    })
})

describe('useAppEventBridge — repo lookup against populated lists', () => {
    it('OPEN_REPO_DETAIL opens the FOUND rich repo on the overview tab', () => {
        mount(); fire(APP_EVENTS.OPEN_REPO_DETAIL, { owner: 'acme', repo: 'demo' })
        expect(p.handleOpenRepo).toHaveBeenCalledWith(ACME, { tab: 'overview' })
    })
    it('OPEN_REPO_SETTINGS opens the found repo on the settings tab', () => {
        mount(); fire(APP_EVENTS.OPEN_REPO_SETTINGS, { owner: 'acme', repo: 'demo' })
        expect(p.handleOpenRepo).toHaveBeenCalledWith(ACME, { tab: 'settings' })
    })
    it('OPEN_REPO_DETAIL synthesizes a stub when the repo is not loaded', () => {
        mount({ repos: [], orgRepos: [] })
        fire(APP_EVENTS.OPEN_REPO_DETAIL, { owner: 'ghost', repo: 'x' })
        expect(p.handleOpenRepo).toHaveBeenCalledWith(
            { name: 'x', full_name: 'ghost/x', owner: { login: 'ghost' } },
            { tab: 'overview' },
        )
    })
})

describe('useAppEventBridge — palette/RepoDetail event re-emits', () => {
    it('OPEN_PR_DETAIL re-emits REPO_DETAIL_SELECT_PR', () => {
        mount()
        const spy = vi.fn(); const off = onAppEvent(APP_EVENTS.REPO_DETAIL_SELECT_PR, spy)
        fire(APP_EVENTS.OPEN_PR_DETAIL, { number: 9 })
        off()
        expect(spy.mock.calls[0][0].detail).toEqual({ number: 9 })
    })
    it('PLAN_ISSUE_WITH_AI re-emits REPO_DETAIL_PLAN_ISSUE', () => {
        mount()
        const spy = vi.fn(); const off = onAppEvent(APP_EVENTS.REPO_DETAIL_PLAN_ISSUE, spy)
        fire(APP_EVENTS.PLAN_ISSUE_WITH_AI, { number: 4 })
        off()
        expect(spy.mock.calls[0][0].detail).toEqual({ number: 4 })
    })
    it('START_PR_REVIEW sets the PR and routes to pr-review', () => {
        mount(); fire(APP_EVENTS.START_PR_REVIEW, { number: 7 })
        expect(p.setReviewingPR).toHaveBeenCalledWith({ number: 7 })
        expect(p.setActiveView).toHaveBeenCalledWith('pr-review')
    })
    it('GENERATE_PR_DESCRIPTION opens DevToolkit when a repo is selected', () => {
        mount({ selectedRepoDetail: ACME })
        fire(APP_EVENTS.GENERATE_PR_DESCRIPTION, { number: 7, head: { ref: 'f' }, base: { ref: 'main' } })
        expect(p.openModalWithData).toHaveBeenCalledWith('showDevToolkit', {
            initialTab: 'pr',
            repo: ACME,
            pr: { number: 7, head: 'f', base: 'main' },
        })
    })
    it('GENERATE_PR_DESCRIPTION is a no-op without a selected repo', () => {
        mount({ selectedRepoDetail: null })
        fire(APP_EVENTS.GENERATE_PR_DESCRIPTION, { number: 7, head: { ref: 'f' }, base: { ref: 'main' } })
        expect(p.openModalWithData).not.toHaveBeenCalled()
    })
})

describe('useAppEventBridge — migration + cross-surface fulfillment', () => {
    it('MIGRATION_COMPLETE nudges the assistant with an open_ai_polish action', () => {
        mount()
        const spy = vi.fn(); const off = onAppEvent(APP_EVENTS.AI_ASSISTANT_INJECT_MESSAGE, spy)
        fire(APP_EVENTS.MIGRATION_COMPLETE, { createdRepos: [{ full_name: 'a/b' }, { full_name: 'c/d' }] })
        off()
        const { detail } = spy.mock.calls[0][0]
        expect(detail.actions[0].type).toBe('open_ai_polish')
        expect(detail.actions[0].payload.repoFullNames).toEqual(['a/b', 'c/d'])
    })
    it('OPEN_REPO_PR records the pending intent; PRS_LOADED then selects the matching PR', () => {
        mount()
        fire(APP_EVENTS.OPEN_REPO_PR, { repoFullName: 'acme/demo', number: 7 })
        expect(p.handleOpenRepo).toHaveBeenCalledWith(ACME, { tab: 'pulls' })
        const spy = vi.fn(); const off = onAppEvent(APP_EVENTS.REPO_DETAIL_SELECT_PR, spy)
        fire(APP_EVENTS.REPO_DETAIL_PRS_LOADED, [{ number: 7, title: 'pending' }, { number: 8 }])
        off()
        expect(spy.mock.calls[0][0].detail).toEqual({ number: 7, title: 'pending' })
    })
    it('OPEN_REPO_ISSUE then ISSUES_LOADED selects the matching issue', () => {
        mount()
        fire(APP_EVENTS.OPEN_REPO_ISSUE, { repoFullName: 'acme/demo', number: 3 })
        expect(p.handleOpenRepo).toHaveBeenCalledWith(ACME, { tab: 'issues' })
        const spy = vi.fn(); const off = onAppEvent(APP_EVENTS.REPO_DETAIL_SELECT_ISSUE, spy)
        fire(APP_EVENTS.REPO_DETAIL_ISSUES_LOADED, [{ number: 3, title: 'bug' }])
        off()
        expect(spy.mock.calls[0][0].detail).toEqual({ issue: { number: 3, title: 'bug' } })
    })
})
