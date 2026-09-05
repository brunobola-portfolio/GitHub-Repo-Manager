import { useCallback, useState } from 'react'

/**
 * useRepoDetailNavigation — repo-detail state + navigation for the app shell.
 *
 * Owns selectedRepoDetail (the repo object driving the repo-detail view),
 * the initial/active tab pair (`repoDetailInitialTab` is where to OPEN — set
 * by navigation/deep-link; `repoDetailActiveTab` is what's showing NOW, kept
 * in sync by RepoDetail's onTabChange so useAppRouter can mirror it into the
 * URL hash), the hoisted PR/branch/issue entity lists the command palette
 * reads, and reviewingPR (the PR overlay on top of repo-detail).
 *
 * `setActiveView` is owned by AppContent (it also drives non-repo-detail
 * views) and passed in rather than reimplemented here. `patchRepoEverywhere`
 * and `refresh` are `useGitHub()` outputs, needed by handleSelectedRepoMutated
 * to keep the repos list and the open detail view in sync after a mutation.
 *
 * Behaviour is locked by tests/components/App.test.jsx (hash-routing deep
 * links into repo-detail) and tests/hooks/useRepoDetailNavigation.test.js.
 */
export function useRepoDetailNavigation({ setActiveView, patchRepoEverywhere, refresh }) {
    const [selectedRepoDetail, setSelectedRepoDetail] = useState(null)
    const [repoDetailInitialTab, setRepoDetailInitialTab] = useState('overview')
    const [repoDetailActiveTab, setRepoDetailActiveTab] = useState('overview')
    // Lifted from RepoDetail tabs via window CustomEvents (`repo-detail:*-loaded`).
    // The command palette consumes these to enumerate the PR / branch / issue
    // action registries inside the active repo. Reset whenever the user leaves
    // the repo-detail view so the palette doesn't surface stale targets.
    const [repoDetailEntities, setRepoDetailEntities] = useState({ prs: [], branches: [], issues: [] })
    const [reviewingPR, setReviewingPR] = useState(null)

    const handleOpenRepo = useCallback((repo, { tab = 'overview' } = {}) => {
        setSelectedRepoDetail(repo)
        setRepoDetailInitialTab(tab)
        setRepoDetailActiveTab(tab)
        setActiveView('repo-detail')
    }, [setActiveView])

    // Leaving repo-detail (or its pr-review overlay) for another top-level
    // view. Named so every "Back"/"go home" callsite reads as intent rather
    // than repeating the two-setter pair.
    const closeRepoDetail = useCallback((destination) => {
        setSelectedRepoDetail(null)
        setActiveView(destination)
    }, [setActiveView])

    // RepoDetail mutations land here. When the child has the new repo shape
    // (description edits, archive, visibility, topics, …) we patch the matching
    // entry in both the personal `repos` list and any loaded `orgRepos` list —
    // instant, no refetch. We also keep `selectedRepoDetail` in sync so the
    // header chips/title reflect changes the moment the user navigates back.
    // When the child can only signal "something changed" (null), fall back to
    // a full page refresh so the data isn't silently stale.
    const handleSelectedRepoMutated = useCallback((updatedRepo) => {
        if (updatedRepo) {
            patchRepoEverywhere(updatedRepo)
            setSelectedRepoDetail(prev => (prev ? { ...prev, ...updatedRepo } : prev))
        } else {
            refresh()
        }
    }, [patchRepoEverywhere, refresh])

    return {
        selectedRepoDetail,
        setSelectedRepoDetail,
        repoDetailInitialTab,
        setRepoDetailInitialTab,
        repoDetailActiveTab,
        setRepoDetailActiveTab,
        repoDetailEntities,
        setRepoDetailEntities,
        reviewingPR,
        setReviewingPR,
        handleOpenRepo,
        closeRepoDetail,
        handleSelectedRepoMutated,
    }
}
