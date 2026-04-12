import { useState, useCallback, useRef } from 'react'

const TAB_STORAGE_KEY = 'devToolkit_activeTab'
const MAX_HISTORY = 5

export function useDevToolkit({ repos = [], initialTab, initialRepo, initialBranch, initialPR } = {}) {
    const [activeTab, setActiveTabState] = useState(() => {
        if (initialTab) return initialTab
        try { return sessionStorage.getItem(TAB_STORAGE_KEY) || 'commits' } catch { return 'commits' }
    })
    const [selectedRepo, setSelectedRepo] = useState(initialRepo || null)
    const [headBranch, setHeadBranch] = useState(initialBranch || null)
    const [baseBranch, setBaseBranch] = useState(null)
    const [branches, setBranches] = useState([])
    const [compareData, setCompareData] = useState(null)
    const [compareLoading, setCompareLoading] = useState(false)
    const [prContext, setPrContext] = useState(initialPR || null)
    const [history, setHistory] = useState([])
    const abortRef = useRef(null)

    const setActiveTab = useCallback((tab) => {
        setActiveTabState(tab)
        try { sessionStorage.setItem(TAB_STORAGE_KEY, tab) } catch { /* noop */ }
    }, [])

    const fetchBranches = useCallback(async (owner, repo) => {
        try {
            const res = await fetch(`/api/repos/${owner}/${repo}/branches?per_page=100`)
            if (!res.ok) return
            const data = await res.json()
            setBranches(data)
            const defaultBranch = data.find(b => b.name === 'main') || data.find(b => b.name === 'master') || data[0]
            if (defaultBranch && !baseBranch) {
                setBaseBranch(defaultBranch.name)
            }
        } catch { /* noop */ }
    }, [baseBranch])

    const fetchCompare = useCallback(async (owner, repo, base, head) => {
        if (!base || !head || base === head) {
            setCompareData(null)
            return
        }
        abortRef.current?.abort()
        const ctrl = new AbortController()
        abortRef.current = ctrl
        setCompareLoading(true)
        try {
            const res = await fetch(`/api/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`, { signal: ctrl.signal })
            if (!res.ok) throw new Error('Compare failed')
            const data = await res.json()
            setCompareData({
                ahead_by: data.ahead_by,
                behind_by: data.behind_by,
                total_commits: data.total_commits,
                commits: (data.commits || []).map(c => ({ sha: c.sha, message: c.commit?.message || '' })),
                files: (data.files || []).map(f => ({
                    filename: f.filename,
                    status: f.status,
                    additions: f.additions,
                    deletions: f.deletions,
                    patch: f.patch || '',
                })),
                diff_summary: {
                    files_changed: (data.files || []).length,
                    additions: (data.files || []).reduce((s, f) => s + (f.additions || 0), 0),
                    deletions: (data.files || []).reduce((s, f) => s + (f.deletions || 0), 0),
                },
            })
        } catch (err) {
            if (err.name !== 'AbortError') setCompareData(null)
        } finally {
            setCompareLoading(false)
        }
    }, [])

    const selectRepo = useCallback((repo) => {
        setSelectedRepo(repo)
        setHeadBranch(null)
        setBaseBranch(null)
        setBranches([])
        setCompareData(null)
        if (repo) {
            fetchBranches(repo.owner?.login || repo.full_name?.split('/')[0], repo.name)
        }
    }, [fetchBranches])

    const addToHistory = useCallback((message) => {
        setHistory(prev => [message, ...prev.filter(m => m !== message)].slice(0, MAX_HISTORY))
    }, [])

    return {
        activeTab, setActiveTab,
        repos, selectedRepo, selectRepo,
        headBranch, setHeadBranch,
        baseBranch, setBaseBranch,
        branches,
        compareData, compareLoading, fetchCompare,
        prContext, setPrContext,
        history, addToHistory,
    }
}
