import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { clsx } from 'clsx'

const SEARCH_DEBOUNCE_MS = 150

const SIGNAL_ORDER = ['review_requested', 'authored_pr', 'assigned_issue', 'owned', 'recent_commit', 'pinned', 'webhook']
const SIGNAL_LABELS = {
    review_requested: 'Review requested',
    authored_pr: 'Authored',
    assigned_issue: 'Assigned',
    owned: 'Owned',
    recent_commit: 'Recent commits',
    pinned: 'Pinned',
    webhook: 'Webhook',
}

export function SearchFilterBar({ filters, countsBySignal, onChange }) {
    const [searchInput, setSearchInput] = useState(filters.search ?? '')
    const debounceRef = useRef()

    useEffect(() => {
        clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
            if ((filters.search ?? '') !== searchInput) {
                onChange({ ...filters, search: searchInput || undefined })
            }
        }, SEARCH_DEBOUNCE_MS)
        return () => clearTimeout(debounceRef.current)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchInput])

    const toggleSignal = (signal) => {
        onChange({ ...filters, signal: filters.signal === signal ? undefined : signal })
    }

    const toggleMuted = () => {
        let next
        if (filters.muted === undefined) next = false
        else next = undefined
        onChange({ ...filters, muted: next })
    }

    const mutedLabel = filters.muted === false ? 'Show muted' : filters.muted === true ? 'Only muted' : 'Hide muted'

    return (
        <div className="flex flex-col gap-2 p-3 border-b border-slate-200/40 dark:border-slate-700/40">
            <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Search tracked repositories…"
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
            </div>

            <div className="flex flex-wrap gap-1.5">
                {SIGNAL_ORDER.filter(s => countsBySignal[s] > 0).map(signal => (
                    <Chip
                        key={signal}
                        active={filters.signal === signal}
                        label={`${SIGNAL_LABELS[signal]} (${countsBySignal[signal]})`}
                        onClick={() => toggleSignal(signal)}
                    />
                ))}
                <Chip
                    active={filters.muted !== undefined}
                    label={mutedLabel}
                    onClick={toggleMuted}
                />
            </div>
        </div>
    )
}

function Chip({ active, label, onClick }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={clsx(
                'px-2.5 py-1 text-xs font-medium rounded-full border transition-colors',
                active
                    ? 'bg-indigo-500 text-white border-indigo-500'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
            )}
        >
            {label}
        </button>
    )
}
