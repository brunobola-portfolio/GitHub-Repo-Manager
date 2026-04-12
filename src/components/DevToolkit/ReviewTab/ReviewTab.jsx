import { useState, useCallback, useEffect } from 'react'
import { Eye } from 'lucide-react'
import { useStreaming } from '../../../hooks/useStreaming'
import { ChatInput } from '../shared/ChatInput'
import { PRSelector } from './PRSelector'
import { QuickSummary } from './QuickSummary'
import { QuickActions } from './QuickActions'

export function ReviewTab({ toolkit, onStartReview, onClose }) {
    const { repos, selectedRepo, selectRepo, prContext, generatedPR } = toolkit
    const [pulls, setPulls] = useState([])
    const [pullsLoading, setPullsLoading] = useState(false)
    const [selectedPR, setSelectedPR] = useState(null)
    const [summary, setSummary] = useState(null)
    const [summaryLoading, setSummaryLoading] = useState(false)
    const [summaryError, setSummaryError] = useState(null)

    const { streamingText, isStreaming, startStream, cancelStream } = useStreaming()

    const [qaHistory, setQaHistory] = useState([])
    const [qaResponses, setQaResponses] = useState([])

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

    useEffect(() => {
        if (generatedPR?.number && pulls.length) {
            const pr = pulls.find(p => p.number === generatedPR.number)
            if (pr) setSelectedPR(pr)
        }
    }, [generatedPR, pulls])

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

            const result = await startStream('/api/ai/review-summary', {
                fileManifest: files.map(f => ({ filename: f.filename, additions: f.additions, deletions: f.deletions, status: f.status })),
                topFilePatches: files.slice(0, 30).map(f => ({ filename: f.filename, patch: f.patch })),
                prMetadata: { title: pr.title, additions: files.reduce((s, f) => s + f.additions, 0), deletions: files.reduce((s, f) => s + f.deletions, 0), fileCount: files.length },
            })

            if (result) {
                // Streaming returns the normalized summary object directly
                setSummary(result)
            }
        } catch (err) {
            setSummaryError(err.message || 'Failed to generate summary')
        } finally {
            setSummaryLoading(false)
        }
    }, [selectedRepo, startStream])

    const handlePRSelect = useCallback((pr) => {
        setSelectedPR(pr)
        setSummary(null)
        setQaHistory([])
        setQaResponses([])
        fetchSummary(pr)
    }, [fetchSummary])

    const handleQA = useCallback(async (question) => {
        if (!selectedRepo || !selectedPR) return
        const owner = selectedRepo.owner?.login
        const repo = selectedRepo.name

        const newHistory = [...qaHistory, { role: 'user', content: question }]
        setQaHistory(newHistory)
        setQaResponses(prev => [...prev, { role: 'user', content: question }])

        const filesRes = await fetch(`/api/repos/${owner}/${repo}/pulls/${selectedPR.number}/files`)
        const files = filesRes.ok ? await filesRes.json() : []
        const patches = files.slice(0, 20).map(f => `${f.filename}:\n${f.patch || ''}`).join('\n---\n')

        const result = await startStream('/api/ai/chat-refine', {
            message: question,
            current_output: summary?.summary?.overview || '',
            original_diff: patches,
            content_type: 'review_qa',
            history: newHistory.slice(-10),
        })

        if (result?.refined_content) {
            setQaHistory(prev => [...prev, { role: 'assistant', content: result.refined_content }])
            setQaResponses(prev => [...prev, { role: 'assistant', content: result.refined_content }])
        }
    }, [selectedRepo, selectedPR, qaHistory, summary, startStream])

    const handleStartFullReview = useCallback(() => {
        if (selectedPR && onStartReview) {
            onClose?.()
            onStartReview(selectedPR)
        }
    }, [selectedPR, onStartReview, onClose])

    return (
        <div className="p-4 md:p-6 space-y-4">
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
                        <button type="button" onClick={() => { setSelectedPR(null); setSummary(null); setQaHistory([]); setQaResponses([]) }} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Change PR</button>
                    </div>

                    <QuickSummary summary={summary} loading={summaryLoading} error={summaryError} onRetry={() => fetchSummary(selectedPR)} />

                    {summary && (
                        <div className="space-y-3">
                            <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Ask about this PR</h4>
                            {qaResponses.length > 0 && (
                                <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-2">
                                    {qaResponses.map((msg, i) => (
                                        <div key={i} className={`px-3 py-2 rounded-lg text-sm ${
                                            msg.role === 'user'
                                                ? 'bg-indigo-500/10 text-indigo-300 ml-8'
                                                : 'bg-slate-800/60 text-slate-300 mr-8'
                                        }`}>
                                            {msg.content}
                                        </div>
                                    ))}
                                    {isStreaming && (
                                        <div className="bg-slate-800/60 text-slate-300 mr-8 px-3 py-2 rounded-lg text-sm">
                                            {streamingText}
                                            <span className="inline-block w-2 h-4 ml-0.5 bg-emerald-400 animate-pulse align-text-bottom" />
                                        </div>
                                    )}
                                </div>
                            )}
                            <ChatInput
                                placeholder='Ask: e.g. "is the error handling sufficient?"'
                                onSubmit={handleQA}
                                disabled={isStreaming}
                            />
                        </div>
                    )}

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
