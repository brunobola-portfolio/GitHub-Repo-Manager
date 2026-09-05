import { useRef, useState, useEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Inbox, Search } from 'lucide-react'
import { RepoRow } from './RepoRow'
import { SearchFilterBar } from './SearchFilterBar'
import { BulkActionsBar } from './BulkActionsBar'
import { Skeleton } from '../../ui/Skeleton'
import { EmptyState } from '../../ui/EmptyState'

const ROW_HEIGHT = 56

export function TrackedReposList({
    repos,
    countsBySignal,
    filters,
    isLoading,
    onFilterChange,
    onRowAction,
    onBulkAction,
}) {
    const parentRef = useRef(null)
    const [selected, setSelected] = useState(new Set())

    useEffect(() => {
        if (selected.size === 0) return
        const visible = new Set(repos.map(r => r.repo_full_name))
        const next = new Set([...selected].filter(n => visible.has(n)))
        if (next.size !== selected.size) setSelected(next)
    }, [repos, selected])

    // eslint-disable-next-line react-hooks/incompatible-library
    const virtualizer = useVirtualizer({
        count: repos.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 6,
    })

    const handleSelectionChange = (repoFullName, isSelected) => {
        setSelected(prev => {
            const next = new Set(prev)
            if (isSelected) next.add(repoFullName)
            else next.delete(repoFullName)
            return next
        })
    }

    const handleBulk = (action) => {
        onBulkAction([...selected], action)
        setSelected(new Set())
    }

    if (isLoading) {
        return (
            <div className="space-y-2 p-3">
                {[0, 1, 2, 3, 4].map(i => (
                    <Skeleton key={i} className="h-12 rounded-lg" />
                ))}
            </div>
        )
    }

    const isEmpty = repos.length === 0
    const hasSearch = filters.search && filters.search.length > 0

    return (
        <div className="flex flex-col">
            <SearchFilterBar filters={filters} countsBySignal={countsBySignal} onChange={onFilterChange} />

            {isEmpty && !hasSearch && (
                <EmptyState
                    icon={Inbox}
                    title="No tracked repositories yet"
                    description="Run discovery or add one manually below."
                />
            )}

            {isEmpty && hasSearch && (
                <EmptyState
                    icon={Search}
                    title={`No results for "${filters.search}"`}
                    description="Try a different search term or clear the filter."
                    action={{ label: 'Clear search', onClick: () => onFilterChange({ ...filters, search: '' }) }}
                />
            )}

            {!isEmpty && (
                <div
                    ref={parentRef}
                    className="max-h-[400px] overflow-auto"
                    style={{ contain: 'strict' }}
                >
                    <div
                        style={{
                            height: `${virtualizer.getTotalSize()}px`,
                            width: '100%',
                            position: 'relative',
                        }}
                    >
                        {virtualizer.getVirtualItems().map(virtualRow => {
                            const repo = repos[virtualRow.index]
                            return (
                                <div
                                    key={repo.repo_full_name}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: '100%',
                                        height: `${virtualRow.size}px`,
                                        transform: `translateY(${virtualRow.start}px)`,
                                    }}
                                >
                                    <RepoRow
                                        repo={repo}
                                        onAction={onRowAction}
                                        selected={selected.has(repo.repo_full_name)}
                                        onSelectionChange={handleSelectionChange}
                                    />
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            <BulkActionsBar
                selectedCount={selected.size}
                onAction={handleBulk}
                onClear={() => setSelected(new Set())}
            />
        </div>
    )
}
