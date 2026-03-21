import { useState, useEffect } from 'react'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import { Sparkles, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { useFocusTrap } from '../hooks/useFocusTrap'

export function CreateRepoModal({ isOpen, onClose, onCreate, orgs, isPerforming, askAI }) {
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [targetOrg, setTargetOrg] = useState('')
    const [isPrivate, setIsPrivate] = useState(true)
    const [isGenerating, setIsGenerating] = useState(false)
    const [aiError, setAiError] = useState(null)
    const [nameStatus, setNameStatus] = useState(null) // null | 'checking' | 'available' | 'taken'
    const modalRef = useFocusTrap(isOpen, onClose)

    // Debounced name availability check
    useEffect(() => {
        if (!name || !isOpen) {
            setNameStatus(null)
            return
        }
        setNameStatus('checking')
        const timer = setTimeout(async () => {
            try {
                const res = await fetch('/api/import/check-duplicates', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ names: [name], org: targetOrg || undefined })
                })
                if (res.ok) {
                    const data = await res.json()
                    const duplicates = data.duplicates || []
                    setNameStatus(duplicates.length > 0 ? 'taken' : 'available')
                } else {
                    setNameStatus(null)
                }
            } catch {
                setNameStatus(null)
            }
        }, 500)
        return () => clearTimeout(timer)
    }, [name, targetOrg, isOpen])

    // Scroll input into view when keyboard appears (mobile fix)
    useEffect(() => {
        if (!isOpen) return

        const handleFocus = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                setTimeout(() => {
                    e.target.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }, 300) // Delay for keyboard animation
            }
        }

        const modal = modalRef.current
        modal?.addEventListener('focusin', handleFocus)
        return () => modal?.removeEventListener('focusin', handleFocus)
    }, [isOpen, modalRef])

    if (!isOpen) return null

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
        e.preventDefault()
        const result = await onCreate(name, {
            description,
            org: targetOrg || undefined,
            private: isPrivate
        })
        if (result?.success) {
            onClose()
            setName('')
            setDescription('')
            setTargetOrg('')
        }
    }

    return (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="create-repo-title"
                className="w-full max-w-md max-h-[85vh] md:max-h-[90vh] flex flex-col overflow-hidden"
            >
            <Card className="flex-1 overflow-y-auto p-6">
                <div className="flex items-center justify-between mb-6">
                    <h2 id="create-repo-title" className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <span className="text-2xl" aria-hidden="true">📦</span>
                        Create Repository
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-2xl" aria-label="Close modal">
                        ×
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Owner
                        </label>
                        <Select
                            value={targetOrg}
                            onChange={setTargetOrg}
                            options={[
                                { value: '', label: 'My personal account' },
                                ...(orgs?.map((org) => ({
                                    value: org.login,
                                    label: org.login
                                })) || [])
                            ]}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Repository Name *
                        </label>
                        <div className="relative">
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value.replace(/\s/g, '-'))}
                                placeholder="my-awesome-project"
                                className="w-full px-3 py-2 pr-9 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-500 dark:placeholder:text-slate-400"
                                required
                            />
                            {nameStatus && (
                                <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
                                    {nameStatus === 'checking' && <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />}
                                    {nameStatus === 'available' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                                    {nameStatus === 'taken' && <XCircle className="w-4 h-4 text-red-500" />}
                                </span>
                            )}
                        </div>
                        {nameStatus === 'taken' && (
                            <p className="mt-1 text-xs text-red-500 dark:text-red-400">This repository name is already taken</p>
                        )}
                    </div>

                    <div className="relative">
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Description (optional)
                        </label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="A short description of your repository"
                            rows={2}
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-500 dark:placeholder:text-slate-400 pr-10"
                        />
                        <button
                            type="button"
                            onClick={handleMagicDescription}
                            disabled={!name || isGenerating}
                            className="absolute right-2 top-8 text-indigo-500 hover:text-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed p-1"
                            title="Generate description with AI"
                        >
                            {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                        </button>
                    </div>

                    {aiError && (
                        <div className="px-4 py-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl text-sm text-red-600 dark:text-red-400">
                            {aiError}
                        </div>
                    )}

                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={isPrivate}
                            onChange={(e) => setIsPrivate(e.target.checked)}
                            className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 dark:bg-slate-700"
                        />
                        <span className="text-sm text-slate-700 dark:text-slate-300">Private repository</span>
                    </label>

                    <div className="flex gap-3 pt-2">
                        <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!name || isPerforming} className="flex-1">
                            {isPerforming ? 'Creating...' : 'Create Repository'}
                        </Button>
                    </div>
                </form>
            </Card>
            </div>
        </div>
    )
}

