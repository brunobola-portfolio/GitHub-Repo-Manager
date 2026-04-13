import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Copy, Check, Terminal, Square } from 'lucide-react'

export function StreamingOutput({ content, streamingText, isStreaming, onCancel, label = 'Generated Output', retryCount = 0 }) {
    const [copiedId, setCopiedId] = useState(null)
    const displayText = isStreaming ? streamingText : content

    const handleCopy = useCallback((text, id) => {
        navigator.clipboard.writeText(text)
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
    }, [])

    if (!displayText && !isStreaming) return null

    const gitCommand = displayText.includes('\n')
        ? `git commit -m "$(cat <<'EOF'\n${displayText}\nEOF\n)"`
        : `git commit -m "${(displayText || '').replace(/"/g, '\\"')}"`

    return (
        <AnimatePresence>
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
                <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>
                    <div className="flex items-center gap-2">
                        {retryCount > 0 && (
                            <span className="text-[10px] text-amber-400 animate-pulse">Reconnecting ({retryCount}/3)...</span>
                        )}
                        {isStreaming && (
                            <button type="button" onClick={onCancel} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-red-400 hover:text-red-300 rounded transition-colors">
                                <Square className="w-3 h-3" /> Stop
                            </button>
                        )}
                    </div>
                </div>
                <div className="relative group">
                    <div className="w-full px-4 py-4 bg-slate-950 text-emerald-400 rounded-xl font-mono text-sm leading-relaxed border border-slate-700/50 ring-1 ring-emerald-500/10 whitespace-pre-wrap min-h-[60px]" aria-live="polite">
                        {displayText}
                        {isStreaming && <span className="inline-block w-2 h-5 ml-0.5 bg-emerald-400 animate-pulse align-text-bottom" />}
                    </div>
                    {!isStreaming && displayText && (
                        <div className="absolute top-2.5 right-2.5 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                            <CopyBtn text={displayText} id="msg" copiedId={copiedId} onCopy={handleCopy} label="Copy message" />
                            <CopyBtn text={gitCommand} id="cmd" copiedId={copiedId} onCopy={handleCopy} label="Copy as git command" icon={Terminal} />
                        </div>
                    )}
                </div>
            </motion.div>
        </AnimatePresence>
    )
}

function CopyBtn({ text, id, copiedId, onCopy, label, icon: Icon = Copy }) {
    return (
        <button type="button" onClick={() => onCopy(text, id)} className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-md transition-all" aria-label={label} title={label}>
            {copiedId === id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Icon className="w-3.5 h-3.5" />}
        </button>
    )
}
