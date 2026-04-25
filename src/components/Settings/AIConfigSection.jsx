import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
    Sparkles, Check, X, AlertTriangle, Loader2,
    Info,
} from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { fetchWithRetry } from '../../utils/api'
import { useToast } from '../../hooks/useToast'
import { ConfirmModal } from '../ui/ConfirmModal'
import { Skeleton } from '../ui/Skeleton'
import { PROVIDER_DEFAULTS } from '../../utils/providerCapabilities'
import { PRICING_LAST_UPDATED } from '../../utils/providerPricing'

import { TEST_COOLDOWN_S, PROVIDERS_NEEDING_EMBEDDING_OVERRIDE } from './AIConfig/constants'
import { ProviderSelect } from './AIConfig/ProviderSelect'
import { ProviderFields } from './AIConfig/ProviderFields'
import { EmbeddingSection } from './AIConfig/EmbeddingSection'
import { PerFeatureOverrideSection } from './AIConfig/PerFeatureOverrideSection'
import { TestButton } from './AIConfig/TestButton'
import { CapabilityMatrix } from './AIConfig/CapabilityMatrix'
import { CurrentConfigSummary } from './AIConfig/CurrentConfigSummary'
import { SectionHeader } from './AIConfig/SectionHeader'

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
    updatedAt: null,
}

export function AIConfigSection() {
    const { toast } = useToast()
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
                updatedAt: data.updatedAt ?? null,
            }
            setForm(loaded)
            setSaved(loaded)
        } catch {
            setSaveMessage({ type: 'error', text: 'Failed to load AI configuration.' })
        } finally {
            setLoading(false)
        }
    }, [])

    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time config load on mount; fetchConfig is stable (useCallback, [] deps)
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
            // fetchWithRetry returns the Response on 2xx; throws ApiError on non-2xx.
            await fetchWithRetry(`${API_BASE_URL}/api/user/ai-config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body),
            })

            setSaveMessage({ type: 'success', text: 'AI configuration saved.' })
            toast.success('AI configuration saved')
            await fetchConfig()
        } catch (err) {
            // Field-level validation errors — ApiError.data holds the JSON body
            if (err?.type === 'VALIDATION' && Array.isArray(err?.data?.details)) {
                const fieldErrors = {}
                for (const item of err.data.details) {
                    if (item?.field && item?.message) {
                        fieldErrors[item.field] = item.message
                    }
                }
                if (Object.keys(fieldErrors).length > 0) {
                    setErrors(fieldErrors)
                    toast.error('Fix the highlighted fields and try again')
                    return
                }
            }
            setSaveMessage({ type: 'error', text: err?.userMessage || err?.message || 'Something went wrong.' })
            toast.error(`Failed to save AI configuration — ${err?.message || 'try again'}`)
        } finally {
            setSaving(false)
        }
    }, [form, saved, fetchConfig, toast])

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
            await fetchWithRetry(`${API_BASE_URL}/api/user/ai-config`, {
                method: 'DELETE',
                credentials: 'include',
            })
            // fetchWithRetry throws ApiError on non-2xx — reaching here means success.
            setSaveMessage({ type: 'success', text: 'AI configuration removed.' })
            toast.success('AI configuration removed')
            // Only close the modal on success. On failure, the rethrown error
            // keeps the modal open via ConfirmModal's catch path.
            setConfirmRemove(false)
            await fetchConfig()
        } finally {
            setRemoving(false)
        }
    }, [fetchConfig, toast])

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
            const res = await fetchWithRetry(`${API_BASE_URL}/api/user/ai-config/test`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ kind: 'completion' }),
            })

            const data = await res.json()
            setTestResult(data)
            startCountdown()
            if (data?.ok) {
                toast.success('Provider responded successfully')
            } else if (data?.error) {
                toast.error(`Test failed — ${data.error}`)
            }
        } catch (err) {
            // fetchWithRetry throws ApiError for non-2xx responses (e.g. 429 RATE_LIMIT).
            // Detect rate-limit specifically so we can show the countdown UI.
            if (err?.type === 'RATE_LIMIT') {
                startCountdown()
                const message = err?.data?.error || 'Rate limited. Please wait.'
                setTestResult({ ok: false, error: message })
                toast.warning('Rate limited — please wait before retrying')
            } else {
                setTestResult({ ok: false, error: 'Network error. Please try again.' })
                toast.error('Network error — try again')
            }
        } finally {
            setTesting(false)
        }
    }, [startCountdown, toast])

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------

    if (loading) {
        return (
            <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                    <Skeleton key={i} variant="card" className="h-28" />
                ))}
            </div>
        )
    }

    const hasKeyStored = form.hasCompletionKey || form.hasEmbeddingKey

    return (
        <div className="space-y-5">
            {/* Editorial header */}
            <header className="relative flex items-start gap-4 pb-1">
                <span
                    aria-hidden="true"
                    className="absolute -left-1 top-1 bottom-1 w-0.5 rounded-full bg-gradient-to-b from-indigo-500 via-purple-500 to-pink-500 opacity-80"
                />
                <div className="pl-3 flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-indigo-600 dark:text-indigo-300">
                        <Sparkles className="w-3 h-3" aria-hidden="true" />
                        AI Workspace
                    </div>
                    <h2 className="mt-1 text-lg font-bold tracking-tight text-slate-900 dark:text-white ds-font-display">
                        Bring your own AI
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 max-w-lg">
                        Connect your own provider API key. Your choices override the server default and stay private to your account.
                    </p>
                </div>
            </header>

            {/* Shared-key banner — premium hairline-gradient */}
            {form.serverFallbackAvailable && !hasKeyStored && (
                <div className="relative rounded-2xl p-[1px] bg-gradient-to-br from-amber-400/40 via-amber-500/20 to-transparent">
                    <div className="flex items-start gap-3 rounded-2xl bg-amber-50/80 dark:bg-amber-900/10 backdrop-blur-xl px-3.5 py-3">
                        <div className="w-8 h-8 shrink-0 rounded-lg bg-amber-500/15 ring-1 ring-inset ring-amber-500/30 flex items-center justify-center">
                            <Info className="w-4 h-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                        </div>
                        <div className="flex-1 min-w-0 text-sm text-amber-900 dark:text-amber-200">
                            <div className="font-semibold">
                                Currently using the server&apos;s shared AI key. Configure your own for private, metered usage.
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_18rem] gap-5 lg:items-start">
                {/* ─────────── Left column: configuration form ─────────── */}
                <div className="space-y-4 min-w-0">
                    {/* 01 — Completion provider */}
                    <section className="rounded-2xl bg-gradient-to-br from-indigo-500/[0.03] via-purple-500/[0.02] to-transparent dark:from-indigo-500/[0.05] dark:via-purple-500/[0.03] ring-1 ring-inset ring-indigo-500/15 dark:ring-indigo-500/20 p-4">
                        <SectionHeader
                            step={1}
                            title="Completion provider"
                            description="Choose where completions are generated."
                        />
                        <div className="space-y-3">
                            <ProviderSelect
                                value={form.completionProvider}
                                onChange={(v) => {
                                    handleFieldChange('completionProvider', v)
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
                    </section>

                    {/* 02 — Embedding provider */}
                    <AnimatePresence>
                        {form.completionProvider && (
                            <motion.section
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.2 }}
                                className="rounded-2xl bg-white/60 dark:bg-slate-900/50 ring-1 ring-inset ring-slate-200/70 dark:ring-slate-800 p-4 overflow-hidden"
                            >
                                <SectionHeader
                                    step={2}
                                    title="Embedding provider"
                                    description={
                                        PROVIDERS_NEEDING_EMBEDDING_OVERRIDE.includes(form.completionProvider)
                                            ? 'Required — your completion provider has no native embeddings.'
                                            : 'Optional override — only if you want a different provider for semantic search.'
                                    }
                                />
                                <EmbeddingSection form={form} onChange={handleFieldChange} />
                            </motion.section>
                        )}
                    </AnimatePresence>

                    {/* 03 — Per-feature overrides */}
                    <AnimatePresence>
                        {form.completionProvider && (
                            <motion.section
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.2 }}
                                className="overflow-hidden"
                            >
                                <PerFeatureOverrideSection
                                    featureOverrides={form.featureOverrides}
                                    completionModel={form.completionModel || (PROVIDER_DEFAULTS[form.completionProvider]?.modelPlaceholder ?? '')}
                                    completionProvider={form.completionProvider}
                                    embeddingProvider={form.embeddingProvider}
                                    onChange={handleFieldChange}
                                />
                            </motion.section>
                        )}
                    </AnimatePresence>

                    {/* 04 — Test connection */}
                    <AnimatePresence>
                        {form.completionProvider && (
                            <motion.section
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.2 }}
                                className="rounded-2xl bg-white/60 dark:bg-slate-900/50 ring-1 ring-inset ring-slate-200/70 dark:ring-slate-800 p-4 overflow-hidden"
                            >
                                <SectionHeader
                                    step={4}
                                    title="Test connection"
                                    description="Verify your API key is valid and the provider responds correctly."
                                />
                                <TestButton
                                    onTest={handleTest}
                                    disabled={testing}
                                    result={testResult}
                                    countdown={testCountdown}
                                    isDirty={isDirty}
                                />
                            </motion.section>
                        )}
                    </AnimatePresence>

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

                    {/* Action bar — sticky on mobile for thumb-reach */}
                    <div className="sticky bottom-0 -mx-4 px-4 pb-2 pt-3 bg-gradient-to-t from-white via-white/95 to-white/0 dark:from-slate-900 dark:via-slate-900/95 dark:to-slate-900/0 lg:static lg:mx-0 lg:px-0 lg:pt-2 lg:pb-0 lg:bg-none">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                            {hasKeyStored ? (
                                <button
                                    onClick={handleRemove}
                                    disabled={removing}
                                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors"
                                >
                                    <X className="w-4 h-4" />
                                    {removing ? 'Removing…' : 'Remove config'}
                                </button>
                            ) : <span />}

                            <button
                                onClick={handleSave}
                                disabled={saving || !isDirty}
                                className="ds-btn-shimmer inline-flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:from-slate-400 disabled:to-slate-500 disabled:shadow-none disabled:cursor-not-allowed rounded-xl shadow-lg shadow-indigo-500/25 transition-all"
                            >
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                {saving ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* ─────────── Right rail: summary + capabilities ─────────── */}
                <aside className="space-y-4 lg:sticky lg:top-2">
                    <CurrentConfigSummary form={form} />
                    <CapabilityMatrix activeProvider={form.completionProvider} />
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
                        Prices as of {PRICING_LAST_UPDATED}, informational only. We never meter LLM tokens — you pay your provider directly.
                    </p>
                </aside>
            </div>

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
