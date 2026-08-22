import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, FileCode } from 'lucide-react'

export function DiffSummary({ files = [], summary, loading }) {
    const [expandedFile, setExpandedFile] = useState(null)

    if (loading) {
        return (
            <div className="space-y-2">
                {[1, 2, 3].map(i => (
                    <div key={i} className="h-8 rounded-lg ds-skeleton" />
                ))}
            </div>
        )
    }

    if (!files.length) return null

    return (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    {summary?.files_changed || files.length} files changed
                </span>
                <span className="text-xs text-slate-500">
                    <span className="text-emerald-700 dark:text-emerald-400">+{summary?.additions || 0}</span>
                    {' '}
                    <span className="text-red-600 dark:text-red-400">−{summary?.deletions || 0}</span>
                </span>
            </div>
            <div className="max-h-48 overflow-auto">
                {files.map(file => (
                    <div key={file.filename}>
                        <button
                            type="button"
                            onClick={() => setExpandedFile(expandedFile === file.filename ? null : file.filename)}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                        >
                            <ChevronRight className={`w-3 h-3 text-slate-400 transition-transform ${expandedFile === file.filename ? 'rotate-90' : ''}`} />
                            <FileCode className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="flex-1 text-left text-slate-700 dark:text-slate-300 font-mono truncate">{file.filename}</span>
                            <span className="text-emerald-700 dark:text-emerald-400">+{file.additions}</span>
                            <span className="text-red-600 dark:text-red-400">−{file.deletions}</span>
                        </button>
                        <AnimatePresence>
                            {expandedFile === file.filename && file.patch && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="overflow-hidden"
                                >
                                    <pre className="px-4 py-2 ds-text-meta font-mono bg-slate-900 dark:bg-slate-950 text-slate-300 overflow-x-auto max-h-40">{file.patch}</pre>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                ))}
            </div>
        </div>
    )
}
