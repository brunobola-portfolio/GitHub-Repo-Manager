import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X, GitCommitHorizontal, GitPullRequest, Eye } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
import { useDevToolkit } from '../../hooks/useDevToolkit'
import { RepoBadge } from './shared/RepoBadge'
import { SmartContextBar } from './shared/SmartContextBar'
import { CommitTab } from './CommitTab/CommitTab'
import { PRTab } from './PRTab/PRTab'
import { ReviewTab } from './ReviewTab/ReviewTab'

const TABS = [
    { id: 'commits', label: 'Commits', icon: GitCommitHorizontal, shortcut: '1' },
    { id: 'pr', label: 'Pull Request', icon: GitPullRequest, shortcut: '2' },
    { id: 'review', label: 'Review', icon: Eye, shortcut: '3' },
]

const MIN_WIDTH = 480
const MAX_WIDTH = 900

export function DevToolkitPanel({ isOpen, onClose, modalData, repos, onStartReview }) {
    const toolkit = useDevToolkit({
        repos,
        initialTab: modalData?.initialTab,
        initialRepo: modalData?.repo,
        initialBranch: modalData?.branch,
        initialPR: modalData?.pr,
    })

    const panelRef = useFocusTrap(isOpen, onClose)
    useBodyScrollLock(isOpen)

    // --- Drag resize (Q3: only depend on setPanelWidth, not entire toolkit) ---
    const [dragging, setDragging] = useState(false)
    const dragStartX = useRef(0)
    const dragStartWidth = useRef(0)
    const { setPanelWidth } = toolkit

    const onDragStart = useCallback((e) => {
        e.preventDefault()
        setDragging(true)
        dragStartX.current = e.clientX
        dragStartWidth.current = toolkit.panelWidth
    }, [toolkit.panelWidth])

    useEffect(() => {
        if (!dragging) return

        const onMouseMove = (e) => {
            const delta = dragStartX.current - e.clientX
            const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragStartWidth.current + delta))
            setPanelWidth(next)
        }

        const onMouseUp = () => {
            setDragging(false)
        }

        window.addEventListener('mousemove', onMouseMove)
        window.addEventListener('mouseup', onMouseUp)
        return () => {
            window.removeEventListener('mousemove', onMouseMove)
            window.removeEventListener('mouseup', onMouseUp)
        }
    }, [dragging, setPanelWidth])

    // --- Keyboard shortcuts (U1) ---
    const { setActiveTab } = toolkit
    useEffect(() => {
        if (!isOpen) return

        const handleKeyDown = (e) => {
            // Don't capture when typing in inputs
            const tag = e.target.tagName
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

            // Tab switching: 1, 2, 3
            if (e.key === '1') { setActiveTab('commits'); return }
            if (e.key === '2') { setActiveTab('pr'); return }
            if (e.key === '3') { setActiveTab('review'); return }

            // Escape to close
            if (e.key === 'Escape') { onClose(); return }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isOpen, setActiveTab, onClose])

    // --- Dismissed suggestions (local) ---
    const [dismissedSuggestions, setDismissedSuggestions] = useState([])

    const filteredAnalysis = useMemo(() => {
        if (!toolkit.contextAnalysis) return null
        if (dismissedSuggestions.length === 0) return toolkit.contextAnalysis
        return {
            ...toolkit.contextAnalysis,
            suggestions: (toolkit.contextAnalysis.suggestions || []).filter(
                (_, i) => !dismissedSuggestions.includes(i)
            ),
        }
    }, [toolkit.contextAnalysis, dismissedSuggestions])

    const handleDismissSuggestion = useCallback((index) => {
        setDismissedSuggestions(prev => [...prev, index])
    }, [])

    const handleSuggestionClick = useCallback((suggestion) => {
        if (suggestion.tab) {
            toolkit.setActiveTab(suggestion.tab)
        }
    }, [toolkit])

    // --- Tab content ---
    const content = useMemo(() => {
        if (!toolkit.selectedRepo && !toolkit.isPinned) {
            return (
                <div className="flex-1 flex items-center justify-center p-8">
                    <div className="text-center space-y-3">
                        <div className="w-12 h-12 mx-auto rounded-xl bg-slate-100 dark:bg-slate-800/60 flex items-center justify-center">
                            <GitCommitHorizontal className="w-6 h-6 text-slate-400" />
                        </div>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            Select a repository to get started
                        </p>
                    </div>
                </div>
            )
        }

        switch (toolkit.activeTab) {
            case 'commits':
                return <CommitTab toolkit={toolkit} />
            case 'pr':
                return <PRTab toolkit={toolkit} />
            case 'review':
                return <ReviewTab toolkit={toolkit} onStartReview={onStartReview} onClose={onClose} />
            default:
                return null
        }
    }, [toolkit, onStartReview, onClose])

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[var(--ds-z-modal)]"
                        aria-hidden="true"
                    />

                    {/* Panel */}
                    <motion.aside
                        ref={panelRef}
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                        className="fixed right-0 top-0 bottom-0 z-[var(--ds-z-modal)] flex flex-col bg-white/70 dark:bg-slate-900/95 backdrop-blur-xl border-l border-slate-200/40 dark:border-slate-700/40 shadow-2xl"
                        style={{ width: `min(${toolkit.panelWidth}px, 100vw)` }}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Dev Toolkit"
                    >
                        {/* Drag handle */}
                        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- mouse-only resize affordance; the panel content is independently keyboard-navigable so a kbd resize isn't required */}
                        <div
                            onMouseDown={onDragStart}
                            className={`absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 transition-colors bg-transparent hover:bg-indigo-500/50 ${
                                dragging ? 'bg-indigo-500/50' : ''
                            }`}
                            role="separator"
                            aria-orientation="vertical"
                            aria-label="Resize panel"
                        />

                        {/* Header */}
                        <header className="relative bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-4">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded-md bg-white/20 flex items-center justify-center">
                                        <GitCommitHorizontal className="w-3.5 h-3.5 text-white" />
                                    </div>
                                    <h2 className="text-base font-semibold text-white">Dev Toolkit</h2>
                                </div>
                                <div className="flex items-center gap-2">
                                    {toolkit.autoDraftEnabled && (
                                        <span className="px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider rounded-full bg-white/20 text-white/80">
                                            auto-draft
                                        </span>
                                    )}
                                    <button
                                        onClick={onClose}
                                        className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
                                        aria-label="Close panel"
                                    >
                                        <X className="w-4 h-4 text-white" />
                                    </button>
                                </div>
                            </div>
                            <p className="text-xs text-white/70 mt-1 ml-8">
                                AI-powered developer tools
                            </p>
                            <div className="mt-3">
                                <RepoBadge
                                    repos={toolkit.repos}
                                    selectedRepo={toolkit.selectedRepo}
                                    isPinned={toolkit.isPinned}
                                    onSelectRepo={toolkit.selectRepo}
                                    onTogglePin={() => toolkit.setIsPinned(!toolkit.isPinned)}
                                />
                            </div>
                        </header>

                        {/* Tab bar */}
                        <nav className="flex border-b border-slate-200/60 dark:border-slate-700/40 px-2" role="tablist">
                            {TABS.map((tab) => {
                                const Icon = tab.icon
                                const isActive = toolkit.activeTab === tab.id
                                return (
                                    <button
                                        key={tab.id}
                                        role="tab"
                                        aria-selected={isActive}
                                        onClick={() => toolkit.setActiveTab(tab.id)}
                                        className={`relative flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors ${
                                            isActive
                                                ? 'text-indigo-600 dark:text-indigo-400'
                                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                                        }`}
                                        title={`${tab.label} (${tab.shortcut})`}
                                    >
                                        <Icon className="w-4 h-4" />
                                        {tab.label}
                                        <kbd className="hidden sm:inline ml-1 text-[9px] text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded font-mono">{tab.shortcut}</kbd>
                                        {isActive && (
                                            <motion.div
                                                layoutId="dev-toolkit-panel-tabs"
                                                className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 dark:bg-indigo-400 rounded-full"
                                                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                                            />
                                        )}
                                    </button>
                                )
                            })}
                        </nav>

                        {/* SmartContextBar */}
                        <SmartContextBar
                            analysis={filteredAnalysis}
                            diffSummary={toolkit.compareData?.diff_summary}
                            loading={toolkit.contextAnalysisLoading}
                            onSuggestionClick={handleSuggestionClick}
                            onDismissSuggestion={handleDismissSuggestion}
                        />

                        {/* Tab content */}
                        <div className="flex-1 overflow-y-auto ds-scrollbar">
                            {content}
                        </div>
                    </motion.aside>
                </>
            )}
        </AnimatePresence>
    )
}
