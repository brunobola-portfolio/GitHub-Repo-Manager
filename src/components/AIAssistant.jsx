import React, { useState, useRef, useEffect } from 'react'
import { MessageSquare, X, Send, Sparkles, Loader2, Settings, Key } from 'lucide-react'
import { Card } from './ui/Card'
import ReactMarkdown from 'react-markdown'
import { SettingsModal } from './SettingsModal'

export function AIAssistant({ askAI, user, checkAIStatus }) {
    const [isOpen, setIsOpen] = useState(false)
    const [messages, setMessages] = useState([
        { role: 'assistant', text: 'Hi! I\'m your AI assistant. How can I help you manage your repositories today?' }
    ])
    const [input, setInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const messagesEndRef = useRef(null)
    const [isConfigured, setIsConfigured] = useState(true)
    const [showSettings, setShowSettings] = useState(false)
    const [isIdle, setIsIdle] = useState(false)
    const hideTimerRef = useRef(null)
    const scrollTimerRef = useRef(null)

    // Check configuration on mount and when isOpen changes
    useEffect(() => {
        const checkConfig = async () => {
            const status = await checkAIStatus()
            setIsConfigured(status.configured)
        }
        if (isOpen) {
            checkConfig()
        }
    }, [isOpen, checkAIStatus])

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }

    useEffect(() => {
        scrollToBottom()
    }, [messages, isOpen])

    // Autohide: fade button after inactivity, show on scroll/hover near corner
    useEffect(() => {
        if (isOpen) {
            setIsIdle(false)
            return
        }

        const startIdleTimer = () => {
            clearTimeout(hideTimerRef.current)
            hideTimerRef.current = setTimeout(() => setIsIdle(true), 4000)
        }

        const handleScroll = () => {
            setIsIdle(false)
            clearTimeout(scrollTimerRef.current)
            scrollTimerRef.current = setTimeout(startIdleTimer, 1500)
        }

        const handleMouseMove = (e) => {
            const nearBottomRight =
                e.clientX > window.innerWidth - 120 &&
                e.clientY > window.innerHeight - 120
            if (nearBottomRight) {
                setIsIdle(false)
                startIdleTimer()
            }
        }

        startIdleTimer()
        window.addEventListener('scroll', handleScroll, { passive: true })
        window.addEventListener('mousemove', handleMouseMove, { passive: true })

        return () => {
            clearTimeout(hideTimerRef.current)
            clearTimeout(scrollTimerRef.current)
            window.removeEventListener('scroll', handleScroll)
            window.removeEventListener('mousemove', handleMouseMove)
        }
    }, [isOpen])

    const handleSubmit = async (e) => {
        e.preventDefault()
        if (!input.trim() || isLoading) return

        const userMessage = input
        setInput('')
        setMessages(prev => [...prev, { role: 'user', text: userMessage }])
        setIsLoading(true)

        try {
            const response = await askAI(userMessage, { user: user?.login })

            if (response.error === 'AI_NOT_CONFIGURED') {
                setIsConfigured(false)
            } else {
                setMessages(prev => [...prev, { role: 'assistant', text: response.message }])
            }
        } catch {
            setMessages(prev => [...prev, { role: 'assistant', text: 'Sorry, I encountered an error. Please try again.' }])
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <>
            {/* Floating Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                onMouseEnter={() => { setIsIdle(false); clearTimeout(hideTimerRef.current) }}
                className={`fixed bottom-20 xl:bottom-6 right-3 sm:right-6 p-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-full shadow-lg shadow-indigo-500/20 dark:shadow-indigo-500/30 transition-all duration-500 transform hover:scale-110 z-40 ds-btn-shimmer ${
                    isIdle && !isOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'
                }`}
                aria-label={isOpen ? 'Close AI Assistant' : 'Open AI Assistant'}
            >
                {isOpen ? <X size={20} /> : <Sparkles size={20} />}
            </button>

            {/* Chat Window */}
            {isOpen && (
                <Card className="fixed bottom-32 xl:bottom-20 right-3 sm:right-6 w-[calc(100vw-2rem)] sm:w-80 md:w-96 h-[60vh] xl:h-[500px] flex flex-col shadow-2xl dark:shadow-black/50 z-[45] border border-slate-200/60 dark:border-slate-700/50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl overflow-hidden ds-animate-scale-in rounded-2xl">
                    {/* Header */}
                    <div className="p-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Sparkles size={20} />
                            <h3 className="font-semibold ds-font-display">Gemini Assistant</h3>
                        </div>
                        <button
                            onClick={() => setShowSettings(true)}
                            className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
                            title="AI Settings"
                        >
                            <Settings size={16} />
                        </button>
                    </div>

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
                                onClick={() => setShowSettings(true)}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl transition-colors shadow-sm shadow-indigo-500/20"
                            >
                                Configure API Key
                            </button>
                        </div>
                    ) : (
                        <>
                            {/* Messages */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50 dark:bg-slate-950/50">
                                {messages.map((msg, idx) => (
                                    <div
                                        key={idx}
                                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                                    >
                                        <div
                                            className={`max-w-[85%] p-3 rounded-2xl text-sm ${msg.role === 'user'
                                                ? 'bg-indigo-600 text-white rounded-br-none'
                                                : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-bl-none shadow-sm prose prose-sm dark:prose-invert max-w-none'
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
                                        <div className="bg-white dark:bg-slate-800 p-3 rounded-2xl rounded-bl-none border border-slate-200 dark:border-slate-700 shadow-sm">
                                            <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
                                        </div>
                                    </div>
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Input */}
                            <form onSubmit={handleSubmit} className="p-3 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        placeholder="Ask about your repos..."
                                        className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                    <button
                                        type="submit"
                                        disabled={isLoading || !input.trim()}
                                        className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        <Send size={18} />
                                    </button>
                                </div>
                            </form>
                        </>
                    )}
                </Card>
            )}

            <SettingsModal
                isOpen={showSettings}
                onClose={async () => {
                    setShowSettings(false)
                    const status = await checkAIStatus()
                    setIsConfigured(status.configured)
                }}
            />
        </>
    )
}
