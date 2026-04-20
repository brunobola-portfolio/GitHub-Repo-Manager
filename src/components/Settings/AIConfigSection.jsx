import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
    Sparkles, Check, X, AlertTriangle, Loader2,
    Info,
} from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { InsightCard } from '../ui/InsightCard'
import { ConfirmModal } from '../ui/ConfirmModal'
import { PROVIDER_DEFAULTS } from '../../utils/providerCapabilities'
import { PRICING_LAST_UPDATED } from '../../utils/providerPricing'

import { TEST_COOLDOWN_S, PROVIDERS_NEEDING_EMBEDDING_OVERRIDE } from './AIConfig/constants'
import { ProviderSelect } from './AIConfig/ProviderSelect'
import { ProviderFields } from './AIConfig/ProviderFields'
import { EmbeddingSection } from './AIConfig/EmbeddingSection'
import { PerFeatureOverrideSection } from './AIConfig/PerFeatureOverrideSection'
import { TestButton } from './AIConfig/TestButton'
import { CapabilityMatrix } from './AIConfig/CapabilityMatrix'

// ---------------------------------------------------------------------------
// Main: AIConfigSection
// ---------------------------------------------------------------------------

const EMPTY_FORM = {
    completionProvider: null,
    completionModel: '',
    completionApiKey: '',
    completionEndpointUrl: '',
    embeddingProvider: null,
    embeddingModel: '',
    embeddingApiKey: '',
    embeddingEndpointUrl: '',
    hasCompletionKey: false,
    hasEmbeddingKey: false,
    featureOverrides: {},
    serverFallbackAvailable: false,
}

export function AIConfigSection() {
    const [form, setForm] = useState(EMPTY_FORM)
    const [saved, setSaved] = useState(EMPTY_FORM)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [removing, setRemoving] = useState(false)
    const [errors, setErrors] = useState({})
    const [saveMessage, setSaveMessage] = useState(null)

    // Test connection state
    const [testing, setTesting] = useState(false)
    const [testResult, setTestResult] = useState(null)
    const [testCountdown, setTestCountdown] = useState(0)
    const [confirmRemove, setConfirmRemove] = useState(false)
    const countdownRef = useRef(null)

    // ---------------------------------------------------------------------------
    // Fetch config on mount
    // ---------------------------------------------------------------------------

    const fetchConfig = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch(`${API_BASE_URL}/api/user/ai-config`, {
                credentials: 'include',
            })
            if (!res.ok) throw new Error('Failed to load AI configuration')
            const data = await res.json()

            const loaded = {
                completionProvider: data.completionProvider ?? null,
                completionModel: data.completionModel ?? '',
                completionApiKey: '',  // never pre-filled from API
                completionEndpointUrl: '',
                embeddingProvider: data.embeddingProvider ?? null,
                embeddingModel: data.embeddingModel ?? '',
                embeddingApiKey: '',
                embeddingEndpointUrl: '',
                hasCompletionKey: data.hasCompletionKey ?? false,
                hasEmbeddingKey: data.hasEmbeddingKey ?? false,
                featureOverrides: data.featureOverrides ?? {},
                serverFallbackAvailable: data.serverFallbackAvailable ?? false,
            }
            setForm(loaded)
            setSaved(loaded)
        } catch {
            setSaveMessage({ type: 'error', text: 'Failed to load AI configuration.' })
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { fetchConfig() }, [fetchConfig])

    // ---------------------------------------------------------------------------
    // Form helpers
    // ---------------------------------------------------------------------------

    const handleFieldChange = useCallback((field, value) => {
        setForm((prev) => ({ ...prev, [field]: value }))
        setErrors((prev) => {
            if (!prev[field]) return prev
            const next = { ...prev }
            delete next[field]
            return next
        })
    }, [])

    const isDirty = JSON.stringify({
        completionProvider: form.completionProvider,
        completionModel: form.completionModel,
        completionApiKey: form.completionApiKey,
        completionEndpointUrl: form.completionEndpointUrl,
        embeddingProvider: form.embeddingProvider,
        embeddingModel: form.embeddingModel,
        embeddingApiKey: form.embeddingApiKey,
        embeddingEndpointUrl: form.embeddingEndpointUrl,
        featureOverrides: form.featureOverrides,
    }) !== JSON.stringify({
        completionProvider: saved.completionProvider,
        completionModel: saved.completionModel,
        completionApiKey: saved.completionApiKey,
        completionEndpointUrl: saved.completionEndpointUrl,
        embeddingProvider: saved.embeddingProvider,
        embeddingModel: saved.embeddingModel,
        embeddingApiKey: saved.embeddingApiKey,
        embeddingEndpointUrl: saved.embeddingEndpointUrl,
        featureOverrides: saved.featureOverrides,
    })

    // ---------------------------------------------------------------------------
    // Save
    // ---------------------------------------------------------------------------

    const handleSave = useCallback(async () => {
        setSaving(true)
        setSaveMessage(null)
        setErrors({})

        // Build body — only include fields that changed or are non-empty
        const body = {}
        if (form.completionProvider !== saved.completionProvider) body.completionProvider = form.completionProvider
        if (form.completionModel !== saved.completionModel) body.completionModel = form.completionModel || null
        if (form.completionApiKey !== '') body.completionApiKey = form.completionApiKey || null
        if (form.completionEndpointUrl !== '') body.completionEndpointUrl = form.completionEndpointUrl || null
        if (form.embeddingProvider !== saved.embeddingProvider) body.embeddingProvider = form.embeddingProvider
        if (form.embeddingModel !== saved.embeddingModel) body.embeddingModel = form.embeddingModel || null
        if (form.embeddingApiKey !== '') body.embeddingApiKey = form.embeddingApiKey || null
        if (form.embeddingEndpointUrl !== '') body.embeddingEndpointUrl = form.embeddingEndpointUrl || null
        if (JSON.stringify(form.featureOverrides) !== JSON.stringify(saved.featureOverrides)) {
            body.featureOverrides = form.featureOverrides
        }

        try {
            const res = await fetch(`${API_BASE_URL}/api/user/ai-config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body),
            })

            if (res.status === 204) {
                setSaveMessage({ type: 'success', text: 'AI configuration saved.' })
                await fetchConfig()
                return
            }

            const data = await res.json().catch(() => ({}))

            if (res.status === 400 && Array.isArray(data?.details)) {
                // Field-level validation errors from server's { details: [{ field, message }] } shape
                const fieldErrors = {}
                for (const item of data.details) {
                    if (item?.field && item?.message) {
                        fieldErrors[item.field] = item.message
                    }
                }
                if (Object.keys(fieldErrors).length > 0) {
                    setErrors(fieldErrors)
                    return
                }
            }

            throw new Error(data.error || data.message || 'Save failed')
        } catch (err) {
            setSaveMessage({ type: 'error', text: err.message || 'Something went wrong.' })
        } finally {
            setSaving(false)
        }
    }, [form, saved, fetchConfig])

    // ---------------------------------------------------------------------------
    // Remove
    // ---------------------------------------------------------------------------

    const handleRemove = useCallback(() => {
        // Opens the confirm modal; actual deletion runs in performRemove().
        setConfirmRemove(true)
    }, [])

    const performRemove = useCallback(async () => {
        setRemoving(true)
        setSaveMessage(null)
        // Note: we deliberately DON'T wrap this body in a try/catch — errors
        // propagate to ConfirmModal's handleConfirm, which populates its
        // own in-modal `confirmError` banner. The user stays on the modal
        // with the error visible inline and a Cancel escape hatch.
        // The `try/finally` (no catch) below makes sure setRemoving(false)
        // still fires on the error path without a useless catch clause.
        try {
            const res = await fetch(`${API_BASE_URL}/api/user/ai-config`, {
                method: 'DELETE',
                credentials: 'include',
            })
            if (!res.ok) throw new Error('Failed to remove configuration')
            setSaveMessage({ type: 'success', text: 'AI configuration removed.' })
            // Only close the modal on success. On failure, the rethrown error
            // keeps the modal open via ConfirmModal's catch path.
            setConfirmRemove(false)
            await fetchConfig()
        } finally {
            setRemoving(false)
        }
    }, [fetchConfig])

    // ---------------------------------------------------------------------------
    // Test connection
    // ---------------------------------------------------------------------------

    const startCountdown = useCallback(() => {
        setTestCountdown(TEST_COOLDOWN_S)
        if (countdownRef.current) clearInterval(countdownRef.current)
        countdownRef.current = setInterval(() => {
            setTestCountdown((prev) => {
                if (prev <= 1) {
                    clearInterval(countdownRef.current)
                    return 0
                }
                return prev - 1
            })
        }, 1000)
    }, [])

    useEffect(() => () => {
        if (countdownRef.current) clearInterval(countdownRef.current)
    }, [])

    const handleTest = useCallback(async () => {
        setTesting(true)
        setTestResult(null)
        try {
            const res = await fetch(`${API_BASE_URL}/api/user/ai-config/test`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ kind: 'completion' }),
            })

            if (res.status === 429) {
                const data = await res.json().catch(() => ({}))
                startCountdown()
                setTestResult({ ok: false, error: data.error || 'Rate limited. Please wait.' })
                return
            }

            const data = await res.json()
            setTestResult(data)
            startCountdown()
        } catch {
            setTestResult({ ok: false, error: 'Network error. Please try again.' })
        } finally {
            setTesting(false)
        }
    }, [startCountdown])

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------

    if (loading) {
        return (
            <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="h-28 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
                ))}
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-purple-500" />
                </div>
                <div>
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white">AI Configuration</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        Bring your own API key — overrides the server-wide provider
                    </p>
                </div>
            </div>

            {/* Server fallback indicator */}
            {form.serverFallbackAvailable && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-sm border bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700/50 text-amber-800 dark:text-amber-300">
                    <Info className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                        Currently using the server&apos;s shared AI key. Configure your own for private, metered usage.
                    </span>
                </div>
            )}

            {/* Completion Provider */}
            <InsightCard tone="ai" hover={false}>
                <div className="space-y-4">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Completion Provider
                    </label>

                    <ProviderSelect
                        value={form.completionProvider}
                        onChange={(v) => {
                            handleFieldChange('completionProvider', v)
                            // Reset model when switching providers
                            handleFieldChange('completionModel', '')
                        }}
                    />

                    <AnimatePresence mode="wait">
                        {form.completionProvider && (
                            <motion.div
                                key={form.completionProvider}
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                transition={{ duration: 0.15 }}
                            >
                                <ProviderFields
                                    provider={form.completionProvider}
                                    form={form}
                                    onChange={handleFieldChange}
                                    errors={errors}
                                />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </InsightCard>

            {/* Embedding Provider */}
            <AnimatePresence>
                {form.completionProvider && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                    >
                        <InsightCard tone="default" hover={false}>
                            <div className="space-y-3">
                                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                    Embedding Provider
                                    {!PROVIDERS_NEEDING_EMBEDDING_OVERRIDE.includes(form.completionProvider) && (
                                        <span className="ml-2 text-xs font-normal text-slate-400">(optional override)</span>
                                    )}
                                </label>
                                <EmbeddingSection form={form} onChange={handleFieldChange} />
                            </div>
                        </InsightCard>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Per-feature model overrides */}
            <AnimatePresence>
                {form.completionProvider && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                    >
                        <PerFeatureOverrideSection
                            featureOverrides={form.featureOverrides}
                            completionModel={form.completionModel || (PROVIDER_DEFAULTS[form.completionProvider]?.modelPlaceholder ?? '')}
                            onChange={handleFieldChange}
                        />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Test Connection */}
            <InsightCard tone="default" hover={false}>
                <div className="space-y-3">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Test Connection
                    </label>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        Verify your API key is valid and the provider responds correctly.
                    </p>
                    <TestButton
                        onTest={handleTest}
                        disabled={testing}
                        result={testResult}
                        countdown={testCountdown}
                    />
                </div>
            </InsightCard>

            {/* Save message */}
            <AnimatePresence>
                {saveMessage && (
                    <motion.p
                        role="status"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className={`text-sm font-medium flex items-center gap-1.5 ${
                            saveMessage.type === 'success'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-red-600 dark:text-red-400'
                        }`}
                    >
                        {saveMessage.type === 'success'
                            ? <Check className="w-4 h-4 shrink-0" />
                            : <AlertTriangle className="w-4 h-4 shrink-0" />}
                        {saveMessage.text}
                    </motion.p>
                )}
            </AnimatePresence>

            {/* Action Buttons */}
            <div className="flex items-center justify-between pt-1">
                <button
                    onClick={handleRemove}
                    disabled={removing}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors"
                >
                    <X className="w-4 h-4" />
                    {removing ? 'Removing...' : 'Remove Config'}
                </button>

                <button
                    onClick={handleSave}
                    disabled={saving || !isDirty}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-sm shadow-indigo-500/20 transition-all"
                >
                    {saving ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                        <Check className="w-4 h-4" />
                    )}
                    {saving ? 'Saving...' : 'Save'}
                </button>
            </div>

            {/* Capability Matrix */}
            <CapabilityMatrix activeProvider={form.completionProvider} />

            {/* Pricing disclaimer */}
            <p className="text-xs text-slate-400 dark:text-slate-500 text-center">
                Prices as of {PRICING_LAST_UPDATED} and informational only. We never meter LLM tokens — you pay your provider directly.
            </p>

            <ConfirmModal
                isOpen={confirmRemove}
                onClose={() => setConfirmRemove(false)}
                onConfirm={performRemove}
                title="Remove AI configuration?"
                message="This will clear your stored API keys for every provider. AI features will stop working until you add a key again. This cannot be undone."
                confirmText="Remove configuration"
                cancelText="Cancel"
                variant="danger"
                isLoading={removing}
            />
        </div>
    )
}
