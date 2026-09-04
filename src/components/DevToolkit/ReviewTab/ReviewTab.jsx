import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Eye } from 'lucide-react'
import { Button } from '../../ui/Button'
import { useStreaming } from '../../../hooks/useStreaming'
import { isAbort } from '../../../utils/errorClassification'
import { ChatInput } from '../shared/ChatInput'
import { PRSelector } from './PRSelector'
import { QuickSummary } from './QuickSummary'
import { QuickActions } from './QuickActions'

export function ReviewTab({ toolkit, onStartReview, onClose }) {
    const { selectedRepo, prContext, generatedPR, repoOwner } = toolkit
    const [pulls, setPulls] = useState([])
    const [pullsLoading, setPullsLoading] = useState(false)
    const [selectedPR, setSelectedPR] = useState(null)
    const [summary, setSummary] = useState(null)
    const [summaryLoading, setSummaryLoading] = useState(false)
    const [summaryError, setSummaryError] = useState(null)

    const { streamingText, isStreaming, error: streamError, startStream } = useStreaming()
    const pullsAbortRef = useRef(null)

    const [qaHistory, setQaHistory] = useState([])
    const [qaResponses, setQaResponses] = useState([])

    // Fetch open PRs with proper cleanup
    useEffect(() => {
        if (!selectedRepo) return

        pullsAbortRef.current?.abort()
        const controller = new AbortController()
        pullsAbortRef.current = controller

        // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for the fetch this effect kicks off
        setPullsLoading(true)
        fetch(`/api/repos/${repoOwner}/${selectedRepo.name}/pulls?state=open`, { signal: controller.signal, credentials: 'include' })
            .then(r => r.ok ? r.json() : [])
            .then(setPulls)
            .catch((err) => {
                if (!isAbort(err)) setPulls([])
            })
            .finally(() => setPullsLoading(false))

        return () => controller.abort()
    }, [selectedRepo, repoOwner])

    // Auto-select a PR from an external signal — either the toolkit opened
    // with a specific PR in mind (prContext), or a PR was just created by the
    // generator (generatedPR). Consolidated from two near-identical effects
    // into one render-time check (generatedPR keeps precedence when both are
    // present, matching the old effect declaration order): applies at most
    // once per distinct target number, so a later manual "Change PR" click
    // isn't fought, and naturally retries once `pulls` finishes loading if
    // the target wasn't found in it yet.
    const externalTargetNumber = useMemo(
        () => generatedPR?.number ?? prContext?.number ?? null,
        [generatedPR, prContext],
    )
    const [appliedExternalTarget, setAppliedExternalTarget] = useState(null)
    if (externalTargetNumber && externalTargetNumber !== appliedExternalTarget && pulls.length) {
        const pr = pulls.find(p => p.number === externalTargetNumber)
        if (pr) {
            setAppliedExternalTarget(externalTargetNumber)
            setSelectedPR(pr)
        }
    }

    const fetchSummary = useCallback(async (pr) => {
        if (!selectedRepo || !pr) return
        setSummaryLoading(true)
        setSummaryError(null)

        try {
            const owner = repoOwner
            const repo = selectedRepo.name

            const filesRes = await fetch(`/api/repos/${owner}/${repo}/pulls/${pr.number}/files`, { credentials: 'include' })
            if (!filesRes.ok) throw new Error('Failed to fetch PR files')
            const files = await filesRes.json()

            const result = await startStream('/api/ai/review-summary', {
                fileManifest: files.map(f => ({ filename: f.filename, additions: f.additions, deletions: f.deletions, status: f.status })),
                topFilePatches: files.slice(0, 30).map(f => ({ filename: f.filename, patch: f.patch })),
                prMetadata: { title: pr.title, additions: files.reduce((s, f) => s + f.additions, 0), deletions: files.reduce((s, f) => s + f.deletions, 0), fileCount: files.length },
            })

            if (result) {
                setSummary(result)
            }
        } catch (err) {
            setSummaryError(err.message || 'Failed to generate summary')
        } finally {
            setSummaryLoading(false)
        }
    }, [selectedRepo, startStream, repoOwner])

    const handlePRSelect = useCallback((pr) => {
        setSelectedPR(pr)
        setSummary(null)
        setQaHistory([])
        setQaResponses([])
        fetchSummary(pr)
    }, [fetchSummary])

    const handleQA = useCallback(async (question) => {
        if (!selectedRepo || !selectedPR) return
        const owner = repoOwner
        const repo = selectedRepo.name

        const newHistory = [...qaHistory, { role: 'user', content: question }]
        setQaHistory(newHistory)
        setQaResponses(prev => [...prev, { role: 'user', content: question }])

        try {
            const filesRes = await fetch(`/api/repos/${owner}/${repo}/pulls/${selectedPR.number}/files`, { credentials: 'include' })
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
        } catch {
            setQaResponses(prev => [...prev, { role: 'assistant', content: 'Failed to get answer. Try again.' }])
        }
    }, [selectedRepo, selectedPR, qaHistory, summary, startStream, repoOwner])

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
                            <p className="text-xs text-slate-500 dark:text-slate-400">#{selectedPR.number} by {selectedPR.user?.login}</p>
                        </div>
                        <button type="button" onClick={() => { setSelectedPR(null); setSummary(null); setQaHistory([]); setQaResponses([]) }} className="text-xs text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] hover:underline">Change PR</button>
                    </div>

                    <QuickSummary summary={summary} loading={summaryLoading} error={summaryError || streamError} onRetry={() => fetchSummary(selectedPR)} />

                    {summary && (
                        <div className="space-y-3">
                            <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Ask about this PR</h4>
                            {qaResponses.length > 0 && (
                                <div className="max-h-48 overflow-y-auto ds-scrollbar space-y-2">
                                    {qaResponses.map((msg, i) => (
                                        <div key={i} className={`px-3 py-2 rounded-lg text-sm ${
                                            msg.role === 'user'
                                                ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300 ml-8'
                                                : 'bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300 mr-8'
                                        }`}>
                                            {msg.content}
                                        </div>
                                    ))}
                                    {isStreaming && (
                                        <div className="bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300 mr-8 px-3 py-2 rounded-lg text-sm">
                                            {streamingText}
                                            <span className="inline-block w-2 h-4 ml-0.5 bg-emerald-500 dark:bg-emerald-400 animate-pulse align-text-bottom" />
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
                        <QuickActions owner={repoOwner} repo={selectedRepo.name} pullNumber={selectedPR.number} onSubmitted={() => fetchSummary(selectedPR)} />
                    )}

                    <Button
                        type="button"
                        variant="primary"
                        size="md"
                        onClick={handleStartFullReview}
                        className="w-full"
                    >
                        <Eye className="w-4 h-4" />
                        Open Full Review
                    </Button>
                </>
            )}
        </div>
    )
}
