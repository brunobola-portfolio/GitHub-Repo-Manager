/*
 * GitHub Repo Manager
 * GitHub data and actions hook (composer)
 *
 * This is the primary hook consumed by App.jsx. It composes four
 * focused sub-hooks and merges their return values into a single
 * object, maintaining full backward compatibility.
 *
 * Sub-hooks:
 *   useAuth  - Authentication & session (user, fetchUser)
 *   useRepos - Repository data, pagination, CRUD, bulk ops
 *   useOrgs  - Organizations, stats, activity feed
 *   useAI    - AI chat, suggestions, README generation
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the GNU AGPL v3.0 only (SPDX: AGPL-3.0-only). See LICENSE in the project root.
 */

import { useCallback } from 'react'
import { useAuth } from './useAuth'
import { useRepos } from './useRepos'
import { useOrgs } from './useOrgs'
import { useAI } from './useAI'
import { MOCK_MODE } from '../config'

/**
 * Composite hook that delegates to focused sub-hooks while
 * preserving the exact return shape App.jsx expects.
 *
 * @returns {object} Combined state and actions from all sub-hooks
 */
export function useGitHub() {
    // ---- Auth ----
    const {
        user,
        fetchUser,
        authLoading,
        authError,
        authErrorInfo,
        authMessage
    } = useAuth()

    // ---- Repos (needs user to know when to fetch) ----
    const {
        repos,
        loading: reposLoading,
        error: reposError,
        errorInfo: reposErrorInfo,
        message: reposMessage,
        page,
        perPage,
        totalPages,
        isPerforming,
        results,
        setPage,
        refresh,
        patchRepoLocal,
        performAction: performActionRaw,
        archiveRepos: archiveReposRaw,
        deleteRepos: deleteReposRaw,
        createRepo: createRepoRaw,
        importFromAzure,
        checkImportStatus
    } = useRepos(user)

    // ---- Orgs (needs user to auto-load orgs/stats/activity) ----
    const {
        orgs,
        selectedOrg,
        setSelectedOrg,
        orgRepos,
        stats,
        activity,
        fetchOrgs,
        fetchOrgRepos,
        fetchStats,
        patchOrgRepoLocal
    } = useOrgs(user)

    // ---- AI ----
    const {
        checkAIStatus,
        askAI,
        askAIStream
    } = useAI()

    // Merge loading / error / message: auth state takes priority
    // when it is active, otherwise fall through to repos state.
    const loading = authLoading || reposLoading
    const error = authError || reposError
    const errorInfo = authErrorInfo || reposErrorInfo
    const message = authMessage || reposMessage

    // Apply a patch to whichever lists currently hold the repo (personal +
    // org-scoped). Lets RepoDetail mutations propagate to the visible list
    // without a full refetch — described in docs/specs as the "premium" flow.
    const patchRepoEverywhere = useCallback((updatedRepo) => {
        patchRepoLocal(updatedRepo)
        patchOrgRepoLocal(updatedRepo)
    }, [patchRepoLocal, patchOrgRepoLocal])

    // Single source of truth for keeping org data real-time. Any repo mutation
    // can shift the org "N repos" badges and dashboard stats: create/delete
    // change totals, transfer moves ownership between accounts, visibility
    // flips the public/private split. The mutation wrappers below already
    // refetch the repo LIST (fetchRepos); this refreshes the ORG side too, so
    // every surface — context menu, bulk bar, command palette, modals — stays
    // current without each call site remembering to. Silent by design: the
    // action that ran shows its own result toast.
    const refreshOrgData = useCallback(() => {
        Promise.all([fetchOrgs(), fetchStats()]).catch(() => {})
    }, [fetchOrgs, fetchStats])

    // Wrap a repo mutation so a successful result also refreshes org data.
    // Functions that throw on failure (archive/delete) propagate the throw
    // before the refresh; those that resolve with { success: false }
    // (performAction/createRepo) are guarded so a no-op/failed call doesn't
    // trigger a pointless refetch.
    const withOrgRefresh = useCallback((fn) => async (...args) => {
        const result = await fn(...args)
        // Skip the org refetch on a failed call OR a dry-run preview (no mutation).
        if (result?.success !== false && !result?.dryRun) refreshOrgData()
        return result
    }, [refreshOrgData])

    const performAction = withOrgRefresh(performActionRaw)
    const createRepo = withOrgRefresh(createRepoRaw)
    const deleteRepos = withOrgRefresh(deleteReposRaw)
    const archiveRepos = withOrgRefresh(archiveReposRaw)

    // ---- Return the exact same shape the old monolith exposed ----
    return {
        user,
        repos,
        loading,
        error,
        errorInfo,
        message,
        page,
        perPage,
        totalPages,
        isPerforming,
        results,
        isMockMode: MOCK_MODE,
        setPage,
        refresh,
        patchRepoLocal,
        patchOrgRepoLocal,
        patchRepoEverywhere,
        performAction,
        fetchUser,
        createRepo,
        importFromAzure,
        checkImportStatus,
        orgs,
        selectedOrg,
        orgRepos,
        stats,
        fetchOrgRepos,
        fetchOrgs,
        fetchStats,
        activity,
        askAI,
        askAIStream,
        setSelectedOrg,
        archiveRepos,
        deleteRepos,
        checkAIStatus
    }
}
