import { getCsrfToken } from '../utils/api'

const BASE = '/api/v1/work-board/ai'

async function assertOk(res) {
    if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const err = new Error(body.error || `Request failed: HTTP ${res.status}`)
        err.status = res.status
        err.code = body.code
        err.body = body
        throw err
    }
    return res
}

async function get(path) {
    const res = await fetch(path, { method: 'GET', credentials: 'include' })
    await assertOk(res)
    return res.json()
}

async function post(path, body) {
    const csrf = await getCsrfToken()
    const res = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    await assertOk(res)
    return res.json()
}

export function fetchStatus() {
    return get(`${BASE}/status`)
}
export function fetchSuggestions() {
    return get(`${BASE}/suggestions`)
}
export function dismissSuggestion(pattern_key, repo_full_name = '') {
    return post(`${BASE}/dismiss-suggestion`, { pattern_key, repo_full_name })
}
export function interpretPrompt(prompt) {
    return post(`${BASE}/interpret`, { prompt })
}
export function applyDiff(validity_token) {
    return post(`${BASE}/apply`, { validity_token })
}
export function fetchActivity() {
    return get(`${BASE}/activity`)
}
