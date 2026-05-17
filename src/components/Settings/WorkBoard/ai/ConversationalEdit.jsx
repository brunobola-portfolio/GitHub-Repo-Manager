import { useState } from 'react'
import { InsightCard } from '../../../ui/InsightCard'
import { Textarea } from '../../../ui/form'
import { MessageSquare, Loader2, Check, Pencil } from 'lucide-react'

export function ConversationalEdit({ onInterpret, onApply }) {
    const [prompt, setPrompt] = useState('')
    const [diff, setDiff] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    const handlePreview = async () => {
        setError(null)
        setLoading(true)
        try {
            const result = await onInterpret(prompt.trim())
            setDiff(result)
        } catch (e) {
            setError(e.message || 'Preview failed')
        } finally {
            setLoading(false)
        }
    }

    const handleApply = async () => {
        if (!diff?.validity_token) return
        setLoading(true)
        try {
            await onApply(diff.validity_token)
            setDiff(null)
            setPrompt('')
        } catch (e) {
            setError(e.message || 'Apply failed')
        } finally {
            setLoading(false)
        }
    }

    return (
        <InsightCard tone="default" hover={false}>
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-slate-500" />
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">AI-assisted edit</p>
                </div>

                {!diff && (
                    <>
                        <Textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="Describe what you want — e.g. mute all forks, keep only tesla org"
                            rows={2}
                        />
                        <button
                            type="button"
                            onClick={handlePreview}
                            disabled={loading || prompt.trim().length < 3}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                            Preview
                        </button>
                    </>
                )}

                {diff && (
                    <div className="space-y-2">
                        <p className="text-sm text-slate-700 dark:text-slate-300">{diff.summary}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            {diff.actions.length} {diff.actions.length === 1 ? 'action' : 'actions'}
                            {diff.skipped > 0 ? ` · ${diff.skipped} skipped (no access)` : ''}
                        </p>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handleApply}
                                disabled={loading || diff.actions.length === 0}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50 transition-colors"
                            >
                                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                Apply
                            </button>
                            <button
                                type="button"
                                onClick={() => setDiff(null)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                            >
                                <Pencil className="w-3 h-3" /> Edit
                            </button>
                        </div>
                    </div>
                )}

                {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
            </div>
        </InsightCard>
    )
}
