import { useState, useCallback } from 'react'
import { RefreshCw, Wand2 } from 'lucide-react'
import { BranchSelector } from '../shared/BranchSelector'
import { DiffSummary } from '../shared/DiffSummary'
import { useStreaming } from '../../../hooks/useStreaming'
import { StreamingOutput } from '../shared/StreamingOutput'
import { RefinementZone } from '../shared/RefinementZone'
import { FormatSelector } from './FormatSelector'
import { SessionHistory } from './SessionHistory'
import { MultiCommitSplit } from './MultiCommitSplit'

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
    const { repos, selectedRepo, selectRepo, headBranch, setHeadBranch, baseBranch, setBaseBranch, branches, compareData, compareLoading, fetchCompare, history, addToHistory } = toolkit

    const { streamingText, isStreaming, result: streamResult, startStream, cancelStream, reset: resetStream } = useStreaming()

    const [inputMode, setInputMode] = useState(selectedRepo ? 'auto' : 'manual')
    const [manualDiff, setManualDiff] = useState('')
    const [format, setFormat] = useState('conventional')
    const [repoStyle, setRepoStyle] = useState(null)
    const [repoStyleLoading, setRepoStyleLoading] = useState(false)
    const [generated, setGenerated] = useState('')
    const [loading, setLoading] = useState(false)
    const [multiCommits, setMultiCommits] = useState(null)
    const [versions, setVersions] = useState([])

    const totalChanges = compareData
        ? (compareData.diff_summary?.additions || 0) + (compareData.diff_summary?.deletions || 0)
        : 0

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
        setGenerated('')
        setMultiCommits(null)
    }, [baseBranch, headBranch, selectedRepo, setHeadBranch, setBaseBranch, fetchCompare])

    const fetchRepoStyle = useCallback(async () => {
        if (!selectedRepo) return null
        setRepoStyleLoading(true)
        try {
            const res = await fetch(`/api/repos/${selectedRepo.owner?.login}/${selectedRepo.name}/commits/style`)
            if (!res.ok) return null
            const data = await res.json()
            setRepoStyle(data)
            return data
        } catch { return null } finally { setRepoStyleLoading(false) }
    }, [selectedRepo])

    const handleGenerate = useCallback(async () => {
        const diff = inputMode === 'auto'
            ? compareData?.files?.map(f => f.patch).filter(Boolean).join('\n---\n')
            : manualDiff

        if (!diff?.trim()) return
        setGenerated('')
        setMultiCommits(null)

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
            setVersions(prev => [{ content: result.message, instruction: 'Generated', time: new Date().toLocaleTimeString() }, ...prev].slice(0, 10))
            toolkit.setGeneratedCommit?.({ message: result.message, format })
        }
    }, [inputMode, compareData, manualDiff, format, repoStyle, selectedRepo, fetchRepoStyle, addToHistory, startStream, toolkit])

    const handleRefine = useCallback(async (instruction) => {
        if (!generated) return
        if (instruction === 'regenerate') {
            handleGenerate()
            return
        }

        const diff = inputMode === 'auto'
            ? compareData?.files?.map(f => f.patch).filter(Boolean).join('\n---\n')
            : manualDiff

        const result = await startStream('/api/ai/refine', {
            original_content: generated,
            original_diff: diff,
            instruction,
            content_type: 'commit',
        })

        if (result?.refined_content) {
            setGenerated(result.refined_content)
            addToHistory(result.refined_content)
            setVersions(prev => [{ content: result.refined_content, instruction, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 10))
            toolkit.setGeneratedCommit?.({ message: result.refined_content, format })
        }
    }, [generated, inputMode, compareData, manualDiff, addToHistory, handleGenerate, startStream, toolkit, format])

    const handleChatRefine = useCallback(async (message) => {
        const diff = inputMode === 'auto'
            ? compareData?.files?.map(f => f.patch).filter(Boolean).join('\n---\n')
            : manualDiff
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
            setVersions(prev => [{ content: result.refined_content, instruction: message, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 10))
            toolkit.setGeneratedCommit?.({ message: result.refined_content, format })
        }
    }, [inputMode, compareData, manualDiff, generated, format, startStream, addToHistory, toolkit])

    const handleSplit = useCallback(async () => {
        const diff = compareData?.files?.map(f => f.patch).filter(Boolean).join('\n---\n')
        if (!diff) return
        setLoading(true)
        try {
            const res = await fetch('/api/ai/generate-commit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    diff,
                    format,
                    repo_context: selectedRepo ? { name: selectedRepo.full_name } : undefined,
                }),
            })
            if (!res.ok) throw new Error('Split failed')
            const data = await res.json()
            const msgs = data.message.split('\n').filter(l => l.trim())
            setMultiCommits(msgs.map(m => ({ message: m.replace(/^\d+\.\s*/, ''), files: [] })))
        } catch { /* noop */ } finally { setLoading(false) }
    }, [compareData, format, selectedRepo])

    const canGenerate = inputMode === 'auto'
        ? (compareData && compareData.files?.length > 0)
        : manualDiff.trim().length > 0

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
                                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
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
                            <BranchSelector branches={branches} selected={headBranch} onSelect={b => handleBranchChange(b, 'head')} label="Branch" />
                            <BranchSelector branches={branches} selected={baseBranch} onSelect={b => handleBranchChange(b, 'base')} label="Compare against" defaultBranch={baseBranch} />
                        </div>
                    )}
                    <DiffSummary files={compareData?.files || []} summary={compareData?.diff_summary} loading={compareLoading} />
                </div>
            )}

            {inputMode === 'manual' && (
                <div>
                    <textarea
                        value={manualDiff}
                        onChange={(e) => setManualDiff(e.target.value)}
                        placeholder="Paste a git diff, file changes, or describe what you changed in plain text..."
                        className="w-full h-40 px-4 py-3 bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 resize-none font-mono placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-colors leading-relaxed"
                    />
                </div>
            )}

            <FormatSelector selected={format} onSelect={setFormat} repoStyleLoading={repoStyleLoading} />

            <button
                type="button"
                onClick={handleGenerate}
                disabled={!canGenerate || isStreaming}
                className="ds-btn-shimmer inline-flex items-center gap-2 px-6 py-2.5 text-[13px] font-semibold rounded-lg text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-md shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
                {isStreaming ? (
                    <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Generating...</>
                ) : (
                    <><Wand2 className="w-3.5 h-3.5" />Generate</>
                )}
            </button>

            {inputMode === 'auto' && totalChanges > MULTI_COMMIT_THRESHOLD && !multiCommits && generated && (
                <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50 text-xs text-amber-700 dark:text-amber-300">
                    <span>Large diff detected ({totalChanges} lines). Split into logical commits?</span>
                    <button type="button" onClick={handleSplit} className="px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-600 text-white font-medium">Split</button>
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
                    onRestore={(content) => { setGenerated(content); toolkit.setGeneratedCommit?.({ message: content, format }) }}
                />
            )}

            <SessionHistory items={history} onRestore={setGenerated} />
        </div>
    )
}
