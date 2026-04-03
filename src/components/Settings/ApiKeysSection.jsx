import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Key, Plus, Copy, Check, Trash2, Eye, EyeOff, AlertTriangle, X } from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'

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
    return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
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
            const body = { name: name.trim(), scopes, ...(expiry ? { expiresAt: expiry } : {}) }
            const res = await fetch(`${API_BASE_URL}/api/v1/api-keys`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.message || 'Failed to create API key')
            onCreated(data)
        } catch (err) {
            setError(err.message)
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
            <Card className="p-5 border-indigo-200/70 dark:border-indigo-700/50 bg-indigo-50/30 dark:bg-indigo-900/10">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                    <Key className="w-4 h-4 text-indigo-500" />
                    Create New API Key
                </h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                            Key Name
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. CI/CD Pipeline"
                            className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
                            Scopes
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            {SCOPE_OPTIONS.map((scope) => (
                                <label
                                    key={scope.id}
                                    className={`flex items-start gap-2 p-2.5 rounded-xl border cursor-pointer transition-all ${
                                        scopes.includes(scope.id)
                                            ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-400 dark:border-indigo-600'
                                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700'
                                    }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={scopes.includes(scope.id)}
                                        onChange={() => toggleScope(scope.id)}
                                        className="mt-0.5 accent-indigo-600"
                                    />
                                    <div>
                                        <p className="text-xs font-medium text-slate-800 dark:text-slate-200">{scope.label}</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">{scope.description}</p>
                                    </div>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                            Expiry Date <span className="text-slate-400">(optional)</span>
                        </label>
                        <input
                            type="date"
                            value={expiry}
                            onChange={(e) => setExpiry(e.target.value)}
                            min={new Date().toISOString().split('T')[0]}
                            className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition"
                        />
                    </div>

                    {error && (
                        <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            {error}
                        </p>
                    )}

                    <div className="flex gap-2 justify-end pt-1">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-sm transition-all"
                        >
                            {submitting ? 'Creating...' : 'Create Key'}
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
            // fallback
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
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:text-indigo-600 dark:hover:text-indigo-400'
                    }`}
                >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
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
            className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 bg-white dark:bg-slate-800/60 rounded-xl border border-slate-200/70 dark:border-slate-700/50 hover:border-indigo-200 dark:hover:border-indigo-800 transition-all"
        >
            <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{apiKey.name}</span>
                    <Badge variant={apiKey.status === 'active' ? 'success' : 'danger'}>
                        {apiKey.status}
                    </Badge>
                </div>
                <code className="text-xs text-slate-500 dark:text-slate-400 font-mono">{apiKey.prefix}</code>
                <div className="flex flex-wrap gap-1 mt-1">
                    {(apiKey.scopes || []).map((scope) => (
                        <Badge key={scope} variant={SCOPE_VARIANT_MAP[scope] || 'default'} className="text-xs">
                            {scope}
                        </Badge>
                    ))}
                </div>
                <div className="flex gap-4 text-xs text-slate-400 dark:text-slate-500">
                    <span>Created {formatDate(apiKey.createdAt)}</span>
                    <span>Last used {formatDate(apiKey.lastUsedAt)}</span>
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
                        disabled={apiKey.status === 'revoked'}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-colors"
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
    const [keys, setKeys] = useState([])
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
            setKeys(data.keys || data || [])
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { fetchKeys() }, [fetchKeys])

    const handleCreated = useCallback((data) => {
        setNewKeyData(data)
        setShowForm(false)
        fetchKeys()
    }, [fetchKeys])

    const handleRevoke = useCallback(async (id) => {
        const res = await fetch(`${API_BASE_URL}/api/v1/api-keys/${id}`, {
            method: 'DELETE',
            credentials: 'include',
        })
        if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            throw new Error(data.message || 'Failed to revoke key')
        }
        setKeys((prev) => prev.map((k) => k.id === id ? { ...k, status: 'revoked' } : k))
    }, [])

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
                        <Key className="w-5 h-5 text-indigo-500" />
                    </div>
                    <div>
                        <h2 className="text-base font-semibold text-slate-900 dark:text-white">API Keys</h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Manage programmatic access to the API</p>
                    </div>
                </div>
                {!showForm && !newKeyData && (
                    <button
                        onClick={() => setShowForm(true)}
                        className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm shadow-indigo-500/20 transition-all"
                    >
                        <Plus className="w-4 h-4" />
                        Create New Key
                    </button>
                )}
            </div>

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
                        <div key={i} className="h-24 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
                    ))}
                </div>
            ) : error ? (
                <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {error}
                </div>
            ) : keys.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                        <Key className="w-6 h-6 text-slate-400" />
                    </div>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400">No API keys yet</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Create your first key to get started</p>
                </div>
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
