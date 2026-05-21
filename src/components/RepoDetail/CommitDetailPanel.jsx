// SPDX-License-Identifier: AGPL-3.0-only
import { GitCommit, ExternalLink, Copy, Check } from 'lucide-react'
import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { Spinner } from '../ui/Spinner'
import { StaleDataBadge } from '../ui/StaleDataBadge'
import { useResilientFetch } from '../../hooks/useResilientFetch'
import { CodeReviewSurface } from '../diff/CodeReviewSurface'
import { formatRelativeTime } from '../../utils/format'

function CommitMessageBody({ description }) {
    if (!description) return null
    return (
        <div className="px-4 py-3 mx-4 my-3 rounded-xl bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/40">
            <pre className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300 font-sans leading-relaxed">{description}</pre>
        </div>
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
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
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
                    <span className="text-emerald-600 dark:text-emerald-400">+{stats.additions}</span>
                    <span className="text-rose-600 dark:text-rose-400">−{stats.deletions}</span>
                    {data?.html_url && (
                        <a href={data.html_url} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline">
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
                        rightSlot={null}
                    />
                )}
            </div>
        </Modal>
    )
}
