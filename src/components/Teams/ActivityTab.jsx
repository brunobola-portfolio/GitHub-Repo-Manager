import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { GitCommit, GitPullRequest, CircleDot, Activity, Clock, FileCode, Star, GitFork, Tag, Trash2, AlertTriangle } from 'lucide-react';

import { MOCK_MODE } from '../../config';
import { EmptyState } from '../ui/EmptyState';
import { Card } from '../ui/Card';
import { Skeleton } from '../ui/Skeleton';
import { formatDate, parseServerTimestamp } from '../../utils/format';

export function ActivityTab({ teamId }) {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [meta, setMeta] = useState({ truncated: false, totalRepos: 0, scannedRepos: 0 });

    useEffect(() => {
        let cancelled = false;
        const fetchActivity = async () => {
            if (MOCK_MODE) {
                // Simulate network delay
                await new Promise(resolve => setTimeout(resolve, 800));
                if (cancelled) return;
                setEvents(MOCK_ACTIVITY_DATA);
                setLoading(false);
                return;
            }

            try {
                setLoading(true);
                setError(false);
                const res = await fetch(`/api/teams/${teamId}/activity`);
                if (!res.ok) throw new Error(`activity request failed: ${res.status}`);

                const data = await res.json();
                if (cancelled) return;
                // Backwards compatible: older shape was a bare array; current
                // shape is { events, totalRepos, scannedRepos, truncated }.
                if (Array.isArray(data)) {
                    setEvents(data);
                    setMeta({ truncated: false, totalRepos: 0, scannedRepos: 0 });
                } else {
                    setEvents(data.events ?? []);
                    setMeta({
                        truncated: !!data.truncated,
                        totalRepos: data.totalRepos ?? 0,
                        scannedRepos: data.scannedRepos ?? 0,
                    });
                }
            } catch {
                // Surface an honest error + Retry instead of silently
                // substituting fabricated demo events — real users would read
                // MOCK_ACTIVITY_DATA as genuine team activity.
                if (!cancelled) {
                    setError(true);
                    setEvents([]);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        fetchActivity();
        return () => { cancelled = true; };
    }, [teamId, reloadKey]);

    if (loading) return <ActivitySkeleton />;
    if (error) return (
        <EmptyState
            icon={AlertTriangle}
            title="Couldn't load activity"
            description="Couldn't reach the activity feed. Check your connection and try again."
            action={{ label: 'Retry', onClick: () => setReloadKey(k => k + 1) }}
        />
    );
    if (events.length === 0) return (
        <EmptyState
            icon={Activity}
            title="No recent activity"
            description="Once this team's repositories see commits, PRs or issues, they'll show up here."
        />
    );

    // Group events by date. formatDate parses naive-UTC server strings
    // correctly (and passes ISO-with-zone through untouched).
    const groupedEvents = events.reduce((groups, event) => {
        const date = formatDate(event.created_at, {
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
            {meta.truncated && (
                <div className="px-4 py-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl text-xs text-amber-800 dark:text-amber-200">
                    Showing activity from {meta.scannedRepos} of {meta.totalRepos} team repositories — older or rate-limited repos are deferred to keep this feed responsive.
                </div>
            )}
            {Object.entries(groupedEvents).map(([date, dayEvents]) => (
                <div key={date} className="relative">
                    <div className="sticky top-0 z-10 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-sm py-2 px-1 mb-4 flex items-center gap-4">
                        <span className="ds-eyebrow text-slate-500 dark:text-slate-400">{date}</span>
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
    // parseServerTimestamp handles naive-UTC server strings; toLocaleTimeString
    // gives the clock time (no format.js time-only helper exists to reuse).
    const eventTime = parseServerTimestamp(event.created_at);

    const getEventIcon = (type) => {
        switch (type) {
            case 'PushEvent': return <GitCommit className="w-4 h-4 text-emerald-500" />;
            case 'PullRequestEvent': return <GitPullRequest className="w-4 h-4 text-brand-500" />;
            case 'IssuesEvent': return <CircleDot className="w-4 h-4 text-amber-500" />;
            case 'CreateEvent': return <FileCode className="w-4 h-4 text-blue-500" />;
            case 'WatchEvent': return <Star className="w-4 h-4 text-amber-500" />;
            case 'ForkEvent': return <GitFork className="w-4 h-4 text-brand-500" />;
            case 'ReleaseEvent': return <Tag className="w-4 h-4 text-emerald-500" />;
            case 'DeleteEvent': return <Trash2 className="w-4 h-4 text-rose-400" />;
            default: return <Activity className="w-4 h-4 text-slate-400" />;
        }
    };

    const getEventDescription = (event) => {
        const repo = event.repo_name ? event.repo_name.split('/')[1] : 'unknown-repo';
        const actor = <span className="font-medium text-slate-900 dark:text-slate-100">{event.actor.login}</span>;
        const repoLink = <span className="font-medium text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]">{repo}</span>;
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
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Card glass={false} shadow="sm" className="flex items-start gap-4 p-4 hover:border-brand-500/30 group">
            <div className="mt-1 p-2 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-700 group-hover:border-brand-300/60 dark:group-hover:border-brand-500/40 transition-colors">
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
                    <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {eventTime ? eventTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                </div>
            </div>
        </Card>
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
                    <Skeleton className="w-8 h-8 rounded-lg" />
                    <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-1/4" />
                    </div>
                </div>
            ))}
        </div>
    );
}

