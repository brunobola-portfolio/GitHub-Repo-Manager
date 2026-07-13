import { useState, useCallback, useMemo, useRef } from 'react'
import { API_BASE } from '../config'
import { getCsrfToken } from '../utils/api'
import { isAbort } from '../utils/errorClassification'

const TAB_STORAGE_KEY = 'devToolkit_activeTab'
const PANEL_WIDTH_KEY = 'devToolkit_panelWidth'
const AUTO_DRAFT_KEY = 'devToolkit_autoDraft'
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
    const [generatedCommit, setGeneratedCommit] = useState(null)
    const [generatedPR, setGeneratedPR] = useState(null)
    const [contextAnalysis, setContextAnalysis] = useState(null)
    const [contextAnalysisLoading, setContextAnalysisLoading] = useState(false)
    const [isPinned, setIsPinned] = useState(!!initialRepo)
    const [panelWidth, setPanelWidthState] = useState(() => {
        try {
            const stored = sessionStorage.getItem(PANEL_WIDTH_KEY)
            return stored ? Number(stored) : 640
        } catch { return 640 }
    })
    const [autoDraftEnabled, setAutoDraftEnabledState] = useState(() => {
        try { return sessionStorage.getItem(AUTO_DRAFT_KEY) !== 'false' } catch { return true }
    })
    const abortRef = useRef(null)
    const branchesAbortRef = useRef(null)

    const setActiveTab = useCallback((tab) => {
        setActiveTabState(tab)
        try { sessionStorage.setItem(TAB_STORAGE_KEY, tab) } catch { /* noop */ }
    }, [])

    const fetchBranches = useCallback(async (owner, repo) => {
        // Mirror fetchCompare's abortRef pattern: cancel any in-flight branch
        // fetch for a previous repo so a late (out-of-order) response can
        // never overwrite the branches/baseBranch of the repo now selected.
        branchesAbortRef.current?.abort()
        const ctrl = new AbortController()
        branchesAbortRef.current = ctrl
        try {
            const res = await fetch(`${API_BASE}/repos/${owner}/${repo}/branches?per_page=100`, { signal: ctrl.signal, credentials: 'include' })
            if (!res.ok) return
            const data = await res.json()
            setBranches(data)
            const defaultBranch = data.find(b => b.name === 'main') || data.find(b => b.name === 'master') || data[0]
            if (defaultBranch) {
                setBaseBranch(prev => prev ?? defaultBranch.name)
            }
        } catch {
            // Aborts (repo changed) and real fetch failures are both silent
            // here — there's no error state for branches, unlike fetchCompare.
        }
    }, [])

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
            const res = await fetch(`${API_BASE}/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`, { signal: ctrl.signal, credentials: 'include' })
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
            if (!isAbort(err)) setCompareData(null)
        } finally {
            setCompareLoading(false)
        }
    }, [])

    const setPanelWidth = useCallback((w) => {
        setPanelWidthState(w)
        try { sessionStorage.setItem(PANEL_WIDTH_KEY, String(w)) } catch { /* noop */ }
    }, [])

    const setAutoDraftEnabled = useCallback((v) => {
        setAutoDraftEnabledState(v)
        try { sessionStorage.setItem(AUTO_DRAFT_KEY, String(v)) } catch { /* noop */ }
    }, [])

    const fetchContextAnalysis = useCallback(async (owner, repo, diffSummary, commits, fileList) => {
        setContextAnalysisLoading(true)
        try {
            const csrfToken = await getCsrfToken()
            const res = await fetch(`${API_BASE}/ai/analyze-context`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: JSON.stringify({
                    repo: `${owner}/${repo}`,
                    diff_summary: diffSummary,
                    commits,
                    file_list: fileList,
                }),
            })
            if (!res.ok) throw new Error('Context analysis failed')
            const data = await res.json()
            setContextAnalysis(data)
        } catch {
            setContextAnalysis(null)
        } finally {
            setContextAnalysisLoading(false)
        }
    }, [])

    const selectRepo = useCallback((repo) => {
        setSelectedRepo(repo)
        setHeadBranch(null)
        setBaseBranch(null)
        setBranches([])
        setCompareData(null)
        setGeneratedCommit(null)
        setGeneratedPR(null)
        setContextAnalysis(null)
        if (repo) {
            fetchBranches(repo.owner?.login || repo.full_name?.split('/')[0], repo.name)
        }
    }, [fetchBranches])

    const addToHistory = useCallback((message) => {
        setHistory(prev => [message, ...prev.filter(m => m !== message)].slice(0, MAX_HISTORY))
    }, [])

    // --- Shared utilities (Q1: deduplicated branch change logic) ---
    const handleBranchChange = useCallback((branch, type) => {
        if (type === 'head') {
            setHeadBranch(branch)
            if (baseBranch && selectedRepo) {
                fetchCompare(selectedRepo.owner?.login, selectedRepo.name, baseBranch, branch)
            }
        } else {
            setBaseBranch(branch)
            if (headBranch && selectedRepo) {
                fetchCompare(selectedRepo.owner?.login, selectedRepo.name, branch, headBranch)
            }
        }
    }, [baseBranch, headBranch, selectedRepo, fetchCompare])

    // --- Q2: Shared diff text extraction ---
    const getDiffText = useCallback(() => {
        if (!compareData?.files) return ''
        return compareData.files.map(f => f.patch).filter(Boolean).join('\n---\n')
    }, [compareData])

    // --- Memoised repo owner helper ---
    const repoOwner = useMemo(() => {
        return selectedRepo?.owner?.login || selectedRepo?.full_name?.split('/')[0] || null
    }, [selectedRepo])

    return {
        activeTab, setActiveTab,
        repos, selectedRepo, selectRepo,
        headBranch, setHeadBranch,
        baseBranch, setBaseBranch,
        branches,
        compareData, compareLoading, fetchCompare,
        prContext, setPrContext,
        history, addToHistory,
        generatedCommit, setGeneratedCommit,
        generatedPR, setGeneratedPR,
        contextAnalysis, contextAnalysisLoading, fetchContextAnalysis,
        isPinned, setIsPinned,
        panelWidth, setPanelWidth,
        autoDraftEnabled, setAutoDraftEnabled,
        handleBranchChange,
        getDiffText,
        repoOwner,
    }
}
