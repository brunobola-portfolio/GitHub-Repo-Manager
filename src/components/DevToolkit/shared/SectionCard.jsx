import { useState } from 'react'
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard'
import { Pencil } from 'lucide-react'
import { motion } from 'framer-motion'
import { AnimatedCopyIcon } from '../../ui/AnimatedCopyIcon'
import { RefinementChips } from './RefinementChips'
import { Card } from '../../ui/Card'
import { Tooltip } from '../../ui/Tooltip'

export function SectionCard({ title, content, onContentChange, chips, onRefine, refining, loading }) {
    const [editing, setEditing] = useState(false)
    const { copied, copy } = useCopyToClipboard()

    const handleCopy = () => copy(content || '')

    if (loading) {
        return <div className="h-20 ds-skeleton rounded-xl" />
    }

    return (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
        <Card glass={false} shadow="none" className="rounded-xl">
            <div className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">{title}</span>
                <div className="flex gap-1">
                    <Tooltip label={editing ? 'Done editing' : 'Edit'}>
                        <button
                            type="button"
                            onClick={() => setEditing(!editing)}
                            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors ds-focus-ring"
                            aria-label={editing ? 'Done editing' : 'Edit'}
                            aria-pressed={editing}
                        >
                            <Pencil className="w-3 h-3 text-slate-400" />
                        </button>
                    </Tooltip>
                    <Tooltip label={copied ? 'Copied!' : 'Copy'}>
                        <button
                            type="button"
                            onClick={handleCopy}
                            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors ds-focus-ring"
                            aria-label={copied ? 'Copied' : 'Copy'}
                        >
                            <AnimatedCopyIcon copied={copied} size="w-3 h-3" copyClassName="text-slate-400" checkClassName="text-emerald-500" />
                        </button>
                    </Tooltip>
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
        </Card>
        </motion.div>
    )
}
