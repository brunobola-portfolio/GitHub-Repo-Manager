// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import { GitCommit, ExternalLink, Files } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Spinner } from '../ui/Spinner'
import { StaleDataBadge } from '../ui/StaleDataBadge'
import { useResilientFetch } from '../../hooks/useResilientFetch'

/**
 * CommitDetailPanel — modal showing a commit's metadata, message, and per-
 * file diff. Uses the same DiffRenderer as the PR review surface for visual
 * parity.
 */
export function CommitDetailPanel({ owner, repo, sha, onClose }) {
    const { data, loading, error, stale, fetchedAt, reload } = useResilientFetch(
        `/api/v1/repos/${owner}/${repo}/commits/${sha}`,
    )

    const message = data?.commit?.message || ''
    const subject = message.split('\n')[0]
    const description = message.split('\n').slice(1).join('\n').trim()
    const files = data?.files || []

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            title={subject || `Commit ${sha?.slice(0, 7)}`}
            subtitle={data?.commit?.author?.name ? `by ${data.commit.author.name}` : undefined}
            icon={GitCommit}
            iconGradient="primary"
            size="2xl"
            mobileVariant="sheet"
            isBusy={loading}
        >
            <div className="p-5 md:p-6 space-y-5">
                <div className="flex items-center gap-3 flex-wrap text-xs">
                    <span className="font-mono px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        {sha?.slice(0, 12)}
                    </span>
                    {data?.html_url && (
                        <a
                            href={data.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                            View on GitHub <ExternalLink className="w-3 h-3" />
                        </a>
                    )}
                    {stale && <StaleDataBadge fetchedAt={fetchedAt} onRetry={reload} />}
                </div>

                {description && (
                    <pre className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg">
                        {description}
                    </pre>
                )}

                {loading && (
                    <div className="flex items-center justify-center py-12">
                        <Spinner size="lg" />
                    </div>
                )}

                {error && !data && (
                    <div className="px-4 py-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl text-sm text-red-600 dark:text-red-400">
                        Couldn&apos;t load commit. Please retry.
                    </div>
                )}

                {data && (
                    <>
                        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
                            <span className="inline-flex items-center gap-1">
                                <Files className="w-3.5 h-3.5" />
                                {files.length} {files.length === 1 ? 'file' : 'files'}
                            </span>
                            {data.stats && (
                                <>
                                    <span className="text-emerald-600 dark:text-emerald-400">+{data.stats.additions}</span>
                                    <span className="text-rose-600 dark:text-rose-400">−{data.stats.deletions}</span>
                                </>
                            )}
                        </div>

                        <div className="space-y-3">
                            {files.map(file => <CommitFileDiff key={file.sha || file.filename} file={file} />)}
                        </div>
                    </>
                )}
            </div>
        </Modal>
    )
}

function CommitFileDiff({ file }) {
    const [expanded, setExpanded] = useState(false)
    const hasPatch = !!file.patch
    return (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700/60 overflow-hidden">
            <button
                type="button"
                onClick={() => setExpanded(v => !v)}
                disabled={!hasPatch}
                className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
                <span className="text-xs font-mono truncate flex-1">{file.filename}</span>
                <span className="flex items-center gap-2 text-xs flex-shrink-0">
                    <span className="text-emerald-600 dark:text-emerald-400">+{file.additions ?? 0}</span>
                    <span className="text-rose-600 dark:text-rose-400">−{file.deletions ?? 0}</span>
                    {hasPatch && (
                        <span className="ml-1 text-slate-400 text-[10px]">{expanded ? 'Hide' : 'Show'} diff</span>
                    )}
                </span>
            </button>
            {expanded && hasPatch && (
                <pre className="text-xs font-mono leading-relaxed overflow-x-auto p-3 bg-slate-50/40 dark:bg-slate-900/40 max-h-[480px]">
                    {file.patch}
                </pre>
            )}
        </div>
    )
}
