import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Send, Sparkles, Loader2, Settings, Key, Minus, ArrowRight, AlertTriangle, RotateCw } from 'lucide-react'
import { Spinner } from './ui/Spinner'
import { Card } from './ui/Card'
import ReactMarkdown from 'react-markdown'
import { useModal } from '../hooks/useModal'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { motion, AnimatePresence } from 'framer-motion'
import { sanitizeActions, dispatchAction } from '../utils/aiActions'
import { detectRepoUrl } from '../utils/repoUrlDetector'
import { AIAssistantPasteCard } from './AIAssistantPasteCard'
import { buildWizardPayload } from '../utils/pasteDialogPayload'

let msgIdCounter = 0
const nextMsgId = () => `msg-${Date.now()}-${++msgIdCounter}`

// Error codes that warrant a "Configure API key" deep link to AI Settings.
// Drive this from the canonical machine code rather than substring-matching
// the human message text — message wording is free to change without
// breaking the CTA.
const CONFIGURE_CTA_CODES = new Set([
    'INVALID_API_KEY',
    'AI_NOT_CONFIGURED',
    'NO_AI_PROVIDER',
    'MODEL_NOT_FOUND',
])

const WELCOME_MESSAGE = {
    id: 'welcome',
    role: 'assistant',
    text: "Hi! I'm your AI assistant. Ask me to open the migration wizard, create a repo, or help you manage your projects.",
}

// Session-scoped persistence: keep chat history across panel close/open and
// route navigation, but drop it when the tab is closed so long-lived sessions
// don't balloon sessionStorage with stale conversation logs.
const CHAT_STORAGE_KEY = 'grm-ai-assistant-messages'
const CHAT_STORAGE_MAX_MESSAGES = 200

function loadInitialMessages() {
    try {
        const raw = typeof window !== 'undefined' ? window.sessionStorage.getItem(CHAT_STORAGE_KEY) : null
        if (!raw) return [WELCOME_MESSAGE]
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed) || parsed.length === 0) return [WELCOME_MESSAGE]
        return parsed.slice(-CHAT_STORAGE_MAX_MESSAGES)
    } catch {
        return [WELCOME_MESSAGE]
    }
}

export function AIAssistant({ askAI, user, checkAIStatus }) {
    const [isOpen, setIsOpen] = useState(false)
    const [isMinimized, setIsMinimized] = useState(false)
    const [messages, setMessages] = useState(loadInitialMessages)
    const [input, setInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const messagesEndRef = useRef(null)
    const [isConfigured, setIsConfigured] = useState(true)
    const { openModal, openModalWithData } = useModal()
    const [pasteDialog, setPasteDialog] = useState(null)

    const handlePasteAnswer = useCallback((field, value) => {
      setPasteDialog((prev) => {
        if (!prev) return prev
        const nextAnswers = { ...prev.answers, [field]: value }
        const nextField = computeNextField(nextAnswers, prev.parsed)
        return {
          ...prev,
          answers: nextAnswers,
          nextField,
          status: nextField === null ? 'ready' : 'collecting',
        }
      })
    }, [])

    const handlePasteCancel = useCallback(() => setPasteDialog(null), [])

    const handlePasteConfirm = useCallback(() => {
      setPasteDialog((prev) => {
        if (!prev) return prev
        const payload = buildWizardPayload(prev)
        openModalWithData('showMigrationWizard', payload)
        return null
      })
    }, [openModalWithData])
    const [isIdle, setIsIdle] = useState(false)
    const idleTimerRef = useRef(null)
    const handleCloseChat = useCallback(() => setIsOpen(false), [])
    const chatRef = useFocusTrap(isOpen, handleCloseChat)

    // Instrument open-count for AI promo dismissal tracking
    useEffect(() => {
        if (!isOpen) return
        try {
            const current = parseInt(localStorage.getItem('ai-assistant-opened-count') ?? '0', 10)
            const next = Number.isFinite(current) ? current + 1 : 1
            localStorage.setItem('ai-assistant-opened-count', String(next))
        } catch {
            /* OK to skip */
        }
    }, [isOpen])

    useEffect(() => {
        if (!isOpen) return
        let cancelled = false
        const run = async () => {
            try {
                const status = await checkAIStatus()
                if (!cancelled) setIsConfigured(status?.configured ?? false)
            } catch {
                if (!cancelled) setIsConfigured(false)
            }
        }
        run()
        return () => { cancelled = true }
    }, [isOpen, checkAIStatus])

    useEffect(() => {
        const handler = () => { setIsOpen(true); setIsMinimized(false) }
        window.addEventListener('ai-assistant:open', handler)
        return () => window.removeEventListener('ai-assistant:open', handler)
    }, [])

    // System-level message injection — used when other parts of the app want
    // to nudge the user into an AI flow they wouldn't otherwise discover
    // (e.g. post-migration polish suggestion). Goes through sanitizeActions
    // so injected actions are validated against the same allow-list as
    // model-generated ones.
    useEffect(() => {
        const onInject = (ev) => {
            const detail = ev?.detail || {}
            const text = typeof detail.text === 'string' ? detail.text.trim() : ''
            if (!text) return
            const actions = sanitizeActions(detail.actions)
            setMessages(prev => [...prev, {
                id: nextMsgId(),
                role: 'assistant',
                text,
                actions,
                injected: true,
            }])
            // Pop the panel open so the message is visible right away.
            setIsOpen(true)
            setIsMinimized(false)
        }
        window.addEventListener('ai-assistant:inject-message', onInject)
        return () => window.removeEventListener('ai-assistant:inject-message', onInject)
    }, [])

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, isOpen])

    // Persist the most recent slice of the conversation to sessionStorage so
    // closing/reopening the panel (or navigating between routes) doesn't wipe
    // context. We cap at CHAT_STORAGE_MAX_MESSAGES to bound storage footprint.
    useEffect(() => {
        try {
            if (typeof window === 'undefined') return
            // Skip persisting a pristine state with only the welcome message.
            if (messages.length <= 1 && messages[0]?.id === 'welcome') {
                window.sessionStorage.removeItem(CHAT_STORAGE_KEY)
                return
            }
            const bounded = messages.slice(-CHAT_STORAGE_MAX_MESSAGES)
            window.sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(bounded))
        } catch {
            // Quota exceeded or private mode — degrade silently, the in-memory
            // state is still correct for this session.
        }
    }, [messages])

    useEffect(() => {
        if (isOpen) { setIsIdle(false); return }
        const startIdle = () => {
            clearTimeout(idleTimerRef.current)
            idleTimerRef.current = setTimeout(() => setIsIdle(true), 5000)
        }
        const wake = () => { setIsIdle(false); startIdle() }
        startIdle()
        window.addEventListener('scroll', wake, { passive: true })
        return () => {
            clearTimeout(idleTimerRef.current)
            window.removeEventListener('scroll', wake)
        }
    }, [isOpen])

    const handleActionClick = useCallback((action) => {
        dispatchAction(action, { openModal })
    }, [openModal])

    const sendMessage = useCallback(async (text) => {
        setMessages(prev => [...prev, { id: nextMsgId(), role: 'user', text }])
        setIsLoading(true)
        try {
            const response = await askAI(text, { user: user?.login })
            const actions = sanitizeActions(response?.actions)
            setMessages(prev => [...prev, {
                id: nextMsgId(),
                role: 'assistant',
                text: response?.reply || '',
                actions,
            }])
        } catch (err) {
            if (err?.code === 'AI_NOT_CONFIGURED' || err?.code === 'AI_NOT_INITIALIZED') {
                setIsConfigured(false)
                return
            }
            if (err?.code === 'SESSION_EXPIRED') {
                setMessages(prev => [...prev, {
                    id: nextMsgId(), role: 'assistant', isError: true,
                    text: 'Your session has expired. Please log in again to continue.',
                }])
                return
            }
            setMessages(prev => [...prev, {
                id: nextMsgId(), role: 'assistant', isError: true,
                text: err?.friendlyMessage || err?.message || 'Something went wrong talking to Gemini.',
                // Preserve the machine code so MessageBubble can branch on it
                // instead of substring-matching the human-readable text.
                errorCode: err?.code || null,
                retryText: text,
            }])
        } finally {
            setIsLoading(false)
        }
    }, [askAI, user?.login])

    const handleSubmit = (e) => {
        e.preventDefault()
        const trimmed = input.trim()
        if (!trimmed || isLoading) return
        setInput('')

        const detection = detectRepoUrl(trimmed)
        if (detection.sourceType) {
          setPasteDialog({
            status: 'collecting',
            sourceType: detection.sourceType,
            parsed: detection.parsed,
            answers: {},
            nextField: 'targetOrg',
          })
          return
        }

        sendMessage(trimmed)
    }

    return (
        <>
            <AnimatePresence>
                {!isOpen && (
                    <motion.button
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.8, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                        onClick={() => { setIsOpen(true); setIsIdle(false) }}
                        onMouseEnter={() => setIsIdle(false)}
                        className="fixed bottom-20 xl:bottom-6 right-3 sm:right-6 z-[var(--ds-z-composer)] group"
                        aria-label="Open AI Assistant"
                    >
                        <div className="relative">
                            <span className={`absolute inset-0 rounded-2xl bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 blur-lg transition-opacity duration-500 ${
                                isIdle ? 'opacity-0' : 'opacity-30 group-hover:opacity-60'
                            }`} />
                            <div className={`relative ds-btn-shimmer flex items-center bg-gradient-to-r from-indigo-600 via-indigo-600 to-purple-600 hover:from-indigo-500 hover:via-purple-500 hover:to-purple-500 text-white shadow-xl shadow-indigo-500/30 dark:shadow-indigo-500/50 transition-all duration-500 ease-in-out transform hover:scale-105 hover:-translate-y-0.5 ${
                                isIdle
                                    ? 'gap-0 px-3 py-3 rounded-full opacity-60 hover:opacity-100'
                                    : 'gap-2.5 px-4 py-3 rounded-2xl opacity-100'
                            }`}>
                                <Sparkles size={isIdle ? 16 : 18} className="shrink-0 transition-all duration-500" />
                                <span className={`text-sm font-semibold whitespace-nowrap transition-all duration-500 overflow-hidden ${
                                    isIdle ? 'w-0 opacity-0' : 'w-auto opacity-100 hidden sm:inline'
                                }`}>
                                    AI Assistant
                                </span>
                            </div>
                        </div>
                    </motion.button>
                )}
            </AnimatePresence>

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
                        <Card className={`ds-glass-strong w-[calc(100vw-2rem)] sm:w-[22rem] md:w-[26rem] flex flex-col shadow-2xl shadow-indigo-500/20 dark:shadow-black/60 border border-white/30 dark:border-white/10 bg-white/85 dark:bg-slate-900/80 overflow-hidden rounded-2xl transition-all duration-300 ${
                            isMinimized ? '' : 'h-[65vh] xl:h-[540px]'
                        }`}>
                            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                            <div
                                className="relative p-4 text-white flex items-center justify-between shrink-0 cursor-pointer select-none overflow-hidden"
                                onClick={() => isMinimized && setIsMinimized(false)}
                            >
                                <div
                                    className="absolute inset-0 bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600"
                                    style={{ backgroundSize: '200% 200%' }}
                                    aria-hidden="true"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" aria-hidden="true" />
                                <div className="relative flex items-center gap-3 z-10">
                                    <div className="relative w-9 h-9 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center ring-1 ring-white/30 shadow-inner">
                                        <Sparkles size={16} className="drop-shadow" />
                                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-white/60 animate-pulse" aria-hidden="true" />
                                    </div>
                                    <div className="leading-tight">
                                        <h3 className="font-semibold text-sm tracking-tight ds-font-display">Gemini Assistant</h3>
                                        <span className="text-[11px] text-white/80 flex items-center gap-1">
                                            <span className={`inline-block w-1.5 h-1.5 rounded-full ${isLoading ? 'bg-amber-300 animate-pulse' : 'bg-emerald-300'}`} aria-hidden="true" />
                                            {isLoading ? 'Thinking…' : 'Online'}
                                        </span>
                                    </div>
                                </div>
                                <div className="relative z-10 flex items-center gap-0.5">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); openModal('showSettings') }}
                                        className="p-1.5 hover:bg-white/15 rounded-lg transition-colors"
                                        title="AI Settings"
                                        aria-label="AI Settings"
                                    >
                                        <Settings size={14} />
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized) }}
                                        className="p-1.5 hover:bg-white/15 rounded-lg transition-colors"
                                        title={isMinimized ? 'Expand' : 'Minimize'}
                                        aria-label={isMinimized ? 'Expand assistant' : 'Minimize assistant'}
                                    >
                                        <Minus size={14} />
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setIsOpen(false) }}
                                        className="p-1.5 hover:bg-white/15 rounded-lg transition-colors"
                                        title="Close assistant"
                                        aria-label="Close assistant"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            </div>

                            {!isMinimized && (
                                <>
                                    {!isConfigured ? (
                                        <NotConfiguredState onOpenSettings={() => openModal('showSettings')} />
                                    ) : (
                                        <>
                                            <div className="ds-scrollbar flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-gradient-to-b from-slate-50/60 to-white/30 dark:from-slate-950/40 dark:to-slate-900/20">
                                                {messages.map((msg) => (
                                                    <MessageBubble
                                                        key={msg.id}
                                                        message={msg}
                                                        onAction={handleActionClick}
                                                        onRetry={(text) => sendMessage(text)}
                                                        onOpenSettings={() => openModal('showSettings')}
                                                    />
                                                ))}
                                                {pasteDialog && (
                                                  <AIAssistantPasteCard
                                                    dialog={pasteDialog}
                                                    onAnswer={handlePasteAnswer}
                                                    onConfirm={handlePasteConfirm}
                                                    onCancel={handlePasteCancel}
                                                  />
                                                )}
                                                {isLoading && <TypingIndicator />}
                                                <div ref={messagesEndRef} />
                                            </div>

                                            <form
                                                onSubmit={handleSubmit}
                                                className="p-3 border-t border-white/40 dark:border-white/10 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md shrink-0"
                                            >
                                                <div className="flex gap-2 items-end">
                                                    <input
                                                        type="text"
                                                        value={input}
                                                        onChange={(e) => setInput(e.target.value)}
                                                        placeholder="Ask me to open, create, or migrate…"
                                                        aria-label="Message the AI assistant"
                                                        className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/60 focus:border-indigo-400 transition-all placeholder:text-slate-400"
                                                    />
                                                    <button
                                                        type="submit"
                                                        disabled={isLoading || !input.trim()}
                                                        className="ds-btn-shimmer p-2.5 bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 text-white rounded-xl hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-md shadow-indigo-500/30 hover:shadow-lg hover:shadow-indigo-500/40 active:scale-95"
                                                        aria-label="Send message"
                                                    >
                                                        {isLoading
                                                            ? <Spinner size="sm" />
                                                            : <Send size={16} />}
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

function MessageBubble({ message, onAction, onRetry, onOpenSettings }) {
    const isUser = message.role === 'user'
    const isError = !!message.isError

    return (
        <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
            {!isUser && (
                <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${isError ? 'from-rose-500 to-amber-500' : 'from-indigo-500 via-purple-500 to-pink-500'} flex items-center justify-center shrink-0 mt-0.5 mr-2 ring-1 ring-white/30 shadow-sm`}>
                    {isError
                        ? <AlertTriangle size={13} className="text-white" />
                        : <Sparkles size={13} className="text-white" />}
                </div>
            )}
            <div className={`max-w-[82%] flex flex-col gap-2`}>
                <div
                    className={`px-3.5 py-2.5 text-sm leading-relaxed rounded-2xl shadow-sm ${
                        isUser
                            ? 'bg-gradient-to-br from-indigo-600 to-purple-600 text-white rounded-br-sm shadow-indigo-500/25'
                            : isError
                                ? 'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-900/50 rounded-bl-sm'
                                : 'bg-white dark:bg-slate-800/90 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-700/60 rounded-bl-sm prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-pre:my-2 prose-code:text-xs'
                    }`}
                >
                    {isUser ? message.text : <ReactMarkdown>{message.text}</ReactMarkdown>}
                </div>

                {!isUser && Array.isArray(message.actions) && message.actions.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {message.actions.map((action) => (
                            <ActionChip key={action.type} action={action} onClick={() => onAction(action)} />
                        ))}
                    </div>
                )}

                {isError && message.retryText && (
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => onRetry(message.retryText)}
                            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors"
                        >
                            <RotateCw size={12} /> Retry
                        </button>
                    </div>
                )}
                {isError && CONFIGURE_CTA_CODES.has(message.errorCode) && (
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={onOpenSettings}
                            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
                        >
                            <Key size={12} /> Configure API key
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}

function ActionChip({ action, onClick }) {
    return (
        <button
            type="button"
            onClick={onClick}
            data-action={action.type}
            className="group relative inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 text-indigo-700 dark:text-indigo-200 ring-1 ring-indigo-200 dark:ring-indigo-800/60 transition-all duration-200 hover:-translate-y-0.5 hover:ring-2 hover:ring-indigo-400 dark:hover:ring-indigo-500 hover:shadow-lg hover:shadow-indigo-500/25 active:translate-y-0"
        >
            <span className="pointer-events-none absolute -inset-px rounded-full bg-gradient-to-r from-indigo-500/0 via-purple-500/0 to-pink-500/0 group-hover:from-indigo-500/20 group-hover:via-purple-500/20 group-hover:to-pink-500/20 transition-opacity" aria-hidden="true" />
            <Sparkles size={11} className="relative text-indigo-500 dark:text-indigo-300 transition-transform group-hover:rotate-12" />
            <span className="relative truncate max-w-[180px]">{action.label}</span>
            <ArrowRight size={11} className="relative transition-transform group-hover:translate-x-0.5" />
        </button>
    )
}

function TypingIndicator() {
    return (
        <div className="flex justify-start" aria-live="polite" aria-label="Assistant is typing">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shrink-0 mt-0.5 mr-2 ring-1 ring-white/30 shadow-sm">
                <Sparkles size={13} className="text-white" />
            </div>
            <div className="bg-white dark:bg-slate-800/90 px-3.5 py-3 rounded-2xl rounded-bl-sm border border-slate-200/80 dark:border-slate-700/60 shadow-sm">
                <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 bg-gradient-to-br from-indigo-400 to-purple-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-2 h-2 bg-gradient-to-br from-purple-400 to-pink-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-2 h-2 bg-gradient-to-br from-pink-400 to-rose-400 rounded-full animate-bounce" />
                </div>
            </div>
        </div>
    )
}

function NotConfiguredState({ onOpenSettings }) {
    return (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4 bg-gradient-to-b from-slate-50 to-white dark:from-slate-950/50 dark:to-slate-900/40">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-100 via-purple-100 to-pink-100 dark:from-indigo-900/30 dark:via-purple-900/30 dark:to-pink-900/30 flex items-center justify-center shadow-inner ring-1 ring-indigo-200/50 dark:ring-indigo-900/40">
                <Key className="w-7 h-7 text-indigo-600 dark:text-indigo-300" />
            </div>
            <h4 className="text-lg font-semibold text-slate-900 dark:text-white ds-font-display">Setup required</h4>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-[260px]">
                The AI assistant needs a Gemini API key. Add <code className="font-mono text-xs bg-slate-100 dark:bg-slate-800 rounded px-1.5 py-0.5">GEMINI_API_KEY</code> in <code className="font-mono text-xs">server/.env</code>, or configure it from settings.
            </p>
            <button
                type="button"
                onClick={onOpenSettings}
                className="ds-btn-shimmer px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-sm font-semibold rounded-xl transition-all shadow-md shadow-indigo-500/25"
            >
                Open settings
            </button>
        </div>
    )
}

function computeNextField(answers, parsed) {
  if (!answers.targetOrg) return 'targetOrg'
  // Only ask for a custom name when the parser actually detected a repo
  // to "keep". When parsed.repo is null (e.g. Azure org/project-only URL),
  // there's nothing to rename — skip straight to ready.
  if (!parsed || !parsed.repo) return null
  if (answers.targetName === undefined) return 'targetName'
  return null
}
