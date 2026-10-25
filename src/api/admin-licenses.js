// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 BolaLabs Licensed under the Apache License 2.0.
/**
 * Admin licences API client: /api/v1/admin/licenses/* (requireAuth +
 * requireAdmin, server/routes/admin-licenses.js). Every route answers
 * `{ data }` on success and `{ error, code }` on failure; this returns `data`
 * and throws an Error carrying `status` and `code` otherwise.
 */
import { fetchWithRetry, safeParseJson } from '../utils/api'

const BASE = '/api/v1/admin/licenses'

async function call(path, { method = 'GET', body } = {}) {
    const res = await fetchWithRetry(`${BASE}${path}`, {
        method,
        credentials: 'include',
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    })
    const json = await safeParseJson(res).catch(() => null)
    if (!res.ok) {
        const err = new Error(typeof json?.error === 'string' ? json.error : `status ${res.status}`)
        err.status = res.status
        err.code = json?.code
        throw err
    }
    return json?.data ?? json
}

const ref = (subRef) => encodeURIComponent(subRef)

/** @returns {Promise<Array<object>>} subscriptions, worst sharing level first */
export async function listLicenses() {
    return (await call('')).licenses ?? []
}

/** @returns {Promise<Array<object>>} installations, most recently seen first */
export async function listInstalls(subRef) {
    return (await call(`/${ref(subRef)}/installs`)).installs ?? []
}

export function blockInstall(subRef, seq, reason) {
    return call(`/${ref(subRef)}/installs/${seq}/block`, { method: 'POST', body: { reason } })
}

export function unblockInstall(subRef, seq, reason) {
    return call(`/${ref(subRef)}/installs/${seq}/unblock`, { method: 'POST', body: { reason } })
}

/** @returns {Promise<{ lid: string, revoked: number, blocked: number, emailDelivered: boolean }>} */
export function rotateLicense(subRef, keep, reason) {
    return call(`/${ref(subRef)}/rotate`, { method: 'POST', body: { keep, reason } })
}
