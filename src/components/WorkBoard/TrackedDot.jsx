import { useTrackedRepos } from '../../hooks/useTrackedRepos'

const SIZE_CLASS = {
    xs: 'w-1 h-1',
    sm: 'w-1.5 h-1.5',
    md: 'w-2 h-2',
}

export function TrackedDot({ repoFullName, size = 'sm' }) {
    const { repos } = useTrackedRepos()
    const tracked = repos.find(r => r.repo_full_name === repoFullName)

    if (!tracked) return null

    if (tracked.is_muted) {
        return (
            <span
                data-state="muted"
                aria-label="Muted from Work Board"
                title="Muted from Work Board"
                className={`inline-block rounded-full border border-slate-400 shrink-0 ${SIZE_CLASS[size]}`}
            />
        )
    }

    return (
        <span
            data-state="active"
            aria-label={tracked.is_pinned ? 'Pinned in Work Board' : 'Tracked in Work Board'}
            title={tracked.is_pinned ? 'Pinned in Work Board' : 'Tracked in Work Board'}
            className={`inline-block rounded-full bg-indigo-500 shrink-0 ${SIZE_CLASS[size]}`}
        />
    )
}
