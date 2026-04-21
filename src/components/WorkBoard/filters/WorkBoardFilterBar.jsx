import { FilterChip } from './FilterChip'

const AGE_BUCKETS = [
    { id: '24h', label: '24h' },
    { id: '7d', label: '7d' },
    { id: '30d', label: '30d' },
]

function csvToSet(s) {
    return new Set((s || '').split(',').map(x => x.trim()).filter(Boolean))
}
function setToCsv(set) {
    return Array.from(set).join(',')
}

function toggleMulti(current, value) {
    const s = csvToSet(current)
    if (s.has(value)) s.delete(value); else s.add(value)
    return setToCsv(s)
}

export function WorkBoardFilterBar({
    filters,
    setFilters,
    availableRepos = [],
    availableAuthors = [],
    availableLabels = [],
    children,
}) {
    const repos = csvToSet(filters.repos)
    const authors = csvToSet(filters.authors)
    const labels = csvToSet(filters.labels)

    return (
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-2xl border border-slate-200/50 dark:border-slate-700/40 bg-white/60 dark:bg-slate-900/40 backdrop-blur">
            {/* Repos */}
            {availableRepos.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mr-1">Repo</span>
                    {availableRepos.map(r => (
                        <FilterChip key={r} label={r} tone="indigo"
                            active={repos.has(r)}
                            onToggle={() => setFilters({ repos: toggleMulti(filters.repos, r) })} />
                    ))}
                </div>
            )}

            {/* Authors */}
            {availableAuthors.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mr-1">By</span>
                    {availableAuthors.map(a => (
                        <FilterChip key={a} label={a} tone="emerald"
                            active={authors.has(a)}
                            onToggle={() => setFilters({ authors: toggleMulti(filters.authors, a) })} />
                    ))}
                </div>
            )}

            {/* Labels */}
            {availableLabels.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mr-1">Label</span>
                    {availableLabels.map(l => (
                        <FilterChip key={l} label={l} tone="amber"
                            active={labels.has(l)}
                            onToggle={() => setFilters({ labels: toggleMulti(filters.labels, l) })} />
                    ))}
                </div>
            )}

            {/* Age — single-select */}
            <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mr-1">Age</span>
                {AGE_BUCKETS.map(b => (
                    <FilterChip key={b.id} label={b.label} tone="slate"
                        active={filters.age === b.id}
                        onToggle={() => setFilters({ age: filters.age === b.id ? '' : b.id })} />
                ))}
            </div>

            {/* Snooze toggle */}
            <div className="ml-auto flex items-center gap-2">
                <FilterChip
                    label="Hide snoozed"
                    tone="slate"
                    active={filters.snoozed === 'hidden'}
                    onToggle={() => setFilters({ snoozed: filters.snoozed === 'hidden' ? '' : 'hidden' })}
                />
                {children}
            </div>
        </div>
    )
}
