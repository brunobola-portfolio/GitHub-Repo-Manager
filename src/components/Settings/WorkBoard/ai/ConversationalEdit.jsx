import { useState } from 'react'
import { InsightCard } from '../../../ui/InsightCard'
import { Textarea } from '../../../ui/form'
import { Button } from '../../../ui/Button'
import { Spinner } from '../../../ui/Spinner'
import { MessageSquare, Check, Pencil } from 'lucide-react'
import { formatUserError } from '../../../../utils/errors'

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
            setError(formatUserError(e, { fallbackTitle: 'Preview failed' }))
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
            setError(formatUserError(e, { fallbackTitle: 'Apply failed' }))
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
                        <Button variant="primary" size="sm" onClick={handlePreview} disabled={loading || prompt.trim().length < 3}>
                            {loading ? <Spinner size="sm" tone="onPrimary" /> : null}
                            Preview
                        </Button>
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
                            <Button variant="primary" size="xs" onClick={handleApply} disabled={loading || diff.actions.length === 0}>
                                {loading ? <Spinner size="xs" tone="onPrimary" /> : <Check className="w-3 h-3" />}
                                Apply
                            </Button>
                            <button
                                type="button"
                                onClick={() => setDiff(null)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors ds-focus-ring rounded"
                            >
                                <Pencil className="w-3 h-3" /> Edit
                            </button>
                        </div>
                    </div>
                )}

                {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error.title}</p>}
            </div>
        </InsightCard>
    )
}
