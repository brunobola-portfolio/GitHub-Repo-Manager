import React, { useState, useRef, useEffect } from 'react'
import { MessageSquare, X, Send, Sparkles, Loader2, Settings, Key } from 'lucide-react'
import { useGitHub } from '../hooks/useGitHub'
import { Card } from './ui/Card'
import ReactMarkdown from 'react-markdown'
import { SettingsModal } from './SettingsModal'

export function AIAssistant() {
    const [isOpen, setIsOpen] = useState(false)
    const [messages, setMessages] = useState([
        { role: 'assistant', text: 'Hi! I\'m your AI assistant. How can I help you manage your repositories today?' }
    ])
    const [input, setInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const messagesEndRef = useRef(null)
    const { askAI, user } = useGitHub()
    const [isConfigured, setIsConfigured] = useState(true)
    const [showSettings, setShowSettings] = useState(false)

    // Check configuration on mount and when isOpen changes
    useEffect(() => {
        const checkConfig = () => {
            const key = localStorage.getItem('GEMINI_API_KEY')
            // Also check if server has it (we can't easily, but we can assume if no local key, we might need one)
            // For this UX, let's rely on the local key or a flag. 
            // If the user hasn't set a local key, we'll assume it might be missing unless they say otherwise.
            // Actually, let's just check if we have a key in localStorage for the "Setup" UI.
            // If not, we show the setup UI.
            setIsConfigured(!!key)
        }
        checkConfig()
    }, [isOpen])

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }

    useEffect(() => {
        scrollToBottom()
    }, [messages, isOpen])

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
        } catch (error) {
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
                className="fixed bottom-6 right-6 p-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-lg transition-all transform hover:scale-105 z-40 flex items-center gap-2"
            >
                {isOpen ? <X size={24} /> : <Sparkles size={24} />}
                {!isOpen && <span className="font-medium hidden sm:inline">AI Assistant</span>}
            </button>

            {/* Chat Window */}
            {isOpen && (
                <Card className="fixed bottom-24 right-6 w-80 sm:w-96 h-[500px] flex flex-col shadow-2xl z-40 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden animate-in slide-in-from-bottom-10 fade-in duration-200 rounded-2xl">
                    {/* Header */}
                    <div className="p-4 bg-indigo-600 text-white flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Sparkles size={20} />
                            <h3 className="font-semibold">Gemini Assistant</h3>
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
                onClose={() => {
                    setShowSettings(false)
                    // Re-check config after closing settings
                    const key = localStorage.getItem('GEMINI_API_KEY')
                    setIsConfigured(!!key)
                }}
            />
        </>
    )
}
