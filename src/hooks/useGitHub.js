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
 * Licensed under the MIT License. See LICENSE in the project root.
 */

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
        performAction,
        archiveRepos,
        deleteRepos,
        createRepo,
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
        fetchStats
    } = useOrgs(user)

    // ---- AI ----
    const {
        checkAIStatus,
        askAI
    } = useAI()

    // Merge loading / error / message: auth state takes priority
    // when it is active, otherwise fall through to repos state.
    const loading = authLoading || reposLoading
    const error = authError || reposError
    const errorInfo = authErrorInfo || reposErrorInfo
    const message = authMessage || reposMessage

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
        setSelectedOrg,
        archiveRepos,
        deleteRepos,
        checkAIStatus
    }
}
