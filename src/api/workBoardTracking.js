import { getCsrfToken } from '../utils/api'

const BASE = '/api/v1/work-board'

async function assertOk(res) {
    if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const detail = body.error ? ` – ${body.error}` : ''
        const err = new Error(`Request failed: HTTP ${res.status}${detail}`)
        err.status = res.status
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

async function mutate(path, method, body) {
    const csrf = await getCsrfToken()
    const res = await fetch(path, {
        method,
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrf,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    await assertOk(res)
    return res.json()
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
