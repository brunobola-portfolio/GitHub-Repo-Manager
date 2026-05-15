import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { WizardPanel } from './ui/WizardPanel'
import { InsightCard } from './ui/InsightCard'
import { useMobileBreakpoint } from '../hooks/useMobileBreakpoint'
import { useToast } from '../hooks/useToast'
import { Select } from './ui/Select'
import { Button } from './ui/Button'
import { useDebounce } from '../hooks/useDebounce'
import { Plus, Sparkles, Loader2, CheckCircle2, XCircle, Lock, Globe } from 'lucide-react'
import { Spinner } from './ui/Spinner'
import { getCsrfToken } from '../utils/api'

export function CreateRepoModal({ isOpen, onClose, onCreate, orgs, isPerforming, askAI }) {
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [targetOrg, setTargetOrg] = useState('')
    const [isPrivate, setIsPrivate] = useState(true)
    const [isGenerating, setIsGenerating] = useState(false)
    const [aiError, setAiError] = useState(null)
    const [nameStatus, setNameStatus] = useState(null)
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
                const headers = { 'Content-Type': 'application/json' }
                try { headers['X-CSRF-Token'] = await getCsrfToken() } catch { /* server will 403 */ }
                if (controller.signal.aborted) return
                const res = await fetch('/api/import/check-duplicates', {
                    method: 'POST',
                    credentials: 'include',
                    headers,
                    body: JSON.stringify({ names: [debouncedName], org: targetOrg || undefined }),
                    signal: controller.signal,
                })
                if (controller.signal.aborted) return
                if (res.ok) {
                    const data = await res.json()
                    if (controller.signal.aborted) return
                    const duplicates = data.duplicates || []
                    setNameStatus(duplicates.length > 0 ? 'taken' : 'available')
                } else {
                    setNameStatus(null)
                }
            } catch (err) {
                if (controller.signal.aborted || err?.name === 'AbortError') return
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
            if (res.error === 'AI_NOT_CONFIGURED') {
                setDescription('AI not configured. Set GEMINI_API_KEY in server/.env')
            } else if (res?.message) {
                setDescription(res.message.replace(/^"|"$/g, '').trim())
            }
        } catch (e) {
            setAiError(e?.message || 'Failed to generate description')
        } finally {
            setIsGenerating(false)
        }
    }

    const handleSubmit = async (e) => {
        if (e) e.preventDefault()
        if (!name || isPerforming || nameStatus === 'taken') return
        try {
            const result = await onCreate(name, {
                description,
                org: targetOrg || undefined,
                private: isPrivate
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
            <button
                type="button"
                onClick={handleSubmit}
                disabled={!name || isPerforming || nameStatus === 'taken'}
                className="px-6 py-2.5 text-[13px] font-semibold rounded-lg text-white bg-emerald-600 dark:bg-emerald-500 hover:bg-emerald-700 dark:hover:bg-emerald-600 shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
                {isPerforming ? 'Creating...' : 'Create Repository'}
            </button>
        </div>
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
                <div className="max-w-lg mx-auto space-y-6">
                    {/* Owner */}
                    <div>
                        <p className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            Owner
                        </p>
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
                    </div>

                    {/* Repository Name */}
                    <div>
                        <label htmlFor="create-repo-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            Repository Name <span className="text-red-400">*</span>
                        </label>
                        <div className="relative">
                            <input
                                id="create-repo-name"
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value.replace(/\s/g, '-'))}
                                placeholder="my-awesome-project"
                                aria-label="Repository name"
                                aria-required="true"
                                aria-invalid={nameStatus === 'taken'}
                                className="w-full px-4 py-3 pr-10 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 text-slate-900 dark:text-slate-100 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-colors"
                                autoComplete="off"
                            />
                            {nameStatus && (
                                <span className="absolute right-3 top-1/2 -translate-y-1/2">
                                    {nameStatus === 'checking' && <Spinner size="sm" tone="muted" />}
                                    {nameStatus === 'available' && (
                                        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}>
                                            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                        </motion.span>
                                    )}
                                    {nameStatus === 'taken' && (
                                        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}>
                                            <XCircle className="w-4 h-4 text-red-500" />
                                        </motion.span>
                                    )}
                                </span>
                            )}
                        </div>
                        {nameStatus === 'taken' && (
                            <p className="mt-1.5 text-xs text-red-500 dark:text-red-400">This repository name is already taken</p>
                        )}
                        {nameStatus === 'available' && (
                            <p className="mt-1.5 text-xs text-emerald-500 dark:text-emerald-400">Name is available</p>
                        )}
                    </div>

                    {/* Description */}
                    <div>
                        <label htmlFor="create-repo-description" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            Description <span className="text-slate-400 font-normal">(optional)</span>
                        </label>
                        <div className="relative">
                            <textarea
                                id="create-repo-description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="A short description of your repository"
                                aria-label="Repository description"
                                rows={3}
                                className="w-full px-4 py-3 pr-10 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 text-slate-900 dark:text-slate-100 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 placeholder:text-slate-400 dark:placeholder:text-slate-500 resize-none transition-colors"
                            />
                            <button
                                type="button"
                                onClick={handleMagicDescription}
                                disabled={!name || isGenerating}
                                className="absolute right-2.5 bottom-2.5 text-emerald-500 hover:text-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed p-1 rounded hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
                                title="Generate description with AI"
                            >
                                {isGenerating ? <Spinner size="sm" /> : <Sparkles size={15} />}
                            </button>
                        </div>
                    </div>

                    {aiError && (
                        <div className="px-3.5 py-2.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-lg text-sm text-red-600 dark:text-red-400">
                            {aiError}
                        </div>
                    )}

                    {/* Visibility */}
                    <InsightCard hover={false} className="flex items-center gap-3 p-3.5">
                        <button
                            type="button"
                            role="switch"
                            aria-checked={isPrivate}
                            aria-label="Private repository"
                            onClick={() => setIsPrivate(!isPrivate)}
                            className={`
                                relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0
                                ${isPrivate ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}
                            `}
                        >
                            <span className={`
                                inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform
                                ${isPrivate ? 'translate-x-[18px]' : 'translate-x-[3px]'}
                            `} />
                        </button>
                        <div className="flex items-center gap-2">
                            {isPrivate ? <Lock className="w-4 h-4 text-emerald-500" /> : <Globe className="w-4 h-4 text-slate-400" />}
                            <div>
                                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                                    {isPrivate ? 'Private' : 'Public'}
                                </span>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    {isPrivate ? 'Only you and collaborators can see this repository' : 'Anyone on the internet can see this repository'}
                                </p>
                            </div>
                        </div>
                    </InsightCard>
                </div>
            </form>
        </WizardPanel>
    )
}
