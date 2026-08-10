import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Copy, Check, Terminal } from 'lucide-react'
import { shellQuote } from '../../../utils/shellQuote'

export function OutputSection({ content, loading, label = 'Generated Output' }) {
    const [copiedId, setCopiedId] = useState(null)

    const handleCopy = useCallback((text, id) => {
        navigator.clipboard.writeText(text)
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
    }, [])

    if (loading) {
        return (
            <div className="space-y-2">
                <div className="h-4 w-32 ds-skeleton rounded" />
                <div className="h-24 ds-skeleton rounded-xl" />
            </div>
        )
    }

    if (!content) return null

    const gitCommand = content.includes('\n')
        ? `git commit -m "$(cat <<'EOF'\n${content}\nEOF\n)"`
        : `git commit -m "${shellQuote(content)}"`

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
            >
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">{label}</label>
                <div className="relative group">
                    <div className="w-full px-4 py-4 bg-slate-900 dark:bg-slate-900/80 text-emerald-300 rounded-xl font-mono text-sm leading-relaxed border border-slate-700/50 ring-1 ring-emerald-500/10 whitespace-pre-wrap">
                        {content}
                    </div>
                    <div className="absolute top-2.5 right-2.5 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        <CopyButton text={content} id="msg" copiedId={copiedId} onCopy={handleCopy} label="Copy message" />
                        <CopyButton text={gitCommand} id="cmd" copiedId={copiedId} onCopy={handleCopy} label="Copy as git command" icon={Terminal} />
                    </div>
                </div>
            </motion.div>
        </AnimatePresence>
    )
}

function CopyButton({ text, id, copiedId, onCopy, label, icon: Icon = Copy }) {
    const isCopied = copiedId === id
    return (
        <button
            type="button"
            onClick={() => onCopy(text, id)}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-md transition-all"
            aria-label={label}
            title={label}
        >
            {isCopied
                ? <Check className="w-3.5 h-3.5 text-emerald-400" />
                : <Icon className="w-3.5 h-3.5" />
            }
        </button>
    )
}
