import { useState } from 'react'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import { Sparkles, Loader2 } from 'lucide-react'
import { useGitHub } from '../hooks/useGitHub'

export function CreateRepoModal({ isOpen, onClose, onCreate, orgs, isPerforming }) {
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [targetOrg, setTargetOrg] = useState('')
    const [isPrivate, setIsPrivate] = useState(true)
    const { askAI } = useGitHub()
    const [isGenerating, setIsGenerating] = useState(false)

    if (!isOpen) return null

    const handleMagicDescription = async () => {
        if (!name) return
        setIsGenerating(true)
        try {
            const res = await askAI(`Generate a short, professional, and catchy description (max 100 chars) for a GitHub repository named "${name}". Return ONLY the description text, no quotes.`)

            if (res.error === 'AI_NOT_CONFIGURED') {
                setDescription('⚠️ AI not configured. Set GEMINI_API_KEY in server/.env')
            } else if (res?.message) {
                setDescription(res.message.replace(/^"|"$/g, '').trim())
            }
        } catch (e) {
            console.error(e)
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
            <Card className="w-full max-w-md p-6">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <span className="text-2xl">📦</span>
                        Create Repository
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-2xl">
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
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value.replace(/\s/g, '-'))}
                            placeholder="my-awesome-project"
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                            required
                        />
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
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400 dark:placeholder:text-slate-500 pr-10"
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
    )
}

