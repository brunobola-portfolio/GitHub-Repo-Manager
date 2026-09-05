import { apiCall } from '../utils/api'

const BASE = '/api/v1/work-board'

// apiCall's ApiError carries .status and .data (the parsed body) — the
// same fields this used to hand-roll off the raw Response via assertOk().
async function get(path) {
    return apiCall(path, { method: 'GET' })
}

async function mutate(path, method, body) {
    return apiCall(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
}

function buildQuery(filters) {
    const pairs = []
    for (const [k, v] of Object.entries(filters ?? {})) {
        if (v === undefined || v === null || v === '') continue
        pairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    }
    return pairs.length ? `?${pairs.join('&')}` : ''
}

export function fetchTrackedRepos(filters = {}) {
    return get(`${BASE}/tracked-repos${buildQuery(filters)}`)
}

export function mutateTrackedRepo(repo, action) {
    return mutate(`${BASE}/tracked-repos`, 'POST', { repo, action })
}

export function bulkMutateTrackedRepos(repos, action) {
    return mutate(`${BASE}/tracked-repos/bulk`, 'POST', { repos, action })
}

export function fetchPrefs() {
    return get(`${BASE}/prefs`)
}

export function patchPrefs(patch) {
    return mutate(`${BASE}/prefs`, 'PATCH', patch)
}

export function postDiscover() {
    return mutate(`${BASE}/discover`, 'POST')
}

export function postUndo(operationId) {
    return mutate(`${BASE}/undo/${encodeURIComponent(operationId)}`, 'POST')
}

export function postPing() {
    return get(`${BASE}/ping`)
}

export function searchRepos(q) {
    return get(`${BASE}/repo-search?q=${encodeURIComponent(q)}`)
}
