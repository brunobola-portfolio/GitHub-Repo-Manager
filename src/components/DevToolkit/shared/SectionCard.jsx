import { useState, useCallback } from 'react'
import { Copy, Check, Pencil } from 'lucide-react'
import { motion } from 'framer-motion'
import { RefinementChips } from './RefinementChips'

export function SectionCard({ title, content, onContentChange, chips, onRefine, refining, loading }) {
    const [editing, setEditing] = useState(false)
    const [copied, setCopied] = useState(false)

    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(content || '')
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }, [content])

    if (loading) {
        return <div className="h-20 ds-skeleton rounded-xl" />
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden"
        >
            <div className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">{title}</span>
                <div className="flex gap-1">
                    <button type="button" onClick={() => setEditing(!editing)} className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors" aria-label="Edit">
                        <Pencil className="w-3 h-3 text-slate-400" />
                    </button>
                    <button type="button" onClick={handleCopy} className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors" aria-label="Copy">
                        {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3 text-slate-400" />}
                    </button>
                </div>
            </div>
            <div className="px-3 py-2">
                {editing ? (
                    <textarea
                        value={content || ''}
                        onChange={(e) => onContentChange?.(e.target.value)}
                        aria-label="Section content"
                        className="w-full min-h-[60px] bg-transparent text-sm text-slate-700 dark:text-slate-300 resize-y outline-none font-mono"
                        autoFocus
                    />
                ) : (
                    <div className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">
                        {content || <span className="text-slate-400 italic">No content generated</span>}
                    </div>
                )}
            </div>
            {chips && chips.length > 0 && (
                <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-800">
                    <RefinementChips chips={chips} onSelect={onRefine} disabled={refining} loading={refining} />
                </div>
            )}
        </motion.div>
    )
}
