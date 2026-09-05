import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { EASE, DURATION } from '../ui/motion'
import { X, GitCommitHorizontal, GitPullRequest, Eye } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
import { useDevToolkit } from '../../hooks/useDevToolkit'
import { RepoBadge } from './shared/RepoBadge'
import { SmartContextBar } from './shared/SmartContextBar'
import { CommitTab } from './CommitTab/CommitTab'
import { PRTab } from './PRTab/PRTab'
import { ReviewTab } from './ReviewTab/ReviewTab'
import { TabBar } from '../ui/TabBar'
import { Kbd } from '../ui/Kbd'

const TABS = [
    { id: 'commits', label: 'Commits', icon: GitCommitHorizontal, shortcut: '1' },
    { id: 'pr', label: 'Pull Request', icon: GitPullRequest, shortcut: '2' },
    { id: 'review', label: 'Review', icon: Eye, shortcut: '3' },
]

// TabBar's per-tab `trailing` slot renders the numeric shortcut hint that
// used to be a raw <kbd> hand-typed into the inline tab bar this replaces.
const DEV_TOOLKIT_TABS = TABS.map(tab => ({
    ...tab,
    trailing: <span className="hidden sm:inline"><Kbd>{tab.shortcut}</Kbd></span>,
}))

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
                        transition={{ duration: DURATION.slow, ease: EASE.standard }}
                        className="fixed right-0 top-0 bottom-0 z-[var(--ds-z-modal)] flex flex-col bg-white/70 dark:bg-slate-900/95 backdrop-blur-md border-l border-slate-200/40 dark:border-slate-700/40 ds-elevation-overlay"
                        style={{ width: `min(${toolkit.panelWidth}px, 100vw)` }}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Dev Toolkit"
                    >
                        {/* Drag handle */}
                        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- mouse-only resize affordance; the panel content is independently keyboard-navigable so a kbd resize isn't required */}
                        <div
                            onMouseDown={onDragStart}
                            className={`absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 transition-colors bg-transparent hover:bg-brand-500/50 ${
                                dragging ? 'bg-brand-500/50' : ''
                            }`}
                            role="separator"
                            aria-orientation="vertical"
                            aria-label="Resize panel"
                        />

                        {/* Header */}
                        <header className="relative bg-brand-700 dark:bg-brand-600 px-5 py-4">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded-md bg-white/20 flex items-center justify-center">
                                        <GitCommitHorizontal className="w-3.5 h-3.5 text-white" />
                                    </div>
                                    <h2 className="text-base font-semibold text-white">Dev Toolkit</h2>
                                </div>
                                <div className="flex items-center gap-2">
                                    {toolkit.autoDraftEnabled && (
                                        <span className="ds-eyebrow px-2 py-0.5 rounded-full bg-white text-[color:var(--ds-accent-brand)]">
                                            auto-draft
                                        </span>
                                    )}
                                    <button
                                        onClick={onClose}
                                        className="p-1.5 rounded-lg hover:bg-white/20 transition-colors ds-focus-ring"
                                        aria-label="Close panel"
                                    >
                                        <X className="w-4 h-4 text-white" />
                                    </button>
                                </div>
                            </div>
                            <p className="text-xs text-white mt-1 ml-8">
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
                        <TabBar
                            tabs={DEV_TOOLKIT_TABS}
                            activeTab={toolkit.activeTab}
                            onTabChange={toolkit.setActiveTab}
                            variant="underline"
                            layoutId="dev-toolkit-panel-tabs"
                            className="px-2"
                        />

                        {/* SmartContextBar */}
                        <SmartContextBar
                            analysis={filteredAnalysis}
                            diffSummary={toolkit.compareData?.diff_summary}
                            loading={toolkit.contextAnalysisLoading}
                            onSuggestionClick={handleSuggestionClick}
                            onDismissSuggestion={handleDismissSuggestion}
                        />

                        {/* Tab content — the element TabBar's aria-controls points at */}
                        <div
                            role="tabpanel"
                            id={`tabpanel-dev-toolkit-panel-tabs-${toolkit.activeTab}`}
                            aria-labelledby={`tab-dev-toolkit-panel-tabs-${toolkit.activeTab}`}
                            className="flex-1 overflow-y-auto ds-scrollbar"
                        >
                            {content}
                        </div>
                    </motion.aside>
                </>
            )}
        </AnimatePresence>
    )
}
