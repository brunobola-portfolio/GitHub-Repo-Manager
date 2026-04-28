/*
 * GitHub Repo Manager
 * Bulk operation two-step confirmation helper
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { getCsrfToken } from '../utils/api'

/**
 * Build a BulkError with `.status` and `.reason` attached.
 */
function makeBulkError(message, status, reason, body) {
  const err = new Error(message)
  err.status = status
  err.reason = reason
  err.body = body
  return err
}

/**
 * Execute a destructive bulk operation with server-enforced dry-run +
 * confirmation-token. From the caller's perspective, this looks like a
 * single call; internally it does two POSTs (dry-run → execute).
 *
 * @param {object} opts
 * @param {string} opts.url          Full endpoint URL (e.g. API_ENDPOINTS.delete)
 * @param {object} opts.body         The request body WITHOUT `dryRun` flag
 * @param {object} [opts.fetchOptions]  Extra options merged into fetch (e.g. signal)
 * @returns {Promise<Response>}      The FINAL (execute) Response. Caller parses JSON as usual.
 * @throws {Error}                   On network failure, dry-run rejection, or execute rejection.
 *                                   Error has `.status`, `.reason` (if server returned one), `.body`.
 */
export async function bulkExecuteWithConfirmation({ url, body, fetchOptions = {} }) {
  // Spread fetchOptions FIRST so caller-supplied opts (e.g. signal) come
  // through, then re-set headers explicitly so caller's headers cannot stomp
  // our Content-Type. Previously we declared `headers` twice in the literal,
  // which is a no-dupe-keys lint error and a footgun (the second wins
  // silently — the first declaration was always dead code).
  const { headers: callerHeaders, ...restFetchOptions } = fetchOptions
  let csrfToken = null
  try { csrfToken = await getCsrfToken() } catch { /* server will 403 */ }
  const baseOptions = {
    method: 'POST',
    credentials: 'include',
    ...restFetchOptions,
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...(callerHeaders || {}),
    },
  }

  // ── Step 1: Dry-run ──────────────────────────────────────────────────────
  const dryRunResp = await fetch(url, {
    ...baseOptions,
    body: JSON.stringify({ ...body, dryRun: true }),
  })

  if (!dryRunResp.ok) {
    let parsed = null
    try { parsed = await dryRunResp.json() } catch (_) { /* ignore */ }
    const reason = parsed?.reason || parsed?.error || null
    throw makeBulkError(
      `Dry-run rejected with status ${dryRunResp.status}${reason ? `: ${reason}` : ''}`,
      dryRunResp.status,
      reason,
      parsed,
    )
  }

  let dryRunData = null
  try { dryRunData = await dryRunResp.json() } catch (e) {
    throw makeBulkError('Failed to parse dry-run response: ' + e.message, dryRunResp.status, null, null)
  }

  const { confirmationToken, expiresInSeconds } = dryRunData || {}

  if (!confirmationToken || expiresInSeconds == null) {
    throw makeBulkError(
      'Server did not return a valid confirmation token or expiry — cannot proceed with execute.',
      dryRunResp.status,
      null,
      dryRunData,
    )
  }

  // ── Step 2: Execute ──────────────────────────────────────────────────────
  const executeResp = await fetch(url, {
    ...baseOptions,
    headers: {
      ...baseOptions.headers,
      'X-Bulk-Confirmation-Token': confirmationToken,
    },
    body: JSON.stringify({ ...body }),
  })

  if (!executeResp.ok) {
    let parsed = null
    try { parsed = await executeResp.json() } catch (_) { /* ignore */ }
    const reason = parsed?.reason || parsed?.error || null
    throw makeBulkError(
      `Execute rejected with status ${executeResp.status}${reason ? `: ${reason}` : ''}`,
      executeResp.status,
      reason,
      parsed,
    )
  }

  return executeResp
}
