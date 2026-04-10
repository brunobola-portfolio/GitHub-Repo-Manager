import { useState, useEffect } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring, useReducedMotion } from 'framer-motion';
import {
    FileText, Users, Activity, CheckCircle,
    XCircle, AlertCircle, TrendingUp, RefreshCw
} from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { useFocusTrap } from '../hooks/useFocusTrap';

function getScoreConfig(score) {
    if (score >= 80) return { color: '#10b981', tailwind: 'emerald', label: 'Excellent' };
    if (score >= 60) return { color: '#3b82f6', tailwind: 'blue', label: 'Good' };
    if (score >= 40) return { color: '#f59e0b', tailwind: 'amber', label: 'Fair' };
    return { color: '#ef4444', tailwind: 'red', label: 'Needs Improvement' };
}

function HealthScoreRing({ score }) {
    const reducedMotion = useReducedMotion();
    const config = getScoreConfig(score);
    const normalizedScore = Math.min(Math.max(score, 0), 100) / 100;
    const motionValue = useMotionValue(0);
    const springValue = useSpring(motionValue, { stiffness: 80, damping: 20, duration: reducedMotion ? 0 : 1.2 });
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
                    initial={{ pathLength: reducedMotion ? normalizedScore : 0 }}
                    animate={{ pathLength: normalizedScore }}
                    transition={reducedMotion ? { duration: 0 } : { duration: 1.2, ease: 'easeOut' }}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center rotate-0">
                <span className="text-3xl md:text-5xl font-bold text-slate-900 dark:text-white">{displayScore}</span>
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

export function CommunityHealthDashboard({ repo, onClose }) {
    const [health, setHealth] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const { toast } = useToast();
    const modalRef = useFocusTrap(true, onClose);

    useEffect(() => {
        if (repo) {
            fetchHealth(repo.full_name);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [repo]);

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

    const handleRefresh = () => {
        setRefreshing(true);
        fetchHealth(repo.full_name, true);
    };

    const showContent = !loading && health;

    return (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
            role="dialog" aria-modal="true" aria-label="Community Health Dashboard"
        >
            <motion.div
                ref={modalRef}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl rounded-3xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-auto"
            >
                <div className="sticky top-0 z-10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-white/10 dark:border-white/5 px-6 py-3 sm:py-4 flex items-center justify-between rounded-t-3xl">
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Community Health</h1>
                            {showContent && <ScoreBadge score={health.score} />}
                        </div>
                        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{repo.full_name}</p>
                    </div>

                    <div className="flex gap-3">
                        <button
                            onClick={handleRefresh}
                            disabled={refreshing}
                            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                        >
                            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                            Refresh
                        </button>
                        <button
                            onClick={onClose}
                            className="px-4 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </div>

                <div className="p-6 space-y-6">
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
                                {/* Health Score */}
                                <div className="rounded-3xl p-8 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 dark:from-indigo-500/20 dark:to-purple-500/20 border border-indigo-200/30 dark:border-indigo-500/20">
                                    <div className="flex flex-col sm:flex-row items-center gap-6">
                                        <HealthScoreRing score={health.score} />
                                        <div className="text-center sm:text-left space-y-1">
                                            <div className="text-sm uppercase tracking-wide text-slate-500 dark:text-slate-400">Overall Health Score</div>
                                            <div className="text-4xl font-bold text-slate-900 dark:text-white">{health.score}<span className="text-lg text-slate-400">%</span></div>
                                            <ScoreBadge score={health.score} />
                                        </div>
                                    </div>
                                </div>

                                {/* File Checklist */}
                                <motion.div
                                    initial={{ opacity: 0, y: 12 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.2, duration: 0.4 }}
                                    className="rounded-3xl p-6 border border-slate-200/40 dark:border-slate-800/40 bg-white/60 dark:bg-slate-900/60"
                                >
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                                        <FileText className="w-5 h-5 text-indigo-500" />
                                        Community Files
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {Object.entries(health.metrics.files).map(([file, data]) => (
                                            <FileCheckItem key={file} file={file} exists={data.exists} size={data.size} />
                                        ))}
                                    </div>
                                </motion.div>

                                {/* Activity Metrics */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                    <MetricCard
                                        title="Contributors"
                                        value={health.metrics.activity.contributorCount}
                                        icon={Users}
                                        color="blue"
                                        index={0}
                                    />
                                    <MetricCard
                                        title="Commits (30d)"
                                        value={health.metrics.activity.commitsLast30Days}
                                        icon={Activity}
                                        color="green"
                                        index={1}
                                    />
                                    <MetricCard
                                        title="Open Issues"
                                        value={health.metrics.activity.openIssues}
                                        icon={AlertCircle}
                                        color="amber"
                                        index={2}
                                    />
                                    <MetricCard
                                        title="Closed Issues"
                                        value={health.metrics.activity.closedIssues}
                                        icon={CheckCircle}
                                        color="emerald"
                                        index={3}
                                    />
                                </div>

                                {/* Recommendations */}
                                <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-700">
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
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

                                {/* Last Updated */}
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
            </motion.div>
        </div>
    );
}

function FileCheckItem({ file, exists, size }) {
    return (
        <motion.div whileHover={{ y: -1 }}
            className={`flex items-center justify-between p-3 rounded-xl min-h-[44px] ds-card-shimmer bg-white/60 dark:bg-slate-900/60 border ${exists ? 'border-slate-200/40 dark:border-slate-800/40' : 'border-red-300/40 dark:border-red-500/20'} transition-all`}>
            <div className="flex items-center gap-3">
                {exists ? (
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
                        <CheckCircle className="w-5 h-5 text-emerald-500" />
                    </motion.div>
                ) : (<XCircle className="w-5 h-5 text-red-400 dark:text-red-500" />)}
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{file}</span>
            </div>
            {exists && size > 0 && (<span className="text-xs text-slate-400">{(size / 1024).toFixed(1)} KB</span>)}
        </motion.div>
    );
}

function AnimatedNumber({ value }) {
    const reducedMotion = useReducedMotion();
    const motionValue = useMotionValue(0);
    const springValue = useSpring(motionValue, { stiffness: 100, damping: 20, duration: reducedMotion ? 0 : 0.8 });
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
            <div className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
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
        low: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800'
    };

    return (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
            <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5" />
            <div className="flex-1">
                <div className="font-medium text-slate-900 dark:text-white">{recommendation.action}</div>
                <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Category: {recommendation.category}
                </div>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full border ${priorityColors[recommendation.priority]}`}>
                {recommendation.priority}
            </span>
        </div>
    );
}

function SkeletonState() {
    const [messageIndex, setMessageIndex] = useState(0);
    const messages = [
        'Checking community files...',
        'Analyzing repository activity...',
        'Calculating health score...',
        'Generating recommendations...'
    ];

    useEffect(() => {
        const interval = setInterval(() => {
            setMessageIndex(i => (i + 1) % messages.length);
        }, 1500);
        return () => clearInterval(interval);
    }, [messages.length]);

    return (
        <div className="space-y-6">
            <div className="flex justify-center py-2">
                <AnimatePresence mode="wait">
                    <motion.p
                        key={messageIndex}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0, transition: { duration: 0.35 } }}
                        exit={{ opacity: 0, y: -8, transition: { duration: 0.25 } }}
                        className="text-sm font-medium text-indigo-600 dark:text-indigo-400"
                    >
                        {messages[messageIndex]}
                    </motion.p>
                </AnimatePresence>
            </div>
            <div className="rounded-3xl p-8 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 dark:from-indigo-500/20 dark:to-purple-500/20 border border-indigo-200/30 dark:border-indigo-500/20">
                <div className="flex flex-col sm:flex-row items-center gap-6">
                    <div className="w-28 h-28 md:w-36 md:h-36 rounded-full bg-slate-200/60 dark:bg-slate-700/40 animate-pulse" />
                    <div className="space-y-3 flex-1">
                        <div className="h-4 w-40 bg-slate-200/60 dark:bg-slate-700/40 rounded-lg animate-pulse" />
                        <div className="h-8 w-24 bg-slate-200/60 dark:bg-slate-700/40 rounded-lg animate-pulse" />
                        <div className="h-4 w-32 bg-slate-200/60 dark:bg-slate-700/40 rounded-lg animate-pulse" />
                    </div>
                </div>
            </div>
            <div className="rounded-3xl p-6 border border-slate-200/40 dark:border-slate-800/40 bg-white/60 dark:bg-slate-900/60">
                <div className="h-5 w-36 bg-slate-200/60 dark:bg-slate-700/40 rounded-lg animate-pulse mb-4" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="h-12 bg-slate-200/40 dark:bg-slate-700/30 rounded-xl animate-pulse" />
                    ))}
                </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="rounded-2xl p-6 border border-slate-200/40 dark:border-slate-800/40 bg-white/60 dark:bg-slate-900/60">
                        <div className="w-12 h-12 bg-slate-200/60 dark:bg-slate-700/40 rounded-xl animate-pulse mb-4" />
                        <div className="h-7 w-16 bg-slate-200/60 dark:bg-slate-700/40 rounded-lg animate-pulse mb-2" />
                        <div className="h-4 w-24 bg-slate-200/60 dark:bg-slate-700/40 rounded-lg animate-pulse" />
                    </div>
                ))}
            </div>
            <div className="rounded-3xl p-6 border border-slate-200/40 dark:border-slate-800/40 bg-white/60 dark:bg-slate-900/60">
                <div className="h-5 w-40 bg-slate-200/60 dark:bg-slate-700/40 rounded-lg animate-pulse mb-4" />
                <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-16 bg-slate-200/40 dark:bg-slate-700/30 rounded-xl animate-pulse" />
                    ))}
                </div>
            </div>
        </div>
    );
}
