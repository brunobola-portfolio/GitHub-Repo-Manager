// SPDX-License-Identifier: Apache-2.0
import { GitCommit, ExternalLink, Sparkles } from 'lucide-react'
import { AnimatedCopyIcon } from '../ui/AnimatedCopyIcon'
import { useState } from 'react'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { Spinner } from '../ui/Spinner'
import { StaleDataBadge } from '../ui/StaleDataBadge'
import { useResilientFetch } from '../../hooks/useResilientFetch'
import { useCommitAI } from '../../hooks/useCommitAI'
import { CodeReviewSurface } from '../diff/CodeReviewSurface'
import { AISummaryPanel } from '../PRReview/AIInsights/AISummaryPanel'
import { sortFilesByRisk } from '../PRReview/hooks/useReviewAI'
import { formatRelativeTime } from '../../utils/format'
import { emitAppEvent, APP_EVENTS } from '../../utils/appEvents'

function CommitMessageBody({ description }) {
    if (!description) return null
    return (
        <div className="px-4 py-3 mx-4 my-3 rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/40">
            <pre className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300 font-sans leading-relaxed">{description}</pre>
        </div>
    )
}

// AI summary for a single commit — cheap because a commit's diff is a
// strict subset of a PR's (see useCommitAI). Loads on demand: a "Ask AI"
// button until the user asks, then the same AISummaryPanel PR review uses.
// The commitAI state is owned by the parent so the file tree can pick up
// the AI's real per-file risk once it lands (same handoff PRFilesTab does
// with useReviewAI), instead of staying on the heuristic fallback forever.
function CommitAIPanel({ summary, loading, error, hasRequested, generate }) {
    const [collapsed, setCollapsed] = useState(false)

    if (!hasRequested) {
        return (
            <Button
                variant="secondary"
                size="sm"
                onClick={generate}
                className="w-full justify-center"
            >
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                Ask AI to summarize this commit
            </Button>
        )
    }

    return (
        <AISummaryPanel
            summary={summary}
            loading={loading}
            error={error}
            collapsed={collapsed}
            onToggle={() => setCollapsed((c) => !c)}
            onRetry={generate}
            onFileClick={(filename) => {
                emitAppEvent(APP_EVENTS.CODE_REVIEW_SELECT_FILE, { filename })
            }}
            headerLabel="AI Commit Summary"
            loadingLabel="Analyzing commit..."
            errorContext="Commit summary"
        />
    )
}

function CopyButton({ value, label }) {
    const [copied, setCopied] = useState(false)
    const onClick = async () => {
        try {
            await navigator.clipboard.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
        } catch { /* clipboard denied; ignore */ }
    }
    return (
        <button type="button" onClick={onClick}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            aria-label={`Copy ${label}`}>
            <AnimatedCopyIcon copied={copied} size="w-3 h-3" checkClassName="text-emerald-500" />
            {value}
        </button>
    )
}

export function CommitDetailPanel({ owner, repo, sha, onClose }) {
    const { data, loading, error, stale, fetchedAt, reload } = useResilientFetch(
        `/api/v1/repos/${owner}/${repo}/commits/${sha}`,
    )

    const message = data?.commit?.message || ''
    const subject = message.split('\n')[0]
    const description = message.split('\n').slice(1).join('\n').trim()
    const files = data?.files || []
    const stats = data?.stats || { additions: 0, deletions: 0 }
    const author = data?.commit?.author

    const commitAI = useCommitAI(owner, repo, sha, files, subject)

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            title={subject || `Commit ${sha?.slice(0, 7)}`}
            subtitle={author?.name ? `by ${author.name}` : undefined}
            icon={GitCommit}
            size="full"
            closeOnBackdrop={false}
            mobileVariant="sheet"
            isBusy={loading}
            bodyClassName="!p-0 flex flex-col"
        >
            <div className="flex flex-col h-full min-h-0">
                <div className="flex items-center gap-3 flex-wrap text-xs px-4 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800">
                    <CopyButton value={sha?.slice(0, 12) || ''} label="commit SHA" />
                    {author?.date && <span className="text-slate-500 dark:text-slate-400">{formatRelativeTime(author.date)}</span>}
                    <span className="text-emerald-700 dark:text-emerald-400">+{stats.additions}</span>
                    <span className="text-rose-600 dark:text-rose-400">−{stats.deletions}</span>
                    {data?.html_url && (
                        <a href={data.html_url} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] hover:underline">
                            View on GitHub <ExternalLink className="w-3 h-3" />
                        </a>
                    )}
                    {stale && <StaleDataBadge fetchedAt={fetchedAt} onRetry={reload} />}
                </div>

                {loading && (
                    <div className="flex items-center justify-center py-12 flex-1">
                        <Spinner size="lg" />
                    </div>
                )}

                {error && !data && (
                    <div className="m-4 px-4 py-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl text-sm text-red-600 dark:text-red-400">
                        Couldn&apos;t load commit. Please retry.
                    </div>
                )}

                {data && (
                    <CodeReviewSurface
                        files={files}
                        storageKey={`commit-reviewed:${owner}/${repo}#${sha}`}
                        headerSlot={<CommitMessageBody description={description} />}
                        rightSlot={files.length > 0 ? <CommitAIPanel {...commitAI} /> : null}
                        // Risk-sorted, risk-colored file tree — same heuristic scorer
                        // PR review uses, so a commit that touches auth/migration code
                        // or hundreds of lines reads differently from a one-line typo
                        // fix, matching PR review's file tree instead of the flat,
                        // unscored order commits got before. Once the AI summary
                        // lands, its real per-file risk takes over from the
                        // heuristic fallback — same handoff PRFilesTab does.
                        sortFiles={(f) => sortFilesByRisk(f, {})}
                        fileMeta={{ aiFileRisks: commitAI.summary?.fileRisks ?? [] }}
                    />
                )}
            </div>
        </Modal>
    )
}
