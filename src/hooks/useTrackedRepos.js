import { useContext } from 'react'
import { TrackedReposContext } from '../contexts/contexts'

export function useTrackedRepos() {
    const ctx = useContext(TrackedReposContext)
    if (!ctx) {
        throw new Error('useTrackedRepos must be used inside TrackedReposProvider')
    }
    return ctx
}
