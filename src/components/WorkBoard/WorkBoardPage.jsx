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
    AlertTriangle, Wrench, Users, RefreshCw, Lock,
} from 'lucide-react'
import * as Popover from '@radix-ui/react-popover'
import { clsx } from 'clsx'
import {
    useMyPendingReviews,
    useStalePRs,
    useMyOpenIssues,
    useTechDebt,
    useKpiSnapshots,
} from '../../hooks/useWorkBoard'
import { useRelativeTime } from '../../hooks/useRelativeTime'
import { useUrlParams } from '../../hooks/useUrlParams'
import { PageShell } from '../ui/PageShell'
import { PageHeader } from '../ui/PageHeader'
import { PageMount } from '../ui/PageMount'
import { HeroHalo } from '../ui/HeroHalo'
import { EmptyState as SharedEmptyState } from '../ui/EmptyState'
import { Inbox } from 'lucide-react'
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
import { ManageReposButton } from './ManageReposButton'
import { MOCK_MODE } from '../../config'

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
// WorkBoardEmptyState — shared <EmptyState> + an inline webhook checklist.
//
// The shared primitive owns the icon / title / description / primary CTA;
// the webhook checklist stays here because it's load-bearing for first-run
// onboarding (Connect webhook + Open a PR/issue) and doesn't generalize.
// ---------------------------------------------------------------------------

function WorkBoardEmptyState({ webhookConnected, onRefresh }) {
    return (
        <div className="flex flex-col items-center mt-4">
            <SharedEmptyState
                icon={Inbox}
                title="Your Work Board is ready"
                description="Connect a webhook to see your real-time engineering data."
                action={{ label: 'Already connected? Pull fresh data', onClick: onRefresh }}
            />
            <div className="w-full max-w-md -mt-4 space-y-2">
                <div className={clsx(
                    'flex items-center gap-3 rounded-xl border p-3 text-left text-sm',
                    webhookConnected
                        ? 'border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'border-slate-200 dark:border-white/10 bg-white/80 dark:bg-white/5 text-slate-500 dark:text-slate-400',
                )}>
                    <span className={clsx('h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0',
                        webhookConnected ? 'border-emerald-400 bg-emerald-400' : 'border-slate-300 dark:border-slate-600')}>
                        {webhookConnected && <span className="text-white text-[8px] font-bold">✓</span>}
                    </span>
                    <span>
                        Connect GitHub webhook
                        {!webhookConnected && (
                            <a
                                href="/docs/guides/github-webhook-setup"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ml-2 underline text-indigo-500 hover:text-indigo-400"
                            >
                                Setup guide →
                            </a>
                        )}
                    </span>
                </div>
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-white/5 p-3 text-left text-sm text-slate-400 dark:text-slate-400">
                    <span className="h-4 w-4 rounded-full border-2 border-slate-300 dark:border-slate-600 shrink-0" />
                    Open a PR or issue
                </div>
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// LockedTabButton — hover tooltip for tier-gated tabs
// ---------------------------------------------------------------------------

function LockedTabButton({ tab }) {
    const [hovered, setHovered] = useState(false)
    const Icon = tab.icon
    return (
        <Popover.Root open={hovered}>
            <Popover.Trigger
                asChild
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
            >
                <button
                    role="tab"
                    aria-selected={false}
                    aria-disabled="true"
                    tabIndex={-1}
                    className="relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap text-slate-400 dark:text-slate-500 cursor-not-allowed opacity-60"
                >
                    <Icon className="w-4 h-4" />
                    {tab.label}
                    {tab.badge && (
                        <span className="flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                            <Lock className="w-2.5 h-2.5" />
                            {tab.badge}
                        </span>
                    )}
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    side="bottom"
                    className="z-[var(--ds-z-popover)] px-3 py-1.5 text-xs rounded-lg bg-slate-900 text-slate-100 shadow-lg pointer-events-none border border-white/10"
                >
                    Upgrade to {tab.badge} to unlock {tab.label}
                    <Popover.Arrow className="fill-slate-900" />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    )
}

// ---------------------------------------------------------------------------
// WorkBoardPage
// ---------------------------------------------------------------------------

// Map from dashboard category keys (passed as initialTab) to canonical Work
// Board tab IDs. The tab IDs already match the category keys 1:1, so this map
// doubles as a whitelist — any unrecognised key is silently ignored.
const INITIAL_TAB_ALIAS = {
    reviews: 'reviews', // WhatNeedsYouGrid "reviews" → My Reviews tab
    stale:   'stale',   // WhatNeedsYouGrid "stale"   → Stale PRs tab
    issues:  'issues',  // WhatNeedsYouGrid "issues"  → My Issues tab
}

export function WorkBoardPage({ repoCount = 0, onOpenSettings, initialTab }) {
    const [params, setParams] = useUrlParams(['tab', 'repos', 'authors', 'labels', 'age', 'snoozed'])
    const activeTab = params.tab || 'reviews'
    const setActiveTab = (tab) => setParams({ tab: tab === 'reviews' ? '' : tab })

    // Sync to initialTab when navigation requests a specific tab.
    // Only runs when initialTab changes (including on first mount).
    // Does not override if initialTab is absent or unrecognised.
    useEffect(() => {
        if (!initialTab) return
        const canonical = INITIAL_TAB_ALIAS[initialTab]
        if (canonical) setActiveTab(canonical)
        // setActiveTab is intentionally excluded from deps — it's a stable
        // derived setter and including it would cause an infinite loop when
        // the URL param update triggers a re-render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialTab])

    const [hasAI, setHasAI] = useState(false)
    useEffect(() => {
        if (MOCK_MODE) return
        fetch('/api/user/ai-config', { credentials: 'include' })
            .then(r => r.json())
            .then(d => setHasAI(!!(d.hasCompletionKey || d.serverFallbackAvailable)))
            .catch(() => {})
    }, [])

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

    const allZero = !reviews?.data?.length && !stale?.data?.length && !issues?.data?.length && !debt?.data?.items?.length
    const showEmptyState = allZero && reviews?.meta?.source === 'live'

    return (
        <PageMount>
        <PageShell maxWidth="2xl" padding="tight" className="space-y-7">
            <PageHeader
                eyebrow="Cross-repo activity"
                title="Work Board"
                description={
                    repoCount > 0
                        ? `${repoCount} repos tracked · live signals across reviews, issues & delivery`
                        : 'Live signals across reviews, issues & delivery'
                }
                actions={
                    <>
                        {earliest && (
                            <span className="text-[11px] text-slate-400 dark:text-slate-500" aria-live="polite">
                                updated {earliestLabel}
                            </span>
                        )}
                        <ManageReposButton onOpenSettings={onOpenSettings} />
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
                    </>
                }
            />

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

            {showEmptyState ? (
                <WorkBoardEmptyState
                    webhookConnected={!!reviews?.meta?.webhookConnected}
                    onRefresh={refreshAll}
                />
            ) : (
            /* Main card */
            <div className="relative rounded-3xl border border-slate-200/60 dark:border-slate-700/50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-xl shadow-slate-300/20 dark:shadow-black/40 overflow-hidden">
                <HeroHalo palette="indigo" intensity="subtle" position="top" />

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
                        <ActiveComponent
                            {...(activeTab === 'reviews' || activeTab === 'stale' ? { hasAI } : {})}
                        />
                    </motion.div>
                </AnimatePresence>
            </div>
            )}
            </FilterProvider>

            <KeyboardHelpModal open={helpOpen} onClose={() => closeModal('workBoardHelp')} />
        </PageShell>
        </PageMount>
    )
}
