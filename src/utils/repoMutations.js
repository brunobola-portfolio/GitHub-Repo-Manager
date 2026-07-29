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
 * Licensed under the GNU AGPL v3.0 only (SPDX: AGPL-3.0-only). See LICENSE in the project root.
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
/**
 * Server-side ceiling on one bulk request. Mirrors `.max(100)` on
 * bulkArchiveSchema / bulkDeleteSchema / bulkVisibilitySchema /
 * bulkTransferSchema in server/lib/validators.js — keep the two in step.
 */
export const BULK_REPO_LIMIT = 100

/**
 * Fail an over-cap selection here rather than letting the server answer with a
 * Zod 400 the user cannot act on.
 *
 * Select-all is uncapped while the schemas are not, so 137 selected
 * repositories produced an opaque validation error — and on the destructive
 * actions, only AFTER the user had confirmed. Chunking would be worse: these
 * run a two-step dry-run + confirmation-token flow, so splitting one confirmed
 * intent into several requests would ask the user to confirm the same thing
 * again per batch.
 */
function assertWithinBulkLimit(repoNames) {
    const count = Array.isArray(repoNames) ? repoNames.length : 0
    if (count > BULK_REPO_LIMIT) {
        const err = new Error(
            `Select at most ${BULK_REPO_LIMIT} repositories for a bulk action — ${count} are selected.`,
        )
        err.code = 'BULK_SELECTION_TOO_LARGE'
        err.selected = count
        err.limit = BULK_REPO_LIMIT
        throw err
    }
}

export async function archiveRepos(repoNames, archive = true) {
    assertWithinBulkLimit(repoNames)
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
    assertWithinBulkLimit(repoNames)
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
    assertWithinBulkLimit(repoNames)
    // `dryRunOnly` is a client-side flag (stop after the non-mutating dry-run),
    // not part of the request body — pull it out before building the body.
    const { dryRunOnly = false, ...bodyOptions } = options
    const body = {
        repos: repoNames,
        toOrg: org,
        ...bodyOptions,
    }
    const endpoint = API_ENDPOINTS[action] || `${API_BASE}/${action}`
    const resp = await bulkExecuteWithConfirmation({ url: endpoint, body, dryRunOnly })
    return safeParseJson(resp)
}
