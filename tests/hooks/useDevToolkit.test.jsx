import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDevToolkit } from '../../src/hooks/useDevToolkit'

describe('useDevToolkit', () => {
    let fetchSpy
    let sessionStore

    beforeEach(() => {
        fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([]),
        })
        globalThis.fetch = fetchSpy

        // Mock sessionStorage
        sessionStore = {}
        const sessionMock = {
            getItem: vi.fn((key) => sessionStore[key] ?? null),
            setItem: vi.fn((key, value) => { sessionStore[key] = String(value) }),
            removeItem: vi.fn((key) => { delete sessionStore[key] }),
            clear: vi.fn(() => { sessionStore = {} }),
        }
        Object.defineProperty(window, 'sessionStorage', {
            value: sessionMock,
            writable: true,
            configurable: true,
        })
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    const mockRepos = [
        { name: 'repo-a', full_name: 'user/repo-a', owner: { login: 'user' } },
        { name: 'repo-b', full_name: 'user/repo-b', owner: { login: 'user' } },
    ]

    // --- 1. Initial state with defaults ---
    it('returns correct default initial state', () => {
        const { result } = renderHook(() => useDevToolkit())

        expect(result.current.activeTab).toBe('commits')
        expect(result.current.selectedRepo).toBeNull()
        expect(result.current.headBranch).toBeNull()
        expect(result.current.baseBranch).toBeNull()
        expect(result.current.branches).toEqual([])
        expect(result.current.compareData).toBeNull()
        expect(result.current.compareLoading).toBe(false)
        expect(result.current.prContext).toBeNull()
        expect(result.current.history).toEqual([])
        expect(result.current.generatedCommit).toBeNull()
        expect(result.current.generatedPR).toBeNull()
        expect(result.current.contextAnalysis).toBeNull()
        expect(result.current.isPinned).toBe(false)
        expect(result.current.panelWidth).toBe(640)
        expect(result.current.autoDraftEnabled).toBe(true)
    })

    // --- 2. Initial state from params ---
    it('uses initialTab and initialRepo when provided', () => {
        const { result } = renderHook(() =>
            useDevToolkit({
                repos: mockRepos,
                initialTab: 'pr',
                initialRepo: mockRepos[0],
            })
        )

        expect(result.current.activeTab).toBe('pr')
        expect(result.current.selectedRepo).toEqual(mockRepos[0])
        expect(result.current.isPinned).toBe(true)
    })

    it('reads activeTab from sessionStorage when no initialTab provided', () => {
        sessionStore['devToolkit_activeTab'] = 'pr'

        const { result } = renderHook(() => useDevToolkit())

        expect(result.current.activeTab).toBe('pr')
    })

    it('reads panelWidth from sessionStorage', () => {
        sessionStore['devToolkit_panelWidth'] = '800'

        const { result } = renderHook(() => useDevToolkit())

        expect(result.current.panelWidth).toBe(800)
    })

    // --- 3. setActiveTab persists to sessionStorage ---
    it('setActiveTab updates state and persists to sessionStorage', () => {
        const { result } = renderHook(() => useDevToolkit())

        act(() => {
            result.current.setActiveTab('pr')
        })

        expect(result.current.activeTab).toBe('pr')
        expect(window.sessionStorage.setItem).toHaveBeenCalledWith('devToolkit_activeTab', 'pr')
    })

    // --- 4. selectRepo resets dependent state ---
    it('selectRepo resets headBranch, compareData, and generated content', async () => {
        // fetchBranches returns branches with 'main' as default
        fetchSpy.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([{ name: 'main' }, { name: 'dev' }]),
        })

        const { result } = renderHook(() => useDevToolkit({ repos: mockRepos }))

        // Select first repo and wait for branches
        await act(async () => {
            result.current.selectRepo(mockRepos[0])
        })

        // Set some generated content
        act(() => {
            result.current.setGeneratedCommit({ message: 'test' })
            result.current.setGeneratedPR({ title: 'test' })
            result.current.setHeadBranch('feature')
        })

        expect(result.current.generatedCommit).toEqual({ message: 'test' })
        expect(result.current.generatedPR).toEqual({ title: 'test' })
        expect(result.current.headBranch).toBe('feature')

        // Now select a different repo -- should reset generated content and head branch
        await act(async () => {
            result.current.selectRepo(mockRepos[1])
        })

        expect(result.current.selectedRepo).toEqual(mockRepos[1])
        expect(result.current.headBranch).toBeNull()
        expect(result.current.compareData).toBeNull()
        expect(result.current.generatedCommit).toBeNull()
        expect(result.current.generatedPR).toBeNull()
        expect(result.current.contextAnalysis).toBeNull()
    })

    // --- Race safety: fetchBranches must mirror fetchCompare's abortRef pattern ---
    it('aborts the in-flight fetchBranches request when a new repo is selected before it resolves', async () => {
        const abortedUrls = []
        fetchSpy.mockImplementation((url, opts) => {
            if (typeof url === 'string' && url.includes('/repos/user/repo-a/branches')) {
                // Never resolves on its own — only rejects if aborted, mirroring
                // how a real in-flight fetch reacts to AbortController#abort().
                return new Promise((_resolve, reject) => {
                    opts?.signal?.addEventListener('abort', () => {
                        abortedUrls.push(url)
                        const err = new Error('aborted')
                        err.name = 'AbortError'
                        reject(err)
                    })
                })
            }
            if (typeof url === 'string' && url.includes('/repos/user/repo-b/branches')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve([{ name: 'main' }, { name: 'repo-b-feature' }]),
                })
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
        })

        const { result } = renderHook(() => useDevToolkit({ repos: mockRepos }))

        // Select repo A -- fetchBranches(A) starts and stays pending.
        await act(async () => {
            result.current.selectRepo(mockRepos[0])
            await Promise.resolve()
        })

        // Select repo B before A resolves -- must abort A's in-flight request.
        await act(async () => {
            result.current.selectRepo(mockRepos[1])
            await new Promise((r) => setTimeout(r, 0))
        })

        // The old repo's request must have been aborted...
        expect(abortedUrls).toHaveLength(1)
        expect(abortedUrls[0]).toContain('/repos/user/repo-a/branches')

        // ...and only the new repo's branches/baseBranch reach state.
        expect(result.current.selectedRepo).toEqual(mockRepos[1])
        expect(result.current.branches).toEqual([{ name: 'main' }, { name: 'repo-b-feature' }])
        expect(result.current.baseBranch).toBe('main')
    })

    it('selectRepo with null does not fetch branches', () => {
        const { result } = renderHook(() => useDevToolkit())

        act(() => {
            result.current.selectRepo(null)
        })

        expect(result.current.selectedRepo).toBeNull()
        expect(fetchSpy).not.toHaveBeenCalled()
    })

    // --- 5. addToHistory maintains max 5 items and deduplicates ---
    it('addToHistory adds items and caps at 5', () => {
        const { result } = renderHook(() => useDevToolkit())

        act(() => {
            result.current.addToHistory('msg1')
            result.current.addToHistory('msg2')
            result.current.addToHistory('msg3')
            result.current.addToHistory('msg4')
            result.current.addToHistory('msg5')
            result.current.addToHistory('msg6')
        })

        expect(result.current.history).toHaveLength(5)
        // Most recent first, oldest dropped
        expect(result.current.history[0]).toBe('msg6')
        expect(result.current.history).not.toContain('msg1')
    })

    it('addToHistory deduplicates by moving existing item to front', () => {
        const { result } = renderHook(() => useDevToolkit())

        act(() => {
            result.current.addToHistory('aaa')
            result.current.addToHistory('bbb')
            result.current.addToHistory('ccc')
        })

        expect(result.current.history).toEqual(['ccc', 'bbb', 'aaa'])

        // Re-add 'aaa' -- it should move to front, not duplicate
        act(() => {
            result.current.addToHistory('aaa')
        })

        expect(result.current.history).toEqual(['aaa', 'ccc', 'bbb'])
        expect(result.current.history).toHaveLength(3)
    })

    // --- 6. handleBranchChange('main', 'head') updates headBranch ---
    it('handleBranchChange with type=head updates headBranch', () => {
        const { result } = renderHook(() => useDevToolkit())

        act(() => {
            result.current.handleBranchChange('main', 'head')
        })

        expect(result.current.headBranch).toBe('main')
    })

    // --- 7. handleBranchChange('dev', 'base') updates baseBranch ---
    it('handleBranchChange with type=base updates baseBranch', () => {
        const { result } = renderHook(() => useDevToolkit())

        act(() => {
            result.current.handleBranchChange('dev', 'base')
        })

        expect(result.current.baseBranch).toBe('dev')
    })

    it('handleBranchChange triggers fetchCompare when both branches and repo are set', async () => {
        // First call: fetchBranches, second call: fetchCompare
        fetchSpy
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve([{ name: 'main' }, { name: 'dev' }]),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    ahead_by: 2,
                    behind_by: 0,
                    total_commits: 2,
                    commits: [],
                    files: [],
                }),
            })

        const { result } = renderHook(() =>
            useDevToolkit({
                repos: mockRepos,
                initialRepo: mockRepos[0],
            })
        )

        // Wait for initial branch fetch
        await act(async () => {
            await new Promise(r => setTimeout(r, 0))
        })

        // Set base branch
        act(() => {
            result.current.handleBranchChange('main', 'base')
        })

        // Set head branch -- should trigger fetchCompare since baseBranch is set
        await act(async () => {
            result.current.handleBranchChange('feature', 'head')
        })

        expect(result.current.headBranch).toBe('feature')
        const compareCalls = fetchSpy.mock.calls.filter(
            ([url]) => typeof url === 'string' && url.includes('/compare/')
        )
        expect(compareCalls.length).toBeGreaterThan(0)
    })

    // --- 8. getDiffText returns joined patches from compareData ---
    it('getDiffText returns joined patches from compareData files', async () => {
        const branchesResponse = [{ name: 'main' }, { name: 'dev' }]
        const compareResponse = {
            ahead_by: 1,
            behind_by: 0,
            total_commits: 1,
            commits: [{ sha: 'abc', commit: { message: 'fix bug' } }],
            files: [
                { filename: 'a.js', status: 'modified', additions: 1, deletions: 0, patch: '@@ -1 +1 @@\n-old\n+new' },
                { filename: 'b.js', status: 'modified', additions: 2, deletions: 1, patch: '@@ -5 +5 @@\n-foo\n+bar' },
            ],
        }

        // selectRepo triggers fetchBranches (call 1), then handleBranchChange triggers fetchCompare (call 2)
        fetchSpy
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(branchesResponse),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(compareResponse),
            })

        const { result } = renderHook(() => useDevToolkit({ repos: mockRepos }))

        // Select repo to trigger fetchBranches
        await act(async () => {
            result.current.selectRepo(mockRepos[0])
        })

        // Wait for fetchBranches to resolve
        await act(async () => {
            await new Promise(r => setTimeout(r, 0))
        })

        // Set base branch (baseBranch may already be 'main' from fetchBranches, but be explicit)
        act(() => {
            result.current.handleBranchChange('main', 'base')
        })

        // Set head branch to trigger fetchCompare (baseBranch is now 'main', selectedRepo is set)
        await act(async () => {
            result.current.handleBranchChange('dev', 'head')
        })

        // Wait for fetchCompare to resolve
        await act(async () => {
            await new Promise(r => setTimeout(r, 0))
        })

        const diffText = result.current.getDiffText()
        expect(diffText).toContain('@@ -1 +1 @@')
        expect(diffText).toContain('@@ -5 +5 @@')
        expect(diffText).toContain('\n---\n')
    })

    // --- 9. getDiffText returns empty string when no compareData ---
    it('getDiffText returns empty string when compareData is null', () => {
        const { result } = renderHook(() => useDevToolkit())

        expect(result.current.getDiffText()).toBe('')
    })

    // --- 10. setPanelWidth persists to sessionStorage ---
    it('setPanelWidth updates state and persists to sessionStorage', () => {
        const { result } = renderHook(() => useDevToolkit())

        act(() => {
            result.current.setPanelWidth(900)
        })

        expect(result.current.panelWidth).toBe(900)
        expect(window.sessionStorage.setItem).toHaveBeenCalledWith('devToolkit_panelWidth', '900')
    })

    // --- Additional: autoDraftEnabled ---
    it('setAutoDraftEnabled persists to sessionStorage', () => {
        const { result } = renderHook(() => useDevToolkit())

        act(() => {
            result.current.setAutoDraftEnabled(false)
        })

        expect(result.current.autoDraftEnabled).toBe(false)
        expect(window.sessionStorage.setItem).toHaveBeenCalledWith('devToolkit_autoDraft', 'false')
    })

    // --- repoOwner memoisation ---
    it('repoOwner is derived from selectedRepo.owner.login', () => {
        const { result } = renderHook(() =>
            useDevToolkit({ initialRepo: mockRepos[0] })
        )

        expect(result.current.repoOwner).toBe('user')
    })

    it('repoOwner falls back to full_name split', () => {
        const repoNoOwner = { name: 'test', full_name: 'org/test' }
        const { result } = renderHook(() =>
            useDevToolkit({ initialRepo: repoNoOwner })
        )

        expect(result.current.repoOwner).toBe('org')
    })

    it('repoOwner is null when no repo selected', () => {
        const { result } = renderHook(() => useDevToolkit())

        expect(result.current.repoOwner).toBeNull()
    })
})
