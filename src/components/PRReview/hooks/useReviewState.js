import { useReducer, useEffect, useCallback } from 'react'

const PERSIST_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

function getStorageKey(owner, repo, pullNumber) {
    return `pr-review-${owner}-${repo}-${pullNumber}`
}

function loadPersistedState(key) {
    try {
        const raw = localStorage.getItem(key)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        // Validate age
        if (parsed._savedAt && Date.now() - parsed._savedAt > PERSIST_TTL_MS) {
            localStorage.removeItem(key)
            return null
        }
        return parsed
    } catch {
        return null
    }
}

function cleanOldEntries() {
    try {
        const prefix = 'pr-review-'
        const toRemove = []
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)
            if (key && key.startsWith(prefix) && !key.includes('-ai-')) {
                try {
                    const raw = localStorage.getItem(key)
                    if (raw) {
                        const parsed = JSON.parse(raw)
                        if (parsed._savedAt && Date.now() - parsed._savedAt > PERSIST_TTL_MS) {
                            toRemove.push(key)
                        }
                    }
                } catch {
                    // ignore malformed entries
                }
            }
        }
        toRemove.forEach(k => localStorage.removeItem(k))
    } catch {
        // ignore storage errors
    }
}

function buildInitialState(owner, repo, pullNumber) {
    const key = getStorageKey(owner, repo, pullNumber)
    const persisted = loadPersistedState(key)

    return {
        pr: null,
        headSha: null,
        files: [],
        comments: {}, // { filename: [comment, ...] }
        activeFile: persisted?.lastActiveFile ?? null,
        reviewedFiles: persisted?.reviewedFiles ?? [], // array of filenames
        viewMode: persisted?.viewMode ?? 'split', // 'split' | 'unified'
        fileTreeCollapsed: false,
        aiSummaryCollapsed: persisted?.aiSummaryCollapsed ?? false,
        pendingComments: persisted?.pendingComments ?? [],
        resolvedComments: [], // array of comment IDs resolved in this session
        aiSummary: null,
        aiLoading: false,
    }
}

function reducer(state, action) {
    switch (action.type) {
        case 'LOAD_DATA': {
            const { pr, headSha, files, comments } = action.payload
            return {
                ...state,
                pr,
                headSha,
                files,
                comments,
                activeFile: state.activeFile || files[0]?.filename || null,
            }
        }
        case 'SET_ACTIVE_FILE': {
            return { ...state, activeFile: action.filename }
        }
        case 'TOGGLE_REVIEWED': {
            const filename = action.filename
            const already = state.reviewedFiles.includes(filename)
            return {
                ...state,
                reviewedFiles: already
                    ? state.reviewedFiles.filter(f => f !== filename)
                    : [...state.reviewedFiles, filename],
            }
        }
        case 'TOGGLE_VIEW_MODE': {
            return {
                ...state,
                viewMode: state.viewMode === 'split' ? 'unified' : 'split',
            }
        }
        case 'TOGGLE_FILE_TREE': {
            return { ...state, fileTreeCollapsed: !state.fileTreeCollapsed }
        }
        case 'TOGGLE_AI_SUMMARY': {
            return { ...state, aiSummaryCollapsed: !state.aiSummaryCollapsed }
        }
        case 'ADD_PENDING_COMMENT': {
            return {
                ...state,
                pendingComments: [...state.pendingComments, action.comment],
            }
        }
        case 'REMOVE_PENDING_COMMENT': {
            return {
                ...state,
                pendingComments: state.pendingComments.filter((_, i) => i !== action.index),
            }
        }
        case 'CLEAR_PENDING_COMMENTS': {
            return { ...state, pendingComments: [] }
        }
        case 'TOGGLE_RESOLVED': {
            const { commentId } = action
            const already = state.resolvedComments.includes(commentId)
            return {
                ...state,
                resolvedComments: already
                    ? state.resolvedComments.filter(id => id !== commentId)
                    : [...state.resolvedComments, commentId],
            }
        }
        case 'ADD_SUBMITTED_COMMENT': {
            const { filename, comment } = action
            const existing = state.comments[filename] ?? []
            return {
                ...state,
                comments: {
                    ...state.comments,
                    [filename]: [...existing, comment],
                },
            }
        }
        case 'SET_AI_SUMMARY': {
            return { ...state, aiSummary: action.summary, aiLoading: false }
        }
        case 'SET_AI_LOADING': {
            return { ...state, aiLoading: action.loading }
        }
        default:
            return state
    }
}

export function useReviewState(owner, repo, pullNumber) {
    const [state, dispatch] = useReducer(
        reducer,
        { owner, repo, pullNumber },
        ({ owner, repo, pullNumber }) => buildInitialState(owner, repo, pullNumber)
    )

    // Clean old localStorage entries on mount
    useEffect(() => {
        cleanOldEntries()
    }, [])

    // Persist selected fields to localStorage whenever they change
    useEffect(() => {
        if (!owner || !repo || !pullNumber) return
        const key = getStorageKey(owner, repo, pullNumber)
        try {
            const toSave = {
                reviewedFiles: state.reviewedFiles,
                viewMode: state.viewMode,
                lastActiveFile: state.activeFile,
                aiSummaryCollapsed: state.aiSummaryCollapsed,
                pendingComments: state.pendingComments,
                _savedAt: Date.now(),
            }
            localStorage.setItem(key, JSON.stringify(toSave))
        } catch {
            // ignore quota errors
        }
    }, [
        owner,
        repo,
        pullNumber,
        state.reviewedFiles,
        state.viewMode,
        state.activeFile,
        state.aiSummaryCollapsed,
        state.pendingComments,
    ])

    // Warn on beforeunload when there are pending comments
    useEffect(() => {
        function handleBeforeUnload(e) {
            if (state.pendingComments.length > 0) {
                e.preventDefault()
                e.returnValue = ''
            }
        }
        window.addEventListener('beforeunload', handleBeforeUnload)
        return () => window.removeEventListener('beforeunload', handleBeforeUnload)
    }, [state.pendingComments.length])

    return { state, dispatch }
}
