import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Activity, TrendingUp, TrendingDown, Clock, CheckCircle,
    XCircle, AlertCircle, Download, RefreshCw, Zap, ChevronDown
} from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useToast } from '../hooks/useToast';
import { Card } from './ui/Card';
import { Select } from './ui/Select';

const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: { duration: 0.4, staggerChildren: 0.1 }
    }
};

const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4 } }
};

export function ActionsStatsDashboard({ repos, teamId }) {
    const [selectedRepo, setSelectedRepo] = useState(repos[0]?.full_name || null);
    const [timeRange, setTimeRange] = useState(30);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [teamStats, setTeamStats] = useState(null);
    const [error, setError] = useState(null);
    const { toast } = useToast();

    useEffect(() => {
        if (selectedRepo) {
            fetchStats(selectedRepo, timeRange);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedRepo, timeRange]);

    useEffect(() => {
        if (teamId && repos.length > 0) {
            fetchTeamStats();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [teamId, repos, timeRange]);

    const fetchStats = async (repoFullName, days) => {
        try {
            setLoading(true);
            const [owner, repo] = repoFullName.split('/');
            const res = await fetch(`/api/repos/${owner}/${repo}/actions/stats?days=${days}`, {
                credentials: 'include'
            });

            if (!res.ok) throw new Error('Failed to fetch stats');
            
            const data = await res.json();
            setStats(data);
        } catch {
            toast.error('Failed to load actions statistics');
        } finally {
            setLoading(false);
        }
    };

    const fetchTeamStats = async () => {
        try {
            setError(null);
            const res = await fetch(`/api/teams/${teamId}/actions/stats`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ days: timeRange })
            });

            if (!res.ok) throw new Error('Failed to fetch team stats');

            const data = await res.json();
            setTeamStats(data);
        } catch (e) {
            setError(e?.message || 'Failed to load team statistics');
        }
    };

    const syncWorkflowRuns = async () => {
        if (!selectedRepo) return;
        
        try {
            setSyncing(true);
            const [owner, repo] = selectedRepo.split('/');
            const res = await fetch(`/api/repos/${owner}/${repo}/actions/sync`, {
                method: 'POST',
                credentials: 'include'
            });

            if (!res.ok) throw new Error('Failed to sync');
            
            const data = await res.json();
            toast.success(data.message);
            fetchStats(selectedRepo, timeRange);
        } catch (error) {
            toast.error('Failed to sync workflow runs');
        } finally {
            setSyncing(false);
        }
    };

    const exportData = () => {
        if (!stats) return;
        
        const csvData = stats.trends.map(t => 
            `${t.date},${t.runs},${t.successes},${t.failures},${t.successRate},${t.avgDuration}`
        ).join('\n');
        
        const header = 'Date,Runs,Successes,Failures,Success Rate (%),Avg Duration (s)\n';
        const blob = new Blob([header + csvData], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `actions-stats-${selectedRepo?.replace('/', '-')}-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
    };

    if (loading && !stats) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="relative">
                    <div className="w-20 h-20 rounded-full border-4 border-indigo-100 dark:border-indigo-900/30 animate-pulse"></div>
                    <div className="absolute inset-0 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Zap className="w-8 h-8 text-indigo-500" />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="space-y-8 pb-12"
        >
            {/* Premium Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6">
                <div>
                    <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-400 dark:to-purple-400 tracking-tight flex items-center gap-3">
                        <Zap className="w-10 h-10 text-indigo-600 dark:text-indigo-400" />
                        Actions Statistics
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-2 text-lg">
                        Monitor CI/CD pipeline performance across your team
                    </p>
                </div>
                
                <div className="flex gap-3">
                    <Select
                        value={timeRange}
                        onChange={(val) => setTimeRange(Number(val))}
                        options={[
                            { value: 7, label: 'Last 7 days' },
                            { value: 30, label: 'Last 30 days' },
                            { value: 90, label: 'Last 90 days' }
                        ]}
                        size="sm"
                    />
                    
                    <button
                        onClick={syncWorkflowRuns}
                        disabled={syncing}
                        className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 shadow-lg shadow-indigo-500/20 hover:shadow-xl hover:shadow-indigo-500/30 transition-all font-semibold"
                    >
                        <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                        Sync
                    </button>
                    
                    <button
                        onClick={exportData}
                        className="flex items-center gap-2 px-5 py-2.5 bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl border border-slate-200 dark:border-slate-700 rounded-xl hover:shadow-md text-slate-700 dark:text-slate-300 transition-all font-semibold hover:border-indigo-300 dark:hover:border-indigo-500/50"
                    >
                        <Download className="w-4 h-4" />
                        Export CSV
                    </button>
                </div>
            </div>

            {error && (
                <div className="px-4 py-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl text-sm text-red-600 dark:text-red-400">
                    {error}
                </div>
            )}

            {/* Repository Selector Pills */}
            <motion.div variants={itemVariants} className="flex gap-3 overflow-x-auto pb-3 scrollbar-hide">
                {repos.map(repo => (
                    <motion.button
                        key={repo.id}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setSelectedRepo(repo.full_name)}
                        className={`px-6 py-3 rounded-2xl whitespace-nowrap transition-all font-semibold shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset ${
                            selectedRepo === repo.full_name
                                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-indigo-500/30'
                                : 'bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl text-slate-600 dark:text-slate-400 hover:bg-white/80 dark:hover:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/60'
                        }`}
                    >
                        {repo.name}
                    </motion.button>
                ))}
            </motion.div>

            {/* Team Performance Banner */}
            {teamStats && (
                <motion.div variants={itemVariants}>
                    <Card className="p-8 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white border-none shadow-2xl shadow-indigo-500/30 overflow-hidden relative">
                        <div className="absolute top-0 right-0 w-96 h-96 bg-white/10 rounded-full blur-3xl -mr-48 -mt-48" />
                        <div className="relative z-10">
                            <h3 className="text-2xl font-bold mb-6 flex items-center gap-2">
                                <Zap className="w-6 h-6" />
                                Team Performance Overview
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
                                <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6">
                                    <div className="text-5xl font-extrabold mb-2">{teamStats.teamAverages.totalRuns}</div>
                                    <div className="text-indigo-100 font-medium">Total Workflow Runs</div>
                                </div>
                                <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6">
                                    <div className="text-5xl font-extrabold mb-2">{teamStats.teamAverages.avgSuccessRate}%</div>
                                    <div className="text-indigo-100 font-medium">Average Success Rate</div>
                                </div>
                                <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6">
                                    <div className="text-5xl font-extrabold mb-2">{formatDuration(teamStats.teamAverages.avgDuration)}</div>
                                    <div className="text-indigo-100 font-medium">Average Duration</div>
                                </div>
                            </div>
                        </div>
                    </Card>
                </motion.div>
            )}

            {/* Overview Cards */}
            {stats && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                    <StatCard
                        title="Total Runs"
                        value={stats.stats.totalRuns}
                        icon={Activity}
                        color="text-blue-500"
                        bg="bg-blue-500/10"
                        trend={`${stats.stats.totalRuns} executions`}
                    />
                    <StatCard
                        title="Success Rate"
                        value={`${stats.stats.successRate}%`}
                        icon={stats.stats.successRate >= 80 ? CheckCircle : AlertCircle}
                        color={stats.stats.successRate >= 80 ? 'text-emerald-500' : 'text-amber-500'}
                        bg={stats.stats.successRate >= 80 ? 'bg-emerald-500/10' : 'bg-amber-500/10'}
                        trend={stats.stats.successRate >= 80 ? 'Excellent' : 'Needs attention'}
                        trendIcon={stats.stats.successRate >= 80 ? TrendingUp : TrendingDown}
                    />
                    <StatCard
                        title="Avg Duration"
                        value={formatDuration(stats.stats.avgDuration)}
                        icon={Clock}
                        color="text-purple-500"
                        bg="bg-purple-500/10"
                        trend="Per workflow"
                    />
                    <StatCard
                        title="Failures"
                        value={stats.stats.failureCount}
                        icon={XCircle}
                        color="text-red-500"
                        bg="bg-red-500/10"
                        trend={`${stats.stats.successCount} succeeded`}
                    />
                </div>
            )}

            {/* Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 lg:gap-8">
                {/* Success Rate Trend */}
                {stats && stats.trends.length > 0 && (
                    <motion.div variants={itemVariants}>
                        <Card className="p-6 h-[420px] bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-slate-200/60 dark:border-slate-800/60 shadow-xl">
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-8 flex items-center gap-2">
                                <TrendingUp className="w-5 h-5 text-emerald-500" />
                                Success Rate Trend
                            </h3>
                            <div style={{ height: '300px', overflow: 'hidden' }}>
                                <ResponsiveContainer width="100%" height="100%" debounce={50}>
                                    <LineChart data={stats.trends}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.1} vertical={false} />
                                        <XAxis
                                            dataKey="date"
                                            stroke="#94a3b8"
                                            fontSize={12}
                                            tickLine={false}
                                            axisLine={false}
                                            dy={10}
                                        />
                                        <YAxis
                                            stroke="#94a3b8"
                                            fontSize={12}
                                            tickLine={false}
                                            axisLine={false}
                                            dx={-10}
                                        />
                                        <Tooltip
                                            contentStyle={{
                                                backgroundColor: 'rgba(30, 41, 59, 0.9)',
                                                border: 'none',
                                                borderRadius: '12px',
                                                color: '#f8fafc',
                                                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                                                backdropFilter: 'blur(12px)'
                                            }}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="successRate"
                                            stroke="#10b981"
                                            strokeWidth={4}
                                            name="Success Rate (%)"
                                            dot={{ fill: '#10b981', strokeWidth: 0, r: 4 }}
                                            activeDot={{ r: 8, strokeWidth: 0 }}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="runs"
                                            stroke="#6366f1"
                                            strokeWidth={4}
                                            name="Total Runs"
                                            dot={{ fill: '#6366f1', strokeWidth: 0, r: 4 }}
                                            activeDot={{ r: 8, strokeWidth: 0 }}
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </Card>
                    </motion.div>
                )}

                {/* Duration Analysis */}
                {stats && stats.trends.length > 0 && (
                    <motion.div variants={itemVariants}>
                        <Card className="p-6 h-[420px] bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-slate-200/60 dark:border-slate-800/60 shadow-xl">
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-8 flex items-center gap-2">
                                <Clock className="w-5 h-5 text-purple-500" />
                                Average Duration
                            </h3>
                            <div style={{ height: '300px', overflow: 'hidden' }}>
                                <ResponsiveContainer width="100%" height="100%" debounce={50}>
                                    <BarChart data={stats.trends}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.1} vertical={false} />
                                        <XAxis
                                            dataKey="date"
                                            stroke="#94a3b8"
                                            fontSize={12}
                                            tickLine={false}
                                            axisLine={false}
                                            dy={10}
                                        />
                                        <YAxis
                                            stroke="#94a3b8"
                                            fontSize={12}
                                            tickLine={false}
                                            axisLine={false}
                                            dx={-10}
                                        />
                                        <Tooltip
                                            cursor={{ fill: '#334155', opacity: 0.1 }}
                                            contentStyle={{
                                                backgroundColor: 'rgba(30, 41, 59, 0.9)',
                                                border: 'none',
                                                borderRadius: '12px',
                                                color: '#f8fafc',
                                                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                                                backdropFilter: 'blur(12px)'
                                            }}
                                        />
                                        <Bar
                                            dataKey="avgDuration"
                                            fill="#8b5cf6"
                                            radius={[6, 6, 0, 0]}
                                            name="Avg Duration (s)"
                                            barSize={32}
                                        />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </Card>
                    </motion.div>
                )}
            </div>

            {/* Success vs Failures Over Time */}
            {stats && stats.trends.length > 0 && (
                <motion.div variants={itemVariants}>
                    <Card className="p-6 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-slate-200/60 dark:border-slate-800/60 shadow-xl">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-8 flex items-center gap-2">
                            <Activity className="w-5 h-5 text-indigo-500" />
                            Workflow Execution Details
                        </h3>
                        <div style={{ height: '350px', overflow: 'hidden' }}>
                            <ResponsiveContainer width="100%" height="100%" debounce={50}>
                                <BarChart data={stats.trends}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.1} vertical={false} />
                                    <XAxis
                                        dataKey="date"
                                        stroke="#94a3b8"
                                        fontSize={12}
                                        tickLine={false}
                                        axisLine={false}
                                        dy={10}
                                    />
                                    <YAxis
                                        stroke="#94a3b8"
                                        fontSize={12}
                                        tickLine={false}
                                        axisLine={false}
                                        dx={-10}
                                    />
                                    <Tooltip
                                        cursor={{ fill: '#334155', opacity: 0.1 }}
                                        contentStyle={{
                                            backgroundColor: 'rgba(30, 41, 59, 0.9)',
                                            border: 'none',
                                            borderRadius: '12px',
                                            color: '#f8fafc',
                                            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
                                        }}
                                    />
                                    <Legend />
                                    <Bar dataKey="successes" name="Successes" fill="#10b981" radius={[6, 6, 0, 0]} barSize={20} />
                                    <Bar dataKey="failures" name="Failures" fill="#ef4444" radius={[6, 6, 0, 0]} barSize={20} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </Card>
                </motion.div>
            )}
        </motion.div>
    );
}

function StatCard({ title, value, icon: Icon, color, bg, trend, trendIcon: TrendIcon }) {
    return (
        <motion.div
            variants={itemVariants}
            whileHover={{ y: -3 }}
            transition={{ type: "spring", stiffness: 300 }}
        >
            <Card className="p-6 hover:shadow-xl transition-all duration-300 border-slate-200/60 dark:border-slate-800/60 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl group cursor-pointer focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-inset">
                <div className="flex items-start justify-between">
                    <div className="flex-1">
                        <p className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                            {title}
                        </p>
                        <h3 className="text-4xl font-extrabold text-slate-900 dark:text-white group-hover:text-transparent bg-clip-text group-hover:bg-gradient-to-r group-hover:from-indigo-500 group-hover:to-purple-500 transition-all">
                            {value}
                        </h3>
                        {trend && (
                            <p className="text-xs text-slate-400 mt-3 flex items-center gap-1.5 font-medium">
                                {TrendIcon && (
                                    <TrendIcon className="w-3.5 h-3.5 text-emerald-500" />
                                )}
                                {trend}
                            </p>
                        )}
                    </div>
                    <div className={`p-4 rounded-2xl ${bg} group-hover:scale-110 transition-transform duration-300 shadow-lg`}>
                        <Icon className={`w-7 h-7 ${color}`} />
                    </div>
                </div>
            </Card>
        </motion.div>
    );
}

function formatDuration(seconds) {
    if (!seconds) return '0s';
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    const hours = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return remainMins > 0 ? `${hours}h ${remainMins}m` : `${hours}h`;
}
