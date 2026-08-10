import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Key, Plus, Trash2, AlertTriangle, Shield } from 'lucide-react'
import { AnimatedCopyIcon } from '../ui/AnimatedCopyIcon'
import { API_BASE_URL } from '../../config'
import { useToast } from '../../hooks/useToast'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { Skeleton } from '../ui/Skeleton'
import { Field, Input } from '../ui/form'
import { PanelHeader } from '../ui/PanelHeader'
import { RowIconBadge } from '../ui/RowIconBadge'
import { formatDate as formatDateBase } from '../../utils/format'
import { apiCall } from '../../utils/api'

const SCOPE_OPTIONS = [
    { id: 'read', label: 'Read', description: 'Read access to repositories and data' },
    { id: 'write', label: 'Write', description: 'Create and modify resources' },
    { id: 'admin', label: 'Admin', description: 'Administrative operations' },
    { id: 'ai', label: 'AI', description: 'Access AI features and queries' },
]

const SCOPE_VARIANT_MAP = {
    read: 'info',
    write: 'success',
    admin: 'danger',
    ai: 'warning',
}

function formatDate(dateStr) {
    if (!dateStr) return 'Never'
    return formatDateBase(dateStr, { year: 'numeric', month: 'short', day: 'numeric' })
}

function UsageMeter({ current, max, tier }) {
    if (max === undefined || max === null) return null
    const isUnlimited = max === Infinity || max > 1000
    const pct = isUnlimited ? 0 : Math.min((current / max) * 100, 100)
    const isNearLimit = !isUnlimited && pct >= 80

    return (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/50 dark:border-slate-700/40">
            <Shield className="w-4 h-4 text-slate-400 shrink-0" />
            <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-600 dark:text-slate-300 font-medium">
                        {current} / {isUnlimited ? 'Unlimited' : max} active keys
                    </span>
                    <Badge variant={isNearLimit ? 'warning' : 'default'} className="ds-text-micro">
                        {tier}
                    </Badge>
                </div>
                {!isUnlimited && (
                    <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all ${
                                isNearLimit ? 'bg-amber-500' : 'bg-brand-500'
                            }`}
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                )}
            </div>
        </div>
    )
}

function NewKeyForm({ onCreated, onCancel }) {
    const [name, setName] = useState('')
    const [scopes, setScopes] = useState(['read'])
    const [expiry, setExpiry] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState(null)

    const toggleScope = (scope) => {
        setScopes((prev) =>
            prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
        )
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        if (!name.trim()) { setError('Name is required'); return }
        if (scopes.length === 0) { setError('Select at least one scope'); return }
        setSubmitting(true)
        setError(null)
        try {
            const body = { name: name.trim(), scopes, ...(expiry ? { expires_at: new Date(expiry).toISOString() } : {}) }
            // apiCall injects+rotates the CSRF token and parses the body; the
            // server error stays reachable via err.data on a thrown ApiError.
            const data = await apiCall(`${API_BASE_URL}/api/v1/api-keys`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
            onCreated(data)
        } catch (err) {
            setError(err?.data?.error || err?.data?.message || err?.message || 'Failed to create API key')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
        >
            <Card className="p-5 border-brand-200/70 dark:border-brand-700/50 bg-brand-50/30 dark:bg-brand-900/10">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                    <Key className="w-4 h-4 text-brand-500" />
                    Create New API Key
                </h3>
                <form onSubmit={handleSubmit} className="space-y-5">
                    <Field
                        label="Key Name"
                        htmlFor="api-key-name"
                        error={error && error.toLowerCase().includes('name') ? error : undefined}
                    >
                        <Input
                            id="api-key-name"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. CI/CD Pipeline"
                            autoComplete="off"
                        />
                    </Field>

                    <fieldset>
                        <legend className="text-[13px] font-semibold text-slate-700 dark:text-slate-200 mb-2">
                            Scopes
                        </legend>
                        <div className="grid grid-cols-2 gap-2">
                            {SCOPE_OPTIONS.map((scope) => {
                                const checked = scopes.includes(scope.id)
                                return (
                                    <label
                                        key={scope.id}
                                        htmlFor={`scope-${scope.id}`}
                                        aria-label={scope.label}
                                        className={`group flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
                                            checked
                                                ? 'bg-brand-50 dark:bg-brand-500/10 border-brand-300 dark:border-brand-500/40 shadow-sm'
                                                : 'bg-white dark:bg-slate-900/40 border-slate-200 dark:border-slate-700 hover:border-brand-300 dark:hover:border-brand-500/40'
                                        }`}
                                    >
                                        <input
                                            id={`scope-${scope.id}`}
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => toggleScope(scope.id)}
                                            className="mt-0.5 w-4 h-4 accent-brand-600 cursor-pointer ds-focus-ring rounded"
                                        />
                                        <div className="min-w-0">
                                            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{scope.label}</p>
                                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{scope.description}</p>
                                        </div>
                                    </label>
                                )
                            })}
                        </div>
                    </fieldset>

                    <Field label="Expiry Date" optional htmlFor="api-key-expiry">
                        <Input
                            id="api-key-expiry"
                            type="date"
                            value={expiry}
                            onChange={(e) => setExpiry(e.target.value)}
                            min={new Date().toISOString().split('T')[0]}
                        />
                    </Field>

                    {error && !error.toLowerCase().includes('name') && (
                        <p className="text-xs font-medium text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            {error}
                        </p>
                    )}

                    <div className="flex gap-2 justify-end pt-1">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="px-3.5 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors ds-focus-ring"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="px-4 py-2 text-sm font-semibold ds-brand-solid disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-sm transition-colors ds-focus-ring"
                        >
                            {submitting ? 'Creating…' : 'Create Key'}
                        </button>
                    </div>
                </form>
            </Card>
        </motion.div>
    )
}

function NewKeyReveal({ keyData, onDismiss }) {
    const [copied, setCopied] = useState(false)

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(keyData.key)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch {
            // clipboard API not available
        }
    }, [keyData.key])

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-2xl border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 p-5 space-y-3"
        >
            <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div>
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Save your API key now</p>
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                        This key will not be shown again. Copy it and store it somewhere safe.
                    </p>
                </div>
            </div>

            <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800/50 rounded-xl px-3 py-2.5">
                <code className="flex-1 text-xs font-mono text-slate-700 dark:text-slate-200 break-all select-all">
                    {keyData.key}
                </code>
                <button
                    onClick={handleCopy}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                        copied
                            ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-brand-50 dark:hover:bg-brand-900/30 hover:text-brand-600 dark:hover:text-brand-400'
                    }`}
                >
                    <AnimatedCopyIcon copied={copied} />
                    {copied ? 'Copied!' : 'Copy'}
                </button>
            </div>

            <button
                onClick={onDismiss}
                className="w-full py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
                I've saved the key
            </button>
        </motion.div>
    )
}

function KeyRow({ apiKey, onRevoke }) {
    const [confirming, setConfirming] = useState(false)
    const [revoking, setRevoking] = useState(false)

    const scopes = typeof apiKey.scopes === 'string'
        ? (() => { try { return JSON.parse(apiKey.scopes) } catch { return [] } })()
        : Array.isArray(apiKey.scopes) ? apiKey.scopes : []

    const isRevoked = !!apiKey.revoked_at
    const status = isRevoked ? 'revoked' : 'active'

    const handleRevoke = useCallback(async () => {
        setRevoking(true)
        try {
            await onRevoke(apiKey.id)
        } finally {
            setRevoking(false)
            setConfirming(false)
        }
    }, [apiKey.id, onRevoke])

    return (
        <motion.div
            layout
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 bg-white dark:bg-slate-800/60 rounded-xl border border-slate-200/70 dark:border-slate-700/50 hover:border-brand-200 dark:hover:border-brand-800 transition-all"
        >
            <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{apiKey.name}</span>
                    <Badge variant={status === 'active' ? 'success' : 'danger'}>
                        {status}
                    </Badge>
                </div>
                <code className="text-xs text-slate-500 dark:text-slate-400 font-mono">{apiKey.key_prefix || apiKey.prefix}</code>
                <div className="flex flex-wrap gap-1 mt-1">
                    {scopes.map((scope) => (
                        <Badge key={scope} variant={SCOPE_VARIANT_MAP[scope] || 'default'} className="text-xs">
                            {scope}
                        </Badge>
                    ))}
                </div>
                <div className="flex gap-4 text-xs text-slate-500 dark:text-slate-400">
                    <span>Created {formatDate(apiKey.created_at || apiKey.createdAt)}</span>
                    <span>Last used {formatDate(apiKey.last_used_at || apiKey.lastUsedAt)}</span>
                    {apiKey.last_used_ip && <span>IP: {apiKey.last_used_ip}</span>}
                </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
                {confirming ? (
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs text-red-600 dark:text-red-400">Revoke key?</span>
                        <button
                            onClick={handleRevoke}
                            disabled={revoking}
                            className="px-2.5 py-1 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg transition-colors"
                        >
                            {revoking ? 'Revoking...' : 'Yes'}
                        </button>
                        <button
                            onClick={() => setConfirming(false)}
                            className="px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors"
                        >
                            No
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={() => setConfirming(true)}
                        disabled={isRevoked}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-colors"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                        Revoke
                    </button>
                )}
            </div>
        </motion.div>
    )
}

export function ApiKeysSection() {
    const { toast } = useToast()
    const [keys, setKeys] = useState([])
    const [limits, setLimits] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [showForm, setShowForm] = useState(false)
    const [newKeyData, setNewKeyData] = useState(null)

    const fetchKeys = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch(`${API_BASE_URL}/api/v1/api-keys`, { credentials: 'include' })
            if (!res.ok) throw new Error('Failed to load API keys')
            const data = await res.json()

            // Support both old (flat array) and new ({ keys, limits }) response shapes
            if (Array.isArray(data)) {
                setKeys(data)
            } else {
                setKeys(Array.isArray(data?.keys) ? data.keys : [])
                if (data?.limits) setLimits(data.limits)
            }
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }, [])

    /* eslint-disable react-hooks/set-state-in-effect -- mount-time fetch + state seed */
    useEffect(() => { fetchKeys() }, [fetchKeys])
    /* eslint-enable react-hooks/set-state-in-effect */

    const handleCreated = useCallback((data) => {
        setNewKeyData(data)
        setShowForm(false)
        toast.success('API key created')
        fetchKeys()
    }, [fetchKeys, toast])

    const handleRevoke = useCallback(async (id) => {
        try {
            await apiCall(`${API_BASE_URL}/api/v1/api-keys/${id}`, { method: 'DELETE' })
        } catch (err) {
            const msg = err?.data?.error || err?.data?.message || err?.message || 'Failed to revoke key'
            toast.error(msg)
            throw err
        }
        toast.success('API key revoked')
        fetchKeys()
    }, [fetchKeys, toast])

    const atLimit = limits && limits.max !== undefined && limits.max !== Infinity && limits.current >= limits.max

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-start gap-3">
                <RowIconBadge icon={Key} tone="indigo" size="lg" surface="soft" />
                <PanelHeader
                    className="flex-1"
                    title="API Keys"
                    description="Manage programmatic access to the API"
                    actions={!showForm && !newKeyData && (
                        <button
                            onClick={() => setShowForm(true)}
                            disabled={atLimit}
                            className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium ds-brand-solid disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-sm transition-all"
                            title={atLimit ? `Limit reached (${limits.max}). Upgrade your plan.` : 'Create a new API key'}
                        >
                            <Plus className="w-4 h-4" />
                            Create New Key
                        </button>
                    )}
                />
            </div>

            {/* Usage meter */}
            {limits && (
                <UsageMeter current={limits.current} max={limits.max} tier={limits.tier} />
            )}

            <AnimatePresence mode="wait">
                {newKeyData && (
                    <NewKeyReveal
                        key="reveal"
                        keyData={newKeyData}
                        onDismiss={() => setNewKeyData(null)}
                    />
                )}
                {showForm && !newKeyData && (
                    <NewKeyForm
                        key="form"
                        onCreated={handleCreated}
                        onCancel={() => setShowForm(false)}
                    />
                )}
            </AnimatePresence>

            {/* Keys List */}
            {loading ? (
                <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                        <Skeleton key={i} variant="card" className="h-24" />
                    ))}
                </div>
            ) : error ? (
                <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {error}
                </div>
            ) : keys.length === 0 ? (
                <EmptyState
                    icon={Key}
                    title="No API keys yet"
                    description="Create your first key to get started"
                />
            ) : (
                <AnimatePresence>
                    <div className="space-y-3">
                        {keys.map((apiKey) => (
                            <KeyRow key={apiKey.id} apiKey={apiKey} onRevoke={handleRevoke} />
                        ))}
                    </div>
                </AnimatePresence>
            )}
        </div>
    )
}
