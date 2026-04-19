import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { GitCommit, GitPullRequest, CircleDot, Activity, Clock, FileCode, Star, GitFork, Tag, Trash2 } from 'lucide-react';

import { MOCK_MODE } from '../../config';

export function ActivityTab({ teamId }) {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchActivity = async () => {
            if (MOCK_MODE) {
                // Simulate network delay
                await new Promise(resolve => setTimeout(resolve, 800));
                setEvents(MOCK_ACTIVITY_DATA);
                setLoading(false);
                return;
            }

            try {
                setLoading(true);
                setError(null);
                const res = await fetch(`/api/teams/${teamId}/activity`);

                // Fallback for demo if backend not running/configured
                if (!res.ok) {
                    setEvents(MOCK_ACTIVITY_DATA);
                    setLoading(false);
                    return;
                }

                const data = await res.json();
                setEvents(data);
            } catch (e) {
                setError(e?.message || 'Failed to load activity feed');
                setEvents(MOCK_ACTIVITY_DATA);
            } finally {
                setLoading(false);
            }
        };

        fetchActivity();
    }, [teamId]);

    if (loading) return <ActivitySkeleton />;
    if (error && events.length === 0) return <div className="p-8 text-center text-red-400">{error}</div>;
    if (events.length === 0) return (
        <div className="flex flex-col items-center justify-center p-12 text-slate-400">
            <Activity className="w-12 h-12 mb-4 opacity-20" />
            <p>No recent activity found for this team's repositories.</p>
        </div>
    );

    // Group events by date
    const groupedEvents = events.reduce((groups, event) => {
        const date = new Date(event.created_at).toLocaleDateString(undefined, {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        if (!groups[date]) groups[date] = [];
        groups[date].push(event);
        return groups;
    }, {});

    return (
        <div className="space-y-8">
            {error && (
                <div className="px-4 py-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl text-sm text-red-600 dark:text-red-400">
                    {error} — showing cached data.
                </div>
            )}
            {Object.entries(groupedEvents).map(([date, dayEvents]) => (
                <div key={date} className="relative">
                    <div className="sticky top-0 z-10 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-sm py-2 px-1 mb-4 flex items-center gap-4">
                        <span className="text-sm font-bold text-slate-400 uppercase tracking-wider">{date}</span>
                        <div className="h-px bg-slate-200 dark:bg-slate-700 flex-1"></div>
                    </div>
                    <div className="space-y-4 pl-2 lg:pl-0">
                        {dayEvents.map((event) => (
                            <ActivityItem key={event.id} event={event} />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

function ActivityItem({ event }) {
    const getEventIcon = (type) => {
        switch (type) {
            case 'PushEvent': return <GitCommit className="w-4 h-4 text-emerald-500" />;
            case 'PullRequestEvent': return <GitPullRequest className="w-4 h-4 text-purple-500" />;
            case 'IssuesEvent': return <CircleDot className="w-4 h-4 text-amber-500" />;
            case 'CreateEvent': return <FileCode className="w-4 h-4 text-blue-500" />;
            case 'WatchEvent': return <Star className="w-4 h-4 text-yellow-500" />;
            case 'ForkEvent': return <GitFork className="w-4 h-4 text-indigo-500" />;
            case 'ReleaseEvent': return <Tag className="w-4 h-4 text-green-500" />;
            case 'DeleteEvent': return <Trash2 className="w-4 h-4 text-red-400" />;
            default: return <Activity className="w-4 h-4 text-slate-400" />;
        }
    };

    const getEventDescription = (event) => {
        const repo = event.repo_name ? event.repo_name.split('/')[1] : 'unknown-repo';
        const actor = <span className="font-medium text-slate-900 dark:text-white">{event.actor.login}</span>;
        const repoLink = <span className="font-medium text-indigo-500">{repo}</span>;
        const payload = event.payload || {};

        switch (event.type) {
            case 'PushEvent':
                return <>{actor} pushed {payload.size || 0} commits to {repoLink}</>;
            case 'PullRequestEvent':
                return <>{actor} {payload.action} PR #{payload.number} in {repoLink}</>;
            case 'IssuesEvent':
                return <>{actor} {payload.action} issue #{payload.issue?.number} in {repoLink}</>;
            case 'CreateEvent':
                return <>{actor} created {payload.ref_type} {payload.ref || ''} in {repoLink}</>;
            case 'WatchEvent':
                return <>{actor} starred {repoLink}</>;
            case 'ForkEvent':
                return <>{actor} forked {repoLink}</>;
            case 'ReleaseEvent':
                return <>{actor} released {payload.release?.tag_name} in {repoLink}</>;
            case 'DeleteEvent':
                return <>{actor} deleted {payload.ref_type} {payload.ref} in {repoLink}</>;
            default:
                return <>{actor} performed {event.type} in {repoLink}</>;
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-4 p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 hover:border-indigo-500/30 transition-all hover:shadow-sm group"
        >
            <div className="mt-1 p-2 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-700 group-hover:scale-110 transition-transform">
                {getEventIcon(event.type)}
            </div>

            <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    {getEventDescription(event)}
                </p>
                <div className="flex items-center gap-3 mt-2">
                    <img
                        src={event.actor.avatar_url}
                        alt={`Avatar for ${event.actor.login || 'activity actor'}`}
                        className="w-5 h-5 rounded-full border border-slate-200 dark:border-slate-700"
                    />
                    <span className="text-xs text-slate-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(event.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                </div>
            </div>
        </motion.div>
    );
}

const MOCK_ACTIVITY_DATA = [
    {
        id: '1',
        type: 'PushEvent',
        created_at: new Date().toISOString(),
        actor: { login: 'mock-user', avatar_url: 'https://github.com/ghost.png' },
        repo_name: 'owner/demo-repo',
        payload: { size: 3, commits: [{ message: 'Initial commit' }] }
    },
    {
        id: '2',
        type: 'PullRequestEvent',
        created_at: new Date(Date.now() - 3600000).toISOString(),
        actor: { login: 'dev-lead', avatar_url: 'https://github.com/ghost.png' },
        repo_name: 'owner/backend-api',
        payload: { action: 'opened', number: 42, pull_request: { title: 'Add auth middleware' } }
    },
    {
        id: '3',
        type: 'IssuesEvent',
        created_at: new Date(Date.now() - 86400000).toISOString(),
        actor: { login: 'qa-tester', avatar_url: 'https://github.com/ghost.png' },
        repo_name: 'owner/frontend-ui',
        payload: { action: 'opened', issue: { number: 101, title: 'Fix login button alignment' } }
    },
    {
        id: '4',
        type: 'WatchEvent',
        created_at: new Date(Date.now() - 172800000).toISOString(),
        actor: { login: 'fan-user', avatar_url: 'https://github.com/ghost.png' },
        repo_name: 'owner/awesome-project',
        payload: {}
    }
];

function ActivitySkeleton() {
    return (
        <div className="space-y-4">
            {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-start gap-3 p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                    <div className="w-8 h-8 bg-slate-100 dark:bg-slate-700/50 rounded-lg animate-pulse" />
                    <div className="flex-1 space-y-2">
                        <div className="h-4 bg-slate-100 dark:bg-slate-700/50 rounded w-3/4 animate-pulse" />
                        <div className="h-3 bg-slate-100 dark:bg-slate-700/50 rounded w-1/4 animate-pulse" />
                    </div>
                </div>
            ))}
        </div>
    );
}

