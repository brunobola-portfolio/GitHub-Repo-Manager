import { useState, useCallback, useEffect } from 'react'
import { Eye } from 'lucide-react'
import { RepoSelector } from '../shared/RepoSelector'
import { PRSelector } from './PRSelector'
import { QuickSummary } from './QuickSummary'
import { QuickActions } from './QuickActions'

export function ReviewTab({ toolkit, onStartReview, onClose }) {
    const { repos, selectedRepo, selectRepo, prContext } = toolkit
    const [pulls, setPulls] = useState([])
    const [pullsLoading, setPullsLoading] = useState(false)
    const [selectedPR, setSelectedPR] = useState(null)
    const [summary, setSummary] = useState(null)
    const [summaryLoading, setSummaryLoading] = useState(false)
    const [summaryError, setSummaryError] = useState(null)

    useEffect(() => {
        if (!selectedRepo) return
        setPullsLoading(true)
        fetch(`/api/repos/${selectedRepo.owner?.login}/${selectedRepo.name}/pulls?state=open`)
            .then(r => r.ok ? r.json() : [])
            .then(setPulls)
            .catch(() => setPulls([]))
            .finally(() => setPullsLoading(false))
    }, [selectedRepo])

    useEffect(() => {
        if (prContext?.number && pulls.length) {
            const pr = pulls.find(p => p.number === prContext.number)
            if (pr) setSelectedPR(pr)
        }
    }, [prContext, pulls])

    const fetchSummary = useCallback(async (pr) => {
        if (!selectedRepo || !pr) return
        setSummaryLoading(true)
        setSummaryError(null)

        try {
            const owner = selectedRepo.owner?.login
            const repo = selectedRepo.name

            const filesRes = await fetch(`/api/repos/${owner}/${repo}/pulls/${pr.number}/files`)
            if (!filesRes.ok) throw new Error('Failed to fetch files')
            const files = await filesRes.json()

            const res = await fetch('/api/ai/review-summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileManifest: files.map(f => ({ filename: f.filename, additions: f.additions, deletions: f.deletions, status: f.status })),
                    topFilePatches: files.slice(0, 30).map(f => ({ filename: f.filename, patch: f.patch })),
                    prMetadata: { title: pr.title, additions: files.reduce((s, f) => s + f.additions, 0), deletions: files.reduce((s, f) => s + f.deletions, 0), fileCount: files.length },
                }),
            })
            if (!res.ok) throw new Error('AI summary failed')
            const data = await res.json()
            setSummary(data)
        } catch (err) {
            setSummaryError(err.message || 'Failed to generate summary')
        } finally {
            setSummaryLoading(false)
        }
    }, [selectedRepo])

    const handlePRSelect = useCallback((pr) => {
        setSelectedPR(pr)
        setSummary(null)
        fetchSummary(pr)
    }, [fetchSummary])

    const handleStartFullReview = useCallback(() => {
        if (selectedPR && onStartReview) {
            onClose?.()
            onStartReview(selectedPR)
        }
    }, [selectedPR, onStartReview, onClose])

    return (
        <div className="p-4 md:p-6 space-y-4">
            <RepoSelector repos={repos} selected={selectedRepo} onSelect={(r) => { selectRepo(r); setSelectedPR(null); setSummary(null) }} />

            {selectedRepo && !selectedPR && (
                <PRSelector pulls={pulls} loading={pullsLoading} onSelect={handlePRSelect} />
            )}

            {selectedPR && (
                <>
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-medium text-slate-800 dark:text-slate-200">{selectedPR.title}</h3>
                            <p className="text-xs text-slate-400">#{selectedPR.number} by {selectedPR.user?.login}</p>
                        </div>
                        <button type="button" onClick={() => { setSelectedPR(null); setSummary(null) }} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Change PR</button>
                    </div>

                    <QuickSummary summary={summary} loading={summaryLoading} error={summaryError} onRetry={() => fetchSummary(selectedPR)} />

                    {summary && (
                        <QuickActions owner={selectedRepo.owner?.login} repo={selectedRepo.name} pullNumber={selectedPR.number} onSubmitted={() => fetchSummary(selectedPR)} />
                    )}

                    <button
                        type="button"
                        onClick={handleStartFullReview}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium rounded-xl text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-lg shadow-indigo-500/20 transition-all"
                    >
                        <Eye className="w-4 h-4" />
                        Open Full Review
                    </button>
                </>
            )}
        </div>
    )
}
