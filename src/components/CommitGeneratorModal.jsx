import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { WizardPanel } from './ui/WizardPanel'
import { Copy, RefreshCw, Wand2, Check } from 'lucide-react'

export function CommitGeneratorModal({ isOpen, onClose, askAI }) {
    const [diff, setDiff] = useState('')
    const [generatedMessage, setGeneratedMessage] = useState('')
    const [loading, setLoading] = useState(false)
    const [copied, setCopied] = useState(false)
    const [isMaximized, setIsMaximized] = useState(false)
    const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches)

    useEffect(() => {
        const mql = window.matchMedia('(max-width: 767px)')
        const onChange = (e) => setIsMobile(e.matches)
        mql.addEventListener('change', onChange)
        return () => mql.removeEventListener('change', onChange)
    }, [])

    const handleToggleMaximize = useCallback(() => setIsMaximized((v) => !v), [])

    const handleGenerate = async () => {
        if (!diff.trim()) return
        setLoading(true)
        setGeneratedMessage('')
        try {
            const response = await askAI(
                `Generate a concise, conventional commit message (e.g. type(scope): description) for the following code changes/diff. Provide ONLY the commit message, no explanations.\n\nChanges:\n${diff}`,
                { context: "commit-generation" }
            )
            setGeneratedMessage(response.message || 'Failed to generate message.')
        } catch {
            setGeneratedMessage('Error generating commit message. Please check your API key.')
        } finally {
            setLoading(false)
        }
    }

    const handleCopy = () => {
        if (generatedMessage) {
            navigator.clipboard.writeText(generatedMessage)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        }
    }

    const footer = (
        <div className="flex items-center justify-end gap-3">
            <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 text-[13px] font-medium rounded-lg text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 shadow-sm transition-all"
            >
                Close
            </button>
            <button
                type="button"
                onClick={handleGenerate}
                disabled={!diff.trim() || loading}
                className="ds-btn-shimmer inline-flex items-center gap-2 px-6 py-2.5 text-[13px] font-semibold rounded-lg text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-md shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
                {loading ? (
                    <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Generating...
                    </>
                ) : (
                    <>
                        <Wand2 className="w-3.5 h-3.5" />
                        Generate
                    </>
                )}
            </button>
        </div>
    )

    return (
        <WizardPanel
            isOpen={isOpen}
            onClose={onClose}
            title="Commit Generator"
            icon={Wand2}
            stepInfo={{ title: 'AI-powered conventional commits' }}
            size="md"
            footer={footer}
            isMaximized={isMaximized}
            isMobile={isMobile}
            onToggleMaximize={handleToggleMaximize}
        >
            <div className="p-5 md:p-6 lg:p-8">
                <div className="max-w-lg mx-auto space-y-5">
                    {/* Input */}
                    <div>
                        <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                            Paste your changes (Diff or Summary)
                        </label>
                        <textarea
                            value={diff}
                            onChange={(e) => setDiff(e.target.value)}
                            placeholder="e.g. Added user login functionality with JWT tokens..."
                            className="w-full h-40 px-3.5 py-3 bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 resize-none font-mono placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-colors"
                        />
                    </div>

                    {/* Generated output */}
                    <AnimatePresence>
                        {generatedMessage && (
                            <motion.div
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.25 }}
                            >
                                <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                                    Generated Commit Message
                                </label>
                                <div className="relative group">
                                    <div className="w-full px-4 py-3.5 bg-slate-900 dark:bg-slate-900/80 text-emerald-300 rounded-lg font-mono text-sm leading-relaxed border border-slate-700/50 ring-1 ring-emerald-500/10">
                                        {generatedMessage}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleCopy}
                                        className="absolute top-2.5 right-2.5 p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-md transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                                        aria-label="Copy commit message to clipboard"
                                    >
                                        {copied
                                            ? <Check className="w-3.5 h-3.5 text-emerald-400" />
                                            : <Copy className="w-3.5 h-3.5" />
                                        }
                                    </button>
                                </div>
                                {copied && (
                                    <motion.p
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        className="mt-1.5 text-xs text-emerald-500"
                                    >
                                        Copied to clipboard
                                    </motion.p>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </WizardPanel>
    )
}
