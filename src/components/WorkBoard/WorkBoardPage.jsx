/**
 * Cross-Repo Work Board — Phase E3
 *
 * Tabs:
 *   1. My Reviews   — pending review assignments (Free+)
 *   2. Stale PRs    — PRs open > N days (Free+)
 *   3. My Issues    — assigned open issues (Free+)
 *   4. Review Load  — reviewer distribution (Free+)
 *   5. Tech Debt    — labelled issues + hotspots (Free+)
 *   6. DORA         — deploy freq + lead time (Enterprise+)
 */

import { useState, useEffect, lazy, Suspense } from 'react'
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion'
import {
    GitPullRequest, CircleDot, BarChart3,
    AlertTriangle, Wrench, Users, RefreshCw,
} from 'lucide-react'
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
import { useToast } from '../../hooks/useToast'
import { KeyboardHelpModal } from './KeyboardHelpModal'
import { DOCS_URL as WEBHOOK_DOCS_URL } from '../Settings/WorkBoard/WebhookConnectPanel'
import { AISummaryCard } from './AISummaryCard'
import { KpiRow } from './KpiRow'
import { MyReviewsTab } from './tabs/MyReviewsTab'
// Non-default tabs lazy-loaded — most sessions land on My Reviews and
// never visit DORA/Tech Debt. Each tab now ships in its own chunk.
const StalePRsTab = lazy(() => import('./tabs/StalePRsTab').then(m => ({ default: m.StalePRsTab })))
const MyIssuesTab = lazy(() => import('./tabs/MyIssuesTab').then(m => ({ default: m.MyIssuesTab })))
const ReviewLoadTab = lazy(() => import('./tabs/ReviewLoadTab').then(m => ({ default: m.ReviewLoadTab })))
const TechDebtTab = lazy(() => import('./tabs/TechDebtTab').then(m => ({ default: m.TechDebtTab })))
const DORATab = lazy(() => import('./tabs/DORATab').then(m => ({ default: m.DORATab })))
import { SectionSpinner } from '../ui/Spinner'
import { ManageReposButton } from './ManageReposButton'
import { MOCK_MODE } from '../../config'
import { emitAppEvent, onAppEvent, APP_EVENTS } from '../../utils/appEvents'

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

const TABS = [
    { id: 'reviews',     label: 'My Reviews',  icon: GitPullRequest, component: MyReviewsTab, accent: 'purple' },
    { id: 'stale',       label: 'Stale PRs',   icon: AlertTriangle,  component: StalePRsTab,  accent: 'amber' },
    { id: 'issues',      label: 'My Issues',   icon: CircleDot,      component: MyIssuesTab,  accent: 'emerald' },
    { id: 'reviewload',  label: 'Review Load', icon: Users,          component: ReviewLoadTab, accent: 'sky' },
    { id: 'techdebt',    label: 'Tech Debt',   icon: Wrench,         component: TechDebtTab, accent: 'amber' },
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
                                href={WEBHOOK_DOCS_URL}
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
    const { toast } = useToast()

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
        const onRegen = () => emitAppEvent(APP_EVENTS.WORKBOARD_AI_REGENERATE_INTERNAL)
        const onSave = () => {
            // Lightweight first pass: nudge user to the filter-bar PresetDropdown.
            // A deeper integration would open the dropdown + focus its input; we
            // skip that to avoid cross-component ref coupling.
            toast.info('Use the Presets dropdown in the filter bar to save the current filters as a preset.')
        }
        const offs = [
            onAppEvent(APP_EVENTS.WORKBOARD_GO_TAB, onGoTab),
            onAppEvent(APP_EVENTS.WORKBOARD_REGENERATE_AI, onRegen),
            onAppEvent(APP_EVENTS.WORKBOARD_SAVE_PRESET, onSave),
        ]
        return () => offs.forEach(off => off())
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
                            <span className="ds-text-meta text-slate-400 dark:text-slate-500" aria-live="polite">
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
            <div className="relative rounded-3xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
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
                                        ? 'text-[color:var(--ds-accent-brand)] dark:text-indigo-300'
                                        : 'text-slate-500 dark:text-slate-400 hover:bg-white/70 dark:hover:bg-slate-700/50 hover:text-slate-700 dark:hover:text-slate-200'
                                    }
                                `}
                            >
                                <Icon className="w-4 h-4" />
                                {tab.label}
                                {tab.badge && (
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                                        tab.badge === 'Enterprise'
                                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                                            : 'bg-[color:var(--ds-surface-muted)] dark:bg-[color:var(--ds-surface-muted-dark)] text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]'
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
                        <Suspense fallback={<SectionSpinner />}>
                            <ActiveComponent
                                {...(activeTab === 'reviews' || activeTab === 'stale' ? { hasAI } : {})}
                            />
                        </Suspense>
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
