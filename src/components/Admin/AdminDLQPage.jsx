// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.
/**
 * AdminDLQPage — operator UI for the Email + Webhook dead-letter queues.
 *
 * Backend: /api/v1/admin/dlq/* (server/routes/admin-dlq.js), gated behind
 * requireAuth + requireTier('enterprise') + requireAdmin. A 403 from the
 * list endpoint is the classic "you're not admin yet" signal — we render
 * a helpful error state with the bootstrap SQL snippet rather than a
 * generic "forbidden" toast.
 *
 * Structure:
 *   TabBar   → Email | Webhook
 *   Filters  → All | Unresolved | Resolved  + Refresh
 *   Table    → (DLQTable), hover row actions
 *   Panel    → (DLQDetailPanel), side drawer with full payload
 */
import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Mail, Webhook, RefreshCw, ShieldAlert } from 'lucide-react'
import { SectionSpinner } from '../ui/Spinner'
import { TabBar } from '../ui/TabBar'
import { Button } from '../ui/Button'
import { PageHeader } from '../ui/PageHeader'
import { useToast } from '../../hooks/useToast'
import { DLQTable } from './DLQTable'
import { DLQDetailPanel } from './DLQDetailPanel'
import {
    listEmailDLQ,
    getEmailEntry,
    retryEmailEntry,
    resolveEmailEntry,
    listWebhookDLQ,
    getWebhookEntry,
    retryWebhookEntry,
    resolveWebhookEntry,
} from '../../api/admin-dlq'

const TABS = [
    { id: 'email', label: 'Email DLQ', icon: Mail },
    { id: 'webhook', label: 'Webhook DLQ', icon: Webhook },
]

const FILTERS = [
    { id: 'false', label: 'Unresolved' },
    { id: 'true', label: 'Resolved' },
    { id: 'all', label: 'All' },
]

// Bind the right API client set to the active tab. Keeping this as a
// lookup avoids a tangle of ternaries inside the handlers.
const HANDLERS = {
    email: {
        list: listEmailDLQ,
        get: getEmailEntry,
        retry: retryEmailEntry,
        resolve: resolveEmailEntry,
    },
    webhook: {
        list: listWebhookDLQ,
        get: getWebhookEntry,
        retry: retryWebhookEntry,
        resolve: resolveWebhookEntry,
    },
}

export function AdminDLQPage() {
    const [activeTab, setActiveTab] = useState('email')
    const [filter, setFilter] = useState('false')
    const [entries, setEntries] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [busyIds, setBusyIds] = useState(() => new Set())

    // Detail panel
    const [openEntry, setOpenEntry] = useState(null)
    const [openLoading, setOpenLoading] = useState(false)

    const { toast } = useToast()

    const handlers = HANDLERS[activeTab]

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const rows = await handlers.list(filter)
            setEntries(rows)
        } catch (err) {
            setError(err)
            setEntries([])
        } finally {
            setLoading(false)
        }
    }, [handlers, filter])

    // Re-load on tab or filter change. We intentionally clobber the old
    // list while the new one fetches — stale rows from the other tab
    // would be misleading.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tab/filter sync fetch
    useEffect(() => { load() }, [load])

    const markBusy = useCallback((id, flag) => {
        setBusyIds((prev) => {
            const next = new Set(prev)
            if (flag) next.add(id)
            else next.delete(id)
            return next
        })
    }, [])

    const handleView = useCallback(async (row) => {
        setOpenEntry({ id: row.id }) // placeholder so drawer opens immediately
        setOpenLoading(true)
        try {
            const full = await handlers.get(row.id)
            setOpenEntry(full)
        } catch (err) {
            toast.errorFromException(err, { fallbackTitle: 'Failed to load entry' })
            setOpenEntry(null)
        } finally {
            setOpenLoading(false)
        }
    }, [handlers, toast])

    const handleRetry = useCallback(async (row) => {
        markBusy(row.id, true)
        try {
            await handlers.retry(row.id)
            toast.success(`Entry #${row.id} queued for immediate retry`)
            await load()
            // Refresh the drawer if it's showing this row
            setOpenEntry((prev) => (prev && prev.id === row.id ? { ...prev, next_retry_at: new Date().toISOString() } : prev))
        } catch (err) {
            toast.errorFromException(err, { fallbackTitle: 'Retry failed' })
        } finally {
            markBusy(row.id, false)
        }
    }, [handlers, load, toast, markBusy])

    const handleResolve = useCallback(async (row) => {
        markBusy(row.id, true)
        try {
            await handlers.resolve(row.id)
            toast.success(`Entry #${row.id} marked resolved`)
            await load()
            setOpenEntry((prev) => (prev && prev.id === row.id ? null : prev))
        } catch (err) {
            toast.errorFromException(err, { fallbackTitle: 'Resolve failed' })
        } finally {
            markBusy(row.id, false)
        }
    }, [handlers, load, toast, markBusy])

    // 403 → admin-only bootstrap instructions. Everything else → generic
    // retryable error state.
    if (error && error.status === 403) {
        return <AdminGateError />
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="space-y-5"
        >
            <PageHeader
                eyebrow="Admin"
                title="Dead-letter Queue Admin"
                description="Triage failed email deliveries and webhook events. Retry force-schedules the next worker tick; resolve is a soft-delete that preserves the audit trail."
                icon={ShieldAlert}
                actions={
                    <TabBar
                        tabs={TABS}
                        activeTab={activeTab}
                        onTabChange={(id) => { setActiveTab(id); setOpenEntry(null) }}
                        variant="pill"
                        layoutId="admin-dlq-tabs"
                        size="md"
                    />
                }
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1 p-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
                    {FILTERS.map((f) => (
                        <button
                            key={f.id}
                            type="button"
                            onClick={() => setFilter(f.id)}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ds-focus-ring ${
                                filter === f.id
                                    ? 'bg-[color:var(--ds-accent-brand)] text-white shadow-sm'
                                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                            aria-pressed={filter === f.id}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                        {loading ? 'Loading…' : `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`}
                    </span>
                    <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                </div>
            </div>

            {loading && (
                <SectionSpinner padding="py-16" tone="muted" />
            )}

            {!loading && error && error.status !== 403 && (
                <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-4 text-sm text-red-700 dark:text-red-300">
                    Failed to load DLQ entries: {error.message}
                </div>
            )}

            {!loading && !error && (
                <DLQTable
                    kind={activeTab}
                    entries={entries}
                    busyIds={busyIds}
                    onView={handleView}
                    onRetry={handleRetry}
                    onResolve={handleResolve}
                />
            )}

            <DLQDetailPanel
                kind={activeTab}
                entry={openEntry}
                loading={openLoading}
                isOpen={!!openEntry}
                onClose={() => setOpenEntry(null)}
                onRetry={handleRetry}
                onResolve={handleResolve}
                busy={openEntry ? busyIds.has(openEntry.id) : false}
            />
        </motion.div>
    )
}

function AdminGateError() {
    return (
        <div className="max-w-2xl mx-auto mt-12 rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-6">
            <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-amber-200 dark:bg-amber-900 flex items-center justify-center flex-shrink-0">
                    <ShieldAlert className="w-6 h-6 text-amber-700 dark:text-amber-300" />
                </div>
                <div className="flex-1">
                    <h2 className="text-lg font-semibold text-amber-900 dark:text-amber-200">
                        Admin access required
                    </h2>
                    <p className="text-sm text-amber-800 dark:text-amber-300 mt-1">
                        The DLQ operator UI is restricted to accounts with <code className="font-mono text-xs">users.is_admin = 1</code>.
                        Admin is stricter than any tier — it's a manual bootstrap.
                    </p>
                    <pre className="mt-3 bg-white/80 dark:bg-slate-900/70 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs font-mono text-slate-700 dark:text-slate-300 overflow-x-auto">
{`UPDATE users SET is_admin = 1 WHERE id = ?;`}
                    </pre>
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-3">
                        Run against the production SQLite DB, then refresh this tab.
                    </p>
                </div>
            </div>
        </div>
    )
}

export default AdminDLQPage
