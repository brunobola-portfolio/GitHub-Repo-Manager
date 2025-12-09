import { useState } from 'react'
import { X, Copy, RefreshCw, Wand2, Check } from 'lucide-react'
import { Button } from './ui/Button'
import { useGitHub } from '../hooks/useGitHub'
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion'

export function CommitGeneratorModal({ isOpen, onClose }) {
    const [diff, setDiff] = useState('')
    const [generatedMessage, setGeneratedMessage] = useState('')
    const [loading, setLoading] = useState(false)
    const [copied, setCopied] = useState(false)
    const { askAI } = useGitHub()

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
        } catch (e) {
            console.error('Commit Gen Error:', e)
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

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]"
            >
                {/* Header */}
                <div className="p-6 border-b border-slate-200 dark:border-slate-800 bg-gradient-to-r from-indigo-500 to-purple-600 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm">
                            <Wand2 className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white">Commit Generator</h2>
                            <p className="text-white/80 text-xs">AI-powered conventional commits</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-white/70 hover:text-white p-2 hover:bg-white/10 rounded-lg transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 flex-1 overflow-y-auto space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            Paste your changes (Diff or Summary)
                        </label>
                        <textarea
                            value={diff}
                            onChange={(e) => setDiff(e.target.value)}
                            placeholder="e.g. Added user login functionality with JWT tokens..."
                            className="w-full h-32 px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none font-mono text-sm"
                        />
                    </div>

                    <div className="flex justify-end">
                        <Button
                            onClick={handleGenerate}
                            disabled={!diff.trim() || loading}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white"
                        >
                            {loading ? (
                                <>
                                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                    Generating...
                                </>
                            ) : (
                                <>
                                    <Wand2 className="w-4 h-4 mr-2" />
                                    Generate Message
                                </>
                            )}
                        </Button>
                    </div>

                    <AnimatePresence>
                        {generatedMessage && (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="mt-4"
                            >
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                    Generated Commit Message
                                </label>
                                <div className="relative group">
                                    <div className="w-full px-4 py-4 bg-slate-900 text-slate-50 rounded-xl font-mono text-sm leading-relaxed border border-slate-700 shadow-inner">
                                        {generatedMessage}
                                    </div>
                                    <button
                                        onClick={handleCopy}
                                        className="absolute top-2 right-2 p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                        title="Copy to clipboard"
                                    >
                                        {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </motion.div>
        </div>
    )
}
