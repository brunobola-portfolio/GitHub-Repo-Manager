import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useReviewState } from '@/components/PRReview/hooks/useReviewState'

describe('useReviewState', () => {
    beforeEach(() => {
        localStorage.clear()
        vi.clearAllMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('returns correct initial state', () => {
        const { result } = renderHook(() => useReviewState('owner', 'repo', 1))
        const { state } = result.current

        expect(state.pr).toBeNull()
        expect(state.headSha).toBeNull()
        expect(state.files).toEqual([])
        expect(state.comments).toEqual({})
        expect(state.activeFile).toBeNull()
        expect(state.reviewedFiles).toEqual([])
        expect(state.viewMode).toBe('split')
        expect(state.fileTreeCollapsed).toBe(false)
        expect(state.aiSummaryCollapsed).toBe(false)
        expect(state.pendingComments).toEqual([])
        expect(state.aiSummary).toBeNull()
        expect(state.aiLoading).toBe(false)
    })

    it('SET_ACTIVE_FILE changes the active file', () => {
        const { result } = renderHook(() => useReviewState('owner', 'repo', 1))

        act(() => {
            result.current.dispatch({ type: 'SET_ACTIVE_FILE', filename: 'src/index.js' })
        })

        expect(result.current.state.activeFile).toBe('src/index.js')
    })

    it('TOGGLE_REVIEWED adds a file to reviewedFiles', () => {
        const { result } = renderHook(() => useReviewState('owner', 'repo', 1))

        act(() => {
            result.current.dispatch({ type: 'TOGGLE_REVIEWED', filename: 'src/index.js' })
        })

        expect(result.current.state.reviewedFiles).toContain('src/index.js')
    })

    it('TOGGLE_REVIEWED removes a file that is already reviewed', () => {
        const { result } = renderHook(() => useReviewState('owner', 'repo', 1))

        act(() => {
            result.current.dispatch({ type: 'TOGGLE_REVIEWED', filename: 'src/index.js' })
        })
        expect(result.current.state.reviewedFiles).toContain('src/index.js')

        act(() => {
            result.current.dispatch({ type: 'TOGGLE_REVIEWED', filename: 'src/index.js' })
        })
        expect(result.current.state.reviewedFiles).not.toContain('src/index.js')
    })

    it('ADD_PENDING_COMMENT appends a comment to pendingComments', () => {
        const { result } = renderHook(() => useReviewState('owner', 'repo', 1))
        const comment = { path: 'src/index.js', line: 10, body: 'Nice' }

        act(() => {
            result.current.dispatch({ type: 'ADD_PENDING_COMMENT', comment })
        })

        expect(result.current.state.pendingComments).toHaveLength(1)
        expect(result.current.state.pendingComments[0]).toEqual(comment)
    })

    it('CLEAR_PENDING_COMMENTS empties the pendingComments array', () => {
        const { result } = renderHook(() => useReviewState('owner', 'repo', 1))

        act(() => {
            result.current.dispatch({ type: 'ADD_PENDING_COMMENT', comment: { body: 'a' } })
            result.current.dispatch({ type: 'ADD_PENDING_COMMENT', comment: { body: 'b' } })
        })
        expect(result.current.state.pendingComments).toHaveLength(2)

        act(() => {
            result.current.dispatch({ type: 'CLEAR_PENDING_COMMENTS' })
        })
        expect(result.current.state.pendingComments).toHaveLength(0)
    })

    it('TOGGLE_VIEW_MODE switches from split to unified and back', () => {
        const { result } = renderHook(() => useReviewState('owner', 'repo', 1))

        expect(result.current.state.viewMode).toBe('split')

        act(() => {
            result.current.dispatch({ type: 'TOGGLE_VIEW_MODE' })
        })
        expect(result.current.state.viewMode).toBe('unified')

        act(() => {
            result.current.dispatch({ type: 'TOGGLE_VIEW_MODE' })
        })
        expect(result.current.state.viewMode).toBe('split')
    })

    it('persists reviewedFiles and viewMode to localStorage', () => {
        const { result } = renderHook(() => useReviewState('owner', 'repo', 42))

        act(() => {
            result.current.dispatch({ type: 'TOGGLE_REVIEWED', filename: 'README.md' })
            result.current.dispatch({ type: 'TOGGLE_VIEW_MODE' })
        })

        const stored = JSON.parse(localStorage.getItem('pr-review-owner-repo-42'))
        expect(stored).not.toBeNull()
        expect(stored.reviewedFiles).toContain('README.md')
        expect(stored.viewMode).toBe('unified')
    })

    it('restores persisted state from localStorage on mount', () => {
        const key = 'pr-review-owner-repo-99'
        localStorage.setItem(
            key,
            JSON.stringify({
                reviewedFiles: ['src/App.jsx'],
                viewMode: 'unified',
                lastActiveFile: 'src/App.jsx',
                aiSummaryCollapsed: true,
                pendingComments: [],
                _savedAt: Date.now(),
            })
        )

        const { result } = renderHook(() => useReviewState('owner', 'repo', 99))
        const { state } = result.current

        expect(state.reviewedFiles).toContain('src/App.jsx')
        expect(state.viewMode).toBe('unified')
        expect(state.activeFile).toBe('src/App.jsx')
        expect(state.aiSummaryCollapsed).toBe(true)
    })

    it('discards persisted state older than 30 days', () => {
        const key = 'pr-review-owner-repo-77'
        const oldDate = Date.now() - 31 * 24 * 60 * 60 * 1000
        localStorage.setItem(
            key,
            JSON.stringify({
                reviewedFiles: ['old.js'],
                viewMode: 'unified',
                lastActiveFile: 'old.js',
                aiSummaryCollapsed: false,
                pendingComments: [],
                _savedAt: oldDate,
            })
        )

        const { result } = renderHook(() => useReviewState('owner', 'repo', 77))
        const { state } = result.current

        expect(state.reviewedFiles).toEqual([])
        expect(state.viewMode).toBe('split')
    })

    it('LOAD_DATA sets pr, headSha, files, and comments', () => {
        const { result } = renderHook(() => useReviewState('owner', 'repo', 1))
        const pr = { number: 1, title: 'Test PR', head: { sha: 'abc123' } }
        const files = [{ filename: 'a.js' }]
        const comments = { 'a.js': [{ id: 1, body: 'ok' }] }

        act(() => {
            result.current.dispatch({
                type: 'LOAD_DATA',
                pr,
                headSha: 'abc123',
                files,
                comments,
            })
        })

        expect(result.current.state.pr).toEqual(pr)
        expect(result.current.state.headSha).toBe('abc123')
        expect(result.current.state.files).toEqual(files)
        expect(result.current.state.comments).toEqual(comments)
    })
})
