import { useState, useEffect } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring, useReducedMotion } from 'framer-motion';
import { EASE, SPRING } from './ui/motion'
import {
    FileText, Users, Activity, CheckCircle,
    XCircle, AlertCircle, TrendingUp, RefreshCw, Heart, Sparkles, Bot
} from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { TabBar } from './ui/TabBar';
import { Tooltip } from './ui/Tooltip';
import { CommunityHealthFixModal } from './AI/CommunityHealthFixModal';
import { AgentRulesModal } from './AI/AgentRulesModal';
import { formatFileSize } from '../utils/format';

/**
 * Map between the file labels surfaced by the community-health analyser and
 * the registry keys understood by `/community-health/generate`.
 *
 * The analyser today uses GitHub's community profile labels (e.g. "README",
 * "LICENSE"), while the generator registry keys are snake_case. Keys not in
 * this map (rare) hide the Fix-with-AI button — better to omit than guess.
 */
const FILE_TYPE_BY_LABEL = {
    'README': 'readme_stub',
    'README.md': 'readme_stub',
    'LICENSE': 'license',
    'CONTRIBUTING.md': 'contributing',
    'CONTRIBUTING': 'contributing',
    'CODE_OF_CONDUCT.md': 'code_of_conduct',
    'CODE_OF_CONDUCT': 'code_of_conduct',
    'SECURITY.md': 'security',
    'SECURITY': 'security',
    '.github/ISSUE_TEMPLATE': 'issue_template',
    'ISSUE_TEMPLATE': 'issue_template',
    '.github/PULL_REQUEST_TEMPLATE.md': 'pr_template',
    'PULL_REQUEST_TEMPLATE.md': 'pr_template',
    'PULL_REQUEST_TEMPLATE': 'pr_template',
};

function useIsDesktop() {
    const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 1024px)').matches);

    useEffect(() => {
        const mql = window.matchMedia('(min-width: 1024px)');
        const onChange = (e) => setIsDesktop(e.matches);
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
    }, []);

    return isDesktop;
}

// `color` feeds the SVG ring stroke directly, so it must be theme-aware —
// routed through design-system.css tokens instead of hardcoded hexes, keeping
// the ring in the same hue family as ScoreBadge's Tailwind classes per tier.
// Excellent/Fair/danger tokens auto-swap in `:root.dark`; the blue "Good"
// pair (--ds-accent-link / --ds-accent-link-dark) is two static variables,
// so its dark value comes from `ringDarkClass` — a `dark:stroke-[...]` class
// override on the circle (CSS beats the stroke presentation attribute),
// mirroring the `dark:X-[color:var(--ds-*-dark)]` mechanism used app-wide.
function getScoreConfig(score) {
    if (score >= 80) return { color: 'var(--ds-chart-series-2)', tailwind: 'emerald', label: 'Excellent' };
    if (score >= 60) return { color: 'var(--ds-accent-link)', ringDarkClass: 'dark:stroke-[color:var(--ds-accent-link-dark)]', tailwind: 'blue', label: 'Good' };
    if (score >= 40) return { color: 'var(--ds-chart-series-3)', tailwind: 'amber', label: 'Fair' };
    return { color: 'var(--ds-status-danger)', tailwind: 'red', label: 'Needs Improvement' };
}

function HealthScoreRing({ score }) {
    const reducedMotion = useReducedMotion();
    const config = getScoreConfig(score);
    const normalizedScore = Math.min(Math.max(score, 0), 100) / 100;
    const motionValue = useMotionValue(0);
    const springValue = useSpring(motionValue, { ...SPRING.counterRing, duration: reducedMotion ? 0 : 1.2 });
    const [displayScore, setDisplayScore] = useState(reducedMotion ? score : 0);

    useEffect(() => { motionValue.set(score); }, [score, motionValue]);
    useEffect(() => {
        const unsubscribe = springValue.on('change', v => setDisplayScore(Math.round(v)));
        return unsubscribe;
    }, [springValue]);

    const radius = 52, strokeWidth = 8, center = 64;

    return (
        <div className="w-28 h-28 md:w-36 md:h-36 relative">
            <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90" aria-label={`Health score: ${score}% — ${config.label}`} role="img">
                <circle cx={center} cy={center} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="text-slate-200/40 dark:text-slate-700/40" />
                <motion.circle cx={center} cy={center} r={radius} fill="none" stroke={config.color} strokeWidth={strokeWidth} strokeLinecap="round"
                    className={config.ringDarkClass}
                    initial={{ pathLength: reducedMotion ? normalizedScore : 0 }}
                    animate={{ pathLength: normalizedScore }}
                    transition={reducedMotion ? { duration: 0 } : { duration: 1.2, ease: 'easeOut' }}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center rotate-0">
                <span className="text-3xl md:text-5xl font-bold text-slate-900 dark:text-slate-100">{displayScore}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{config.label}</span>
            </div>
        </div>
    );
}

function ScoreBadge({ score, className = '' }) {
    const config = getScoreConfig(score);
    const badgeColors = {
        emerald: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
        blue: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800',
        amber: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
        red: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800'
    };
    return (
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${badgeColors[config.tailwind]} ${className}`}>
            {config.label}
        </span>
    );
}

const HEALTH_TABS = [
    { id: 'files', label: 'Files', icon: FileText },
    { id: 'activity', label: 'Activity', icon: Activity },
    { id: 'recommendations', label: 'Recommendations', icon: TrendingUp },
];

export function CommunityHealthDashboard({ repo, onClose }) {
    const [health, setHealth] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const { toast } = useToast();
    const isDesktop = useIsDesktop();
    const [activeTab, setActiveTab] = useState('files');
    // Slice 4: Fix-with-AI modal — null when closed, fileType key when open.
    const [fixOpen, setFixOpen] = useState(null);
    // Wave 6, Feature 3: Agent Rules Generator detection card + modal.
    const [agentRulesOpen, setAgentRulesOpen] = useState(false);
    const [agentRulesFiles, setAgentRulesFiles] = useState({ agentsExists: false, claudeExists: false });

    useEffect(() => {
        if (repo) {
            // eslint-disable-next-line react-hooks/immutability -- fetchHealth is stable across the modal's lifetime
            fetchHealth(repo.full_name);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [repo]);

    // Presence check for AGENTS.md/CLAUDE.md via the existing generic repo-tree
    // endpoint (server/routes/repos/tree.js) — no dedicated detection route.
    // Best-effort only: any failure (network, non-ok, malformed body) just
    // leaves the card showing "missing", never blocks the rest of the panel.
    useEffect(() => {
        if (!repo?.full_name) return undefined;
        const [owner, repoName] = repo.full_name.split('/');
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`/api/repos/${owner}/${repoName}/tree`, { credentials: 'include' });
                if (cancelled || !res?.ok) return;
                const data = await res.json();
                if (cancelled || !data) return;
                const paths = new Set((data.entries || []).map((e) => e.path));
                setAgentRulesFiles({ agentsExists: paths.has('AGENTS.md'), claudeExists: paths.has('CLAUDE.md') });
            } catch {
                // best-effort detection only
            }
        })();
        return () => { cancelled = true; };
    }, [repo?.full_name]);

    const fetchHealth = async (repoFullName, refresh = false) => {
        try {
            setLoading(true);
            const [owner, repoName] = repoFullName.split('/');
            const res = await fetch(
                `/api/repos/${owner}/${repoName}/community-health${refresh ? '?refresh=true' : ''}`,
                { credentials: 'include' }
            );

            if (!res.ok) throw new Error('Failed to fetch health');

            const data = await res.json();
            setHealth(data);
        } catch {
            toast.error('Failed to load community health');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const handleFixCommitted = () => {
        if (repo?.full_name) fetchHealth(repo.full_name, true);
        setFixOpen(null);
        toast.success('Community health updated');
    };

    const handleFix = (fileLabel) => {
        const fileType = FILE_TYPE_BY_LABEL[fileLabel];
        if (!fileType) {
            toast.info(`No AI generator wired for ${fileLabel} yet`);
            return;
        }
        setFixOpen(fileType);
    };

    const handleRefresh = () => {
        setRefreshing(true);
        fetchHealth(repo.full_name, true);
    };

    const showContent = !loading && health;

    return (
        <Modal
            isOpen={!!repo}
            onClose={onClose}
            title="Community Health"
            subtitle={repo?.full_name}
            icon={Heart}
            size="2xl"
            closeOnBackdrop={false}
            isBusy={loading || refreshing}
        >
            <div className="flex items-center justify-end mb-4 gap-2">
                {showContent && <ScoreBadge score={health.score} />}
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRefresh}
                    disabled={refreshing}
                    aria-label="Refresh community health"
                >
                    <RefreshCw className={`w-4 h-4 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
                    Refresh
                </Button>
            </div>

            <div className="space-y-6">
                    <AnimatePresence mode="wait">
                        {showContent ? (
                            <motion.div
                                key="content"
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -12 }}
                                transition={{ duration: 0.3 }}
                                className="space-y-6"
                            >
                                {/* Health Score — always visible */}
                                <div className="rounded-3xl p-8 bg-indigo-500/10 dark:bg-indigo-500/20 border border-indigo-200/30 dark:border-indigo-500/20">
                                    <div className="flex flex-col sm:flex-row items-center gap-6">
                                        <HealthScoreRing score={health.score} />
                                        <div className="text-center sm:text-left space-y-1">
                                            <div className="text-sm uppercase tracking-wide text-slate-500 dark:text-slate-400">Overall Health Score</div>
                                            <div className="text-4xl font-bold text-slate-900 dark:text-slate-100">{health.score}<span className="text-lg text-slate-400">%</span></div>
                                            <ScoreBadge score={health.score} />
                                        </div>
                                    </div>
                                </div>

                                {isDesktop ? (
                                    <>
                                        {/* Tab Bar */}
                                        <TabBar
                                            tabs={HEALTH_TABS}
                                            activeTab={activeTab}
                                            onTabChange={setActiveTab}
                                            variant="pill"
                                            layoutId="health-tabs"
                                        />

                                        {/* Tab Content */}
                                        <AnimatePresence mode="wait">
                                            <motion.div
                                                key={activeTab}
                                                role="tabpanel"
                                                id={`tabpanel-health-tabs-${activeTab}`}
                                                aria-labelledby={`tab-health-tabs-${activeTab}`}
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                exit={{ opacity: 0 }}
                                                transition={{ duration: 0.15 }}
                                            >
                                                {activeTab === 'files' && (
                                                    <div className="rounded-3xl p-6 border border-slate-200/40 dark:border-slate-800/40 bg-white/60 dark:bg-slate-900/60">
                                                        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
                                                            <FileText className="w-5 h-5 text-indigo-500" />
                                                            Community Files
                                                        </h3>
                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                            {Object.entries(health.metrics.files).map(([file, data]) => (
                                                                <FileCheckItem key={file} file={file} exists={data.exists} size={data.size} onFix={handleFix} />
                                                            ))}
                                                            <AgentRulesCard exists={agentRulesFiles.agentsExists} onGenerate={() => setAgentRulesOpen(true)} />
                                                        </div>
                                                    </div>
                                                )}

                                                {activeTab === 'activity' && (
                                                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                                        <MetricCard title="Contributors" value={health.metrics.activity.contributorCount} icon={Users} color="blue" index={0} />
                                                        <MetricCard title="Commits (30d)" value={health.metrics.activity.commitsLast30Days} icon={Activity} color="green" index={1} />
                                                        <MetricCard title="Open Issues" value={health.metrics.activity.openIssues} icon={AlertCircle} color="amber" index={2} />
                                                        <MetricCard title="Closed Issues" value={health.metrics.activity.closedIssues} icon={CheckCircle} color="emerald" index={3} />
                                                    </div>
                                                )}

                                                {activeTab === 'recommendations' && (
                                                    <div className="rounded-3xl p-6 border border-slate-200/40 dark:border-slate-800/40 bg-white/60 dark:bg-slate-900/60">
                                                        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
                                                            <TrendingUp className="w-5 h-5 text-indigo-500" />
                                                            Recommendations
                                                        </h3>
                                                        <div className="space-y-3">
                                                            {health.recommendations.map((rec, idx) => (
                                                                <RecommendationItem key={idx} recommendation={rec} />
                                                            ))}
                                                            {health.recommendations.length === 0 && (
                                                                <p className="text-slate-500 dark:text-slate-400 italic">
                                                                    Great job! No recommendations at this time.
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </motion.div>
                                        </AnimatePresence>
                                    </>
                                ) : (
                                    <>
                                        {/* Mobile: stacked scroll layout (unchanged from current code) */}
                                        <motion.div
                                            initial={{ opacity: 0, y: 12 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: 0.2, duration: 0.4 }}
                                            className="rounded-3xl p-6 border border-slate-200/40 dark:border-slate-800/40 bg-white/60 dark:bg-slate-900/60"
                                        >
                                            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
                                                <FileText className="w-5 h-5 text-indigo-500" />
                                                Community Files
                                            </h3>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                {Object.entries(health.metrics.files).map(([file, data]) => (
                                                    <FileCheckItem key={file} file={file} exists={data.exists} size={data.size} />
                                                ))}
                                                <AgentRulesCard exists={agentRulesFiles.agentsExists} onGenerate={() => setAgentRulesOpen(true)} />
                                            </div>
                                        </motion.div>

                                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                            <MetricCard title="Contributors" value={health.metrics.activity.contributorCount} icon={Users} color="blue" index={0} />
                                            <MetricCard title="Commits (30d)" value={health.metrics.activity.commitsLast30Days} icon={Activity} color="green" index={1} />
                                            <MetricCard title="Open Issues" value={health.metrics.activity.openIssues} icon={AlertCircle} color="amber" index={2} />
                                            <MetricCard title="Closed Issues" value={health.metrics.activity.closedIssues} icon={CheckCircle} color="emerald" index={3} />
                                        </div>

                                        <motion.div
                                            initial={{ opacity: 0, y: 12 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: 0.6, duration: 0.4 }}
                                            className="rounded-3xl p-6 border border-slate-200/40 dark:border-slate-800/40 bg-white/60 dark:bg-slate-900/60"
                                        >
                                            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
                                                <TrendingUp className="w-5 h-5 text-indigo-500" />
                                                Recommendations
                                            </h3>
                                            <div className="space-y-3">
                                                {health.recommendations.map((rec, idx) => (
                                                    <RecommendationItem key={idx} recommendation={rec} />
                                                ))}
                                                {health.recommendations.length === 0 && (
                                                    <p className="text-slate-500 dark:text-slate-400 italic">
                                                        Great job! No recommendations at this time.
                                                    </p>
                                                )}
                                            </div>
                                        </motion.div>
                                    </>
                                )}

                                {/* Last Updated — always visible */}
                                <div className="text-center text-sm text-slate-400">
                                    Last analyzed: {new Date(health.lastUpdated).toLocaleString()}
                                    {health.cached && ' (cached)'}
                                </div>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="skeleton"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.2 }}
                            >
                                <SkeletonState />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
                {repo && (
                    <CommunityHealthFixModal
                        isOpen={!!fixOpen}
                        onClose={() => setFixOpen(null)}
                        repo={repo}
                        fileType={fixOpen}
                        onCommitted={handleFixCommitted}
                    />
                )}
                {repo && agentRulesOpen && (
                    <AgentRulesModal
                        isOpen={agentRulesOpen}
                        onClose={() => setAgentRulesOpen(false)}
                        repo={repo}
                        hasExistingAgents={agentRulesFiles.agentsExists}
                        onCommitted={() => {
                            setAgentRulesFiles((prev) => ({ ...prev, agentsExists: true }));
                            setAgentRulesOpen(false);
                            toast.success('Agent rules updated');
                        }}
                    />
                )}
        </Modal>
    );
}

function AgentRulesCard({ exists, onGenerate }) {
    return (
        <motion.div
            className={`flex items-center justify-between p-3 rounded-xl min-h-[44px] bg-white/60 dark:bg-slate-900/60 border ${exists ? 'border-slate-200/40 dark:border-slate-800/40' : 'border-red-300/40 dark:border-red-500/20'} transition-all`}>
            <div className="flex items-center gap-3 min-w-0">
                {exists ? (
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ duration: 0.2, ease: EASE.standard }}>
                        <CheckCircle className="w-5 h-5 text-emerald-500" />
                    </motion.div>
                ) : (<XCircle className="w-5 h-5 text-red-400 dark:text-red-500" />)}
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">AGENTS.md</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
                <Tooltip label={exists ? 'Refresh AGENTS.md/CLAUDE.md, grounded in real repo signals' : 'Generate AGENTS.md/CLAUDE.md, grounded in real repo signals'}>
                    <button
                        type="button"
                        onClick={onGenerate}
                        className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] transition-colors"
                        aria-label={exists ? 'Refresh agent rules with AI' : 'Generate agent rules with AI'}
                    >
                        <Bot className="w-3.5 h-3.5" aria-hidden="true" />
                        {exists ? 'Refresh with AI' : 'Generate with AI'}
                    </button>
                </Tooltip>
            </div>
        </motion.div>
    );
}

function FileCheckItem({ file, exists, size, onFix }) {
    const canFix = !exists && typeof onFix === 'function' && FILE_TYPE_BY_LABEL[file]
    return (
        <motion.div
            className={`flex items-center justify-between p-3 rounded-xl min-h-[44px] bg-white/60 dark:bg-slate-900/60 border ${exists ? 'border-slate-200/40 dark:border-slate-800/40' : 'border-red-300/40 dark:border-red-500/20'} transition-all`}>
            <div className="flex items-center gap-3 min-w-0">
                {exists ? (
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ duration: 0.2, ease: EASE.standard }}>
                        <CheckCircle className="w-5 h-5 text-emerald-500" />
                    </motion.div>
                ) : (<XCircle className="w-5 h-5 text-red-400 dark:text-red-500" />)}
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">{file}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
                {exists && size > 0 && (<span className="text-xs text-slate-400">{formatFileSize(size, 1)}</span>)}
                {canFix && (
                    <Tooltip label={`Generate ${file} with AI and commit it to the repo`}>
                        <button
                            type="button"
                            onClick={() => onFix(file)}
                            className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] transition-colors"
                            aria-label={`Fix ${file} with AI`}
                        >
                            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                            Fix with AI
                        </button>
                    </Tooltip>
                )}
            </div>
        </motion.div>
    );
}

function AnimatedNumber({ value }) {
    const reducedMotion = useReducedMotion();
    const motionValue = useMotionValue(0);
    const springValue = useSpring(motionValue, { ...SPRING.counterNumber, duration: reducedMotion ? 0 : 0.8 });
    const [display, setDisplay] = useState(reducedMotion ? value : 0);
    useEffect(() => { motionValue.set(value); }, [value, motionValue]);
    useEffect(() => {
        const unsubscribe = springValue.on('change', v => setDisplay(Math.round(v)));
        return unsubscribe;
    }, [springValue]);
    return <>{display}</>;
}

function MetricCard({ title, value, icon: Icon, color, index = 0 }) {
    const gradientColors = {
        blue: 'from-blue-500/20 to-blue-600/10 dark:from-blue-500/30 dark:to-blue-600/20',
        green: 'from-green-500/20 to-green-600/10 dark:from-green-500/30 dark:to-green-600/20',
        amber: 'from-amber-500/20 to-amber-600/10 dark:from-amber-500/30 dark:to-amber-600/20',
        emerald: 'from-emerald-500/20 to-emerald-600/10 dark:from-emerald-500/30 dark:to-emerald-600/20'
    };

    const iconColors = {
        blue: 'text-blue-600 dark:text-blue-400',
        green: 'text-green-600 dark:text-green-400',
        amber: 'text-amber-600 dark:text-amber-400',
        emerald: 'text-emerald-600 dark:text-emerald-400'
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 + index * 0.08, duration: 0.4 }}
            className="rounded-2xl p-6 border border-slate-200/40 dark:border-slate-800/40 bg-white/60 dark:bg-slate-900/60"
        >
            <div className={`p-3 rounded-xl bg-gradient-to-br ${gradientColors[color]} w-fit mb-4`}>
                <Icon className={`w-6 h-6 ${iconColors[color]}`} />
            </div>
            <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-1">
                <AnimatedNumber value={value} />
            </div>
            <div className="text-sm text-slate-500 dark:text-slate-400">{title}</div>
        </motion.div>
    );
}

function RecommendationItem({ recommendation }) {
    const priorityColors = {
        high: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800',
        medium: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
        low: 'bg-blue-100/60 dark:bg-blue-900/20 text-blue-600 dark:text-blue-500 border-blue-200/60 dark:border-blue-800/40'
    };

    const iconGradients = {
        high: 'bg-red-500/20 dark:bg-red-500/30',
        medium: 'bg-amber-500/20 dark:bg-amber-500/30',
        low: 'bg-blue-500/15 dark:bg-blue-500/20'
    };

    const iconColors = {
        high: 'text-red-500',
        medium: 'text-amber-500',
        low: 'text-blue-400 dark:text-blue-500'
    };

    return (
        <motion.div
            className="flex items-start gap-3 p-4 rounded-xl bg-white/60 dark:bg-slate-900/60 border border-slate-200/40 dark:border-slate-800/40 transition-all"
        >
            <div className={`p-1.5 rounded-lg ${iconGradients[recommendation.priority]}`}>
                <AlertCircle className={`w-4 h-4 ${iconColors[recommendation.priority]}`} />
            </div>
            <div className="flex-1">
                <div className="font-medium text-slate-900 dark:text-slate-100">{recommendation.action}</div>
                <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Category: {recommendation.category}
                </div>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full border ${priorityColors[recommendation.priority]} ${recommendation.priority === 'high' ? 'animate-pulse' : ''}`}>
                {recommendation.priority}
            </span>
        </motion.div>
    );
}

const SKELETON_MESSAGES = [
    'Checking community files...',
    'Analyzing repository activity...',
    'Calculating health score...',
    'Generating recommendations...'
];

function SkeletonState() {
    const [messageIndex, setMessageIndex] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setMessageIndex(i => (i + 1) % SKELETON_MESSAGES.length);
        }, 1500);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="space-y-6">
            {/* Loading message */}
            <div className="flex justify-center py-2">
                <AnimatePresence mode="wait">
                    <motion.p
                        key={messageIndex}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0, transition: { duration: 0.35 } }}
                        exit={{ opacity: 0, y: -8, transition: { duration: 0.25 } }}
                        className="text-sm font-medium text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]"
                    >
                        {SKELETON_MESSAGES[messageIndex]}
                    </motion.p>
                </AnimatePresence>
            </div>

            {/* Health Score skeleton */}
            <div className="rounded-3xl p-8 bg-indigo-500/10 dark:bg-indigo-500/20 border border-indigo-200/30 dark:border-indigo-500/20">
                <div className="flex flex-col sm:flex-row items-center gap-6">
                    <div className="w-28 h-28 md:w-36 md:h-36 rounded-full ds-skeleton" />
                    <div className="space-y-3 flex-1">
                        <div className="h-4 w-40 ds-skeleton" />
                        <div className="h-8 w-24 ds-skeleton" />
                        <div className="h-6 w-20 ds-skeleton rounded-full" />
                    </div>
                </div>
            </div>

            {/* Community Files skeleton */}
            <div className="rounded-3xl p-6 border border-slate-200/40 dark:border-slate-800/40 bg-white/60 dark:bg-slate-900/60">
                <div className="flex items-center gap-2 mb-4">
                    <div className="w-5 h-5 ds-skeleton rounded-md" />
                    <div className="h-5 w-36 ds-skeleton" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200/20 dark:border-slate-700/20">
                            <div className="w-5 h-5 ds-skeleton rounded-full shrink-0" />
                            <div className="h-4 ds-skeleton flex-1" style={{ maxWidth: `${100 + (i % 3) * 40}px` }} />
                        </div>
                    ))}
                </div>
            </div>

            {/* Activity Metrics skeleton */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="rounded-2xl p-5 border border-slate-200/40 dark:border-slate-800/40 bg-white/60 dark:bg-slate-900/60">
                        <div className="w-10 h-10 ds-skeleton rounded-xl mb-3" />
                        <div className="h-6 w-12 ds-skeleton mb-2" />
                        <div className="h-3.5 w-20 ds-skeleton" />
                    </div>
                ))}
            </div>

            {/* Recommendations skeleton */}
            <div className="rounded-3xl p-6 border border-slate-200/40 dark:border-slate-800/40 bg-white/60 dark:bg-slate-900/60">
                <div className="flex items-center gap-2 mb-4">
                    <div className="w-5 h-5 ds-skeleton rounded-md" />
                    <div className="h-5 w-40 ds-skeleton" />
                </div>
                <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="flex items-start gap-3 p-4 rounded-xl border border-slate-200/20 dark:border-slate-700/20">
                            <div className="w-7 h-7 ds-skeleton rounded-lg shrink-0" />
                            <div className="flex-1 space-y-2">
                                <div className="h-4 ds-skeleton" style={{ maxWidth: `${200 + i * 60}px` }} />
                                <div className="h-3 ds-skeleton w-28" />
                            </div>
                            <div className="w-14 h-5 ds-skeleton rounded-full shrink-0" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
