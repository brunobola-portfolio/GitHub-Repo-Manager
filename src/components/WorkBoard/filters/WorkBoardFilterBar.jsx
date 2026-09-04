import { FilterChip } from './FilterChip'

// Each filter group (Repository / By / Label / Age) gets its own row with
// the label above the chips — inlining the label with the chips wrapped it
// mid-group at 1440 and 375 (e.g. "BY" landing at the end of one line and
// its chips starting the next), which read as unparseable. Stacking removes
// the ambiguity regardless of viewport width or chip count.
function FilterGroup({ label, children }) {
    return (
        <div className="flex flex-col gap-1.5">
            <span className="ds-text-micro font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</span>
            <div className="flex items-center gap-1.5 flex-wrap">{children}</div>
        </div>
    )
}

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
        <div className="flex flex-col gap-3 p-3 rounded-2xl border border-slate-200/50 dark:border-slate-700/40 bg-white/60 dark:bg-slate-900/40 backdrop-blur">
            {/* Repos */}
            {availableRepos.length > 0 && (
                <FilterGroup label="Repository">
                    {availableRepos.map(r => (
                        <FilterChip key={r} label={r} tone="indigo"
                            active={repos.has(r)}
                            onToggle={() => setFilters({ repos: toggleMulti(filters.repos, r) })} />
                    ))}
                </FilterGroup>
            )}

            {/* Authors */}
            {availableAuthors.length > 0 && (
                <FilterGroup label="By">
                    {availableAuthors.map(a => (
                        <FilterChip key={a} label={a} tone="emerald"
                            active={authors.has(a)}
                            onToggle={() => setFilters({ authors: toggleMulti(filters.authors, a) })} />
                    ))}
                </FilterGroup>
            )}

            {/* Labels */}
            {availableLabels.length > 0 && (
                <FilterGroup label="Label">
                    {availableLabels.map(l => (
                        <FilterChip key={l} label={l} tone="amber"
                            active={labels.has(l)}
                            onToggle={() => setFilters({ labels: toggleMulti(filters.labels, l) })} />
                    ))}
                </FilterGroup>
            )}

            {/* Age — single-select */}
            <FilterGroup label="Age">
                {AGE_BUCKETS.map(b => (
                    <FilterChip key={b.id} label={b.label} tone="slate"
                        active={filters.age === b.id}
                        onToggle={() => setFilters({ age: filters.age === b.id ? '' : b.id })} />
                ))}
            </FilterGroup>

            {/* Snooze toggle */}
            <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-slate-200/50 dark:border-slate-700/40">
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
