import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { WizardPanel } from './ui/WizardPanel'
import { InsightCard } from './ui/InsightCard'
import { useMobileBreakpoint } from '../hooks/useMobileBreakpoint'
import { useToast } from '../hooks/useToast'
import { Select } from './ui/Select'
import { Button } from './ui/Button'
import { Field, Input, Textarea, Switch } from './ui/form'
import { useDebounce } from '../hooks/useDebounce'
import { isAbort } from '../utils/errorClassification'
import { Plus, Sparkles, CheckCircle2, XCircle, Lock, Globe } from 'lucide-react'
import { Spinner } from './ui/Spinner'
import { apiCall } from '../utils/api'
import { API_BASE } from '../config'

// GitHub accepts letters, digits, dots, hyphens and underscores; anything
// else is rejected server-side with a message the user only sees after the
// round trip. Spaces are already folded to hyphens on input.
const REPO_NAME_RE = /^[A-Za-z0-9._-]+$/
export const REPO_NAME_HINT = 'Use letters, numbers, dots, hyphens and underscores only.'

export function CreateRepoModal({ isOpen, onClose, onCreate, orgs, isPerforming, askAI }) {
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [targetOrg, setTargetOrg] = useState('')
    const [isPrivate, setIsPrivate] = useState(true)
    const [isGenerating, setIsGenerating] = useState(false)
    const [aiError, setAiError] = useState(null)
    const [nameStatus, setNameStatus] = useState(null)
    const nameInvalid = name.length > 0 && !REPO_NAME_RE.test(name)
    const [isMaximized, setIsMaximized] = useState(false)
    const isMobile = useMobileBreakpoint()
    const { toast } = useToast()
    const debouncedName = useDebounce(name, 500)

    const handleToggleMaximize = useCallback(() => setIsMaximized((v) => !v), [])

    // Debounced name availability check. Uses AbortController so a rapid
    // typing session (or a closed modal) cancels any in-flight request and
    // can't set stale `nameStatus` after the user has moved on.
    /* eslint-disable react-hooks/set-state-in-effect -- debounced name availability probe + reset on close */
    useEffect(() => {
        if (!debouncedName || !isOpen) {
            setNameStatus(null)
            return
        }
        setNameStatus('checking')
        const controller = new AbortController()
        ;(async () => {
            try {
                // maxRetries: 0 — debounced on every keystroke; a retryable 5xx
                // should fall back to null fast rather than stall behind a backoff.
                const data = await apiCall(`${API_BASE}/import/check-duplicates`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    // The route's schema is `{ repos, targetOwner }` and is
                    // .strict() — `{ names, org }` 400'd on every keystroke.
                    body: JSON.stringify({ repos: [debouncedName], targetOwner: targetOrg || undefined }),
                    signal: controller.signal,
                }, { maxRetries: 0 })
                if (controller.signal.aborted) return
                // `duplicates` is an OBJECT keyed by repo name, not an
                // array — reading `.length` yielded undefined, so the
                // indicator said "available" no matter what came back.
                const duplicates = data.duplicates || {}
                setNameStatus(duplicates[debouncedName] ? 'taken' : 'available')
            } catch (err) {
                if (isAbort(err, controller.signal)) return
                setNameStatus(null)
            }
        })()
        return () => controller.abort()
    }, [debouncedName, targetOrg, isOpen])

    // Reset form on close
    useEffect(() => {
        if (!isOpen) {
            setName('')
            setDescription('')
            setTargetOrg('')
            setAiError(null)
            setNameStatus(null)
        }
    }, [isOpen])
    /* eslint-enable react-hooks/set-state-in-effect */

    const handleMagicDescription = async () => {
        if (!name) return
        setIsGenerating(true)
        setAiError(null)
        try {
            const res = await askAI(`Generate a short, professional, and catchy description (max 100 chars) for a GitHub repository named "${name}". Return ONLY the description text, no quotes.`)
            // askAI resolves to { reply, actions } and THROWS typed errors —
            // the description is in res.reply, not res.message.
            const text = (res?.reply || '').replace(/^"|"$/g, '').trim()
            if (text) setDescription(text)
        } catch (e) {
            setAiError(
                e?.code === 'AI_NOT_CONFIGURED'
                    ? 'AI not configured. Set GEMINI_API_KEY in server/.env'
                    : (e?.message || 'Failed to generate description')
            )
        } finally {
            setIsGenerating(false)
        }
    }

    const handleSubmit = async (e) => {
        if (e) e.preventDefault()
        if (!name || nameInvalid || isPerforming || nameStatus === 'taken') return
        try {
            const result = await onCreate(name, {
                description,
                org: targetOrg || undefined,
                // `isPrivate`, not `private` — createRepoSchema declares the
                // former, and Zod used to strip the latter without complaint,
                // so the toggle was discarded and every repo created here came
                // out public while this modal said Private.
                isPrivate
            })
            if (result?.success) {
                toast.success(`Created ${result.repo?.full_name || (targetOrg ? targetOrg + '/' : '') + name}`)
                onClose()
            } else {
                toast.error(result?.message || result?.error || 'Failed to create repository')
            }
        } catch (err) {
            toast.error(err?.message || 'Failed to create repository')
        }
    }

    const footer = (
        <div className="flex items-center justify-end gap-3">
            <Button variant="secondary" type="button" onClick={onClose}>
                Cancel
            </Button>
            <Button
                variant="success"
                size="md"
                type="button"
                onClick={handleSubmit}
                disabled={!name || nameInvalid || isPerforming || nameStatus === 'taken'}
            >
                {isPerforming && <Spinner size="sm" />}
                {isPerforming ? 'Creating…' : 'Create Repository'}
            </Button>
        </div>
    )

    // Trailing slot for name field — checking spinner, success or error
    // glyph rendered inline so the input always reports its own status.
    const nameTrailing = nameStatus && (
        <>
            {nameStatus === 'checking' && <Spinner size="sm" tone="muted" />}
            {nameStatus === 'available' && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}>
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                </motion.span>
            )}
            {nameStatus === 'taken' && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}>
                    <XCircle className="w-4 h-4 text-rose-500" />
                </motion.span>
            )}
        </>
    )

    // Trailing slot for description — AI magic generator button.
    const descTrailing = (
        <button
            type="button"
            onClick={handleMagicDescription}
            disabled={!name || isGenerating}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Generate with AI"
            aria-label="Generate with AI"
        >
            {isGenerating ? <Spinner size="sm" /> : <Sparkles size={15} />}
        </button>
    )

    return (
        <WizardPanel
            isOpen={isOpen}
            onClose={onClose}
            title="Create Repository"
            icon={Plus}
            size="md"
            footer={footer}
            isMaximized={isMaximized}
            isMobile={isMobile}
            onToggleMaximize={handleToggleMaximize}
        >
            <form onSubmit={handleSubmit} className="p-6 md:p-8 lg:p-10">
                <div className="max-w-lg mx-auto space-y-5">
                    {/* Owner */}
                    <Field label="Owner">
                        <Select
                            value={targetOrg}
                            onChange={setTargetOrg}
                            label="Owner"
                            options={[
                                { value: '', label: 'My personal account' },
                                ...(orgs?.map((org) => ({
                                    value: org.login,
                                    label: org.login
                                })) || [])
                            ]}
                        />
                    </Field>

                    {/* Repository Name */}
                    <Field
                        label="Repository Name"
                        required
                        htmlFor="create-repo-name"
                        error={nameInvalid ? REPO_NAME_HINT : nameStatus === 'taken' ? 'This repository name is already taken' : undefined}
                        success={nameStatus === 'available' ? 'Name is available' : undefined}
                    >
                        <Input
                            id="create-repo-name"
                            type="text"
                            tone="emerald"
                            value={name}
                            onChange={(e) => setName(e.target.value.replace(/\s/g, '-'))}
                            placeholder="my-awesome-project"
                            autoComplete="off"
                            trailing={nameTrailing}
                        />
                    </Field>

                    {/* Description */}
                    <Field label="Description" optional htmlFor="create-repo-description">
                        <Textarea
                            id="create-repo-description"
                            tone="emerald"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="A short description of your repository"
                            rows={3}
                            trailing={descTrailing}
                        />
                    </Field>

                    {aiError && (
                        <div className="px-3.5 py-2.5 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/50 rounded-xl text-sm text-rose-600 dark:text-rose-400">
                            {aiError}
                        </div>
                    )}

                    {/* Visibility */}
                    <InsightCard hover={false} className="flex items-center gap-4 p-4">
                        <Switch
                            checked={isPrivate}
                            onChange={setIsPrivate}
                            label="Private repository"
                            tone="emerald"
                        />
                        <div className="flex items-center gap-2 min-w-0">
                            {isPrivate ? (
                                <Lock className="w-4 h-4 text-emerald-500 shrink-0" />
                            ) : (
                                <Globe className="w-4 h-4 text-slate-400 shrink-0" />
                            )}
                            <div className="min-w-0">
                                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                                    {isPrivate ? 'Private' : 'Public'}
                                </span>
                                <p className="ds-text-meta text-slate-500 dark:text-slate-400">
                                    {isPrivate
                                        ? 'Only you and collaborators can see this repository'
                                        : 'Anyone on the internet can see this repository'}
                                </p>
                            </div>
                        </div>
                    </InsightCard>
                </div>
            </form>
        </WizardPanel>
    )
}
