/*
 * GitHub Repo Manager
 * Azure DevOps request helper
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the Apache License 2.0 (SPDX: Apache-2.0). See LICENSE in the project root.
 */

import { apiCall } from '../utils/api'
import { azureCredPayload } from '../utils/azureRequestPayload'
import { API_BASE } from '../config'

/**
 * POST to an Azure DevOps-backed endpoint with the caller-supplied fields
 * plus the wizard's credential slice (`azureCredPayload(source)` — prefers
 * `savedCredentialId`, falls back to a raw `pat`, always includes `host`)
 * merged into the body.
 *
 * Centralises the CSRF-POST boilerplate every MigrationWizard Azure step
 * used to hand-roll (fetch the CSRF token, build headers, JSON.stringify,
 * check `res.ok`) — routing through `apiCall`/`fetchWithRetry` means CSRF
 * header injection and the 403 `csrf_invalid` rotation-retry apply for
 * free, and the 30s timeout / offline handling that raw `fetch` never had.
 *
 * @param {string} path   endpoint path relative to the API root, e.g. '/azure/repos'
 * @param {object} source wizard source state slice (host, pat, credentialMode, savedCredentialId)
 * @param {object} [extra] additional body fields, merged in BEFORE the credential
 *                         payload so a caller can never accidentally shadow host/pat/savedCredentialId
 * @param {object} [opts] extra fetch options (e.g. `signal`) merged into the request;
 *                        `opts.method` and `opts.body` are ignored — this is always a JSON POST
 * @returns {Promise<any>} parsed JSON response body
 */
export function azurePost(path, source, extra = {}, opts = {}) {
    const { signal, headers, method: _method, body: _body, ...restOpts } = opts
    return apiCall(`${API_BASE}${path}`, {
        ...restOpts,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(headers || {}) },
        body: JSON.stringify({ ...extra, ...azureCredPayload(source) }),
        ...(signal ? { signal } : {}),
    })
}
