import { useState, useRef, useEffect, useCallback } from 'react'
import { useCopyToClipboard } from '../hooks/useCopyToClipboard'
import { X, Send, Sparkles, Loader2, Settings, Key, Minus, ArrowRight, AlertTriangle, RotateCw, ExternalLink, Copy, Check, Square, FolderGit2 } from 'lucide-react'
import { Spinner } from './ui/Spinner'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Input } from './ui/form'
import ReactMarkdown from 'react-markdown'
import { useModal } from '../hooks/useModal'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { motion, AnimatePresence } from 'framer-motion'
import { EASE } from './ui/motion'
import { sanitizeActions, dispatchAction } from '../utils/aiActions'
import { detectRepoUrl } from '../utils/repoUrlDetector'
import { AIAssistantPasteCard } from './AIAssistantPasteCard'
import { buildWizardPayload } from '../utils/pasteDialogPayload'
import { onAppEvent, APP_EVENTS } from '../utils/appEvents'

// Render Markdown links in assistant replies as premium, safe external sources
// (Phase 3 Slice 2). Grounded answers cite docs (e.g. the error KB's links);
// surface them distinctly with an external-link affordance and a hardened rel.
function SourceLink({ href, children }) {
    if (!href) return <>{children}</>
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-baseline gap-0.5 font-medium text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] underline decoration-brand-300/50 hover:decoration-brand-500 underline-offset-2 transition-colors ds-focus-ring"
        >
            {children}
            <ExternalLink size={11} className="self-center shrink-0" aria-hidden="true" />
        </a>
    )
}

// Extract the raw text of a Markdown AST node (for copy-to-clipboard).
function nodeText(node) {
    if (!node) return ''
    if (typeof node.value === 'string') return node.value
    if (Array.isArray(node.children)) return node.children.map(nodeText).join('')
    return ''
}

// Render fenced code blocks with a copy button — assistant fixes often include
// shell commands (e.g. `winget install GitHub.GitLFS`) worth one-click copying.
function CodeBlock({ node, children }) {
    const { copied, copy } = useCopyToClipboard(1500)
    const handleCopy = () => copy(nodeText(node))
    return (
        <div className="relative group/code">
            <button
                type="button"
                onClick={handleCopy}
                aria-label="Copy code"
                className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-medium bg-slate-700/80 text-slate-100 opacity-0 group-hover/code:opacity-100 focus-visible:opacity-100 transition-opacity ds-focus-ring"
            >
                {copied ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy'}
            </button>
            <pre>{children}</pre>
        </div>
    )
}

const MARKDOWN_COMPONENTS = { a: SourceLink, pre: CodeBlock }

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
    text: "I'm Repo Advisor. Ask me to open the migration wizard, create a repository, or help you manage your projects.",
}

// Capability-led starter prompts shown in the empty state. Concrete examples
// teach what the assistant can do far better than an open "ask me anything"
// (NN/g chatbot guidance) — and one nods to the troubleshooting it now grounds.
const SUGGESTED_PROMPTS = [
    'Migrate a repo from Azure DevOps',
    'Create a new repository',
    'Why did my migration fail?',
    'Find repositories similar to one of mine',
    'Draft a README for one of my repos',
    'Generate a security posture report',
]

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

export function AIAssistant({ askAI, askAIStream, user, checkAIStatus, currentRepo, currentView }) {
    const [isOpen, setIsOpen] = useState(false)
    const [isMinimized, setIsMinimized] = useState(false)
    // The persisted slice is already capped at CHAT_STORAGE_MAX_MESSAGES, but
    // the live in-memory array previously grew unboundedly. Wrap the setter
    // so every append also truncates — bounds a long-lived tab's memory at
    // the same ~200-message cap as sessionStorage.
    const [messages, setMessagesRaw] = useState(loadInitialMessages)
    const setMessages = useCallback((updater) => {
        setMessagesRaw((prev) => {
            const next = typeof updater === 'function' ? updater(prev) : updater
            return next.length > CHAT_STORAGE_MAX_MESSAGES
                ? next.slice(-CHAT_STORAGE_MAX_MESSAGES)
                : next
        })
    }, [])
    const [input, setInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const messagesEndRef = useRef(null)
    const [isConfigured, setIsConfigured] = useState(true)
    const { openModal, openModalWithData } = useModal()
    const [pasteDialog, setPasteDialog] = useState(null)
    // Context-awareness (Phase 2 Slice 2): a recent error the user is asking
    // about (e.g. a failed migration). Sent with each chat message so the
    // backend can ground the answer in the error knowledge base, and surfaced
    // as a dismissible chip so the user can see what Repo Advisor is looking at.
    const [activeContext, setActiveContext] = useState(null)

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
        return onAppEvent(APP_EVENTS.AI_ASSISTANT_OPEN, handler)
    }, [])

    // System-level message injection — used when other parts of the app want
    // to nudge the user into an AI flow they wouldn't otherwise discover
    // (e.g. post-migration polish suggestion). Goes through sanitizeActions
    // so injected actions are validated against the same allow-list as
    // model-generated ones.
    useEffect(() => {
        const onInject = (ev) => {
            const detail = ev?.detail || {}
            const ec = detail.errorContext
            const hasErrorContext = ec && typeof ec === 'object'
            if (hasErrorContext) {
                setActiveContext({
                    errorMessage: typeof ec.errorMessage === 'string' ? ec.errorMessage : undefined,
                    errorCode: typeof ec.errorCode === 'string' ? ec.errorCode : undefined,
                    label: typeof ec.label === 'string' && ec.label.trim() ? ec.label.trim() : 'Recent error',
                })
            }
            const text = typeof detail.text === 'string' ? detail.text.trim() : ''
            if (text) {
                const actions = sanitizeActions(detail.actions)
                setMessages(prev => [...prev, {
                    id: nextMsgId(),
                    role: 'assistant',
                    text,
                    actions,
                    injected: true,
                }])
            }
            // Pop the panel open when there's something to show — a message or a
            // freshly-attached error context the user can act on.
            if (text || hasErrorContext) {
                setIsOpen(true)
                setIsMinimized(false)
            }
        }
        return onAppEvent(APP_EVENTS.AI_ASSISTANT_INJECT_MESSAGE, onInject)
    }, [setMessages])

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
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-shot idle reset when the panel opens; the rest of the effect manages the idle timer + scroll listener (deps: [isOpen])
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

    // Holds the in-flight streaming request's controller so the Stop button can
    // abort it. Cleared when the request settles.
    const abortRef = useRef(null)
    const handleStop = useCallback(() => { abortRef.current?.abort() }, [])

    const sendMessage = useCallback(async (text) => {
        setMessages(prev => [...prev, { id: nextMsgId(), role: 'user', text }])
        setIsLoading(true)

        // Thread the active error context so the backend can ground the reply in
        // the error knowledge base (Phase 2 Slice 1).
        const ctx = { user: user?.login }
        if (activeContext?.errorMessage) ctx.errorMessage = activeContext.errorMessage
        if (activeContext?.errorCode) ctx.errorCode = activeContext.errorCode
        // Ambient repo/view context (P1.2) — lets the backend resolve "this
        // repo" instead of asking which one the user means.
        if (currentRepo) ctx.currentRepo = currentRepo
        if (currentView) ctx.currentView = currentView

        const surfaceError = (err) => {
            if (err?.code === 'AI_NOT_CONFIGURED' || err?.code === 'AI_NOT_INITIALIZED') {
                setIsConfigured(false)
                return
            }
            if (err?.code === 'SESSION_EXPIRED') {
                setMessages(prev => [...prev, {
                    id: nextMsgId(), role: 'assistant', isError: true,
                    text: 'Your session expired. Sign in again to continue.',
                }])
                return
            }
            setMessages(prev => [...prev, {
                id: nextMsgId(), role: 'assistant', isError: true,
                text: err?.friendlyMessage || err?.message || 'Something went wrong talking to the AI provider.',
                // Preserve the machine code so MessageBubble can branch on it
                // instead of substring-matching the human-readable text.
                errorCode: err?.code || null,
                retryText: text,
            }])
        }

        try {
            if (askAIStream) {
                // Streaming path: render an assistant bubble that fills in live as
                // the reply prose arrives, then finalize with the parsed actions.
                const streamId = nextMsgId()
                setMessages(prev => [...prev, { id: streamId, role: 'assistant', text: '', streaming: true }])
                const controller = new AbortController()
                abortRef.current = controller
                try {
                    const onDelta = (full) => setMessages(prev => prev.map(m => (
                        m.id === streamId ? { ...m, text: full } : m
                    )))
                    const response = await askAIStream(text, ctx, { onDelta, signal: controller.signal })
                    const actions = sanitizeActions(response?.actions)
                    setMessages(prev => prev.map(m => (
                        m.id === streamId
                            ? { ...m, text: response?.reply ?? m.text, actions, streaming: false }
                            : m
                    )))
                } catch (err) {
                    // A mid-stream disconnect must not silently swallow what the
                    // user already read. Keep the partial bubble (marked
                    // interrupted) when text arrived; only drop the placeholder
                    // when nothing streamed in. Either way surfaceError appends an
                    // honest error note + Retry that re-sends this same prompt.
                    setMessages(prev => {
                        const partial = prev.find(m => m.id === streamId)
                        if (partial && partial.text) {
                            return prev.map(m => (
                                m.id === streamId ? { ...m, streaming: false, interrupted: true } : m
                            ))
                        }
                        return prev.filter(m => m.id !== streamId)
                    })
                    surfaceError(err)
                } finally {
                    abortRef.current = null
                }
            } else {
                // Blocking fallback (mock mode / no streaming hook).
                const response = await askAI(text, ctx)
                const actions = sanitizeActions(response?.actions)
                setMessages(prev => [...prev, {
                    id: nextMsgId(), role: 'assistant', text: response?.reply || '', actions,
                }])
            }
        } catch (err) {
            surfaceError(err)
        } finally {
            setIsLoading(false)
        }
    }, [askAI, askAIStream, user?.login, setMessages, activeContext, currentRepo, currentView])

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
                        transition={{ duration: 0.2, ease: EASE.standard }}
                        onClick={() => { setIsOpen(true); setIsIdle(false) }}
                        onMouseEnter={() => setIsIdle(false)}
                        /* Hidden on mobile (< md): the AI Assistant entry point
                           on phones is consolidated into MobileQuickActionsFab
                           so the right edge isn't a stack of four FABs.

                           Bottom offset is the reserved strip, not a literal —
                           LegalFooter pads itself by the same token, so the
                           resting position is empty space rather than the
                           "Status / Commercial license" links it used to sit
                           on top of. */
                        className="hidden md:flex fixed right-3 sm:right-6 z-[var(--ds-z-composer)] group"
                        style={{ bottom: 'calc(var(--ds-fab-safe-bottom) - 44px)' }}
                        aria-label="Open Repo Advisor"
                    >
                        {/* Idle is a QUIETER control, not a dimmer one. The old
                            state dropped the whole button to 60% opacity, which
                            on a dark canvas reads as unfinished rather than
                            unobtrusive — and put the label under AA on the way
                            down. It now keeps full contrast and gives back
                            width: a circular mark that grows into the labelled
                            pill on hover, focus or a new message. */}
                        <span
                            className={`relative flex items-center ds-brand-solid shadow-[var(--ds-shadow)] ring-1 ring-black/5 dark:ring-white/10 ${
                                isIdle
                                    ? 'gap-0 p-3 rounded-full'
                                    : 'gap-2.5 pl-4 pr-4 py-3 rounded-2xl'
                            } motion-safe:transition-all motion-safe:duration-[var(--ds-duration-slow)] motion-safe:ease-[cubic-bezier(.2,0,0,1)] group-hover:gap-2.5 group-hover:pl-4 group-hover:pr-4 group-hover:py-3 group-hover:rounded-2xl group-focus-visible:gap-2.5 group-focus-visible:pl-4 group-focus-visible:pr-4 group-focus-visible:py-3 group-focus-visible:rounded-2xl`}
                        >
                            <Sparkles size={18} className="shrink-0" aria-hidden="true" />
                            <span
                                className={`text-sm font-semibold whitespace-nowrap overflow-hidden motion-safe:transition-all motion-safe:duration-[var(--ds-duration-slow)] group-hover:max-w-[10rem] group-hover:opacity-100 group-hover:visible group-focus-visible:max-w-[10rem] group-focus-visible:opacity-100 group-focus-visible:visible ${
                                    isIdle ? 'max-w-0 opacity-0 invisible' : 'max-w-[10rem] opacity-100 visible'
                                }`}
                            >
                                Repo Advisor
                            </span>
                        </span>
                    </motion.button>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        ref={chatRef}
                        role="dialog"
                        // Floating panel, not a blocking dialog — the rest of the page
                        // stays interactive while this is open (that's the point: browse
                        // repos while chatting), so aria-modal must be false.
                        aria-modal="false"
                        aria-label="Repo Advisor"
                        initial={{ opacity: 0, y: 20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 20, scale: 0.95 }}
                        transition={{ duration: 0.32, ease: EASE.standard }}
                        // z-popover (not a raw value): this panel replaces the closed-state
                        // FAB above (mutually exclusive via isOpen), so it only needs to
                        // clear other composer-level FABs, never coexist/compete with them —
                        // z-[var(--ds-z-popover)] is the contract's next rung up and is
                        // already reused for other fixed floating widgets in the app.
                        className="fixed right-3 sm:right-6 z-[var(--ds-z-popover)]"
                        style={{ bottom: 'calc(var(--ds-fab-safe-bottom) - 44px)' }}
                    >
                        <Card className={`w-[calc(100vw-2rem)] sm:w-[22rem] md:w-[26rem] flex flex-col shadow-[var(--ds-shadow-overlay)] border border-slate-200 dark:border-[color:var(--ds-border-dark)] bg-white dark:bg-[color:var(--ds-surface-dark)] overflow-hidden rounded-2xl transition-all duration-[var(--ds-duration-slow)] ${
                            isMinimized ? '' : 'h-[65vh] xl:h-[540px]'
                        }`}>
                            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                            <div
                                className="relative p-4 text-white flex items-center justify-between shrink-0 cursor-pointer select-none overflow-hidden"
                                onClick={() => isMinimized && setIsMinimized(false)}
                            >
                                <div
                                    className="absolute inset-0 bg-[color:var(--ds-accent-brand)]"
                                    aria-hidden="true"
                                />
                                <div className="relative flex items-center gap-3 z-10">
                                    <div className="relative w-9 h-9 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center ring-1 ring-white/30 shadow-inner">
                                        <Sparkles size={16} className="drop-shadow" />
                                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-white/60 animate-pulse" aria-hidden="true" />
                                    </div>
                                    <div className="leading-tight">
                                        <h3 className="font-semibold text-sm tracking-tight ds-font-display">Repo Advisor</h3>
                                        <span className="ds-text-meta text-white flex items-center gap-1">
                                            <span className={`inline-block w-1.5 h-1.5 rounded-full ${isLoading ? 'bg-amber-300 animate-pulse' : 'bg-emerald-300'}`} aria-hidden="true" />
                                            {isLoading ? 'Thinking…' : 'Online'}
                                        </span>
                                    </div>
                                </div>
                                <div className="relative z-10 flex items-center gap-0.5">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); openModal('showSettings') }}
                                        className="p-1.5 hover:bg-white/15 rounded-lg transition-colors ds-focus-ring"
                                        title="AI Settings"
                                        aria-label="AI Settings"
                                    >
                                        <Settings size={14} />
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized) }}
                                        className="p-1.5 hover:bg-white/15 rounded-lg transition-colors ds-focus-ring"
                                        title={isMinimized ? 'Expand' : 'Minimize'}
                                        aria-label={isMinimized ? 'Expand assistant' : 'Minimize assistant'}
                                    >
                                        <Minus size={14} />
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setIsOpen(false) }}
                                        className="p-1.5 hover:bg-white/15 rounded-lg transition-colors ds-focus-ring"
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
                                            <div
                                                className="ds-scrollbar flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-slate-50/40 dark:bg-slate-900/40"
                                                role="log"
                                                aria-live="polite"
                                                aria-relevant="additions"
                                                aria-label="Conversation"
                                            >
                                                {messages.map((msg) => (
                                                    <MessageBubble
                                                        key={msg.id}
                                                        message={msg}
                                                        onAction={handleActionClick}
                                                        onRetry={(text) => sendMessage(text)}
                                                        onOpenSettings={() => openModal('showSettings')}
                                                    />
                                                ))}
                                                {messages.length === 1 && messages[0]?.id === 'welcome' && !pasteDialog && !isLoading && (
                                                    <div className="pt-1">
                                                        <p className="ds-text-meta text-slate-500 dark:text-slate-400 mb-2 px-0.5">Try asking</p>
                                                        <div className="flex flex-wrap gap-2">
                                                            {SUGGESTED_PROMPTS.map((prompt) => (
                                                                <button
                                                                    key={prompt}
                                                                    type="button"
                                                                    onClick={() => sendMessage(prompt)}
                                                                    className="text-left text-xs font-medium px-3 py-2 rounded-xl bg-white dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700/60 hover:border-brand-300 dark:hover:border-brand-500/40 hover:text-brand-600 dark:hover:text-brand-300 transition-colors ds-focus-ring"
                                                                >
                                                                    {prompt}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                {pasteDialog && (
                                                  <AIAssistantPasteCard
                                                    dialog={pasteDialog}
                                                    onAnswer={handlePasteAnswer}
                                                    onConfirm={handlePasteConfirm}
                                                    onCancel={handlePasteCancel}
                                                  />
                                                )}
                                                {isLoading && !messages.some(m => m.streaming) && <TypingIndicator />}
                                                <div ref={messagesEndRef} />
                                            </div>

                                            {currentRepo && (
                                                <div className="px-3 pt-2 overflow-hidden shrink-0">
                                                    <div className="flex items-center gap-2 rounded-lg bg-slate-100/80 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 px-2.5 py-1.5">
                                                        <FolderGit2 size={12} className="text-slate-400 dark:text-slate-500 shrink-0" aria-hidden="true" />
                                                        <span className="text-xs text-slate-500 dark:text-slate-400 truncate flex-1 min-w-0">
                                                            Looking at: <span className="font-medium text-slate-700 dark:text-slate-300">{currentRepo}</span>
                                                        </span>
                                                    </div>
                                                </div>
                                            )}

                                            <AnimatePresence>
                                                {activeContext && (
                                                    <motion.div
                                                        initial={{ opacity: 0, height: 0 }}
                                                        animate={{ opacity: 1, height: 'auto' }}
                                                        exit={{ opacity: 0, height: 0 }}
                                                        transition={{ duration: 0.2, ease: EASE.standard }}
                                                        className="px-3 pt-2 overflow-hidden shrink-0"
                                                    >
                                                        <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/40 px-2.5 py-1.5">
                                                            <AlertTriangle size={12} className="text-amber-500 dark:text-amber-400 shrink-0" aria-hidden="true" />
                                                            <span className="text-xs text-amber-800 dark:text-amber-200 truncate flex-1 min-w-0">
                                                                Context: {activeContext.label || 'Recent error'}
                                                            </span>
                                                            <button
                                                                type="button"
                                                                onClick={() => setActiveContext(null)}
                                                                className="shrink-0 p-0.5 rounded hover:bg-amber-200/50 dark:hover:bg-amber-900/40 text-amber-700 dark:text-amber-300 transition-colors ds-focus-ring"
                                                                aria-label="Clear context"
                                                            >
                                                                <X size={12} />
                                                            </button>
                                                        </div>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>

                                            <form
                                                onSubmit={handleSubmit}
                                                className="p-3 border-t border-slate-200 dark:border-[color:var(--ds-border-dark)] bg-white/90 dark:bg-[color:var(--ds-surface-dark)] backdrop-blur-md shrink-0"
                                            >
                                                <div className="flex gap-2 items-end">
                                                    <div className="flex-1 min-w-0">
                                                        <Input
                                                            type="text"
                                                            value={input}
                                                            onChange={(e) => setInput(e.target.value)}
                                                            placeholder="Ask me to open, create, or migrate…"
                                                            aria-label="Message the AI assistant"
                                                            autoComplete="off"
                                                        />
                                                    </div>
                                                    {isLoading && askAIStream ? (
                                                        <button
                                                            type="button"
                                                            onClick={handleStop}
                                                            className="shrink-0 inline-flex items-center justify-center h-11 w-11 bg-slate-700 dark:bg-slate-600 text-white rounded-xl hover:opacity-90 transition-colors shadow-sm ds-focus-ring"
                                                            aria-label="Stop generating"
                                                            title="Stop"
                                                        >
                                                            <Square size={14} fill="currentColor" />
                                                        </button>
                                                    ) : (
                                                        <button
                                                            type="submit"
                                                            disabled={isLoading || !input.trim()}
                                                            className="shrink-0 inline-flex items-center justify-center h-11 w-11 ds-brand-solid rounded-xl hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm ds-focus-ring"
                                                            aria-label="Send message"
                                                        >
                                                            {isLoading
                                                                ? <Spinner size="sm" />
                                                                : <Send size={16} />}
                                                        </button>
                                                    )}
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
                <div className={`w-7 h-7 rounded-lg ${isError ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400' : 'ds-brand-solid'} flex items-center justify-center shrink-0 mt-0.5 mr-2 shadow-sm`}>
                    {isError
                        ? <AlertTriangle size={13} className="text-rose-600 dark:text-rose-400" />
                        : <Sparkles size={13} className="text-white" />}
                </div>
            )}
            <div className={`max-w-[82%] flex flex-col gap-2`}>
                <div
                    className={`px-3.5 py-2.5 text-sm leading-relaxed rounded-2xl shadow-sm ${
                        isUser
                            ? 'ds-brand-solid rounded-br-sm shadow-sm'
                            : isError
                                ? 'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-900/50 rounded-bl-sm'
                                : 'bg-white dark:bg-slate-800/90 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-700/60 rounded-bl-sm prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-pre:my-2 prose-code:text-xs'
                    }`}
                >
                    {isUser
                        ? message.text
                        : (
                            <>
                                <ReactMarkdown components={MARKDOWN_COMPONENTS}>{message.text}</ReactMarkdown>
                                {message.streaming && (
                                    <span
                                        className="inline-block w-1.5 h-3.5 -mb-0.5 ml-0.5 align-baseline rounded-[1px] bg-[color:var(--ds-accent-brand)] dark:bg-[color:var(--ds-accent-brand-dark)] animate-pulse motion-reduce:animate-none"
                                        aria-hidden="true"
                                    />
                                )}
                                {message.interrupted && (
                                    <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                                        <AlertTriangle size={11} aria-hidden="true" />
                                        Response interrupted — retry below to continue.
                                    </p>
                                )}
                            </>
                        )}
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
                            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-300 transition-colors"
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
                            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full ds-brand-solid hover:bg-brand-500 transition-colors"
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
            className="group inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] ring-1 ring-slate-200 dark:ring-slate-700 transition-colors duration-150 hover:ring-brand-300 dark:hover:ring-brand-500/40 hover:bg-slate-50 dark:hover:bg-slate-700/60"
        >
            <Sparkles size={11} className="relative text-brand-500 dark:text-brand-300 transition-transform group-hover:rotate-12" />
            <span className="relative truncate max-w-[180px]">{action.label}</span>
            <ArrowRight size={11} className="relative transition-transform group-hover:translate-x-0.5" />
        </button>
    )
}

function TypingIndicator() {
    return (
        <div className="flex justify-start" aria-live="polite" aria-label="Assistant is typing">
            <div className="w-7 h-7 rounded-lg bg-[color:var(--ds-accent-brand)] flex items-center justify-center shrink-0 mt-0.5 mr-2 shadow-sm">
                <Sparkles size={13} className="text-white" />
            </div>
            <div className="bg-white dark:bg-slate-800/90 px-3.5 py-3 rounded-2xl rounded-bl-sm border border-slate-200/80 dark:border-slate-700/60 shadow-sm flex items-center">
                <Spinner size="sm" tone="muted" label="Typing" />
            </div>
        </div>
    )
}

function NotConfiguredState({ onOpenSettings }) {
    return (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4 bg-slate-50 dark:bg-slate-900/40">
            <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center ring-1 ring-slate-200 dark:ring-slate-700">
                <Key className="w-7 h-7 text-[color:var(--ds-accent-brand)]" />
            </div>
            <h4 className="text-lg font-semibold text-slate-900 dark:text-slate-100 ds-font-display">Setup required</h4>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-[260px]">
                Repo Advisor needs an AI provider key. Add a provider key (e.g. <code className="font-mono text-xs bg-slate-100 dark:bg-slate-800 rounded px-1.5 py-0.5">GEMINI_API_KEY</code>) in <code className="font-mono text-xs">server/.env</code>, or configure a provider from settings.
            </p>
            <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={onOpenSettings}
            >
                Open settings
            </Button>
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
