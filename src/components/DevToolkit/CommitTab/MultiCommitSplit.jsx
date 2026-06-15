import { useState } from 'react'
import { motion } from 'framer-motion'
import { Lightbulb, X } from 'lucide-react'
import { Button } from '../../ui/Button'
import { AnimatedCopyIcon } from '../../ui/AnimatedCopyIcon'
import { Tooltip } from '../../ui/Tooltip'

export function MultiCommitSplit({ commits = [], onDismiss, onUseAll }) {
    const [copiedIdx, setCopiedIdx] = useState(null)

    const handleCopy = (msg, idx) => {
        navigator.clipboard.writeText(msg)
        setCopiedIdx(idx)
        setTimeout(() => setCopiedIdx(null), 2000)
    }

    const handleUseAll = () => {
        const all = commits.map((c, i) => `${i + 1}. ${c.message}`).join('\n')
        navigator.clipboard.writeText(all)
        onUseAll?.()
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/20 overflow-hidden"
        >
            <div className="flex items-center justify-between px-3 py-2 border-b border-amber-200 dark:border-amber-800/50">
                <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                    <Lightbulb className="w-3.5 h-3.5" />
                    Suggested commit sequence
                </span>
                <Tooltip label="Dismiss suggestion">
                    <button
                        type="button"
                        onClick={onDismiss}
                        className="p-1 rounded hover:bg-amber-200/50 dark:hover:bg-amber-800/30 transition-colors ds-focus-ring"
                        aria-label="Dismiss"
                    >
                        <X className="w-3 h-3 text-amber-500" />
                    </button>
                </Tooltip>
            </div>
            <div className="divide-y divide-amber-100 dark:divide-amber-900/30">
                {commits.map((commit, idx) => (
                    <motion.div
                        key={idx}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className="flex items-start gap-2 px-3 py-2"
                    >
                        <span className="shrink-0 w-5 h-5 rounded-full bg-amber-200 dark:bg-amber-800 text-amber-700 dark:text-amber-200 ds-text-micro font-bold flex items-center justify-center mt-0.5">
                            {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-mono text-slate-800 dark:text-slate-200 break-words">{commit.message}</p>
                            {commit.files && (
                                <p className="ds-text-micro text-slate-500 dark:text-slate-400 mt-0.5">{commit.files.join(', ')}</p>
                            )}
                        </div>
                        <Tooltip label={copiedIdx === idx ? 'Copied!' : 'Copy commit message'}>
                            <button
                                type="button"
                                onClick={() => handleCopy(commit.message, idx)}
                                className="shrink-0 p-1 rounded hover:bg-amber-200/50 dark:hover:bg-amber-800/30 transition-colors ds-focus-ring"
                                aria-label={copiedIdx === idx ? 'Copied' : 'Copy commit message'}
                            >
                                <AnimatedCopyIcon copied={copiedIdx === idx} size="w-3 h-3" copyClassName="text-slate-400" checkClassName="text-emerald-500" />
                            </button>
                        </Tooltip>
                    </motion.div>
                ))}
            </div>
            <div className="flex justify-end gap-2 px-3 py-2 border-t border-amber-200 dark:border-amber-800/50">
                <button type="button" onClick={onDismiss} className="px-3 py-1 text-xs rounded-md text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">Dismiss</button>
                <Button type="button" variant="warning" size="xs" onClick={handleUseAll}>Use all</Button>
            </div>
        </motion.div>
    )
}
