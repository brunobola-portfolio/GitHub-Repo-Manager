import { useCallback, useEffect, useState } from 'react'
import { getCsrfToken } from '../utils/api'
import { MOCK_MODE } from '../config'

const BASE = '/api/v1/work-board/presets'
const DEFAULT_SCOPE = 'work-board'

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

async function call(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase()
    let headers = options.headers
    if (MUTATION_METHODS.has(method)) {
        headers = { ...(headers || {}) }
        if (!headers['X-CSRF-Token']) {
            try { headers['X-CSRF-Token'] = await getCsrfToken() } catch { /* server will 403 */ }
        }
    }
    const res = await fetch(url, { credentials: 'include', ...options, headers })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
        const err = new Error(json.error || `status ${res.status}`)
        err.status = res.status
        err.code = json.code
        throw err
    }
    return json
}

// Mock-mode persistence — MOCK_MODE has no backend to CRUD against, so saved
// views are kept in localStorage instead, namespaced by scope so a Work
// Board view and a Repositories view can share a name without colliding.
// Real (non-mock) mode never touches this; the server + work_board_presets
// table (scoped since G5's migration 35) is the source of truth there.
function mockStorageKey(scope) { return `saved-views:${scope}` }

function readMockPresets(scope) {
    try {
        const raw = localStorage.getItem(mockStorageKey(scope))
        const parsed = raw ? JSON.parse(raw) : []
        return Array.isArray(parsed) ? parsed : []
    } catch {
        return []
    }
}

function writeMockPresets(scope, presets) {
    try { localStorage.setItem(mockStorageKey(scope), JSON.stringify(presets)) }
    catch { /* storage unavailable (quota, private mode) — mock state just won't persist */ }
}

let mockIdSeq = Date.now()

/**
 * useSavedViews — CRUD over named filter presets ("saved views"), scoped by
 * feature surface (e.g. 'work-board', 'repos'). Generalised from the
 * Work-Board-only useWorkBoardPresets (G5) so other filter bars (the
 * Repositories view) can save/apply views through the same backend
 * (server/routes/work-board-actions.js, server/lib/work-board-presets.js).
 *
 * The default scope's wire format is left byte-identical to the pre-G5
 * behaviour (no `scope` query param or body field, since the server also
 * defaults to 'work-board') so nothing about the original Work Board
 * integration — including its existing tests — changes.
 */
export function useSavedViews(scope = DEFAULT_SCOPE) {
    const [presets, setPresets] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    const listUrl = scope === DEFAULT_SCOPE ? BASE : `${BASE}?scope=${encodeURIComponent(scope)}`

    const refresh = useCallback(async () => {
        if (MOCK_MODE) {
            setPresets(readMockPresets(scope))
            setLoading(false)
            return
        }
        setLoading(true)
        try {
            const json = await call(listUrl)
            setPresets(json.data || [])
            setError(null)
        } catch (e) {
            setError(e)
        } finally {
            setLoading(false)
        }
    }, [listUrl, scope])

    // Fetch-on-mount. The setState updates inside `refresh()` are asynchronous
    // (wrapped in a Promise), so this does NOT cascade synchronous renders —
    // the `react-hooks/set-state-in-effect` rule flags the call shape but the
    // actual behaviour is safe.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { refresh() }, [refresh])

    const create = useCallback(async ({ name, filters }) => {
        if (MOCK_MODE) {
            const existing = readMockPresets(scope)
            if (existing.some((p) => p.name === name)) {
                const err = new Error('Preset name already exists')
                err.code = 'preset_exists'
                throw err
            }
            const next = [...existing, { id: mockIdSeq++, name, filters, scope }]
            writeMockPresets(scope, next)
            setPresets(next)
            return
        }
        const body = scope === DEFAULT_SCOPE ? { name, filters } : { name, filters, scope }
        await call(BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
        await refresh()
    }, [refresh, scope])

    const update = useCallback(async (id, patch) => {
        if (MOCK_MODE) {
            const next = readMockPresets(scope).map((p) => (p.id === id ? { ...p, ...patch } : p))
            writeMockPresets(scope, next)
            setPresets(next)
            return
        }
        const body = scope === DEFAULT_SCOPE ? patch : { ...patch, scope }
        await call(`${BASE}/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
        await refresh()
    }, [refresh, scope])

    const remove = useCallback(async (id) => {
        if (MOCK_MODE) {
            const next = readMockPresets(scope).filter((p) => p.id !== id)
            writeMockPresets(scope, next)
            setPresets(next)
            return
        }
        const url = scope === DEFAULT_SCOPE ? `${BASE}/${id}` : `${BASE}/${id}?scope=${encodeURIComponent(scope)}`
        await call(url, { method: 'DELETE' })
        await refresh()
    }, [refresh, scope])

    return { presets, loading, error, refresh, create, update, remove }
}

/**
 * Work-Board-scoped wrapper, kept so every pre-G5 call site (and its tests)
 * continues to work unmodified.
 */
export function useWorkBoardPresets() {
    return useSavedViews(DEFAULT_SCOPE)
}
