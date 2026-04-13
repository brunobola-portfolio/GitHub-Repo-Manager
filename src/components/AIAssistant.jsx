import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Send, Sparkles, Loader2, Settings, Key, Minus } from 'lucide-react'
import { Card } from './ui/Card'
import ReactMarkdown from 'react-markdown'
import { useModal } from '../hooks/useModal'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { motion, AnimatePresence } from 'framer-motion'

let msgIdCounter = 0
const nextMsgId = () => `msg-${Date.now()}-${++msgIdCounter}`

export function AIAssistant({ askAI, user, checkAIStatus }) {
    const [isOpen, setIsOpen] = useState(false)
    const [isMinimized, setIsMinimized] = useState(false)
    const [messages, setMessages] = useState([
        { id: nextMsgId(), role: 'assistant', text: 'Hi! I\'m your AI assistant. How can I help you manage your repositories today?' }
    ])
    const [input, setInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const messagesEndRef = useRef(null)
    const [isConfigured, setIsConfigured] = useState(true)
    const { openModal } = useModal()
    const [isIdle, setIsIdle] = useState(false)
    const idleTimerRef = useRef(null)
    const handleCloseChat = useCallback(() => setIsOpen(false), [])
    const chatRef = useFocusTrap(isOpen, handleCloseChat)

    useEffect(() => {
        if (isOpen) {
            const checkConfig = async () => {
                try {
                    const status = await checkAIStatus()
                    setIsConfigured(status?.configured ?? false)
                } catch {
                    setIsConfigured(false)
                }
            }
            checkConfig()
        }
    }, [isOpen, checkAIStatus])

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }

    useEffect(() => {
        scrollToBottom()
    }, [messages, isOpen])

    // Auto-hide: shrink to a slim pill after 5s of inactivity, reappear on hover/scroll
    useEffect(() => {
        if (isOpen) {
            setIsIdle(false)
            return
        }

        const startIdle = () => {
            clearTimeout(idleTimerRef.current)
            idleTimerRef.current = setTimeout(() => setIsIdle(true), 5000)
        }

        const wake = () => {
            setIsIdle(false)
            startIdle()
        }

        startIdle()
        window.addEventListener('scroll', wake, { passive: true })

        return () => {
            clearTimeout(idleTimerRef.current)
            window.removeEventListener('scroll', wake)
        }
    }, [isOpen])

    const handleSubmit = async (e) => {
        e.preventDefault()
        if (!input.trim() || isLoading) return

        const userMessage = input
        setInput('')
        setMessages(prev => [...prev, { id: nextMsgId(), role: 'user', text: userMessage }])
        setIsLoading(true)

        try {
            const response = await askAI(userMessage, { user: user?.login })

            if (response.error === 'AI_NOT_CONFIGURED') {
                setIsConfigured(false)
            } else {
                setMessages(prev => [...prev, { id: nextMsgId(), role: 'assistant', text: response.message }])
            }
        } catch {
            setMessages(prev => [...prev, { id: nextMsgId(), role: 'assistant', text: 'Sorry, I encountered an error. Please try again.' }])
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <>
            {/* Floating Button - transitions between full pill and slim dot */}
            <AnimatePresence>
                {!isOpen && (
                    <motion.button
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.8, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                        onClick={() => { setIsOpen(true); setIsIdle(false) }}
                        onMouseEnter={() => setIsIdle(false)}
                        className="fixed bottom-20 xl:bottom-6 right-3 sm:right-6 z-40 group"
                        aria-label="Open AI Assistant"
                    >
                        <div className="relative">
                            {/* Glow ring */}
                            <span className={`absolute inset-0 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-500 blur-md transition-opacity duration-500 ${
                                isIdle ? 'opacity-0' : 'opacity-20 group-hover:opacity-40'
                            }`} />

                            {/* Button body - morphs between pill and dot */}
                            <div className={`relative flex items-center bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-lg shadow-indigo-500/25 dark:shadow-indigo-500/40 transition-all duration-500 ease-in-out transform hover:scale-105 hover:-translate-y-0.5 ${
                                isIdle
                                    ? 'gap-0 px-3 py-3 rounded-full opacity-60 hover:opacity-100'
                                    : 'gap-2.5 px-4 py-3 rounded-2xl opacity-100'
                            }`}>
                                <Sparkles size={isIdle ? 16 : 18} className="shrink-0 transition-all duration-500" />
                                <span className={`text-sm font-medium whitespace-nowrap transition-all duration-500 overflow-hidden ${
                                    isIdle ? 'w-0 opacity-0' : 'w-auto opacity-100 hidden sm:inline'
                                }`}>
                                    AI Assistant
                                </span>
                            </div>
                        </div>
                    </motion.button>
                )}
            </AnimatePresence>

            {/* Chat Window */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        ref={chatRef}
                        role="dialog"
                        aria-modal="true"
                        aria-label="AI Assistant"
                        initial={{ opacity: 0, y: 20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 20, scale: 0.95 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                        className="fixed bottom-20 xl:bottom-6 right-3 sm:right-6 z-[45]"
                    >
                        <Card className={`w-[calc(100vw-2rem)] sm:w-80 md:w-96 flex flex-col shadow-2xl shadow-indigo-500/10 dark:shadow-black/50 border border-slate-200/60 dark:border-slate-700/50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl overflow-hidden rounded-2xl transition-all duration-300 ${
                            isMinimized ? '' : 'h-[60vh] xl:h-[500px]'
                        }`}>
                            {/* Header */}
                            <div
                                className="p-3.5 bg-gradient-to-r from-indigo-600 via-indigo-600 to-purple-600 text-white flex items-center justify-between shrink-0 cursor-pointer select-none"
                                onClick={() => isMinimized && setIsMinimized(false)}
                            >
                                <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 bg-white/15 rounded-xl flex items-center justify-center backdrop-blur-sm">
                                        <Sparkles size={16} />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-sm ds-font-display leading-tight">Gemini Assistant</h3>
                                        <span className="text-[10px] text-indigo-200 leading-tight">
                                            {isLoading ? 'Thinking...' : 'Online'}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-0.5">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); openModal('showSettings') }}
                                        className="p-1.5 hover:bg-white/15 rounded-lg transition-colors"
                                        title="AI Settings"
                                    >
                                        <Settings size={14} />
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized) }}
                                        className="p-1.5 hover:bg-white/15 rounded-lg transition-colors"
                                        title={isMinimized ? 'Expand' : 'Minimize'}
                                    >
                                        <Minus size={14} />
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setIsOpen(false) }}
                                        className="p-1.5 hover:bg-white/15 rounded-lg transition-colors"
                                        title="Close assistant"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            </div>

                            {/* Body - hidden when minimized */}
                            {!isMinimized && (
                                <>
                                    {!isConfigured ? (
                                        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4 bg-slate-50 dark:bg-slate-950/50">
                                            <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/30 rounded-full flex items-center justify-center mb-2">
                                                <Key className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
                                            </div>
                                            <h4 className="text-lg font-semibold text-slate-900 dark:text-white">
                                                Setup Required
                                            </h4>
                                            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-[240px]">
                                                To use the AI Assistant, you need to configure your Gemini API key.
                                            </p>
                                            <button
                                                onClick={() => openModal('showSettings')}
                                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl transition-colors shadow-sm shadow-indigo-500/20"
                                            >
                                                Configure API Key
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                            {/* Messages */}
                                            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gradient-to-b from-slate-50 to-white dark:from-slate-950/50 dark:to-slate-900/50">
                                                {messages.map((msg) => (
                                                    <div
                                                        key={msg.id}
                                                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                                                    >
                                                        {msg.role === 'assistant' && (
                                                            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shrink-0 mt-1 mr-2">
                                                                <Sparkles size={12} className="text-white" />
                                                            </div>
                                                        )}
                                                        <div
                                                            className={`max-w-[80%] p-3 text-sm leading-relaxed ${msg.role === 'user'
                                                                ? 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white rounded-2xl rounded-br-sm shadow-sm shadow-indigo-500/20'
                                                                : 'bg-white dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-700/50 rounded-2xl rounded-bl-sm shadow-sm prose prose-sm dark:prose-invert max-w-none'
                                                            }`}
                                                        >
                                                            {msg.role === 'assistant' ? (
                                                                <ReactMarkdown>{msg.text}</ReactMarkdown>
                                                            ) : (
                                                                msg.text
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                                {isLoading && (
                                                    <div className="flex justify-start">
                                                        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shrink-0 mt-1 mr-2">
                                                            <Sparkles size={12} className="text-white" />
                                                        </div>
                                                        <div className="bg-white dark:bg-slate-800/80 p-3 rounded-2xl rounded-bl-sm border border-slate-200/80 dark:border-slate-700/50 shadow-sm">
                                                            <div className="flex items-center gap-1.5">
                                                                <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                                                                <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                                                                <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" />
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                                <div ref={messagesEndRef} />
                                            </div>

                                            {/* Input */}
                                            <form onSubmit={handleSubmit} className="p-3 border-t border-slate-200/80 dark:border-slate-700/50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm shrink-0">
                                                <div className="flex gap-2 items-end">
                                                    <input
                                                        type="text"
                                                        value={input}
                                                        onChange={(e) => setInput(e.target.value)}
                                                        placeholder="Ask about your repos..."
                                                        className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-400 transition-all placeholder:text-slate-400"
                                                    />
                                                    <button
                                                        type="submit"
                                                        disabled={isLoading || !input.trim()}
                                                        className="p-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm shadow-indigo-500/20 hover:shadow-md hover:shadow-indigo-500/30 active:scale-95"
                                                    >
                                                        <Send size={16} />
                                                    </button>
                                                </div>
                                            </form>
                                        </>
                                    )}
                                </>
                            )}
                        </Card>
                    </motion.div>
                )}
            </AnimatePresence>

        </>
    )
}
