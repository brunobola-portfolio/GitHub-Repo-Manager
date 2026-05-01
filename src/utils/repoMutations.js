/*
 * GitHub Repo Manager
 * Repo mutation helpers (pure callable HTTP functions).
 *
 * Extracted from src/hooks/useRepos.js so non-React callers (the future
 * `runAction` runner, batch tools, tests) can invoke the same backend
 * contract without going through the hook. The hook keeps thin wrappers
 * that close over its state for message/results/refresh churn and
 * delegates the wire work here.
 *
 * Transport: every helper goes through `bulkExecuteWithConfirmation`,
 * which performs the server-enforced two-step dry-run + execute flow.
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { safeParseJson } from './api'
import { API_BASE, API_ENDPOINTS } from '../config'
import { bulkExecuteWithConfirmation } from '../api/bulkConfirm'

/**
 * Archive (or unarchive) a list of repositories.
 *
 * @param {string[]} repoNames        Full names like 'owner/repo'.
 * @param {boolean}  [archive=true]   true to archive, false to unarchive.
 * @returns {Promise<object>}         Parsed JSON body from the execute step.
 * @throws {Error}                    On dry-run rejection or execute rejection
 *                                    (error has `.status`, `.reason`, `.body`).
 */
export async function archiveRepos(repoNames, archive = true) {
    const resp = await bulkExecuteWithConfirmation({
        url: API_ENDPOINTS.archive,
        body: { repos: repoNames, archive },
    })
    return safeParseJson(resp)
}

/**
 * Delete a list of repositories.
 *
 * @param {string[]} repoNames                Full names like 'owner/repo'.
 * @param {string}   [confirmToken='DELETE']  Server-side confirm token.
 * @returns {Promise<object>}                 Parsed JSON body from execute.
 * @throws {Error}                            On any rejection from the two-step flow.
 */
export async function deleteRepos(repoNames, confirmToken = 'DELETE') {
    const resp = await bulkExecuteWithConfirmation({
        url: API_ENDPOINTS.delete,
        body: { repos: repoNames, confirm: confirmToken },
    })
    return safeParseJson(resp)
}

/**
 * Perform a generic bulk action ('visibility' | 'transfer' | 'mirror' | …)
 * against a list of repositories.
 *
 * Endpoint resolution mirrors the original useRepos contract: prefer
 * `API_ENDPOINTS[action]`, fall back to `${API_BASE}/${action}` for
 * unknown actions. The body shape is `{ repos, toOrg, ...options }`.
 *
 * @param {string}   action       Action key (e.g. 'visibility').
 * @param {string[]} repoNames    Full names like 'owner/repo'.
 * @param {string}   [org='']     Target org for transfer/mirror; empty otherwise.
 * @param {object}   [options={}] Additional flags (e.g. { makePublic: true }).
 * @returns {Promise<object>}     Parsed JSON body from execute (caller
 *                                inspects `results`, `message`, etc).
 * @throws {Error}                On any rejection from the two-step flow.
 */
export async function performAction(action, repoNames, org = '', options = {}) {
    const body = {
        repos: repoNames,
        toOrg: org,
        ...options,
    }
    const endpoint = API_ENDPOINTS[action] || `${API_BASE}/${action}`
    const resp = await bulkExecuteWithConfirmation({ url: endpoint, body })
    return safeParseJson(resp)
}
