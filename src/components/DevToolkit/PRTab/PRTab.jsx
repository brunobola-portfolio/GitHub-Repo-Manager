import { useState, useCallback, useEffect } from 'react'
import { RefreshCw, GitPullRequest, Copy, Check, Rocket, Info, CheckCircle2, FileText } from 'lucide-react'
import { useStreaming } from '../../../hooks/useStreaming'
import { useToast } from '../../../hooks/useToast'
import { BranchSelector } from '../shared/BranchSelector'
import { DiffSummary } from '../shared/DiffSummary'
import { RefinementZone } from '../shared/RefinementZone'
import { PRSections } from './PRSections'
import { CreatePRConfirm } from './CreatePRConfirm'
import { getCsrfToken } from '../../../utils/api'

export function PRTab({ toolkit }) {
    const { toast } = useToast()
    const { selectedRepo, headBranch, baseBranch, branches, compareData, compareLoading, handleBranchChange, getDiffText, repoOwner, prContext, generatedCommit, setHeadBranch, setBaseBranch, fetchCompare } = toolkit
    const { isStreaming, error: streamError, startStream } = useStreaming()

    const [sections, setSections] = useState(null)
    const [labels, setLabels] = useState([])
    const [reviewers, setReviewers] = useState([])
    const [loading, setLoading] = useState(false)
    const [refiningSection, setRefiningSection] = useState(null)
    const [templateBadge, setTemplateBadge] = useState(null)
    const [confirmAction, setConfirmAction] = useState(null)
    const [actionLoading, setActionLoading] = useState(false)
    const [copied, setCopied] = useState(false)
    const [prUrl, setPrUrl] = useState(null)
    const [localError, setLocalError] = useState(null)

    useEffect(() => {
        if (prContext && selectedRepo) {
            if (prContext.base && prContext.head) {
                setHeadBranch(prContext.head)
                setBaseBranch(prContext.base)
                fetchCompare(repoOwner, selectedRepo.name, prContext.base, prContext.head)
            }
        }
    }, [prContext, selectedRepo, setHeadBranch, setBaseBranch, fetchCompare, repoOwner])

    const onBranchChange = useCallback((branch, type) => {
        handleBranchChange(branch, type)
        setSections(null)
        setLocalError(null)
    }, [handleBranchChange])

    const handleGenerate = useCallback(async () => {
        if (!compareData) return
        setLoading(true)
        setSections(null)
        setLocalError(null)

        try {
            let template = null
            if (selectedRepo) {
                try {
                    const tplRes = await fetch(`/api/repos/${repoOwner}/${selectedRepo.name}/pr-template`, { credentials: 'include' })
                    if (tplRes.ok) {
                        const tplData = await tplRes.json()
                        if (tplData.found) {
                            template = tplData.template
                            setTemplateBadge('Using repo template')
                        } else {
                            setTemplateBadge('Using default template')
                        }
                    }
                } catch {
                    setTemplateBadge('Using default template')
                }
            }

            const topPatches = compareData.files
                .slice(0, 30)
                .map(f => f.patch)
                .filter(Boolean)
                .join('\n---\n')

            const body = {
                commits: compareData.commits,
                diff_summary: { files: compareData.files, ...compareData.diff_summary },
                top_patches: topPatches,
                template,
                repo_context: selectedRepo ? { name: selectedRepo.full_name, description: selectedRepo.description } : undefined,
                commit_context: generatedCommit?.message || undefined,
            }

            const result = await startStream('/api/ai/generate-pr', body)
            if (result) {
                setSections(result)
                setLabels(result.suggested_labels || [])
                setReviewers(result.suggested_reviewers || [])
            }
        } catch {
            setLocalError('Error generating PR description. Please try again.')
            setSections({ title: '', summary: 'Error generating PR description. Please try again.', test_plan: '', breaking_changes: null, related_issues: [] })
        } finally {
            setLoading(false)
        }
    }, [compareData, selectedRepo, generatedCommit, startStream, repoOwner])

    const handleRefine = useCallback(async (contentType, instruction) => {
        if (!sections) return
        setRefiningSection(contentType)
        setLocalError(null)
        const field = contentType === 'pr_summary' ? 'summary' : 'test_plan'
        try {
            const result = await startStream('/api/ai/refine', {
                original_content: sections[field],
                original_diff: getDiffText(),
                instruction,
                content_type: contentType,
            })
            if (result?.refined_content) {
                setSections(prev => ({ ...prev, [field]: result.refined_content }))
            }
        } catch {
            setLocalError(`Failed to refine ${field}. Try again.`)
        } finally { setRefiningSection(null) }
    }, [sections, getDiffText, startStream])

    const handleChatRefine = useCallback(async (message) => {
        if (!sections) return
        setLocalError(null)
        const result = await startStream('/api/ai/chat-refine', {
            message,
            current_output: sections.summary,
            original_diff: getDiffText(),
            content_type: 'pr_summary',
            history: [],
        })
        if (result?.refined_content) {
            setSections(prev => ({ ...prev, summary: result.refined_content }))
        }
    }, [sections, getDiffText, startStream])

    const buildBody = useCallback(() => {
        if (!sections) return ''
        const parts = [sections.summary || '', sections.test_plan || '']
        if (sections.breaking_changes) parts.push(sections.breaking_changes)
        if (sections.related_issues?.length) {
            parts.push(sections.related_issues.map(i => `${i.relation} #${i.number}`).join('\n'))
        }
        return parts.filter(Boolean).join('\n\n')
    }, [sections])

    const handleCopyAll = useCallback(() => {
        const body = buildBody()
        const full = `${sections?.title || ''}\n\n${body}`
        navigator.clipboard.writeText(full)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }, [sections, buildBody])

    const handleCreateOrUpdate = useCallback(async () => {
        if (!sections || !selectedRepo) return
        setActionLoading(true)
        setLocalError(null)
        try {
            const owner = repoOwner
            const repo = selectedRepo.name
            const body = buildBody()

            const csrfHeader = await getCsrfToken().catch(() => null)
            const mutationHeaders = {
                'Content-Type': 'application/json',
                ...(csrfHeader ? { 'X-CSRF-Token': csrfHeader } : {}),
            }
            if (prContext?.number) {
                const patchRes = await fetch(`/api/repos/${owner}/${repo}/pulls/${prContext.number}`, {
                    method: 'PATCH',
                    headers: mutationHeaders,
                    credentials: 'include',
                    body: JSON.stringify({ title: sections.title, body }),
                })
                if (!patchRes.ok) throw new Error('Update failed')
                const prUrlValue = `https://github.com/${owner}/${repo}/pull/${prContext.number}`
                setPrUrl(prUrlValue)
                toolkit.setGeneratedPR?.({ number: prContext.number, url: prUrlValue, title: sections.title })
                toast.success(`PR #${prContext.number} updated`)
            } else {
                const res = await fetch(`/api/repos/${owner}/${repo}/pulls`, {
                    method: 'POST',
                    headers: mutationHeaders,
                    credentials: 'include',
                    body: JSON.stringify({
                        title: sections.title,
                        body,
                        head: headBranch,
                        base: baseBranch,
                    }),
                })
                if (!res.ok) throw new Error('Create failed')
                const data = await res.json()
                setPrUrl(data.pull_request?.html_url || `https://github.com/${owner}/${repo}/pulls`)
                toolkit.setGeneratedPR?.({ number: data.pull_request?.number, url: data.pull_request?.html_url, title: sections.title })
                toast.success(`PR #${data.pull_request?.number || ''} created`.trim())
            }
        } catch {
            setLocalError('Failed to create/update PR. Check your permissions and try again.')
            toast.error('Failed to create/update PR — check permissions and try again')
        } finally {
            setActionLoading(false)
            setConfirmAction(null)
        }
    }, [sections, selectedRepo, prContext, headBranch, baseBranch, buildBody, repoOwner, toolkit, toast])

    const canGenerate = compareData && compareData.files?.length > 0
    const displayError = localError || streamError

    return (
        <div className="p-4 md:p-6 space-y-4">
            {selectedRepo && (
                <div className="flex gap-3">
                    <BranchSelector branches={branches} selected={headBranch} onSelect={b => onBranchChange(b, 'head')} label="Head (your branch)" />
                    <BranchSelector branches={branches} selected={baseBranch} onSelect={b => onBranchChange(b, 'base')} label="Base (merge into)" defaultBranch={baseBranch} />
                </div>
            )}

            <DiffSummary files={compareData?.files || []} summary={compareData?.diff_summary} loading={compareLoading} />

            {selectedRepo && (
                <div className="space-y-1.5">
                    {prContext?.number && (
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400">
                            <Info className="w-3.5 h-3.5 shrink-0" />
                            PR #{prContext.number} exists on this branch
                            <span className="ml-auto px-1.5 py-0.5 rounded bg-blue-500/20 text-[10px] font-medium">Update existing</span>
                        </div>
                    )}
                    {generatedCommit && (
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            Using commit context from Commits tab
                        </div>
                    )}
                    {templateBadge && (
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-500/10 border border-slate-500/20 text-xs text-slate-400">
                            <FileText className="w-3.5 h-3.5 shrink-0" />
                            {templateBadge}
                        </div>
                    )}
                </div>
            )}

            {displayError && (
                <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/50 text-xs text-red-600 dark:text-red-400">
                    {displayError}
                </div>
            )}

            <button
                type="button"
                onClick={handleGenerate}
                disabled={!canGenerate || loading || isStreaming}
                className="ds-btn-shimmer inline-flex items-center gap-2 px-6 py-2.5 text-[13px] font-semibold rounded-lg text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-md shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
                {loading || isStreaming ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Generating...</> : <><GitPullRequest className="w-3.5 h-3.5" />Generate PR Description</>}
            </button>

            <PRSections
                sections={sections}
                onSectionChange={(field, val) => setSections(prev => ({ ...prev, [field]: val }))}
                onRefine={handleRefine}
                refiningSection={refiningSection}
                loading={loading || isStreaming}
                labels={labels}
                onLabelsChange={setLabels}
                reviewers={reviewers}
                onReviewersChange={setReviewers}
            />

            {sections && !isStreaming && (
                <RefinementZone
                    chips={[
                        { id: 'shorter', label: 'Shorter' },
                        { id: 'more_context', label: 'More context' },
                        { id: 'architecture_notes', label: 'Architecture notes' },
                    ]}
                    onChipSelect={(instruction) => handleRefine('pr_summary', instruction)}
                    onChatSubmit={handleChatRefine}
                    disabled={!!refiningSection || isStreaming}
                    placeholder='Refine: e.g. "add migration notes to summary"'
                />
            )}

            {sections && !loading && !isStreaming && (
                <div className="flex items-center gap-3 flex-wrap">
                    <button type="button" onClick={handleCopyAll} className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        {copied ? 'Copied!' : 'Copy All'}
                    </button>

                    {!confirmAction && (
                        <button
                            type="button"
                            onClick={() => setConfirmAction(prContext?.number ? 'update' : 'create')}
                            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition-colors"
                        >
                            <Rocket className="w-3.5 h-3.5" />
                            {prContext?.number ? 'Update PR' : 'Create PR'}
                        </button>
                    )}

                    {confirmAction && (
                        <CreatePRConfirm action={confirmAction} onConfirm={handleCreateOrUpdate} onCancel={() => setConfirmAction(null)} loading={actionLoading} />
                    )}

                    {prUrl && (
                        <a href={prUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                            View PR on GitHub &rarr;
                        </a>
                    )}
                </div>
            )}
        </div>
    )
}
