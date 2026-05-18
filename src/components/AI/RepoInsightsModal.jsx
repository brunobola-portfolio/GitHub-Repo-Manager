import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
    Sparkles,
    Brain,
    Lightbulb,
    Loader2,
    FileText,
    CheckCircle2,
    AlertCircle,
    BarChart3,
    Wand2,
    Info,
} from 'lucide-react'
import { Spinner } from '../ui/Spinner'
import { aiApi } from '../../api/ai'
import { Modal, ModalFooter } from '../ui/Modal'
import { InsightCard } from '../ui/InsightCard'
import { StatBar } from '../ui/StatBar'
import { Button } from '../ui/Button'
import { AIErrorState } from '../ui/AIErrorState'
import { AINotConfiguredBanner } from './AINotConfiguredBanner'
import { AINotHealthyBanner } from './AINotHealthyBanner'
import { useAIStatus } from '../../hooks/useAIStatus'

// ReadmeEnhanceDiffPanel pulls in @git-diff-view/react + shiki (~1 MB). Only load
// it when the user actually clicks "Enhance with AI" so the main Insights modal
// stays lightweight.
const ReadmeEnhanceDiffPanel = lazy(() =>
    import('./ReadmeEnhanceDiffPanel').then((m) => ({ default: m.ReadmeEnhanceDiffPanel }))
)

function DiffPanelFallback() {
    return (
        <div className="flex items-center justify-center py-8 text-slate-500 dark:text-slate-400 text-sm gap-2">
            <Spinner size="md" tone="muted" />
            Loading diff viewer…
        </div>
    )
}

const TABS = [
    { id: 'overview',    label: 'Overview',    icon: Sparkles },
    { id: 'quality',     label: 'Quality',     icon: BarChart3 },
    { id: 'suggestions', label: 'Suggestions', icon: Wand2 },
    { id: 'readme',      label: 'README',      icon: FileText },
]

const DEFAULT_TAB = 'overview'
const VALID_TABS = new Set(TABS.map((t) => t.id))

/**
 * RepoInsightsModal — AI-powered repository insights dialog.
 *
 * Uses the shared Modal primitive with size="3xl" so the Quality tab's
 * 2-column grid (Breakdown + Detected Features + Recommendations) fits
 * on a 1080p desktop without a scrollbar. On mobile the Modal's sheet
 * variant slides up from the bottom.
 *
 * `initialTab` lets callers route the user straight to a specific tab —
 * e.g. clicking "Quality Report" in the repo context menu opens the
 * modal on the Quality tab instead of the default Overview.
 */
export default function RepoInsightsModal({ repo, isOpen, onClose, initialTab = DEFAULT_TAB }) {
    const [analysis, setAnalysis] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [activeTab, setActiveTab] = useState(DEFAULT_TAB)

    // Suggestions tab is lazy-loaded to avoid burning an AI call when the
    // user never opens it. State/error/loading are isolated from the main
    // metadata fetch so one failing call doesn't break the other.
    const [suggestionsData, setSuggestionsData] = useState(null)
    const [suggestionsLoading, setSuggestionsLoading] = useState(false)
    const [suggestionsError, setSuggestionsError] = useState(null)

    const abortRef = useRef(null)
    const suggestionsAbortRef = useRef(null)

    const { configured: aiConfigured, keyHealth, loading: aiStatusLoading } = useAIStatus()
    const showNotConfigured = !aiStatusLoading && !aiConfigured
    const showNotHealthy = !aiStatusLoading && aiConfigured && (keyHealth === 'invalid' || keyHealth === 'unreachable')

    // Instrument insights-viewed flag for promo dismissal tracking
    useEffect(() => {
        if (!isOpen) return
        try {
            if (localStorage.getItem('ai-insights-viewed') !== 'true') {
                localStorage.setItem('ai-insights-viewed', 'true')
            }
        } catch {
            /* OK to skip */
        }
    }, [isOpen])

    /* eslint-disable react-hooks/set-state-in-effect, react-hooks/immutability -- this effect is the open/close + repo-switch synchronisation point; setState resets are intentional */
    useEffect(() => {
        if (!isOpen || !repo) {
            setAnalysis(null)
            setError(null)
            setSuggestionsData(null)
            setSuggestionsError(null)
            setSuggestionsLoading(false)
            return
        }

        // Abort any previous in-flight controller (rapid open/close/re-open).
        abortRef.current?.abort()
        suggestionsAbortRef.current?.abort()
        const ctrl = new AbortController()
        abortRef.current = ctrl
        // Reset suggestions cache so a different repo re-fetches.
        setSuggestionsData(null)
        setSuggestionsError(null)
        setSuggestionsLoading(false)
        // Clamp initialTab to a valid id so callers can't open the modal
        // on a non-existent tab (defensive — the union is tiny).
        setActiveTab(VALID_TABS.has(initialTab) ? initialTab : DEFAULT_TAB)
        fetchAnalysis(ctrl.signal)

        return () => {
            ctrl.abort()
            suggestionsAbortRef.current?.abort()
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, repo?.id, initialTab])
    /* eslint-enable react-hooks/set-state-in-effect, react-hooks/immutability */

    // Kick off a new fetch with a fresh AbortController. Used by the error-card
    // retry button and by the mount effect. Always aborts any previous inflight
    // controller before starting so closed modals never set state on unmount.
    const startFetch = () => {
        abortRef.current?.abort()
        const ctrl = new AbortController()
        abortRef.current = ctrl
        fetchAnalysis(ctrl.signal)
    }

    const fetchAnalysis = async (signal) => {
        setLoading(true)
        setError(null)
        try {
            let data = await aiApi.getMetadata(repo.id)
            if (signal?.aborted) return
            if (!data) {
                const indexResult = await aiApi.indexRepo(repo)
                if (signal?.aborted) return
                data = indexResult.analysis
            } else {
                if (typeof data.topics === 'string') data.suggested_topics = JSON.parse(data.topics)
                if (data.topics && !data.suggested_topics) data.suggested_topics = JSON.parse(data.topics)
            }
            if (!signal?.aborted) setAnalysis(data)
        } catch (err) {
            // Preserve err.code so AIErrorState can render the right CTA
            // (configure / upgrade / retry) instead of a generic fallback.
            if (!signal?.aborted) setError(err || new Error('Failed to generate insights. Please try again.'))
        } finally {
            if (!signal?.aborted) setLoading(false)
        }
    }

    const reanalyze = async () => {
        // Abort any pending initial fetch or previous reanalyze before starting.
        abortRef.current?.abort()
        const ctrl = new AbortController()
        abortRef.current = ctrl
        setLoading(true)
        setError(null)
        try {
            const indexResult = await aiApi.indexRepo(repo)
            if (!ctrl.signal.aborted) setAnalysis(indexResult.analysis)
        } catch (err) {
            if (!ctrl.signal.aborted) setError(err || new Error('Re-analysis failed'))
        } finally {
            if (!ctrl.signal.aborted) setLoading(false)
        }
    }

    // Lazy-load suggestions only when the user actually opens that tab.
    // Separate controller so switching tabs mid-flight doesn't cancel the
    // main analysis fetch (and vice versa).
    const fetchSuggestions = async (signal) => {
        setSuggestionsLoading(true)
        setSuggestionsError(null)
        try {
            const result = await aiApi.getSuggestions(repo)
            if (!signal?.aborted) setSuggestionsData(result)
        } catch (err) {
            if (!signal?.aborted) setSuggestionsError(err || new Error('Failed to generate suggestions. Please try again.'))
        } finally {
            if (!signal?.aborted) setSuggestionsLoading(false)
        }
    }

    const startSuggestionsFetch = () => {
        suggestionsAbortRef.current?.abort()
        const ctrl = new AbortController()
        suggestionsAbortRef.current = ctrl
        fetchSuggestions(ctrl.signal)
    }

    useEffect(() => {
        if (!isOpen || !repo) return
        if (activeTab !== 'suggestions') return
        if (suggestionsData || suggestionsLoading || suggestionsError) return
        // eslint-disable-next-line react-hooks/set-state-in-effect -- lazy-load suggestions on tab activation
        startSuggestionsFetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, isOpen, repo?.id])

    const showTabs = Boolean(analysis && !loading && !error)

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="AI Insights"
            subtitle={repo?.full_name}
            icon={Sparkles}
            iconGradient="primary"
            size="3xl"
            closeOnBackdrop={false}
            tabs={showTabs ? TABS : undefined}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            tabsLayoutId="repo-insights-tabs"
            staggerChildren={showTabs}
            mobileVariant="sheet"
            isBusy={loading}
            footer={
                <ModalFooter align="right">
                    <Button variant="ghost" onClick={reanalyze} disabled={loading}>
                        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                        Re-analyze
                    </Button>
                    <Button variant="primary" onClick={onClose}>
                        Done
                    </Button>
                </ModalFooter>
            }
        >
            {showNotConfigured && <AINotConfiguredBanner className="mb-4" />}
            {showNotHealthy && <AINotHealthyBanner state={keyHealth} className="mb-4" />}
            {loading && !analysis && <InsightsSkeletonGrid />}
            {error && (
                <AIErrorState
                    error={error}
                    onRetry={startFetch}
                    context="AI Insights"
                />
            )}
            {analysis && !loading && activeTab === 'overview'    && <OverviewGrid    data={analysis} />}
            {analysis && !loading && activeTab === 'quality'     && <QualityGrid     data={analysis} />}
            {analysis && !loading && activeTab === 'readme'      && <ReadmeGrid      data={analysis} repo={repo} />}
            {analysis && !loading && activeTab === 'suggestions' && (
                <SuggestionsGrid
                    data={suggestionsData}
                    loading={suggestionsLoading}
                    error={suggestionsError}
                    onRetry={startSuggestionsFetch}
                />
            )}
        </Modal>
    )
}

// ============================================================================
// CircularScore — SVG health score ring
// ============================================================================
function CircularScore({ value, max = 100 }) {
    const reducedMotion = useReducedMotion()
    const size = 120
    const stroke = 10
    const radius = (size - stroke) / 2
    const circumference = 2 * Math.PI * radius
    const clamped = Math.max(0, Math.min(value ?? 0, max))
    const offset = circumference - (clamped / max) * circumference

    const colorClass =
        clamped >= 80 ? 'stroke-emerald-500' :
        clamped >= 50 ? 'stroke-amber-500'  :
                        'stroke-red-500'

    return (
        <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }} aria-label={`Health score ${clamped} out of ${max}`} role="img">
            <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
                <circle
                    cx={size / 2} cy={size / 2} r={radius}
                    strokeWidth={stroke}
                    fill="none"
                    className="stroke-slate-200 dark:stroke-slate-800"
                />
                <motion.circle
                    cx={size / 2} cy={size / 2} r={radius}
                    strokeWidth={stroke}
                    fill="none"
                    strokeLinecap="round"
                    className={colorClass}
                    strokeDasharray={circumference}
                    initial={{ strokeDashoffset: reducedMotion ? offset : circumference }}
                    animate={{ strokeDashoffset: offset }}
                    transition={reducedMotion ? { duration: 0 } : { duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
                <span className="text-3xl font-bold text-slate-900 dark:text-white tabular-nums">
                    {clamped}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">/{max}</span>
            </div>
        </div>
    )
}

// ============================================================================
// OverviewGrid — Health score + TL;DR + Highlights + Topics
// ============================================================================
function OverviewGrid({ data }) {
    const summaryRef = useRef(null)
    const [expanded, setExpanded] = useState(false)
    const [needsClamp, setNeedsClamp] = useState(false)

    useEffect(() => {
        const el = summaryRef.current
        if (!el) return
        setNeedsClamp(el.scrollHeight > el.clientHeight + 2)
    }, [data?.summary])

    const hasHighlights = data.highlights?.length > 0
    const hasTopics = data.suggested_topics?.length > 0
    const hasSummary = Boolean(data.summary)

    if (!hasHighlights && !hasTopics && !hasSummary && (data.health_score == null)) {
        return (
            <InsightCard hover={false}>
                <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">
                    Analysis in progress — some sections may appear later.
                </p>
            </InsightCard>
        )
    }

    return (
        <div className="grid gap-4 lg:grid-cols-3">
            {/* Health Score */}
            <InsightCard tone="ai" className="lg:col-span-1 flex flex-col items-center justify-center text-center">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">
                    <Brain className="w-4 h-4" />
                    Health Score
                </div>
                <CircularScore value={data.health_score ?? 0} />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-4">
                    Based on docs, structure &amp; metadata
                </p>
            </InsightCard>

            {/* TL;DR */}
            <InsightCard className="lg:col-span-2">
                <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                    TL;DR Summary
                </h3>
                <div className="relative">
                    <p
                        ref={summaryRef}
                        className={`text-slate-700 dark:text-slate-200 leading-relaxed ${expanded ? '' : 'line-clamp-5'}`}
                    >
                        {data.summary || 'No summary available yet.'}
                    </p>
                    {needsClamp && !expanded && (
                        <button
                            onClick={() => setExpanded(true)}
                            className="mt-2 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                            Show more
                        </button>
                    )}
                </div>
            </InsightCard>

            {/* Highlights */}
            {hasHighlights && (
                <InsightCard tone="success" className="lg:col-span-3">
                    <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                        Highlights
                    </h3>
                    <div className="grid sm:grid-cols-2 gap-2">
                        {data.highlights.map((h, i) => (
                            <div key={i} className="flex items-start gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                                <span className="break-words">{h}</span>
                            </div>
                        ))}
                    </div>
                </InsightCard>
            )}

            {/* Topics */}
            {hasTopics && (
                <InsightCard tone="info" className="lg:col-span-3">
                    <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                        Suggested Topics
                    </h3>
                    <div className="flex flex-wrap gap-2">
                        {data.suggested_topics.map((topic, i) => (
                            <span
                                key={i}
                                className="px-3 py-1 bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 rounded-full text-sm"
                            >
                                #{topic}
                            </span>
                        ))}
                    </div>
                </InsightCard>
            )}
        </div>
    )
}

// ============================================================================
// QualityGrid — Breakdown bars + Detected Features + Recommendations
// ============================================================================
function QualityGrid({ data }) {
    const breakdown = data.quality_breakdown || {}
    const breakdownEntries = Object.entries(breakdown)
    const patterns = data.patterns || {}
    const featureEntries = Object.entries(patterns).filter(([k]) => k.startsWith('has'))
    const improvements = data.improvements || []

    const hasBreakdown = breakdownEntries.length > 0
    const hasFeatures = featureEntries.length > 0
    const hasImprovements = improvements.length > 0

    if (!hasBreakdown && !hasFeatures && !hasImprovements) {
        return (
            <InsightCard hover={false}>
                <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">
                    Quality data not available yet.
                </p>
            </InsightCard>
        )
    }

    return (
        <div className="grid gap-4 lg:grid-cols-2">
            {/* Quality Breakdown */}
            {hasBreakdown && (
                <InsightCard className="lg:col-span-1">
                    <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">
                        Quality Breakdown
                    </h3>
                    <div className="space-y-3">
                        {breakdownEntries.map(([key, value]) => (
                            <StatBar
                                key={key}
                                label={key.replace(/_/g, ' ')}
                                value={Number(value) || 0}
                                max={30}
                                gradient="primary"
                            />
                        ))}
                    </div>
                </InsightCard>
            )}

            {/* Detected Features */}
            {hasFeatures && (
                <InsightCard className="lg:col-span-1">
                    <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">
                        Detected Features
                    </h3>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2 max-h-[240px] overflow-y-auto ds-scrollbar pr-1">
                        {featureEntries.map(([key, value]) => (
                            <div
                                key={key}
                                className={`flex items-center gap-2 text-sm ${value ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`}
                            >
                                {value ? (
                                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                                ) : (
                                    <AlertCircle className="w-4 h-4 shrink-0" />
                                )}
                                <span className="truncate">
                                    {key.replace('has', '').replace(/([A-Z])/g, ' $1').trim()}
                                </span>
                            </div>
                        ))}
                    </div>
                </InsightCard>
            )}

            {/* Recommendations */}
            {hasImprovements && (
                <InsightCard tone="warning" className="lg:col-span-2">
                    <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                        Recommendations
                    </h3>
                    <div className="grid md:grid-cols-2 gap-2">
                        {improvements.map((imp, i) => (
                            <div
                                key={i}
                                className="flex items-start gap-3 p-3 bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 rounded-lg"
                            >
                                <Lightbulb className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
                                <p className="text-slate-700 dark:text-slate-200 text-sm break-words">{imp}</p>
                            </div>
                        ))}
                    </div>
                </InsightCard>
            )}
        </div>
    )
}

// ============================================================================
// ReadmeGrid — README enhancement suggestions
// ============================================================================
function ReadmeGrid({ data, repo }) {
    const suggestions = data.readme_suggestions || []
    const [showEnhance, setShowEnhance] = useState(false)

    const enhanceButton = (
        <Button variant="primary" onClick={() => setShowEnhance(true)} disabled={showEnhance}>
            <Sparkles className="w-4 h-4" />
            Enhance with AI
        </Button>
    )

    if (suggestions.length === 0) {
        return (
            <div className="grid gap-4">
                <InsightCard tone="success" hover={false} className="text-center py-8">
                    <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
                    <p className="text-emerald-600 dark:text-emerald-400 font-medium">README looks complete!</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        All recommended sections are present.
                    </p>
                </InsightCard>
                <div className="flex justify-center">{enhanceButton}</div>
                {showEnhance && (
                    <Suspense fallback={<DiffPanelFallback />}>
                        <ReadmeEnhanceDiffPanel repo={repo} />
                    </Suspense>
                )}
            </div>
        )
    }

    return (
        <div className="grid gap-4">
            <InsightCard tone="info">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <h3 className="text-blue-600 dark:text-blue-400 font-medium mb-1">
                            README Enhancement Suggestions
                        </h3>
                        <p className="text-slate-500 dark:text-slate-400 text-sm">
                            These sections could improve your documentation:
                        </p>
                    </div>
                    {enhanceButton}
                </div>
            </InsightCard>
            <InsightCard>
                <div className="grid sm:grid-cols-2 gap-2">
                    {suggestions.map((section, i) => (
                        <div
                            key={i}
                            className="flex items-center gap-3 p-3 bg-slate-100/60 dark:bg-white/5 border border-slate-200/50 dark:border-slate-800/40 rounded-lg"
                        >
                            <FileText className="w-5 h-5 text-indigo-500 dark:text-indigo-400 shrink-0" />
                            <span className="text-slate-700 dark:text-slate-200 text-sm break-words">{section}</span>
                        </div>
                    ))}
                </div>
            </InsightCard>
            {showEnhance && (
                <Suspense fallback={<DiffPanelFallback />}>
                    <ReadmeEnhanceDiffPanel repo={repo} />
                </Suspense>
            )}
        </div>
    )
}

// ============================================================================
// SuggestionsGrid — AI-powered name/description/topic improvement suggestions
// ============================================================================
// Tone mapping: `improvement` suggestions get the warm amber "recommendation"
// look (matches the Quality tab's Recommendations card). `info` + anything
// else defaults to the neutral indigo/blue palette so the surface reads as
// informational rather than as an action item.
const SUGGESTION_TYPE_STYLES = {
    improvement: {
        icon: Lightbulb,
        wrapper:
            'bg-amber-500/5 dark:bg-amber-500/10 border-amber-500/20 hover:border-amber-500/40',
        iconColor: 'text-amber-500 dark:text-amber-400',
        badgeBg: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
    },
    info: {
        icon: Info,
        wrapper:
            'bg-blue-500/5 dark:bg-blue-500/10 border-blue-500/20 hover:border-blue-500/40',
        iconColor: 'text-blue-500 dark:text-blue-400',
        badgeBg: 'bg-blue-500/15 text-blue-600 dark:text-blue-300',
    },
}

function SuggestionsGrid({ data, loading, error, onRetry }) {
    if (loading) {
        return (
            <div className="grid gap-4" aria-hidden="true" role="presentation">
                <div className="ds-skeleton h-[88px] rounded-xl" />
                <div className="ds-skeleton h-[120px] rounded-xl" />
                <div className="ds-skeleton h-[120px] rounded-xl" />
                <div className="ds-skeleton h-[120px] rounded-xl" />
            </div>
        )
    }

    if (error) {
        return <AIErrorState error={error} onRetry={onRetry} context="Suggestions" />
    }

    const suggestions = data?.suggestions || []
    const analysis = data?.analysis

    if (suggestions.length === 0 && !analysis) {
        return (
            <InsightCard tone="success" hover={false} className="text-center py-8">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
                <p className="text-emerald-600 dark:text-emerald-400 font-medium">
                    No suggestions — looking great!
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    We couldn&apos;t find anything worth improving right now.
                </p>
            </InsightCard>
        )
    }

    return (
        <div className="grid gap-4">
            {analysis && (
                <InsightCard tone="ai">
                    <div className="flex items-start gap-3">
                        <div className="p-2 rounded-lg bg-indigo-500/20 shrink-0">
                            <Wand2 className="w-5 h-5 text-indigo-500 dark:text-indigo-300" />
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                                AI Analysis
                            </h3>
                            <p className="text-slate-700 dark:text-slate-200 text-sm leading-relaxed break-words">
                                {analysis}
                            </p>
                        </div>
                    </div>
                </InsightCard>
            )}

            {suggestions.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                    {suggestions.map((s, i) => {
                        const style =
                            SUGGESTION_TYPE_STYLES[s.type] || SUGGESTION_TYPE_STYLES.info
                        const Icon = style.icon
                        const label = s.type === 'improvement' ? 'Improve' : 'Info'
                        return (
                            <InsightCard key={i} hover={false} className="!p-0">
                                <div
                                    className={`h-full p-4 rounded-xl border ${style.wrapper} transition-colors`}
                                >
                                    <div className="flex items-start gap-3">
                                        <div className="shrink-0 mt-0.5">
                                            <Icon className={`w-5 h-5 ${style.iconColor}`} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <h4 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                                                    {s.title}
                                                </h4>
                                                <span
                                                    className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${style.badgeBg}`}
                                                >
                                                    {label}
                                                </span>
                                            </div>
                                            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed break-words">
                                                {s.description}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </InsightCard>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

// ============================================================================
// Loading / Error states
// ============================================================================
function InsightsSkeletonGrid() {
    return (
        <div className="grid gap-4 lg:grid-cols-3" aria-hidden="true" role="presentation">
            <div className="ds-skeleton h-[200px] lg:col-span-1 rounded-xl" />
            <div className="ds-skeleton h-[200px] lg:col-span-2 rounded-xl" />
            <div className="ds-skeleton h-[120px] lg:col-span-3 rounded-xl" />
            <div className="ds-skeleton h-[60px]  lg:col-span-3 rounded-xl" />
        </div>
    )
}

// InsightsErrorCard removed — replaced by the shared <AIErrorState /> which
// reads action.type from formatUserError() and renders the right CTA per code.
