import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { clsx } from 'clsx'
import { useDebounce } from '../../../hooks/useDebounce'
import { Input } from '../../ui/form'

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
    const debouncedInput = useDebounce(searchInput, SEARCH_DEBOUNCE_MS)

    useEffect(() => {
        if ((filters.search ?? '') !== debouncedInput) {
            onChange({ ...filters, search: debouncedInput || undefined })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedInput])

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
            <Input
                size="sm"
                leadingIcon={Search}
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search tracked repositories…"
                aria-label="Search tracked repositories"
            />

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
                'px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ds-focus-ring',
                active
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
            )}
        >
            {label}
        </button>
    )
}
