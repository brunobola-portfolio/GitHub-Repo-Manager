import { useState } from 'react'
import { ThumbsUp, MessageSquare } from 'lucide-react'

export function QuickActions({ owner, repo, pullNumber, onSubmitted }) {
    const [action, setAction] = useState(null)
    const [comment, setComment] = useState('')
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (event) => {
        setLoading(true)
        try {
            const res = await fetch(`/api/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ event, body: comment || undefined, comments: [] }),
            })
            if (!res.ok) throw new Error('Submit failed')
            setAction(null)
            setComment('')
            onSubmitted?.()
        } catch { /* noop */ } finally { setLoading(false) }
    }

    if (action) {
        return (
            <div className="space-y-2 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder={action === 'APPROVE' ? 'Optional comment...' : 'Your comment...'}
                    className="w-full h-20 px-3 py-2 text-sm bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 rounded-lg resize-none outline-none"
                />
                <div className="flex gap-2">
                    <button type="button" onClick={() => setAction(null)} className="px-3 py-1 text-xs text-slate-500">Cancel</button>
                    <button
                        type="button"
                        onClick={() => handleSubmit(action)}
                        disabled={loading || (action === 'COMMENT' && !comment.trim())}
                        className={`px-3 py-1 text-xs font-medium rounded-md text-white disabled:opacity-50 ${
                            action === 'APPROVE' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'
                        }`}
                    >
                        {loading ? 'Submitting...' : action === 'APPROVE' ? 'Approve' : 'Comment'}
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className="flex gap-2">
            <button
                type="button"
                onClick={() => setAction('APPROVE')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
            >
                <ThumbsUp className="w-3 h-3" /> Quick Approve
            </button>
            <button
                type="button"
                onClick={() => setAction('COMMENT')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
                <MessageSquare className="w-3 h-3" /> Quick Comment
            </button>
        </div>
    )
}
