import { apiCall } from '../utils/api'

const BASE = '/api/v1/work-board/ai'

// apiCall's ApiError already carries .status and .code (the server's
// machine-readable code, from body.code or body.error) — matching the
// shape consumers (useWorkBoardAI.js) previously read off a hand-rolled
// assertOk() error.
async function get(path) {
    return apiCall(path, { method: 'GET' })
}

async function post(path, body) {
    return apiCall(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
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
