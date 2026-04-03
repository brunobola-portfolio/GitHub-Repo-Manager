import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { BarChart3, AlertTriangle, RefreshCw, ArrowUpRight } from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { Card } from '../ui/Card'

function formatDate(dateStr) {
    if (!dateStr) return 'N/A'
    return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function getBarColor(pct) {
    if (pct > 80) return 'bg-red-500'
    if (pct >= 50) return 'bg-amber-500'
    return 'bg-emerald-500'
}

function getTextColor(pct) {
    if (pct > 80) return 'text-red-600 dark:text-red-400'
    if (pct >= 50) return 'text-amber-600 dark:text-amber-400'
    return 'text-emerald-600 dark:text-emerald-400'
}

function UsageBar({ label, icon: IconComp, used, limit, resetDate, description }) {
    const hasLimit = limit > 0
    const pct = hasLimit ? Math.min(100, Math.round((used / limit) * 100)) : 0
    const barColor = getBarColor(pct)
    const textColor = getTextColor(pct)
    const approaching = pct >= 80 && hasLimit

    return (
        <Card className="p-5">
            <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                    {IconComp && (
                        <div className="w-9 h-9 rounded-xl bg-indigo-500/10 flex items-center justify-center shrink-0">
                            <IconComp className="w-5 h-5 text-indigo-500" />
                        </div>
                    )}
                    <div>
                        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</h3>
                        {description && (
                            <p className="text-xs text-slate-500 dark:text-slate-400">{description}</p>
                        )}
                    </div>
                </div>

                <div className="text-right shrink-0">
                    <span className={`text-lg font-bold ${hasLimit ? textColor : 'text-slate-700 dark:text-slate-200'}`}>
                        {used.toLocaleString()}
                    </span>
                    {hasLimit && (
                        <span className="text-sm text-slate-400 dark:text-slate-500">
                            /{limit.toLocaleString()}
                        </span>
                    )}
                </div>
            </div>

            {hasLimit ? (
                <>
                    <div className="h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden mb-2">
                        <motion.div
                            className={`h-full rounded-full ${barColor}`}
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.8, ease: 'easeOut' }}
                        />
                    </div>

                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <span className={`text-xs font-medium ${textColor}`}>{pct}% used</span>
                            {resetDate && (
                                <span className="text-xs text-slate-400 dark:text-slate-500">
                                    Resets on {formatDate(resetDate)}
                                </span>
                            )}
                        </div>
                        {approaching && (
                            <a
                                href="/pricing"
                                className="flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                            >
                                Upgrade for more
                                <ArrowUpRight className="w-3 h-3" />
                            </a>
                        )}
                    </div>
                </>
            ) : (
                <div className="flex items-center gap-2">
                    <div className="h-2.5 flex-1 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full w-full bg-indigo-400/30 rounded-full" />
                    </div>
                    <span className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap">Unlimited</span>
                </div>
            )}
        </Card>
    )
}

const METRIC_ICONS = {
    ai_queries: BarChart3,
    repos: null,
    repos_managed: null,
    api_calls: null,
    storage: null,
}

const METRIC_LABELS = {
    ai_queries: 'AI Queries',
    repos: 'Repos Managed',
    repos_managed: 'Repos Managed',
    api_calls: 'API Calls',
    storage_gb: 'Storage Used (GB)',
    storage: 'Storage Used',
}

const METRIC_DESCRIPTIONS = {
    ai_queries: 'AI-powered insights and code reviews',
    repos: 'Repositories under active management',
    repos_managed: 'Repositories under active management',
    api_calls: 'API calls made this period',
    storage_gb: 'Total storage consumed',
}

export function UsageSection() {
    const [usage, setUsage] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [refreshing, setRefreshing] = useState(false)

    const fetchUsage = async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true)
        else setLoading(true)
        setError(null)
        try {
            const res = await fetch(`${API_BASE_URL}/api/v1/usage`, { credentials: 'include' })
            if (!res.ok) throw new Error('Failed to load usage data')
            const data = await res.json()
            setUsage(data)
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }

    useEffect(() => { fetchUsage() }, [])

    // Normalise the usage data into a flat array of metric items
    const metrics = usage ? (
        Array.isArray(usage.metrics)
            ? usage.metrics
            : Object.entries(usage).filter(([k]) => k !== 'resetDate' && typeof usage[k] === 'object').map(([key, val]) => ({
                key,
                label: METRIC_LABELS[key] || key.replace(/_/g, ' '),
                description: METRIC_DESCRIPTIONS[key] || '',
                used: val.used ?? val.current ?? 0,
                limit: val.limit ?? val.max ?? 0,
                resetDate: val.resetDate || usage.resetDate,
            }))
    ) : []

    // Fallback: try to parse top-level numeric fields
    const fallbackMetrics = usage && metrics.length === 0 ? (
        Object.entries(usage)
            .filter(([k, v]) => k !== 'resetDate' && typeof v === 'number')
            .map(([key, val]) => ({
                key,
                label: METRIC_LABELS[key] || key.replace(/_/g, ' '),
                description: METRIC_DESCRIPTIONS[key] || '',
                used: val,
                limit: 0,
                resetDate: usage.resetDate,
            }))
    ) : []

    const displayMetrics = metrics.length > 0 ? metrics : fallbackMetrics

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                        <BarChart3 className="w-5 h-5 text-blue-500" />
                    </div>
                    <div>
                        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Usage</h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Monitor your resource consumption</p>
                    </div>
                </div>

                <button
                    onClick={() => fetchUsage(true)}
                    disabled={loading || refreshing}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 rounded-xl transition-colors"
                >
                    <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                    Refresh
                </button>
            </div>

            {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {[1, 2].map((i) => (
                        <div key={i} className="h-32 bg-slate-100 dark:bg-slate-800 rounded-2xl animate-pulse" />
                    ))}
                </div>
            ) : error ? (
                <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {error}
                </div>
            ) : displayMetrics.length === 0 ? (
                <Card className="p-8 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-3">
                        <BarChart3 className="w-6 h-6 text-slate-400" />
                    </div>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400">No usage data available</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Usage metrics will appear here once available</p>
                </Card>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {displayMetrics.map((metric, i) => (
                        <motion.div
                            key={metric.key || i}
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.08 }}
                        >
                            <UsageBar
                                label={metric.label || METRIC_LABELS[metric.key] || metric.key}
                                icon={METRIC_ICONS[metric.key] || BarChart3}
                                used={metric.used ?? metric.current ?? 0}
                                limit={metric.limit ?? metric.max ?? 0}
                                resetDate={metric.resetDate}
                                description={metric.description || METRIC_DESCRIPTIONS[metric.key] || ''}
                            />
                        </motion.div>
                    ))}
                </div>
            )}

            {usage?.resetDate && !loading && (
                <p className="text-xs text-slate-400 dark:text-slate-500 text-center">
                    Usage period resets on {formatDate(usage.resetDate)}
                </p>
            )}
        </div>
    )
}
