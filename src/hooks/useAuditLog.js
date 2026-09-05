import { useState, useEffect, useCallback } from 'react'
import { API_BASE_URL } from '../config'
import { parseApiError } from '../components/states'
import { fetchWithRetry } from '../utils/api'

// fetchWithRetry throws an ApiError (status + parsed body on `.data`) instead
// of returning a failed Response, but parseApiError's rich 401/403/503 +
// upgrade-body handling only kicks in for a Response-shaped object (duck-typed
// via 'status' in x && 'ok' in x). This adapts an ApiError back into that
// shape so the audit page keeps its tier-upgrade messaging while routing
// through the shared retry/CSRF/offline-queue transport instead of raw fetch.
function asParsableError(err) {
    if (err && typeof err === 'object' && 'status' in err && !('ok' in err)) {
        const body = err.data ?? {}
        return { status: err.status ?? 0, ok: false, clone() { return this }, json: async () => body }
    }
    return err
}

/**
 * useAuditLog — data + actions behind the audit log table, shared by the
 * full `#/audit` page (src/components/Audit/AuditLogPage.jsx) and the
 * Settings > Audit Log summary tab. Extracted from the page-only
 * AuditLogSection component so both surfaces fetch/filter/paginate/export
 * the same way instead of drifting apart.
 */
export function useAuditLog({ limit = 20 } = {}) {
    const [logs, setLogs] = useState([])
    const [total, setTotal] = useState(0)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    const [action, setAction] = useState('')
    const [dateFrom, setDateFrom] = useState('')
    const [dateTo, setDateTo] = useState('')
    const [page, setPage] = useState(1)

    // Populates the action filter from what the tenant has actually logged
    // rather than a hardcoded list that drifts from real auditLog() call sites.
    const [actionOptions, setActionOptions] = useState([])
    const [actionsLoading, setActionsLoading] = useState(true)

    const fetchLogs = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const params = new URLSearchParams({ page, limit })
            if (action) params.set('action', action)
            if (dateFrom) params.set('from', dateFrom)
            if (dateTo) params.set('to', dateTo)

            const res = await fetchWithRetry(`${API_BASE_URL}/api/v1/audit?${params}`, { credentials: 'include' }, { maxRetries: 0 })
            const data = await res.json()
            setLogs(data.entries || data.logs || data.items || [])
            setTotal(data.total || 0)
        } catch (err) {
            setError(await parseApiError(asParsableError(err), { service: 'Audit log' }))
            setLogs([])
            setTotal(0)
        } finally {
            setLoading(false)
        }
    }, [page, limit, action, dateFrom, dateTo])

    const fetchActions = useCallback(async () => {
        setActionsLoading(true)
        try {
            const res = await fetchWithRetry(`${API_BASE_URL}/api/v1/audit/actions`, { credentials: 'include' }, { maxRetries: 0 })
            const data = await res.json()
            setActionOptions(Array.isArray(data.actions) ? data.actions : [])
        } catch {
            // Non-fatal: the filter falls back to "All Actions" only.
        } finally {
            setActionsLoading(false)
        }
    }, [])

    // Export honours the SAME filters as the table, so what a compliance
    // reviewer downloads matches what they are looking at. The server streams
    // an attachment; anchor-click is the only way to keep the browser's own
    // download UI (and the Content-Disposition filename) rather than buffering
    // a potentially large CSV/JSON into memory here.
    const [exporting, setExporting] = useState(false)
    const handleExport = useCallback((format = 'csv') => {
        setExporting(true)
        try {
            const params = new URLSearchParams({ format })
            if (action) params.set('action', action)
            if (dateFrom) params.set('from', dateFrom)
            if (dateTo) params.set('to', dateTo)
            const link = document.createElement('a')
            link.href = `${API_BASE_URL}/api/v1/audit/export?${params}`
            link.rel = 'noopener'
            document.body.appendChild(link)
            link.click()
            link.remove()
        } finally {
            setExporting(false)
        }
    }, [action, dateFrom, dateTo])

    // Chain-integrity check. Kept separate from fetchLogs/loading so a slow
    // verify pass doesn't block or get blocked by table pagination.
    const [verifying, setVerifying] = useState(false)
    const [verifyResult, setVerifyResult] = useState(null)
    const runVerify = useCallback(async () => {
        setVerifying(true)
        setVerifyResult(null)
        try {
            const res = await fetchWithRetry(`${API_BASE_URL}/api/v1/audit/verify`, { credentials: 'include' }, { maxRetries: 0 })
            const data = await res.json()
            setVerifyResult({ ok: data.ok, checked: data.checked, brokenAt: data.brokenAt ?? null })
        } catch (err) {
            setVerifyResult({ ok: false, error: await parseApiError(asParsableError(err), { service: 'Audit chain verification' }) })
        } finally {
            setVerifying(false)
        }
    }, [])

    /* eslint-disable react-hooks/set-state-in-effect -- filter changes drive page reset + refetch */
    useEffect(() => { fetchLogs() }, [fetchLogs])
    useEffect(() => { fetchActions() }, [fetchActions])
    useEffect(() => { setPage(1) }, [action, dateFrom, dateTo])
    /* eslint-enable react-hooks/set-state-in-effect */

    const totalPages = Math.max(1, Math.ceil(total / limit))

    return {
        logs, total, loading, error, fetchLogs,
        action, setAction, dateFrom, setDateFrom, dateTo, setDateTo,
        page, setPage, limit, totalPages,
        actionOptions, actionsLoading,
        exporting, handleExport,
        verifying, verifyResult, runVerify,
    }
}
