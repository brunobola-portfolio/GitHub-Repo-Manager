// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.
/**
 * DLQTable — shared renderer for Email + Webhook DLQ listings.
 *
 * The two queues have different primary columns (email: to/subject,
 * webhook: delivery_id/event_type) but identical ops (attempts,
 * last_error, timestamps, status, row actions). We parameterise the
 * per-kind columns via `kind` and keep a single table component so the
 * styling + hover-action UX stay in lockstep.
 */
import { useRef } from 'react'
import { motion } from 'framer-motion'
import { Eye, RotateCw, CheckCircle2, Inbox } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { useStickyHeaderShadow } from '../../hooks/useStickyHeaderShadow'
import { parseServerTimestamp } from '../../utils/format'

function formatTimestamp(iso) {
    if (!iso) return '—'
    // parseServerTimestamp reads SQLite's naive 'YYYY-MM-DD HH:MM:SS' as UTC.
    const d = parseServerTimestamp(iso)
    if (!d) return typeof iso === 'string' ? iso : '—'
    return d.toLocaleString()
}

function truncate(text, max = 80) {
    if (!text) return '—'
    if (text.length <= max) return text
    return text.slice(0, max - 1) + '…'
}

function StatusBadge({ resolvedAt }) {
    if (resolvedAt) return <Badge variant="success">Resolved</Badge>
    return <Badge variant="warning">Pending</Badge>
}

export function DLQTable({
    kind, // 'email' | 'webhook'
    entries,
    busyIds,
    onView,
    onRetry,
    onResolve,
}) {
    const tableScrollRef = useRef(null)
    const elevated = useStickyHeaderShadow(tableScrollRef)

    if (!entries || entries.length === 0) {
        return (
            <EmptyState
                icon={Inbox}
                title="Nothing here"
                description={
                    kind === 'email'
                        ? 'No email deliveries are currently in the dead-letter queue for this filter.'
                        : 'No webhook events are currently in the dead-letter queue for this filter.'
                }
            />
        )
    }

    return (
        <Card glass={false} shadow="sm" className="rounded-xl overflow-x-auto">
            <div
                ref={tableScrollRef}
                className="overflow-x-auto overflow-y-auto max-h-[480px]"
            >
            <table className="w-full text-sm">
                <thead className={`sticky top-0 z-10 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 transition-shadow${elevated ? ' shadow-[0_1px_4px_0_rgba(0,0,0,0.08)]' : ''}`}>
                    <tr className="text-left text-slate-500 dark:text-slate-400 uppercase ds-text-meta tracking-wider">
                        <th className="px-4 py-3 font-semibold">ID</th>
                        {kind === 'email' ? (
                            <>
                                <th className="px-4 py-3 font-semibold">To</th>
                                <th className="px-4 py-3 font-semibold">Subject</th>
                            </>
                        ) : (
                            <>
                                <th className="px-4 py-3 font-semibold">Delivery</th>
                                <th className="px-4 py-3 font-semibold">Event</th>
                            </>
                        )}
                        <th className="px-4 py-3 font-semibold text-right">Attempts</th>
                        <th className="px-4 py-3 font-semibold">Last error</th>
                        <th className="px-4 py-3 font-semibold">Created</th>
                        <th className="px-4 py-3 font-semibold">Next retry</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                        <th className="px-4 py-3 font-semibold text-right">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {entries.map((row) => {
                        const busy = busyIds.has(row.id)
                        const resolved = !!row.resolved_at
                        return (
                            <motion.tr
                                key={row.id}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="group border-b border-slate-100 dark:border-slate-800 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                            >
                                <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">
                                    #{row.id}
                                </td>
                                {kind === 'email' ? (
                                    <>
                                        <td className="px-4 py-3 truncate max-w-[220px]" title={row.to_address || ''}>
                                            {row.to_address || '—'}
                                        </td>
                                        <td className="px-4 py-3 truncate max-w-[300px]" title={row.subject || ''}>
                                            {row.subject || <span className="text-slate-400">(no subject)</span>}
                                        </td>
                                    </>
                                ) : (
                                    <>
                                        <td className="px-4 py-3 font-mono text-xs truncate max-w-[180px]" title={row.delivery_id || ''}>
                                            {row.delivery_id || '—'}
                                        </td>
                                        <td className="px-4 py-3">
                                            <Badge variant="info">{row.event_type || '—'}</Badge>
                                        </td>
                                    </>
                                )}
                                <td className="px-4 py-3 text-right font-mono tabular-nums">
                                    {row.attempts ?? 0}
                                </td>
                                <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400 max-w-[280px]" title={row.last_error || ''}>
                                    {truncate(row.last_error, 60)}
                                </td>
                                <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                    {formatTimestamp(row.created_at)}
                                </td>
                                <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                    {formatTimestamp(row.next_retry_at)}
                                </td>
                                <td className="px-4 py-3">
                                    <StatusBadge resolvedAt={row.resolved_at} />
                                </td>
                                <td className="px-4 py-3">
                                    <div className="flex items-center justify-end gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                                        <RowActionButton
                                            onClick={() => onView(row)}
                                            label="View details"
                                            icon={Eye}
                                            disabled={busy}
                                        />
                                        <RowActionButton
                                            onClick={() => onRetry(row)}
                                            label="Retry now"
                                            icon={RotateCw}
                                            disabled={busy || resolved}
                                            tone="indigo"
                                        />
                                        <RowActionButton
                                            onClick={() => onResolve(row)}
                                            label="Mark resolved"
                                            icon={CheckCircle2}
                                            disabled={busy || resolved}
                                            tone="emerald"
                                        />
                                    </div>
                                </td>
                            </motion.tr>
                        )
                    })}
                </tbody>
            </table>
            </div>
        </Card>
    )
}

function RowActionButton({ onClick, label, icon: Icon, disabled, tone = 'slate' }) {
    const toneClass = {
        slate: 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700',
        indigo: 'text-[color:var(--ds-accent-brand)] hover:text-brand-800 dark:text-[color:var(--ds-accent-brand-dark)] dark:hover:text-brand-200 hover:bg-brand-50 dark:hover:bg-brand-900/40',
        emerald: 'text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-200 hover:bg-emerald-50 dark:hover:bg-emerald-900/40',
    }[tone]

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={label}
            aria-label={label}
            className={`p-2 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed ds-focus-ring ${toneClass}`}
        >
            <Icon className="w-4 h-4" />
        </button>
    )
}
