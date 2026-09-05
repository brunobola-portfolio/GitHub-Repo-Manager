import { useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatDateTime as formatDateTimeBase } from '../../utils/format'
import { Card } from '../ui/Card'
import { STICKY_HEAD_SHADOW_CLASS } from '../ui/_variants'
import { Skeleton } from '../ui/Skeleton'
import { FeatureState } from '../states'
import { useStickyHeaderShadow } from '../../hooks/useStickyHeaderShadow'
import { DURATION } from '../ui/motion'

const ACTION_COLORS = {
    'auth.login': 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30',
    'auth.logout': 'text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800',
    'repo.delete': 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/30',
    'repo.transfer': 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30',
    'api_key.revoke': 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/30',
    'team.delete': 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/30',
}

function getActionColor(action) {
    return ACTION_COLORS[action] || 'text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] bg-brand-50 dark:bg-brand-900/30'
}

function formatDateTime(dateStr) {
    if (!dateStr) return '—'
    return formatDateTimeBase(dateStr) || '—'
}

const rowVariants = {
    hidden: { opacity: 0, y: 6 },
    visible: (i) => ({ opacity: 1, y: 0, transition: { delay: i * 0.04, duration: DURATION.standard } }),
    exit: { opacity: 0, y: -4, transition: { duration: DURATION.fast } },
}

/**
 * AuditLogTable — the table + pagination footer shared by the Settings >
 * Audit Log summary tab and the full `#/audit` page. Extracted so filter UI
 * can differ per surface (the Settings tab shows none; the page shows the
 * full filter bar) while the rendering of rows never drifts between them.
 */
export function AuditLogTable({ logs, total, page, limit, totalPages, loading, error, onRetry, onPrevPage, onNextPage, maxHeight = '420px' }) {
    const tableScrollRef = useRef(null)
    const elevated = useStickyHeaderShadow(tableScrollRef)

    if (error) {
        return (
            <FeatureState
                error={error}
                feature="Audit log"
                benefits={[
                    'Track every authentication, repo and team change',
                    'Filter by action, resource and date range',
                    'Retain compliance-grade history for your account',
                ]}
                onRetry={onRetry}
            />
        )
    }

    if (loading && logs.length === 0) {
        return (
            <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} variant="card" className="h-12" />
                ))}
            </div>
        )
    }

    return (
        <>
            <Card glass={false} shadow="sm" className="overflow-x-auto">
                <div ref={tableScrollRef} className="overflow-y-auto" style={{ maxHeight }}>
                    <table className="w-full text-sm">
                        <thead className={`sticky top-0 z-10 transition-shadow${elevated ? ` ${STICKY_HEAD_SHADOW_CLASS}` : ''}`}>
                            <tr className="border-b border-slate-200/70 dark:border-slate-700/50 bg-slate-50/80 dark:bg-slate-800/80">
                                <th scope="col" className="px-4 py-3 text-left ds-eyebrow text-slate-500 dark:text-slate-400">Date</th>
                                <th scope="col" className="px-4 py-3 text-left ds-eyebrow text-slate-500 dark:text-slate-400">Action</th>
                                <th scope="col" className="px-4 py-3 text-left ds-eyebrow text-slate-500 dark:text-slate-400">Resource type</th>
                                <th scope="col" className="px-4 py-3 text-left ds-eyebrow text-slate-500 dark:text-slate-400">Resource ID</th>
                                <th scope="col" className="px-4 py-3 text-left ds-eyebrow text-slate-500 dark:text-slate-400">IP address</th>
                            </tr>
                        </thead>
                        <tbody>
                            <AnimatePresence>
                                {logs.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
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
            </Card>

            {(onPrevPage || onNextPage) && (
                <div className="flex items-center justify-between mt-3">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        {total > 0 ? `${((page - 1) * limit) + 1}–${Math.min(page * limit, total)} of ${total} entries` : 'No entries'}
                    </p>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={onPrevPage}
                            disabled={page === 1 || loading}
                            className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ds-focus-ring"
                            aria-label="Previous page"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                            {page} / {totalPages}
                        </span>
                        <button
                            onClick={onNextPage}
                            disabled={page >= totalPages || loading}
                            className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ds-focus-ring"
                            aria-label="Next page"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}
        </>
    )
}
