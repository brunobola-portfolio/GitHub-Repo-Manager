/**
 * server/lib/bulk-helpers.js
 *
 * Shared execution helper for all destructive bulk endpoints.
 *
 * Copyright (c) 2025-2026 Bola Labs. All rights reserved.
 */

import { issueToken, verifyToken } from './bulk-confirmation.js'
import { auditLog } from './audit.js'

const CONFIRMATION_HEADER = 'x-bulk-confirmation-token'

/**
 * Shared bulk-execution helper.
 *
 * Handles the dry-run → token-issue / confirm → execute flow.
 *
 * @param {object} opts
 * @param {import('express').Request}  opts.req
 * @param {import('express').Response} opts.res
 * @param {string}   opts.action      - audit action name, e.g. "bulk.delete"
 * @param {string[]} opts.repos       - repository full names
 * @param {object}   [opts.extraData] - request-specific fields (toOrg, makePublic, archive, strategies)
 * @param {boolean}  opts.dryRun      - true = issue token, false = verify token and execute
 * @param {(repoFullName: string, extraData: object) => Promise<object>} opts.execute
 * @param {(successCount: number, total: number) => string} opts.messageFn
 * @returns {Promise<void>}  Sends the response.
 */
export async function performBulk({ req, res, action, repos, extraData = {}, dryRun, execute, messageFn }) {
    const userId = req.tenantId ?? req.session?.userId

    // ------------------------------------------------------------------
    // DRY-RUN path: issue a confirmation token, return plan, no side effects
    // ------------------------------------------------------------------
    if (dryRun) {
        const confirmationToken = issueToken({ userId, action, repos, extraData })
        return res.status(200).json({
            dryRun: true,
            plan: { action, repos, extraData },
            confirmationToken,
            expiresInSeconds: 60,
        })
    }

    // ------------------------------------------------------------------
    // EXECUTE path: require and verify the confirmation token
    // ------------------------------------------------------------------
    const token = req.headers[CONFIRMATION_HEADER]
    if (!token) {
        return res.status(400).json({
            error: 'confirmation-token-required',
            reason: 'confirmation-token-required',
            message: 'A dry-run confirmation token is required. Call this endpoint with dryRun:true first, then re-submit with the returned X-Bulk-Confirmation-Token header.',
        })
    }

    const verification = verifyToken(token, { userId, action, repos, extraData })
    if (!verification.valid) {
        return res.status(400).json({
            error: 'invalid-confirmation-token',
            reason: verification.reason,
            message: `Confirmation token is invalid: ${verification.reason}`,
        })
    }

    // ------------------------------------------------------------------
    // Log intent before any side effects (post-incident forensics)
    // ------------------------------------------------------------------
    auditLog(req, `${action}.intent`, 'bulk', JSON.stringify(repos), { ...extraData })

    // ------------------------------------------------------------------
    // Execute per-repo
    // ------------------------------------------------------------------
    const results = []
    for (const repoFullName of repos) {
        try {
            const result = await execute(repoFullName, extraData)
            results.push({ repo: repoFullName, success: true, ...result })
        } catch (error) {
            req.log?.error?.({ err: error, repo: repoFullName }, `${action} failed`)
            const errMsg = error?.message || 'Operation failed'
            results.push({ repo: repoFullName, success: false, error: errMsg })
        }
    }

    const successCount = results.filter(r => r.success).length
    const failureCount = results.length - successCount

    // ------------------------------------------------------------------
    // Audit outcome
    // ------------------------------------------------------------------
    if (successCount > 0) {
        auditLog(req, action, 'bulk', JSON.stringify(repos), { ...extraData, successCount })
    }

    // ------------------------------------------------------------------
    // Respond
    // ------------------------------------------------------------------
    const statusCode = failureCount === 0 ? 200 : successCount === 0 ? 500 : 207
    return res.status(statusCode).json({
        message: messageFn(successCount, repos.length),
        results,
    })
}
