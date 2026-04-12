import { useState, useCallback, useEffect } from 'react'
import { RefreshCw, GitPullRequest, Copy, Check, Rocket } from 'lucide-react'
import { RepoSelector } from '../shared/RepoSelector'
import { BranchSelector } from '../shared/BranchSelector'
import { DiffSummary } from '../shared/DiffSummary'
import { PRSections } from './PRSections'
import { CreatePRConfirm } from './CreatePRConfirm'

export function PRTab({ toolkit }) {
    const { repos, selectedRepo, selectRepo, headBranch, setHeadBranch, baseBranch, setBaseBranch, branches, compareData, compareLoading, fetchCompare, prContext } = toolkit

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

    useEffect(() => {
        if (prContext && selectedRepo) {
            if (prContext.base && prContext.head) {
                setHeadBranch(prContext.head)
                setBaseBranch(prContext.base)
                fetchCompare(selectedRepo.owner?.login, selectedRepo.name, prContext.base, prContext.head)
            }
        }
    }, [prContext, selectedRepo, setHeadBranch, setBaseBranch, fetchCompare])

    const handleBranchChange = useCallback((branch, type) => {
        if (type === 'head') {
            setHeadBranch(branch)
            if (baseBranch && selectedRepo) fetchCompare(selectedRepo.owner?.login, selectedRepo.name, baseBranch, branch)
        } else {
            setBaseBranch(branch)
            if (headBranch && selectedRepo) fetchCompare(selectedRepo.owner?.login, selectedRepo.name, branch, headBranch)
        }
        setSections(null)
    }, [baseBranch, headBranch, selectedRepo, setHeadBranch, setBaseBranch, fetchCompare])

    const handleGenerate = useCallback(async () => {
        if (!compareData) return
        setLoading(true)
        setSections(null)

        try {
            let template = null
            if (selectedRepo) {
                try {
                    const tplRes = await fetch(`/api/repos/${selectedRepo.owner?.login}/${selectedRepo.name}/pr-template`)
                    if (tplRes.ok) {
                        const tplData = await tplRes.json()
                        if (tplData.found) {
                            template = tplData.template
                            setTemplateBadge('Using repo template')
                        } else {
                            setTemplateBadge('Using default template')
                        }
                    }
                } catch { /* noop */ }
            }

            const topPatches = compareData.files
                .slice(0, 30)
                .map(f => f.patch)
                .filter(Boolean)
                .join('\n---\n')

            const res = await fetch('/api/ai/generate-pr', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    commits: compareData.commits,
                    diff_summary: { files: compareData.files, ...compareData.diff_summary },
                    top_patches: topPatches,
                    template,
                    repo_context: selectedRepo ? { name: selectedRepo.full_name, description: selectedRepo.description } : undefined,
                }),
            })
            if (!res.ok) throw new Error('Generation failed')
            const data = await res.json()
            setSections(data)
            setLabels(data.suggested_labels || [])
            setReviewers(data.suggested_reviewers || [])
        } catch {
            setSections({ title: '', summary: 'Error generating PR description. Please try again.', test_plan: '', breaking_changes: null, related_issues: [] })
        } finally {
            setLoading(false)
        }
    }, [compareData, selectedRepo])

    const handleRefine = useCallback(async (contentType, instruction) => {
        if (!sections) return
        setRefiningSection(contentType)
        const field = contentType === 'pr_summary' ? 'summary' : 'test_plan'
        try {
            const res = await fetch('/api/ai/refine', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    original_content: sections[field],
                    original_diff: compareData?.files?.map(f => f.patch).filter(Boolean).join('\n---\n'),
                    instruction,
                    content_type: contentType,
                }),
            })
            if (!res.ok) throw new Error('Refine failed')
            const data = await res.json()
            setSections(prev => ({ ...prev, [field]: data.refined_content }))
        } catch { /* noop */ } finally { setRefiningSection(null) }
    }, [sections, compareData])

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
        try {
            const owner = selectedRepo.owner?.login
            const repo = selectedRepo.name
            const body = buildBody()

            if (prContext?.number) {
                await fetch(`/api/repos/${owner}/${repo}/pulls/${prContext.number}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: sections.title, body }),
                })
                setPrUrl(`https://github.com/${owner}/${repo}/pull/${prContext.number}`)
            } else {
                const res = await fetch(`/api/repos/${owner}/${repo}/pulls`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
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
            }
        } catch { /* noop */ } finally {
            setActionLoading(false)
            setConfirmAction(null)
        }
    }, [sections, selectedRepo, prContext, headBranch, baseBranch, buildBody])

    const canGenerate = compareData && compareData.files?.length > 0

    return (
        <div className="p-4 md:p-6 space-y-4">
            <RepoSelector repos={repos} selected={selectedRepo} onSelect={(r) => { selectRepo(r); setSections(null) }} />
            {selectedRepo && (
                <div className="flex gap-3">
                    <BranchSelector branches={branches} selected={headBranch} onSelect={b => handleBranchChange(b, 'head')} label="Head (your branch)" />
                    <BranchSelector branches={branches} selected={baseBranch} onSelect={b => handleBranchChange(b, 'base')} label="Base (merge into)" defaultBranch={baseBranch} />
                </div>
            )}

            <DiffSummary files={compareData?.files || []} summary={compareData?.diff_summary} loading={compareLoading} />

            {templateBadge && (
                <div className="text-xs text-slate-500 dark:text-slate-400 italic">{templateBadge}</div>
            )}

            <button
                type="button"
                onClick={handleGenerate}
                disabled={!canGenerate || loading}
                className="ds-btn-shimmer inline-flex items-center gap-2 px-6 py-2.5 text-[13px] font-semibold rounded-lg text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-md shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
                {loading ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Generating...</> : <><GitPullRequest className="w-3.5 h-3.5" />Generate PR Description</>}
            </button>

            <PRSections
                sections={sections}
                onSectionChange={(field, val) => setSections(prev => ({ ...prev, [field]: val }))}
                onRefine={handleRefine}
                refiningSection={refiningSection}
                loading={loading}
                labels={labels}
                onLabelsChange={setLabels}
                reviewers={reviewers}
                onReviewersChange={setReviewers}
            />

            {sections && !loading && (
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
