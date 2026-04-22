// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.
// Commercial license: https://bolalabs.pt/license
/**
 * Admin DLQ API client.
 *
 * Thin wrapper over /api/v1/admin/dlq/* — the routes live behind
 * requireAuth + requireTier('enterprise') + requireAdmin, so all calls
 * share the same failure modes:
 *   - 401: session expired → handled by fetchWithRetry event bus
 *   - 403: tier too low or not admin → surfaced as an Error with the
 *          server message (the UI branches on .status where helpful)
 *   - 4xx/5xx: thrown with a human-readable message
 *
 * We intentionally return the inner `data` shape from successful
 * responses (server envelopes them as { data: ... } or { entries: ... }
 * depending on the route — see server/routes/admin-dlq.js). Callers can
 * always expect an array or row object, never a wrapping envelope.
 */
import { fetchWithRetry, safeParseJson } from '../utils/api'

const BASE = '/api/v1/admin/dlq'

/**
 * Extract a human-readable error from a non-OK response. The admin-dlq
 * backend always emits `{ error: '...' }` but we fall back to the status
 * so the UI never shows "undefined" in an error toast.
 */
async function readError(res) {
    try {
        const body = await safeParseJson(res)
        if (body && typeof body.error === 'string') return body.error
    } catch { /* ignore parse errors */ }
    return `status ${res.status}`
}

/**
 * Unwrap the server envelope. Admin-dlq routes return either
 *   { entries: [...] }   — list endpoints
 *   { entry: {...} }     — detail endpoint
 *   { queued: true, entry: {...} }  — retry endpoint
 *   { resolved: true, id }          — delete endpoint
 * Callers want the useful payload, not the envelope.
 */
function unwrap(json, key) {
    if (!json || typeof json !== 'object') return json
    if (key && key in json) return json[key]
    return json
}

async function getJson(path) {
    const res = await fetchWithRetry(`${BASE}${path}`, {
        method: 'GET',
        credentials: 'include',
    })
    if (!res.ok) {
        const err = new Error(await readError(res))
        err.status = res.status
        throw err
    }
    return res.json()
}

async function postJson(path) {
    const res = await fetchWithRetry(`${BASE}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    })
    if (!res.ok) {
        const err = new Error(await readError(res))
        err.status = res.status
        throw err
    }
    return res.json()
}

async function deleteJson(path) {
    const res = await fetchWithRetry(`${BASE}${path}`, {
        method: 'DELETE',
        credentials: 'include',
    })
    if (!res.ok) {
        const err = new Error(await readError(res))
        err.status = res.status
        throw err
    }
    return res.json()
}

// ---------------------------------------------------------------------------
// Email DLQ
// ---------------------------------------------------------------------------

/**
 * @param {'false'|'true'|'all'} filter
 * @returns {Promise<Array>} — rows (without body), most recent first
 */
export async function listEmailDLQ(filter = 'false') {
    const json = await getJson(`/email?resolved=${encodeURIComponent(filter)}`)
    return unwrap(json, 'entries') ?? []
}

/**
 * @param {number} id
 * @returns {Promise<object>} — full entry including body_html / body_text
 */
export async function getEmailEntry(id) {
    const json = await getJson(`/email/${id}`)
    return unwrap(json, 'entry')
}

/**
 * Force-schedule an email row for the next retry tick.
 * @param {number} id
 * @returns {Promise<object>} — refreshed entry summary
 */
export async function retryEmailEntry(id) {
    const json = await postJson(`/email/${id}/retry`)
    return unwrap(json, 'entry')
}

/**
 * Soft-resolve (audit-preserving) an email row.
 * @param {number} id
 * @returns {Promise<{ resolved: boolean, id: number }>}
 */
export async function resolveEmailEntry(id) {
    return deleteJson(`/email/${id}`)
}

// ---------------------------------------------------------------------------
// Webhook DLQ
// ---------------------------------------------------------------------------

export async function listWebhookDLQ(filter = 'false') {
    const json = await getJson(`/webhook?resolved=${encodeURIComponent(filter)}`)
    return unwrap(json, 'entries') ?? []
}

export async function getWebhookEntry(id) {
    const json = await getJson(`/webhook/${id}`)
    return unwrap(json, 'entry')
}

export async function retryWebhookEntry(id) {
    const json = await postJson(`/webhook/${id}/retry`)
    return unwrap(json, 'entry')
}

export async function resolveWebhookEntry(id) {
    return deleteJson(`/webhook/${id}`)
}
