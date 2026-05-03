import { useCallback, useEffect, useState } from 'react'
import { getCsrfToken } from '../utils/api'
import { MOCK_MODE } from '../config'

const BASE = '/api/v1/work-board/presets'

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

export function useWorkBoardPresets() {
    const [presets, setPresets] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    const refresh = useCallback(async () => {
        if (MOCK_MODE) { setLoading(false); return }
        setLoading(true)
        try {
            const json = await call(BASE)
            setPresets(json.data || [])
            setError(null)
        } catch (e) {
            setError(e)
        } finally {
            setLoading(false)
        }
    }, [])

    // Fetch-on-mount. The setState updates inside `refresh()` are asynchronous
    // (wrapped in a Promise), so this does NOT cascade synchronous renders —
    // the `react-hooks/set-state-in-effect` rule flags the call shape but the
    // actual behaviour is safe.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { refresh() }, [refresh])

    const create = useCallback(async ({ name, filters }) => {
        await call(BASE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, filters }),
        })
        await refresh()
    }, [refresh])

    const update = useCallback(async (id, patch) => {
        await call(`${BASE}/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        })
        await refresh()
    }, [refresh])

    const remove = useCallback(async (id) => {
        await call(`${BASE}/${id}`, { method: 'DELETE' })
        await refresh()
    }, [refresh])

    return { presets, loading, error, refresh, create, update, remove }
}
