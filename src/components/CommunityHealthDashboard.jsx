import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
    Shield, FileText, Users, Activity, CheckCircle,
    XCircle, AlertCircle, TrendingUp, RefreshCw
} from 'lucide-react';
import { useToast } from '../hooks/useToast';

export function CommunityHealthDashboard({ repo, onClose }) {
    const [health, setHealth] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const { toast } = useToast();

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

    if (loading) {
        return (
            <div className="flex items-center justify-center p-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
            </div>
        );
    }

    if (!health) return null;

    const getScoreLabel = (score) => {
        if (score >= 80) return 'Excellent';
        if (score >= 60) return 'Good';
        if (score >= 40) return 'Fair';
        return 'Needs Improvement';
    };

    return (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-auto"
            >
                <div className="sticky top-0 z-10 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4 flex items-center justify-between rounded-t-3xl">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Community Health</h1>
                        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{repo.full_name}</p>
                    </div>

                    <div className="flex gap-3">
                        <button
                            onClick={handleRefresh}
                            disabled={refreshing}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                        >
                            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                            Refresh
                        </button>
                        <button
                            onClick={onClose}
                            className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    {/* Health Score */}
                    <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-3xl p-8 text-white">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm uppercase tracking-wide text-indigo-100 mb-2">Overall Health Score</div>
                                <div className="text-6xl font-bold">{health.score}</div>
                                <div className="text-xl text-indigo-100 mt-2">{getScoreLabel(health.score)}</div>
                            </div>
                            <div className="w-32 h-32 rounded-full border-8 border-white/30 flex items-center justify-center">
                                <div className="text-4xl font-bold">{health.score}%</div>
                            </div>
                        </div>
                    </div>

                    {/* File Checklist */}
                    <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-700">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                            <FileText className="w-5 h-5 text-indigo-500" />
                            Community Files
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {Object.entries(health.metrics.files).map(([file, data]) => (
                                <FileCheckItem key={file} file={file} exists={data.exists} size={data.size} />
                            ))}
                        </div>
                    </div>

                    {/* Activity Metrics */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        <MetricCard
                            title="Contributors"
                            value={health.metrics.activity.contributorCount}
                            icon={Users}
                            color="blue"
                        />
                        <MetricCard
                            title="Commits (30d)"
                            value={health.metrics.activity.commitsLast30Days}
                            icon={Activity}
                            color="green"
                        />
                        <MetricCard
                            title="Open Issues"
                            value={health.metrics.activity.openIssues}
                            icon={AlertCircle}
                            color="amber"
                        />
                        <MetricCard
                            title="Closed Issues"
                            value={health.metrics.activity.closedIssues}
                            icon={CheckCircle}
                            color="emerald"
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
                </div>
            </motion.div>
        </div>
    );
}

function FileCheckItem({ file, exists, size }) {
    return (
        <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3">
                {exists ? (
                    <CheckCircle className="w-5 h-5 text-emerald-500" />
                ) : (
                    <XCircle className="w-5 h-5 text-slate-400" />
                )}
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{file}</span>
            </div>
            {exists && size > 0 && (
                <span className="text-xs text-slate-400">{(size / 1024).toFixed(1)} KB</span>
            )}
        </div>
    );
}

function MetricCard({ title, value, icon: Icon, color }) {
    const colors = {
        blue: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
        green: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
        amber: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
        emerald: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700">
            <div className={`p-3 rounded-xl ${colors[color]} w-fit mb-4`}>
                <Icon className="w-6 h-6" />
            </div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white mb-1">{value}</div>
            <div className="text-sm text-slate-500 dark:text-slate-400">{title}</div>
        </div>
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
