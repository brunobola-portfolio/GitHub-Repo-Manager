import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Shield, ChevronLeft, ChevronRight, AlertTriangle, Filter, RefreshCw } from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { formatDateTime as formatDateTimeBase } from '../../utils/format'

const ACTION_OPTIONS = [
    { value: '', label: 'All Actions' },
    { value: 'auth.login', label: 'auth.login' },
    { value: 'auth.logout', label: 'auth.logout' },
    { value: 'repo.create', label: 'repo.create' },
    { value: 'repo.delete', label: 'repo.delete' },
    { value: 'repo.transfer', label: 'repo.transfer' },
    { value: 'team.create', label: 'team.create' },
    { value: 'team.delete', label: 'team.delete' },
    { value: 'team.update', label: 'team.update' },
    { value: 'api_key.create', label: 'api_key.create' },
    { value: 'api_key.revoke', label: 'api_key.revoke' },
    { value: 'settings.update', label: 'settings.update' },
]

const ACTION_COLORS = {
    'auth.login': 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30',
    'auth.logout': 'text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800',
    'repo.delete': 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30',
    'repo.transfer': 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30',
    'api_key.revoke': 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30',
    'team.delete': 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30',
}

function getActionColor(action) {
    return ACTION_COLORS[action] || 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30'
}

function formatDateTime(dateStr) {
    if (!dateStr) return '—'
    return formatDateTimeBase(dateStr) || '—'
}

const rowVariants = {
    hidden: { opacity: 0, y: 6 },
    visible: (i) => ({ opacity: 1, y: 0, transition: { delay: i * 0.04, duration: 0.2 } }),
    exit: { opacity: 0, y: -4, transition: { duration: 0.15 } },
}

export function AuditLogSection() {
    const [logs, setLogs] = useState([])
    const [total, setTotal] = useState(0)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    const [action, setAction] = useState('')
    const [dateFrom, setDateFrom] = useState('')
    const [dateTo, setDateTo] = useState('')
    const [page, setPage] = useState(1)
    const [limit] = useState(20)

    const fetchLogs = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const params = new URLSearchParams({ page, limit })
            if (action) params.set('action', action)
            if (dateFrom) params.set('from', dateFrom)
            if (dateTo) params.set('to', dateTo)

            const res = await fetch(`${API_BASE_URL}/api/v1/audit?${params}`, { credentials: 'include' })
            if (!res.ok) throw new Error('Failed to load audit log')
            const data = await res.json()
            setLogs(data.entries || data.logs || data.items || [])
            setTotal(data.total || 0)
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }, [page, limit, action, dateFrom, dateTo])

    useEffect(() => { fetchLogs() }, [fetchLogs])

    // Reset to page 1 when filters change
    useEffect(() => { setPage(1) }, [action, dateFrom, dateTo])

    const totalPages = Math.max(1, Math.ceil(total / limit))

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
                    <Shield className="w-5 h-5 text-purple-500" />
                </div>
                <div>
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white">Audit Log</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Track all account activity and changes</p>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 items-end">
                <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1">
                        <Filter className="w-3 h-3" /> Action
                    </label>
                    <select
                        value={action}
                        onChange={(e) => setAction(e.target.value)}
                        className="px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition"
                    >
                        {ACTION_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                    </select>
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-400">From</label>
                    <input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none transition"
                    />
                </div>

                <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-400">To</label>
                    <input
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none transition"
                    />
                </div>

                <button
                    onClick={fetchLogs}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl transition-colors"
                    title="Refresh"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                </button>
            </div>

            {/* Table */}
            {error ? (
                <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {error}
                </div>
            ) : loading && logs.length === 0 ? (
                <div className="space-y-2">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-12 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
                    ))}
                </div>
            ) : (
                <div className="overflow-x-auto rounded-2xl border border-slate-200/70 dark:border-slate-700/50 bg-white dark:bg-slate-800/60">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-200/70 dark:border-slate-700/50 bg-slate-50/80 dark:bg-slate-800/80">
                                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Date</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Action</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Resource Type</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Resource ID</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">IP Address</th>
                            </tr>
                        </thead>
                        <tbody>
                            <AnimatePresence>
                                {logs.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-400 dark:text-slate-500">
                                            No audit log entries found
                                        </td>
                                    </tr>
                                ) : (
                                    logs.map((log, i) => (
                                        <motion.tr
                                            key={log.id || i}
                                            custom={i}
                                            variants={rowVariants}
                                            initial="hidden"
                                            animate="visible"
                                            exit="exit"
                                            className="border-b border-slate-100 dark:border-slate-700/40 last:border-0 hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition-colors"
                                        >
                                            <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                                {formatDateTime(log.created_at || log.createdAt || log.timestamp)}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium font-mono ${getActionColor(log.action)}`}>
                                                    {log.action}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                                                {log.resource_type || log.resourceType || '—'}
                                            </td>
                                            <td className="px-4 py-3 text-xs font-mono text-slate-500 dark:text-slate-400 max-w-[160px] truncate">
                                                {log.resource_id || log.resourceId || '—'}
                                            </td>
                                            <td className="px-4 py-3 text-xs font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                                {log.ip_address || log.ipAddress || log.ip || '—'}
                                            </td>
                                        </motion.tr>
                                    ))
                                )}
                            </AnimatePresence>
                        </tbody>
                    </table>
                </div>
            )}

            {/* Pagination */}
            {!error && (
                <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        {total > 0 ? `${((page - 1) * limit) + 1}–${Math.min(page * limit, total)} of ${total} entries` : 'No entries'}
                    </p>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={page === 1 || loading}
                            className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                            {page} / {totalPages}
                        </span>
                        <button
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                            disabled={page >= totalPages || loading}
                            className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
