import { useState, useCallback } from 'react'
import { RefreshCw, Wand2 } from 'lucide-react'
import { Button } from '../../ui/Button'
import { BranchSelector } from '../shared/BranchSelector'
import { DiffSummary } from '../shared/DiffSummary'
import { useStreaming } from '../../../hooks/useStreaming'
import { useAIStatus } from '../../../hooks/useAIStatus'
import { StreamingOutput } from '../shared/StreamingOutput'
import { RefinementZone } from '../shared/RefinementZone'
import { FormatSelector } from './FormatSelector'
import { SessionHistory } from './SessionHistory'
import { MultiCommitSplit } from './MultiCommitSplit'
import { apiCall } from '../../../utils/api'
import { Textarea } from '../../ui/form'

const INPUT_MODES = [
    { id: 'auto', label: 'Auto-fetch' },
    { id: 'manual', label: 'Paste' },
]

const COMMIT_CHIPS = [
    { id: 'shorter', label: 'Shorter' },
    { id: 'more_detail', label: 'More detail' },
    { id: 'add_body', label: '+ Body' },
    { id: 'breaking_change', label: 'Breaking change' },
    { id: 'regenerate', label: 'Regenerate' },
]

const MULTI_COMMIT_THRESHOLD = 300

export function CommitTab({ toolkit }) {
    const { selectedRepo, headBranch, baseBranch, branches, compareData, compareLoading, handleBranchChange, getDiffText, repoOwner, history, addToHistory, setGeneratedCommit } = toolkit

    const { streamingText, isStreaming, error: streamError, retryCount, startStream, cancelStream } = useStreaming()
    const aiStatus = useAIStatus()
    const aiOff = !aiStatus.loading && !aiStatus.configured

    const [inputMode, setInputMode] = useState(selectedRepo ? 'auto' : 'manual')
    const [manualDiff, setManualDiff] = useState('')
    const [format, setFormat] = useState('conventional')
    const [repoStyle, setRepoStyle] = useState(null)
    const [repoStyleLoading, setRepoStyleLoading] = useState(false)
    const [generated, setGenerated] = useState('')
    const [splitLoading, setSplitLoading] = useState(false)
    const [multiCommits, setMultiCommits] = useState(null)
    const [versions, setVersions] = useState([])
    const [localError, setLocalError] = useState(null)

    const totalChanges = compareData
        ? (compareData.diff_summary?.additions || 0) + (compareData.diff_summary?.deletions || 0)
        : 0

    const onBranchChange = useCallback((branch, type) => {
        handleBranchChange(branch, type)
        setGenerated('')
        setMultiCommits(null)
        setLocalError(null)
    }, [handleBranchChange])

    const fetchRepoStyle = useCallback(async () => {
        if (!selectedRepo) return null
        setRepoStyleLoading(true)
        try {
            const res = await fetch(`/api/repos/${repoOwner}/${selectedRepo.name}/commits/style`, { credentials: 'include' })
            if (!res.ok) return null
            const data = await res.json()
            setRepoStyle(data)
            return data
        } catch (err) {
            setLocalError('Failed to fetch repo commit style')
            return null
        } finally { setRepoStyleLoading(false) }
    }, [selectedRepo, repoOwner])

    const handleGenerate = useCallback(async () => {
        const diff = inputMode === 'auto' ? getDiffText() : manualDiff

        if (!diff?.trim()) return
        setGenerated('')
        setMultiCommits(null)
        setLocalError(null)

        let style = repoStyle
        if (format === 'repo-convention' && !style) {
            style = await fetchRepoStyle()
        }

        const result = await startStream('/api/ai/generate-commit', {
            diff,
            format,
            repo_style: format === 'repo-convention' ? style : undefined,
            repo_context: selectedRepo ? { name: selectedRepo.full_name, description: selectedRepo.description } : undefined,
        })

        if (result?.message) {
            setGenerated(result.message)
            addToHistory(result.message)
            setVersions(prev => [{ id: Date.now(), content: result.message, instruction: 'Generated', time: new Date().toLocaleTimeString() }, ...prev].slice(0, 10))
            setGeneratedCommit?.({ message: result.message, format })
        }
    }, [inputMode, manualDiff, format, repoStyle, selectedRepo, fetchRepoStyle, addToHistory, startStream, setGeneratedCommit, getDiffText])

    const handleRefine = useCallback(async (instruction) => {
        if (!generated) return
        if (instruction === 'regenerate') {
            handleGenerate()
            return
        }

        setLocalError(null)
        const diff = inputMode === 'auto' ? getDiffText() : manualDiff

        const result = await startStream('/api/ai/refine', {
            original_content: generated,
            original_diff: diff,
            instruction,
            content_type: 'commit',
        })

        if (result?.refined_content) {
            setGenerated(result.refined_content)
            addToHistory(result.refined_content)
            setVersions(prev => [{ id: Date.now(), content: result.refined_content, instruction, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 10))
            setGeneratedCommit?.({ message: result.refined_content, format })
        }
    }, [generated, inputMode, manualDiff, addToHistory, handleGenerate, startStream, setGeneratedCommit, format, getDiffText])

    const handleChatRefine = useCallback(async (message) => {
        setLocalError(null)
        const diff = inputMode === 'auto' ? getDiffText() : manualDiff
        const result = await startStream('/api/ai/chat-refine', {
            message,
            current_output: generated,
            original_diff: diff,
            content_type: 'commit',
            history: [],
        })
        if (result?.refined_content) {
            setGenerated(result.refined_content)
            addToHistory(result.refined_content)
            setVersions(prev => [{ id: Date.now(), content: result.refined_content, instruction: message, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 10))
            setGeneratedCommit?.({ message: result.refined_content, format })
        }
    }, [inputMode, manualDiff, generated, format, startStream, addToHistory, setGeneratedCommit, getDiffText])

    const handleSplit = useCallback(async () => {
        const diff = getDiffText()
        if (!diff) return
        setSplitLoading(true)
        setLocalError(null)
        try {
            const data = await apiCall('/api/ai/generate-commit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    diff,
                    format,
                    repo_context: selectedRepo ? { name: selectedRepo.full_name } : undefined,
                }),
            })
            const msgs = data.message.split('\n').filter(l => l.trim())
            setMultiCommits(msgs.map(m => ({ message: m.replace(/^\d+\.\s*/, ''), files: [] })))
        } catch {
            setLocalError('Failed to split commits. Try again.')
        } finally { setSplitLoading(false) }
    }, [format, selectedRepo, getDiffText])

    const canGenerate = inputMode === 'auto'
        ? (compareData && compareData.files?.length > 0)
        : manualDiff.trim().length > 0

    const displayError = localError || streamError

    return (
        <div className="p-4 md:p-6 space-y-4">
            {/* Input mode toggle */}
            <div className="flex gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800/60 border border-slate-200/40 dark:border-slate-700/40 w-fit">
                {INPUT_MODES.map(m => (
                    <button
                        key={m.id}
                        type="button"
                        onClick={() => setInputMode(m.id)}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                            inputMode === m.id
                                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                    >
                        {m.label}
                    </button>
                ))}
            </div>

            {inputMode === 'auto' && (
                <div className="space-y-3">
                    {selectedRepo && (
                        <div className="flex gap-3">
                            <BranchSelector branches={branches} selected={headBranch} onSelect={b => onBranchChange(b, 'head')} label="Branch" />
                            <BranchSelector branches={branches} selected={baseBranch} onSelect={b => onBranchChange(b, 'base')} label="Compare against" defaultBranch={baseBranch} />
                        </div>
                    )}
                    <DiffSummary files={compareData?.files || []} summary={compareData?.diff_summary} loading={compareLoading} />
                </div>
            )}

            {inputMode === 'manual' && (
                <div>
                    <Textarea
                        rows={8}
                        value={manualDiff}
                        onChange={(e) => setManualDiff(e.target.value)}
                        placeholder="Paste a git diff, file changes, or describe what you changed in plain text..."
                        aria-label="Manual diff or change description"
                        className="font-mono leading-relaxed"
                    />
                </div>
            )}

            <FormatSelector selected={format} onSelect={setFormat} repoStyleLoading={repoStyleLoading} />

            {displayError && (
                <div className="px-3 py-2 rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800/50 text-xs text-rose-600 dark:text-rose-400 flex items-center justify-between">
                    <span>{displayError}</span>
                    {retryCount > 0 && <span className="text-rose-400 ds-text-micro">Retry {retryCount}/3</span>}
                </div>
            )}

            <Button
                type="button"
                variant="primary"
                size="md"
                onClick={handleGenerate}
                disabled={aiOff || !canGenerate || isStreaming}
                title={aiOff ? 'Configure AI in Settings → AI Configuration to enable generation' : undefined}
            >
                {isStreaming ? (
                    <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Generating...</>
                ) : (
                    <><Wand2 className="w-3.5 h-3.5" />Generate</>
                )}
            </Button>

            {inputMode === 'auto' && totalChanges > MULTI_COMMIT_THRESHOLD && !multiCommits && generated && (
                <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50 text-xs text-amber-700 dark:text-amber-300">
                    <span>Large diff detected ({totalChanges} lines). Split into logical commits?</span>
                    <Button type="button" variant="warning" size="xs" onClick={handleSplit} disabled={splitLoading}>{splitLoading ? 'Splitting...' : 'Split'}</Button>
                </div>
            )}

            {multiCommits && (
                <MultiCommitSplit commits={multiCommits} onDismiss={() => setMultiCommits(null)} onUseAll={() => setMultiCommits(null)} />
            )}

            {!multiCommits && (
                <StreamingOutput
                    content={generated}
                    streamingText={streamingText}
                    isStreaming={isStreaming}
                    onCancel={cancelStream}
                    label="Generated Commit Message"
                    retryCount={retryCount}
                />
            )}

            {generated && !isStreaming && !multiCommits && (
                <RefinementZone
                    chips={COMMIT_CHIPS}
                    onChipSelect={handleRefine}
                    onChatSubmit={handleChatRefine}
                    disabled={isStreaming}
                    placeholder='Refine: e.g. "make it more technical"'
                    versions={versions}
                    onRestore={(content) => { setGenerated(content); setGeneratedCommit?.({ message: content, format }) }}
                />
            )}

            <SessionHistory items={history} onRestore={(content) => { setGenerated(content); setGeneratedCommit?.({ message: content, format }) }} />
        </div>
    )
}
