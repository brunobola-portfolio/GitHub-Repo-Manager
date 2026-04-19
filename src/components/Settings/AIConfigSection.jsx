import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
    Sparkles, Check, X, AlertTriangle, Loader2,
    ExternalLink, ChevronDown, Cpu,
} from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { InsightCard } from '../ui/InsightCard'
import {
    PROVIDER_IDS,
    PROVIDER_LABELS,
    PROVIDER_CAPABILITIES,
    FEATURE_LABELS,
    PROVIDER_DEFAULTS,
} from '../../utils/providerCapabilities'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_COOLDOWN_S = 10

// Providers that lack native embeddings → show embedding override section
const PROVIDERS_NEEDING_EMBEDDING_OVERRIDE = ['anthropic', 'openrouter']

// ---------------------------------------------------------------------------
// Shared input classes
// ---------------------------------------------------------------------------

const INPUT_CLS =
    'w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-xl ' +
    'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 ' +
    'placeholder-slate-400 dark:placeholder-slate-500 ' +
    'focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition'

const LABEL_CLS = 'block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1'

// ---------------------------------------------------------------------------
// Sub-component: ProviderSelect
// ---------------------------------------------------------------------------

function ProviderSelect({ value, onChange }) {
    return (
        <div className="relative">
            <select
                value={value ?? ''}
                onChange={(e) => onChange(e.target.value || null)}
                className={`${INPUT_CLS} pr-8 appearance-none cursor-pointer`}
                aria-label="Completion provider"
            >
                <option value="">— Select a provider —</option>
                {PROVIDER_IDS.map((id) => (
                    <option key={id} value={id}>{PROVIDER_LABELS[id]}</option>
                ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
    )
}

// ---------------------------------------------------------------------------
// Sub-component: ProviderFields
// ---------------------------------------------------------------------------

function ProviderFields({ provider, form, onChange, errors }) {
    if (!provider) return null
    const defaults = PROVIDER_DEFAULTS[provider]
    if (!defaults) return null

    return (
        <div className="space-y-3">
            {/* API Key */}
            {(defaults.apiKeyRequired || provider !== 'local') && (
                <div>
                    <label htmlFor="completion-api-key" className={LABEL_CLS}>{defaults.apiKeyLabel}</label>
                    <input
                        id="completion-api-key"
                        type="password"
                        value={form.completionApiKey ?? ''}
                        onChange={(e) => onChange('completionApiKey', e.target.value)}
                        placeholder={
                            form.hasCompletionKey && form.completionApiKey === ''
                                ? '•••••••• (leave empty to keep current)'
                                : defaults.apiKeyPlaceholder
                        }
                        className={`${INPUT_CLS} ${errors.completionApiKey ? 'border-red-400 dark:border-red-500 focus:ring-red-500' : ''}`}
                        autoComplete="off"
                    />
                    {errors.completionApiKey && (
                        <p role="alert" aria-live="polite" className="mt-1 text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            {errors.completionApiKey}
                        </p>
                    )}
                </div>
            )}

            {/* Endpoint URL (Local only) */}
            {defaults.showEndpointUrl && (
                <div>
                    <label htmlFor="completion-endpoint-url" className={LABEL_CLS}>Endpoint URL</label>
                    <input
                        id="completion-endpoint-url"
                        type="url"
                        value={form.completionEndpointUrl ?? ''}
                        onChange={(e) => onChange('completionEndpointUrl', e.target.value)}
                        placeholder={defaults.endpointPlaceholder}
                        className={INPUT_CLS}
                    />
                </div>
            )}

            {/* Model override */}
            <div>
                <label htmlFor="completion-model" className={LABEL_CLS}>Model</label>
                <input
                    id="completion-model"
                    type="text"
                    value={form.completionModel ?? ''}
                    onChange={(e) => onChange('completionModel', e.target.value)}
                    placeholder={defaults.modelPlaceholder}
                    className={INPUT_CLS}
                />
                {defaults.modelHelp && (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {defaults.modelHelpUrl ? (
                            <a
                                href={defaults.modelHelpUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 text-indigo-600 dark:text-indigo-400 hover:underline"
                            >
                                {defaults.modelHelp}
                                <ExternalLink className="w-3 h-3" />
                            </a>
                        ) : defaults.modelHelp}
                    </p>
                )}
            </div>

            {/* Help text */}
            {defaults.helpText && (
                <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 rounded-lg px-3 py-2">
                    {defaults.helpText}
                </p>
            )}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Sub-component: EmbeddingSection
// ---------------------------------------------------------------------------

function EmbeddingSection({ form, onChange }) {
    const [showOverride, setShowOverride] = useState(
        !!form.embeddingProvider
    )

    const needsEmbedding = PROVIDERS_NEEDING_EMBEDDING_OVERRIDE.includes(form.completionProvider)

    if (!needsEmbedding && !showOverride) {
        return (
            <div className="flex items-center gap-2">
                <input
                    type="checkbox"
                    id="emb-override"
                    checked={false}
                    onChange={(e) => setShowOverride(e.target.checked)}
                    className="accent-indigo-600"
                />
                <label
                    htmlFor="emb-override"
                    className="text-xs text-slate-500 dark:text-slate-400 cursor-pointer select-none"
                >
                    Override embedding provider
                </label>
            </div>
        )
    }

    return (
        <div className="space-y-3">
            {!needsEmbedding && (
                <div className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        id="emb-override"
                        checked={showOverride}
                        onChange={(e) => {
                            setShowOverride(e.target.checked)
                            if (!e.target.checked) {
                                onChange('embeddingProvider', null)
                                onChange('embeddingApiKey', null)
                                onChange('embeddingModel', null)
                            }
                        }}
                        className="accent-indigo-600"
                    />
                    <label
                        htmlFor="emb-override"
                        className="text-xs text-slate-500 dark:text-slate-400 cursor-pointer select-none"
                    >
                        Override embedding provider
                    </label>
                </div>
            )}

            <div>
                <label htmlFor="embedding-provider" className={LABEL_CLS}>Embedding Provider</label>
                <div className="relative">
                    <select
                        id="embedding-provider"
                        value={form.embeddingProvider ?? ''}
                        onChange={(e) => onChange('embeddingProvider', e.target.value || null)}
                        className={`${INPUT_CLS} pr-8 appearance-none cursor-pointer`}
                    >
                        <option value="">— Select embedding provider —</option>
                        {PROVIDER_IDS.filter((id) => PROVIDER_CAPABILITIES[id]?.semanticSearch === 'yes').map((id) => (
                            <option key={id} value={id}>{PROVIDER_LABELS[id]}</option>
                        ))}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
            </div>

            {form.embeddingProvider && (
                <>
                    <div>
                        <label htmlFor="embedding-api-key" className={LABEL_CLS}>
                            {PROVIDER_DEFAULTS[form.embeddingProvider]?.apiKeyLabel ?? 'API Key'}
                        </label>
                        <input
                            id="embedding-api-key"
                            type="password"
                            value={form.embeddingApiKey ?? ''}
                            onChange={(e) => onChange('embeddingApiKey', e.target.value)}
                            placeholder={
                                form.hasEmbeddingKey && form.embeddingApiKey === ''
                                    ? '•••••••• (leave empty to keep current)'
                                    : (PROVIDER_DEFAULTS[form.embeddingProvider]?.apiKeyPlaceholder ?? '')
                            }
                            className={INPUT_CLS}
                            autoComplete="off"
                        />
                    </div>
                    <div>
                        <label htmlFor="embedding-model" className={LABEL_CLS}>Embedding Model</label>
                        <input
                            id="embedding-model"
                            type="text"
                            value={form.embeddingModel ?? ''}
                            onChange={(e) => onChange('embeddingModel', e.target.value)}
                            placeholder={
                                form.embeddingProvider === 'openai'
                                    ? 'text-embedding-3-small'
                                    : form.embeddingProvider === 'gemini'
                                    ? 'gemini-embedding-001'
                                    : 'embedding-model'
                            }
                            className={INPUT_CLS}
                        />
                    </div>
                </>
            )}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Sub-component: TestButton
// ---------------------------------------------------------------------------

function TestButton({ onTest, disabled, result, countdown }) {
    return (
        <div className="space-y-2">
            <button
                onClick={onTest}
                disabled={disabled || countdown > 0}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 border border-indigo-200 dark:border-indigo-700/50 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {disabled && !countdown ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                    <Sparkles className="w-4 h-4" />
                )}
                {countdown > 0
                    ? `Test Connection (${countdown}s)`
                    : 'Test Connection'}
            </button>

            <AnimatePresence>
                {result && (
                    <motion.div
                        key="result"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className={`flex items-start gap-2 px-3 py-2.5 rounded-xl text-sm border ${
                            result.ok
                                ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700/50 text-emerald-800 dark:text-emerald-300'
                                : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700/50 text-red-800 dark:text-red-300'
                        }`}
                    >
                        {result.ok
                            ? <Check className="w-4 h-4 shrink-0 mt-0.5" />
                            : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
                        <span>
                            {result.ok
                                ? `Connected! ${result.latencyMs ? `${result.latencyMs}ms` : ''}${result.modelUsed ? ` · ${result.modelUsed}` : ''}`
                                : result.error}
                        </span>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Sub-component: CapabilityMatrix
// ---------------------------------------------------------------------------

function CapabilityMatrix({ activeProvider }) {
    const features = Object.keys(FEATURE_LABELS)

    return (
        <InsightCard tone="default" hover={false}>
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-slate-400" />
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Provider Capabilities
                    </span>
                </div>
                <div className="overflow-x-auto -mx-1">
                    <table className="w-full text-xs">
                        <thead>
                            <tr>
                                <th className="text-left py-1.5 pr-3 font-medium text-slate-500 dark:text-slate-400 w-32">
                                    Provider
                                </th>
                                {features.map((f) => (
                                    <th
                                        key={f}
                                        className="text-center py-1.5 px-2 font-medium text-slate-500 dark:text-slate-400"
                                    >
                                        {FEATURE_LABELS[f]}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {PROVIDER_IDS.map((pid) => {
                                const isActive = pid === activeProvider
                                return (
                                    <tr
                                        key={pid}
                                        className={`border-t border-slate-100 dark:border-slate-800 ${
                                            isActive
                                                ? 'bg-indigo-50/60 dark:bg-indigo-900/20'
                                                : ''
                                        }`}
                                    >
                                        <td className={`py-1.5 pr-3 font-medium ${
                                            isActive
                                                ? 'text-indigo-700 dark:text-indigo-300'
                                                : 'text-slate-600 dark:text-slate-400'
                                        }`}>
                                            {PROVIDER_LABELS[pid]}
                                            {isActive && (
                                                <span className="ml-1.5 text-[10px] font-semibold text-indigo-500 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-900/40 px-1.5 py-0.5 rounded-full">
                                                    active
                                                </span>
                                            )}
                                        </td>
                                        {features.map((f) => {
                                            const cap = PROVIDER_CAPABILITIES[pid]?.[f]
                                            return (
                                                <td key={f} className="text-center py-1.5 px-2">
                                                    {cap === 'yes' ? (
                                                        <Check className="w-3.5 h-3.5 text-emerald-500 mx-auto" />
                                                    ) : cap === 'depends' ? (
                                                        <span
                                                            className="inline-block text-xs font-semibold text-amber-500 leading-none"
                                                            aria-label="depends on configuration"
                                                            title="Depends on configuration"
                                                        >~</span>
                                                    ) : (
                                                        <X className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 mx-auto" />
                                                    )}
                                                </td>
                                            )
                                        })}
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
                {activeProvider && PROVIDER_CAPABILITIES[activeProvider]?.semanticSearch !== 'yes' && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                        Semantic search requires an embedding provider. Configure one above or switch to Gemini / OpenAI.
                    </p>
                )}
            </div>
        </InsightCard>
    )
}

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
    }) !== JSON.stringify({
        completionProvider: saved.completionProvider,
        completionModel: saved.completionModel,
        completionApiKey: saved.completionApiKey,
        completionEndpointUrl: saved.completionEndpointUrl,
        embeddingProvider: saved.embeddingProvider,
        embeddingModel: saved.embeddingModel,
        embeddingApiKey: saved.embeddingApiKey,
        embeddingEndpointUrl: saved.embeddingEndpointUrl,
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

    const handleRemove = useCallback(async () => {
        if (!window.confirm('Remove all AI configuration? This will clear your stored API keys.')) return
        setRemoving(true)
        setSaveMessage(null)
        try {
            const res = await fetch(`${API_BASE_URL}/api/user/ai-config`, {
                method: 'DELETE',
                credentials: 'include',
            })
            if (!res.ok) throw new Error('Failed to remove configuration')
            setSaveMessage({ type: 'success', text: 'AI configuration removed.' })
            await fetchConfig()
        } catch (err) {
            setSaveMessage({ type: 'error', text: err.message || 'Something went wrong.' })
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
        </div>
    )
}
