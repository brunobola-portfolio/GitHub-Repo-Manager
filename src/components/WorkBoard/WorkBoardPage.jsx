/**
 * Cross-Repo Work Board — Phase E3
 *
 * Tabs:
 *   1. My Reviews   — pending review assignments (Free+)
 *   2. Stale PRs    — PRs open > N days (Pro+)
 *   3. My Issues    — assigned open issues (Free+)
 *   4. Review Load  — reviewer distribution (Pro+)
 *   5. Tech Debt    — labelled issues + hotspots (Pro+)
 *   6. DORA         — deploy freq + lead time (Enterprise+)
 */

import { useState, useEffect } from 'react'
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion'
import {
    GitPullRequest, CircleDot, BarChart3,
    AlertTriangle, Wrench, Users, RefreshCw,
} from 'lucide-react'
import {
    useMyPendingReviews,
    useStalePRs,
    useMyOpenIssues,
    useTechDebt,
    useKpiSnapshots,
} from '../../hooks/useWorkBoard'
import { useRelativeTime } from '../../hooks/useRelativeTime'
import { useUrlParams } from '../../hooks/useUrlParams'
import { WorkBoardFilterBar } from './filters/WorkBoardFilterBar'
import { PresetDropdown } from './filters/PresetDropdown'
import { FilterProvider } from './filters/filter-context'
import { useContextShortcut } from '../../hooks/useKeyboardShortcuts'
import { useModal } from '../../hooks/useModal'
import { KeyboardHelpModal } from './KeyboardHelpModal'
import { AISummaryCard } from './AISummaryCard'
import { KpiRow } from './KpiRow'
import { MyReviewsTab } from './tabs/MyReviewsTab'
import { StalePRsTab } from './tabs/StalePRsTab'
import { MyIssuesTab } from './tabs/MyIssuesTab'
import { ReviewLoadTab } from './tabs/ReviewLoadTab'
import { TechDebtTab } from './tabs/TechDebtTab'
import { DORATab } from './tabs/DORATab'

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

const TABS = [
    { id: 'reviews',     label: 'My Reviews',  icon: GitPullRequest, component: MyReviewsTab, accent: 'purple' },
    { id: 'stale',       label: 'Stale PRs',   icon: AlertTriangle,  component: StalePRsTab,  accent: 'amber' },
    { id: 'issues',      label: 'My Issues',   icon: CircleDot,      component: MyIssuesTab,  accent: 'emerald' },
    { id: 'reviewload',  label: 'Review Load', icon: Users,          component: ReviewLoadTab, badge: 'Pro', accent: 'sky' },
    { id: 'techdebt',    label: 'Tech Debt',   icon: Wrench,         component: TechDebtTab, badge: 'Pro', accent: 'amber' },
    { id: 'dora',        label: 'DORA',        icon: BarChart3,      component: DORATab, badge: 'Enterprise', accent: 'indigo' },
]

// ---------------------------------------------------------------------------
// WorkBoardPage
// ---------------------------------------------------------------------------

export function WorkBoardPage({ repoCount = 0 }) {
    const [params, setParams] = useUrlParams(['tab', 'repos', 'authors', 'labels', 'age', 'snoozed'])
    const activeTab = params.tab || 'reviews'
    const setActiveTab = (tab) => setParams({ tab: tab === 'reviews' ? '' : tab })

    // Help modal state (from centralized ModalContext)
    const { modalStates, openModal, closeModal } = useModal()
    const helpOpen = modalStates.workBoardHelp || false

    // `?` opens help (Shift+/ yields event.key === '?' on most layouts)
    useContextShortcut({ key: '?', handler: () => openModal('workBoardHelp') })
    // Escape closes help
    useContextShortcut({ key: 'Escape', handler: () => closeModal('workBoardHelp'), when: helpOpen, deps: [helpOpen] })

    // Note: a `g`-prefix tab chord was considered but `g` is already bound
    // globally to "Open Dev Toolkit" in useKeyboardShortcuts. Tabs remain
    // accessible via click, URL (`?tab=…`), and the command palette.

    // Command palette wiring — listen for palette-originated events and act.
    // Keeping listeners here means any palette implementation can drive the page
    // without threading callbacks through many layers.
    useEffect(() => {
        const onGoTab = (e) => {
            if (typeof e.detail === 'string') setActiveTab(e.detail)
        }
        const onRegen = () => window.dispatchEvent(new CustomEvent('workboard:ai-regenerate-internal'))
        const onSave = () => {
            // Lightweight first pass: nudge user to the filter-bar PresetDropdown.
            // A deeper integration would open the dropdown + focus its input; we
            // skip that to avoid cross-component ref coupling.
            if (typeof window !== 'undefined' && typeof window.alert === 'function') {
                window.alert('Use the Presets dropdown in the filter bar to save the current filters as a preset.')
            }
        }
        window.addEventListener('workboard:go-tab', onGoTab)
        window.addEventListener('workboard:regenerate-ai', onRegen)
        window.addEventListener('workboard:save-preset', onSave)
        return () => {
            window.removeEventListener('workboard:go-tab', onGoTab)
            window.removeEventListener('workboard:regenerate-ai', onRegen)
            window.removeEventListener('workboard:save-preset', onSave)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const reviews = useMyPendingReviews()
    const stale = useStalePRs({ staleAfterDays: 7 })
    const issues = useMyOpenIssues()
    const debt = useTechDebt()
    const { data: kpiSnapshots } = useKpiSnapshots({ days: 7 })

    // Aggregate filter options from the data loaded by all primary tabs.
    const allItems = [
        ...(Array.isArray(reviews.data) ? reviews.data : []),
        ...(Array.isArray(stale.data) ? stale.data : []),
        ...(Array.isArray(issues.data) ? issues.data : []),
        ...((debt.data?.items) || []),
    ]
    const availableRepos = Array.from(new Set(allItems.map(i => i.repoFullName).filter(Boolean))).sort()
    const availableAuthors = Array.from(new Set(allItems.map(i => i.authorLogin).filter(Boolean))).sort()
    const availableLabels = Array.from(new Set(allItems.flatMap(i => i.labels || []).filter(Boolean))).sort()

    const earliest = (() => {
        const times = [reviews.lastFetchedAt, stale.lastFetchedAt, issues.lastFetchedAt, debt.lastFetchedAt]
            .filter(Boolean)
            .map(d => d.getTime())
        return times.length > 0 ? new Date(Math.min(...times)) : null
    })()
    const earliestLabel = useRelativeTime(earliest)

    const [refreshing, setRefreshing] = useState(false)
    const refreshAll = async () => {
        setRefreshing(true)
        try {
            await Promise.all([
                reviews.refresh?.(),
                stale.refresh?.(),
                issues.refresh?.(),
                debt.refresh?.(),
            ])
        } finally {
            setRefreshing(false)
        }
    }

    const ActiveComponent = TABS.find(t => t.id === activeTab)?.component || MyReviewsTab

    return (
        <div className="max-w-6xl mx-auto space-y-7 animate-in fade-in duration-500 px-1">
            {/* Header */}
            <div className="flex items-end justify-between gap-4 flex-wrap">
                <div>
                    <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-500 dark:text-indigo-400 mb-2">
                        <span className="w-6 h-px bg-gradient-to-r from-transparent via-indigo-400 to-indigo-500" />
                        Cross-Repo Activity
                    </div>
                    <h1 className="text-3xl md:text-4xl font-bold ds-font-display ds-gradient-text leading-tight">
                        Work Board
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                        {repoCount > 0
                            ? `${repoCount} repos tracked · live signals across reviews, issues & delivery`
                            : 'Live signals across reviews, issues & delivery'}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {earliest && (
                        <span className="text-[11px] text-slate-400 dark:text-slate-500" aria-live="polite">
                            updated {earliestLabel}
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={refreshAll}
                        disabled={refreshing}
                        aria-label="Refresh work board"
                        className="p-2 rounded-xl border border-slate-200/60 dark:border-slate-700/50 bg-white/70 dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-600 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                    >
                        <motion.div animate={{ rotate: refreshing ? 360 : 0 }} transition={{ duration: 0.6, ease: 'easeInOut' }}>
                            <RefreshCw className="w-4 h-4" />
                        </motion.div>
                    </button>
                </div>
            </div>

            {/* AI summary card — silently hides when ai_not_configured */}
            <AISummaryCard />

            {/* KPI row */}
            <KpiRow
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                reviews={reviews}
                stale={stale}
                issues={issues}
                debt={debt}
                snapshots={kpiSnapshots ?? []}
            />

            <FilterProvider
                params={params}
                availableRepos={availableRepos}
                availableAuthors={availableAuthors}
                availableLabels={availableLabels}
            >
            {/* Filter bar (URL-synced) */}
            <WorkBoardFilterBar
                filters={params}
                setFilters={setParams}
                availableRepos={availableRepos}
                availableAuthors={availableAuthors}
                availableLabels={availableLabels}
            >
                <PresetDropdown currentFilters={params} onApply={setParams} />
            </WorkBoardFilterBar>

            {/* Main card */}
            <div className="relative rounded-3xl border border-slate-200/60 dark:border-slate-700/50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-xl shadow-slate-300/20 dark:shadow-black/40 overflow-hidden">
                <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[520px] h-[220px] rounded-full bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-transparent blur-3xl" />

                {/* Tab bar */}
                <LayoutGroup>
                <div role="tablist" aria-label="Work Board sections" className="relative flex items-center gap-1 p-2.5 border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/60 dark:bg-slate-800/30 overflow-x-auto">
                    {TABS.map(tab => {
                        const Icon = tab.icon
                        const isActive = activeTab === tab.id
                        return (
                            <button
                                key={tab.id}
                                role="tab"
                                aria-selected={isActive}
                                onClick={() => setActiveTab(tab.id)}
                                className={`
                                    relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-colors duration-200
                                    ${isActive
                                        ? 'text-indigo-600 dark:text-indigo-300'
                                        : 'text-slate-500 dark:text-slate-400 hover:bg-white/70 dark:hover:bg-slate-700/50 hover:text-slate-700 dark:hover:text-slate-200'
                                    }
                                `}
                            >
                                <Icon className="w-4 h-4" />
                                {tab.label}
                                {tab.badge && (
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                                        tab.badge === 'Enterprise'
                                            ? 'bg-gradient-to-r from-amber-100 to-orange-100 dark:from-amber-900/40 dark:to-orange-900/40 text-amber-700 dark:text-amber-300'
                                            : 'bg-gradient-to-r from-indigo-100 to-purple-100 dark:from-indigo-900/50 dark:to-purple-900/50 text-indigo-600 dark:text-indigo-300'
                                    }`}>
                                        {tab.badge}
                                    </span>
                                )}
                                {isActive && (
                                    <motion.div
                                        layoutId="work-board-tab-indicator"
                                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full"
                                        transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                                    />
                                )}
                            </button>
                        )
                    })}
                </div>
                </LayoutGroup>

                {/* Tab content */}
                <AnimatePresence mode="wait">
                    <motion.div
                        key={activeTab}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.18 }}
                        className="min-h-[380px]"
                    >
                        <ActiveComponent />
                    </motion.div>
                </AnimatePresence>
            </div>
            </FilterProvider>

            <KeyboardHelpModal open={helpOpen} onClose={() => closeModal('workBoardHelp')} />
        </div>
    )
}
