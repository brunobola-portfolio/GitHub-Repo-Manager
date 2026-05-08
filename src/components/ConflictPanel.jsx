import { Fragment, useState } from 'react'
import { Trash2, Edit3, SkipForward } from 'lucide-react'
import { formatFileSize, formatDate as formatDateBase } from '../utils/format'
import { MS_PER_DAY } from '../utils/time'
import { Button } from './ui/Button'

// --- Helper functions ---

// `kb` here is the raw count in kilobytes; convert to bytes for the shared
// formatter, which reports "MB"/"GB" the same way as the migration wizard.
function formatSize(kb) {
    if (kb == null) return '0 KB'
    return formatFileSize(kb * 1024)
}

function formatDate(iso) {
    return formatDateBase(iso, { day: 'numeric', month: 'short', year: 'numeric' }) || '—'
}

function compareSummary(source, target) {
    const srcDate = source?.updated_at ? new Date(source.updated_at) : null
    const tgtDate = target?.updated_at ? new Date(target.updated_at) : null

    if (!srcDate || !tgtDate) {
        return { text: 'Unable to compare dates', type: 'neutral' }
    }

    const diffMs = srcDate - tgtDate
    const diffDays = Math.round(Math.abs(diffMs) / MS_PER_DAY)

    if (diffMs > 0) {
        return {
            text: `Source is newer (updated ${diffDays}d later)`,
            type: 'source'
        }
    } else if (diffMs < 0) {
        return {
            text: `Target is newer (updated ${diffDays}d later)`,
            type: 'target'
        }
    } else {
        return { text: 'Repos appear identical', type: 'neutral' }
    }
}

// --- Metadata rows for the comparison table ---

const METADATA_ROWS = [
    {
        label: 'Updated',
        getValue: (repo) => formatDate(repo?.updated_at)
    },
    {
        label: 'Size',
        getValue: (repo) => (repo?.size != null ? formatSize(repo.size) : '—')
    },
    {
        label: 'Language',
        getValue: (repo) => repo?.language || '—'
    },
    {
        label: 'Stars',
        getValue: (repo) => (repo?.stargazers_count != null ? String(repo.stargazers_count) : '—')
    },
    {
        label: 'Forks',
        getValue: (repo) => (repo?.forks_count != null ? String(repo.forks_count) : '—')
    }
]

// --- ConflictPanel component ---

export function ConflictPanel({ conflict, repoName, onResolve, resolution }) {
    const [pendingAction, setPendingAction] = useState(null) // 'replace' | 'rename'
    const [renameValue, setRenameValue] = useState(`${repoName}-2`)

    const { source, target } = conflict || {}
    const summary = compareSummary(source, target)

    const summaryColorClass =
        summary.type === 'source'
            ? 'text-emerald-600 dark:text-emerald-400'
            : summary.type === 'target'
            ? 'text-amber-600 dark:text-amber-400'
            : 'text-slate-500 dark:text-slate-400'

    // --- Resolved state ---
    if (resolution) {
        const label =
            resolution.action === 'replace'
                ? 'Will replace target'
                : resolution.action === 'skip'
                ? 'Will skip this repo'
                : `Will rename to "${resolution.newName}"`

        return (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 px-4 py-3">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
                <button
                    type="button"
                    onClick={() => {
                        setPendingAction(null)
                        setRenameValue(`${repoName}-2`)
                        onResolve(null)
                    }}
                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
                >
                    Change
                </button>
            </div>
        )
    }

    return (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-sm">
            {/* Comparison table */}
            <div className="grid grid-cols-3 bg-slate-50 dark:bg-slate-800/50">
                {/* Column headers */}
                <div className="px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    Field
                </div>
                <div className="px-3 py-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wide">
                    Source
                </div>
                <div className="px-3 py-2 text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide">
                    Target
                </div>

                {/* Data rows */}
                {METADATA_ROWS.map((row) => (
                    <Fragment key={row.label}>
                        <div className="px-3 py-2 text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-slate-700">
                            {row.label}
                        </div>
                        <div className="px-3 py-2 text-slate-700 dark:text-slate-200 border-t border-slate-200 dark:border-slate-700">
                            {row.getValue(source)}
                        </div>
                        <div className="px-3 py-2 text-slate-700 dark:text-slate-200 border-t border-slate-200 dark:border-slate-700">
                            {row.getValue(target)}
                        </div>
                    </Fragment>
                ))}
            </div>

            {/* Smart summary */}
            <div className={`px-3 py-2 border-t border-slate-200 dark:border-slate-700 font-medium ${summaryColorClass}`}>
                {summary.text}
            </div>

            {/* Action area */}
            <div className="px-3 py-3 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/30 space-y-3">
                {/* Replace flow */}
                {pendingAction === 'replace' ? (
                    <div className="space-y-2">
                        <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                            This will overwrite the existing target repository. This cannot be undone.
                        </p>
                        <div className="flex gap-2">
                            {/* danger-button-allowed: in-card 2-step confirm flow — pendingAction state IS the gate, modal would be redundant */}
                            <Button variant="danger" size="xs" onClick={() => onResolve({ action: 'replace' })}>
                                <Trash2 className="w-3.5 h-3.5" />
                                Confirm Replace
                            </Button>
                            <Button variant="ghost" size="xs" onClick={() => setPendingAction(null)}>
                                Cancel
                            </Button>
                        </div>
                    </div>
                ) : pendingAction === 'rename' ? (
                    /* Rename flow */
                    <div className="space-y-2">
                        <label
                            htmlFor={`conflict-rename-${repoName}`}
                            className="block text-xs text-slate-600 dark:text-slate-400 font-medium"
                        >
                            New repository name
                        </label>
                        <input
                            id={`conflict-rename-${repoName}`}
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            aria-label="New repository name"
                            className="w-full px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <div className="flex gap-2">
                            <Button
                                variant="primary"
                                size="xs"
                                onClick={() => onResolve({ action: 'rename', newName: renameValue })}
                                disabled={!renameValue.trim()}
                            >
                                <Edit3 className="w-3.5 h-3.5" />
                                Confirm Rename
                            </Button>
                            <Button variant="ghost" size="xs" onClick={() => setPendingAction(null)}>
                                Cancel
                            </Button>
                        </div>
                    </div>
                ) : (
                    /* Default action buttons */
                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline-danger" size="xs" onClick={() => setPendingAction('replace')}>
                            <Trash2 className="w-3.5 h-3.5" />
                            Replace
                        </Button>
                        <Button
                            variant="outline-primary"
                            size="xs"
                            onClick={() => {
                                setRenameValue(`${repoName}-2`)
                                setPendingAction('rename')
                            }}
                        >
                            <Edit3 className="w-3.5 h-3.5" />
                            Rename
                        </Button>
                        <Button variant="outline" size="xs" onClick={() => onResolve({ action: 'skip' })}>
                            <SkipForward className="w-3.5 h-3.5" />
                            Skip
                        </Button>
                    </div>
                )}
            </div>
        </div>
    )
}
