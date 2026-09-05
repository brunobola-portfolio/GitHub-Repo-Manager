import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, AlertTriangle, Sparkles, Info } from 'lucide-react'
import { API_BASE_URL, MOCK_MODE } from '../../../config'
import { fetchWithRetry, apiCall } from '../../../utils/api'
import { useToast } from '../../../hooks/useToast'
import { Button } from '../../ui/Button'
import { Spinner } from '../../ui/Spinner'
import { PROVIDER_LABELS } from '../../../utils/providerCapabilities'
import { ProviderSelect } from './ProviderSelect'
import { ProviderFields } from './ProviderFields'

const EMPTY_FORM = {
    completionProvider: null,
    completionModel: '',
    completionApiKey: '',
    completionEndpointUrl: '',
    hasCompletionKey: false,
}

/**
 * ProviderKeyForm — a compact, standalone BYOK setup form: the provider
 * picker + key field, reused as-is from AIConfigSection's AIConfig/
 * subcomponents (ProviderSelect, ProviderFields) so there is exactly ONE
 * implementation of "pick a provider, paste a key" rather than a second copy
 * living in onboarding. Adds a single "Test key" action.
 *
 * Deliberately smaller than AIConfigSection: no embedding override, no
 * per-feature overrides, no Remove-config flow — those stay in Settings.
 * This form exists so the onboarding tour's ai-config step doesn't have to
 * send the user away to find them before they can try Deep Review.
 *
 * Grounded honesty: the success copy only renders after the live probe
 * (POST /api/user/ai-config/test — the same endpoint AIConfigSection's Test
 * Connection button calls) reports ok:true. Demo mode has no backend to
 * probe (see BYOKUpgradeBanner's identical guard), so the round-trip is
 * skipped entirely and the result is explicitly labelled "Demo: simulated"
 * rather than pretending to have verified a real key.
 */
export function ProviderKeyForm({ onVerified }) {
    const { toast } = useToast()
    const [form, setForm] = useState(EMPTY_FORM)
    const [loading, setLoading] = useState(!MOCK_MODE)
    const [testing, setTesting] = useState(false)
    const [result, setResult] = useState(null)
    const [validationError, setValidationError] = useState(null)

    // Prefill from any existing config (e.g. the user re-runs the tour after
    // already configuring a key) — never the key itself, matching
    // AIConfigSection's fetchConfig. No backend in demo mode, so skip.
    useEffect(() => {
        // loading's initial state is already `!MOCK_MODE` (false here), so
        // there is nothing to flip — just skip the fetch, there's no backend.
        if (MOCK_MODE) return undefined
        let cancelled = false
        apiCall(`${API_BASE_URL}/api/user/ai-config`)
            .then((data) => {
                if (cancelled || !data) return
                setForm((prev) => ({
                    ...prev,
                    completionProvider: data.completionProvider ?? null,
                    completionModel: data.completionModel ?? '',
                    hasCompletionKey: data.hasCompletionKey ?? false,
                }))
            })
            .catch(() => { /* soft-fail — form just starts empty */ })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [])

    const handleFieldChange = useCallback((field, value) => {
        setForm((prev) => ({ ...prev, [field]: value }))
        setResult(null)
        setValidationError(null)
    }, [])

    const handleTest = useCallback(async () => {
        setValidationError(null)
        if (!form.completionProvider) {
            setValidationError('Choose a provider first.')
            return
        }
        if (form.completionProvider !== 'local' && !form.completionApiKey && !form.hasCompletionKey) {
            setValidationError('Paste your API key first.')
            return
        }

        setTesting(true)
        setResult(null)
        try {
            if (MOCK_MODE) {
                // No backend in demo mode (same reasoning as BYOKUpgradeBanner)
                // — simulate the round-trip locally instead of a real fetch.
                await new Promise((resolve) => setTimeout(resolve, 500))
                const providerName = PROVIDER_LABELS[form.completionProvider] || form.completionProvider
                setResult({ ok: true, mock: true, providerName })
                onVerified?.()
                return
            }

            await fetchWithRetry(`${API_BASE_URL}/api/user/ai-config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    completionProvider: form.completionProvider,
                    completionModel: form.completionModel || null,
                    completionApiKey: form.completionApiKey || null,
                    completionEndpointUrl: form.completionEndpointUrl || null,
                }),
            })

            const res = await fetchWithRetry(`${API_BASE_URL}/api/user/ai-config/test`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ kind: 'completion' }),
            })
            const data = await res.json()
            setResult(data)
            if (data?.ok) {
                toast.success('Provider responded successfully')
                setForm((prev) => ({ ...prev, hasCompletionKey: true, completionApiKey: '' }))
                onVerified?.()
            } else if (data?.error) {
                toast.error(`Test failed — ${data.error}`)
            }
        } catch (err) {
            setResult({
                ok: false,
                code: err?.type || 'NETWORK',
                title: 'Could not verify the key',
                message: err?.userMessage || err?.message || 'Something went wrong. Check your connection and try again.',
                hint: 'You can also finish this later in Settings → AI Configuration.',
            })
        } finally {
            setTesting(false)
        }
    }, [form, toast, onVerified])

    if (loading) {
        return <div className="h-24 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
    }

    return (
        <div className="space-y-3 text-left">
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
                            errors={{}}
                        />
                    </motion.div>
                )}
            </AnimatePresence>

            {validationError && (
                <p className="text-xs font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    {validationError}
                </p>
            )}

            <Button
                type="button"
                variant="soft-primary"
                size="md"
                onClick={handleTest}
                disabled={testing || !form.completionProvider}
                className="w-full justify-center"
            >
                {testing ? <Spinner size="md" tone="primary" /> : <Sparkles className="w-4 h-4" aria-hidden="true" />}
                {testing ? 'Testing…' : 'Test key'}
            </Button>

            <AnimatePresence>
                {result && (result.ok ? (
                    <motion.div
                        key="ok"
                        role="status"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-sm border bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700/50 text-emerald-800 dark:text-emerald-200"
                    >
                        <Check className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                        <span>
                            {result.mock && (
                                <span className="inline-block mr-1.5 px-1.5 py-0.5 rounded ds-text-micro font-semibold uppercase tracking-wide bg-emerald-200/70 dark:bg-emerald-800/50 text-emerald-900 dark:text-emerald-100">
                                    Demo: simulated
                                </span>
                            )}
                            Deep Review is live — open a pull request.
                        </span>
                    </motion.div>
                ) : (
                    <motion.div
                        key="err"
                        role="status"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl text-sm border bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-700/50 text-rose-800 dark:text-rose-200"
                    >
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                        <div className="min-w-0 flex-1 space-y-1">
                            <p className="font-semibold leading-tight">{result.title || 'Test failed'}</p>
                            <p className="text-[13px] leading-relaxed break-words">{result.message || result.error || 'Unknown error'}</p>
                            {result.hint && (
                                <p className="text-[12px] leading-relaxed opacity-80">{result.hint}</p>
                            )}
                        </div>
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    )
}
