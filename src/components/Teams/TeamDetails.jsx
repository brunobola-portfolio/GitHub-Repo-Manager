import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, ArrowLeft, Plus, Trash2, Shield, UserPlus, BookCopy, Zap, Play, Clock, CheckCircle, XCircle, Loader2, Search, Activity } from 'lucide-react';
import { Github } from '../icons/GithubIcon';
import { useToast } from '../../hooks/useToast';
import { ActivityTab } from './ActivityTab';
import { Select } from '../ui/Select';
import { ConfirmModal } from '../ui/ConfirmModal';
import { TabBar } from '../ui/TabBar';
import { Card } from '../ui/Card';

const TEAM_TABS = [
    { id: 'activity', label: 'Activity', icon: Activity },
    { id: 'members', label: 'Members', icon: Users },
    { id: 'repos', label: 'Repositories', icon: Github },
    { id: 'actions', label: 'Actions', icon: Zap },
];

export function TeamDetails({ team, onBack, userRepos = [], user, onShowActionsStats }) {
    const [activeTab, setActiveTab] = useState('activity');
    const [members, setMembers] = useState([]);
    const [assignedRepos, setAssignedRepos] = useState([]);
    const [currentUserRole, setCurrentUserRole] = useState('member');
    const [_loading, setLoading] = useState(true);
    const [showInvite, setShowInvite] = useState(false);
    const [showAssign, setShowAssign] = useState(false);
    const [inviteUsername, setInviteUsername] = useState('');
    const [selectedRepoToAssign, setSelectedRepoToAssign] = useState('');
    const [userSearchResults, setUserSearchResults] = useState([]);
    const [isSearchingUsers, setIsSearchingUsers] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null);
    const { toast } = useToast();

    const fetchDetails = async () => {
        try {
            setLoading(true);
            const res = await fetch(`/api/teams/${team.id}`);
            if (!res.ok) throw new Error('Failed to load team details');
            const data = await res.json();
            setMembers(data.members);
            setAssignedRepos(data.repos);
            setCurrentUserRole(data.currentUserRole);
        } catch (error) {
            toast.error('Failed to load details');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- mount/team-switch fetch
        fetchDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [team.id]);

    const handleInviteGivenUsername = async (usernameToInvite) => {
        try {
            const res = await fetch(`/api/teams/${team.id}/members`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: usernameToInvite })
            });
            const data = await res.json();
            if (res.ok) {
                toast.success('Member added successfully');
                setInviteUsername('');
                setUserSearchResults([]);
                // Keep the search open or close it? Let's close it for cleaner UX
                setShowInvite(false);
                fetchDetails();
            } else {
                toast.error(data.error || 'Failed to add member');
            }
        } catch (error) {
            toast.error('Failed to invite user');
        }
    };




    const handleAssignRepoDirectly = async (repo) => {
        try {
            const res = await fetch(`/api/teams/${team.id}/repos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repoFullName: repo.full_name, repoId: repo.id })
            });
            if (res.ok) {
                toast.success('Repository assigned');
                // Don't close panel, maybe user wants to assign more
                // But typically clearer to close or clear search
                fetchDetails();
            } else {
                toast.error('Failed to assign repository');
            }
        } catch (error) {
            toast.error('Error assigning repository');
        }
    };

    const _handleUpdateRole = async (userId, newRole) => {
        try {
            const res = await fetch(`/api/teams/${team.id}/members/${userId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: newRole })
            });

            if (res.ok) {
                toast.success('Role updated');
                fetchDetails(); // Refresh list
            } else {
                toast.error('Failed to update role');
            }
        } catch (error) {
            toast.error('Error updating role');
        }
    };

    const _handleRemoveMember = (userId) => {
        setConfirmAction({
            title: 'Remove Member',
            message: 'Are you sure you want to remove this member?',
            confirmText: 'Remove',
            onConfirm: async () => {
                try {
                    const res = await fetch(`/api/teams/${team.id}/members/${userId}`, {
                        method: 'DELETE'
                    });

                    if (res.ok) {
                        toast.success('Member removed');
                        fetchDetails();
                    } else {
                        toast.error('Failed to remove member');
                    }
                } catch (error) {
                    toast.error('Error removing member');
                }
            }
        });
    };

    // Filter out repos correctly assigned
    const availableRepos = userRepos.filter(r =>
        !assignedRepos.some(ar => ar.repo_id === r.id)
    );

    return (
        <div className="max-w-7xl mx-auto p-6">
            <button
                onClick={onBack}
                className="flex items-center gap-2 text-slate-500 hover:text-slate-900 dark:hover:text-white mb-6 transition-colors"
            >
                <ArrowLeft className="w-5 h-5" />
                <span>Back to Teams</span>
            </button>

            <header className="mb-8 p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl -mr-32 -mt-32" />

                <div className="relative z-10">
                    <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">{team.name}</h1>
                    <p className="text-lg text-slate-500 dark:text-slate-400 max-w-2xl">{team.description}</p>
                </div>

                <div className="mt-8">
                    <TabBar
                        tabs={TEAM_TABS}
                        activeTab={activeTab}
                        onTabChange={setActiveTab}
                        variant="pill"
                        layoutId="team-detail-tabs"
                    />
                </div>
            </header>

            <AnimatePresence mode="wait">
                {activeTab === 'activity' && (
                    <motion.div
                        key="activity"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        role="tabpanel"
                        id="tabpanel-team-detail-tabs-activity"
                        aria-labelledby="tab-team-detail-tabs-activity"
                    >
                        <ActivityTab teamId={team.id} />
                    </motion.div>
                )}

                {activeTab === 'members' && (
                    <motion.div
                        key="members"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        role="tabpanel"
                        id="tabpanel-team-detail-tabs-members"
                        aria-labelledby="tab-team-detail-tabs-members"
                    >
                        <div className="flex justify-end mb-4">
                            <button
                                onClick={() => setShowInvite(!showInvite)}
                                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-500/20"
                            >
                                <UserPlus className="w-4 h-4" />
                                <span>Add Member</span>
                            </button>
                        </div>

                        {showInvite && (
                            <Card glass={false} className="mb-6 p-4 animate-in fade-in slide-in-from-top-2">
                                <h3 className="font-semibold text-slate-900 dark:text-white mb-3">Add Member</h3>
                                <div className="relative">
                                    <div className="relative">
                                        <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                                        <input
                                            type="text"
                                            value={inviteUsername}
                                            aria-label="Search GitHub username to invite"
                                            onChange={(e) => {
                                                setInviteUsername(e.target.value);
                                                // Debounce search
                                                if (e.target.value.length > 2) {
                                                    setIsSearchingUsers(true);
                                                    const timer = setTimeout(async () => {
                                                        try {
                                                            const res = await fetch(`/api/search/users?q=${e.target.value}`);
                                                            const data = await res.json();
                                                            setUserSearchResults(data || []);
                                                        } catch {
                                                            // User search failed
                                                        } finally {
                                                            setIsSearchingUsers(false);
                                                        }
                                                    }, 500);
                                                    return () => clearTimeout(timer);
                                                } else {
                                                    setUserSearchResults([]);
                                                }
                                            }}
                                            className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                            placeholder="Search GitHub username..."
                                            autoFocus
                                        />
                                        {isSearchingUsers && (
                                            <div className="absolute right-3 top-2.5">
                                                <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                                            </div>
                                        )}
                                    </div>

                                    {/* Search Results Dropdown */}
                                    {userSearchResults.length > 0 && (
                                        <div className="absolute z-50 top-full mt-2 left-0 w-full bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl max-h-60 overflow-y-auto">
                                            {userSearchResults.map(u => (
                                                <button
                                                    key={u.id}
                                                    onClick={() => {
                                                        // Trigger invite immediately on selection
                                                        handleInviteGivenUsername(u.login);
                                                    }}
                                                    className="w-full flex items-center gap-3 p-3 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-left transition-colors border-b border-slate-100 dark:border-slate-700 last:border-0"
                                                >
                                                    <img src={u.avatar_url} alt={u.login} className="w-8 h-8 rounded-full" />
                                                    <div>
                                                        <div className="font-semibold text-slate-900 dark:text-white">{u.login}</div>
                                                        <div className="text-xs text-slate-500">GitHub User</div>
                                                    </div>
                                                    <Plus className="w-4 h-4 ml-auto text-indigo-500" />
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </Card>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {members.map(member => (
                                <MemberCard
                                    key={member.id}
                                    member={member}
                                    currentUserRole={currentUserRole}
                                    isMe={member.username === user?.login}
                                />
                            ))}
                        </div>
                    </motion.div>
                )}

                {activeTab === 'repos' && (
                    <motion.div
                        key="repos"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        role="tabpanel"
                        id="tabpanel-team-detail-tabs-repos"
                        aria-labelledby="tab-team-detail-tabs-repos"
                    >
                        <div className="flex justify-end mb-4">
                            <button
                                onClick={() => setShowAssign(!showAssign)}
                                className="flex items-center gap-2 px-4 py-2 bg-pink-600 text-white rounded-xl hover:bg-pink-700 transition-colors shadow-lg shadow-pink-500/20"
                            >
                                <BookCopy className="w-4 h-4" />
                                <span>Assign Repository</span>
                            </button>
                        </div>

                        {showAssign && (
                            <Card glass={false} className="mb-6 p-4 animate-in fade-in slide-in-from-top-2">
                                <h3 className="font-semibold text-slate-900 dark:text-white mb-3">Assign Repository</h3>
                                <div className="relative mb-4">
                                    <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                                    <input
                                        type="text"
                                        placeholder="Search repositories..."
                                        aria-label="Search repositories to assign"
                                        className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-transparent dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                        onChange={(e) => setSelectedRepoToAssign(e.target.value)} // Using this state for search temporarily
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                                    {availableRepos
                                        .filter(r => r.full_name.toLowerCase().includes(selectedRepoToAssign.toLowerCase()))
                                        .map(repo => {
                                            // Language Colors
                                            const langColors = {
                                                JavaScript: 'bg-yellow-400',
                                                TypeScript: 'bg-blue-500',
                                                Python: 'bg-green-500',
                                                Go: 'bg-cyan-500',
                                                HTML: 'bg-orange-500',
                                                CSS: 'bg-purple-500',
                                                default: 'bg-slate-400'
                                            };
                                            const langColor = langColors[repo.language] || langColors.default;

                                            return (
                                                <button
                                                    key={repo.id}
                                                    onClick={() => handleAssignRepoDirectly(repo)}
                                                    className="flex items-center gap-3 p-3 text-left rounded-xl border border-slate-200 dark:border-slate-700 hover:border-pink-500 hover:ring-1 hover:ring-pink-500 transition-all group bg-slate-50 dark:bg-slate-800/50 hover:bg-white dark:hover:bg-slate-800"
                                                >
                                                    <div className="p-2 bg-white dark:bg-slate-700 rounded-lg group-hover:bg-pink-50 dark:group-hover:bg-pink-900/20 transition-colors shadow-sm">
                                                        <Github className="w-4 h-4 text-slate-600 dark:text-slate-300 group-hover:text-pink-600 dark:group-hover:text-pink-400" />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center justify-between">
                                                            <div className="font-medium text-slate-900 dark:text-white truncate text-sm">{repo.name}</div>
                                                            {repo.language && (
                                                                <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                                                    <span className={`w-1.5 h-1.5 rounded-full ${langColor}`} />
                                                                    {repo.language}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-xs text-slate-500 truncate">{repo.full_name}</div>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    {availableRepos.length === 0 && (
                                        <p className="col-span-full text-center text-slate-500 text-sm py-4">No available repositories to assign.</p>
                                    )}
                                </div>
                            </Card>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {assignedRepos.map(repo => (
                                <RepoCard key={repo.id} repo={repo} teamMembers={members} currentUser={user} />
                            ))}
                            {assignedRepos.length === 0 && (
                                <div className="col-span-full py-12 text-center text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-700">
                                    <Github className="w-12 h-12 mx-auto mb-4 opacity-50" />
                                    <p className="text-lg font-medium">No repositories assigned</p>
                                    <p className="text-sm">Assign repositories to share them with the team.</p>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}

                {activeTab === 'actions' && (
                    <motion.div
                        key="actions"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        role="tabpanel"
                        id="tabpanel-team-detail-tabs-actions"
                        aria-labelledby="tab-team-detail-tabs-actions"
                    >
                        <ActionsTab assignedRepos={assignedRepos} onShowStats={onShowActionsStats} />
                    </motion.div>
                )}
            </AnimatePresence>

            <ConfirmModal
                isOpen={!!confirmAction}
                onClose={() => setConfirmAction(null)}
                onConfirm={() => { confirmAction?.onConfirm(); setConfirmAction(null); }}
                title={confirmAction?.title}
                message={confirmAction?.message}
                confirmText={confirmAction?.confirmText}
                variant="danger"
            />
        </div>
    );
}

function MemberCard({ member, currentUserRole, onUpdateRole, onRemove, isMe }) {
    const canManage = currentUserRole === 'owner' || currentUserRole === 'admin';
    const canLeave = isMe && member.role !== 'owner';
    const canRemove = canManage && !isMe && member.role !== 'owner';
    const showRemoveButton = canLeave || canRemove;

    return (
        <Card glass={false} className="flex items-center gap-4 p-4 hover:shadow-md transition-shadow group">
            <img src={member.avatar_url} alt={member.username} className="w-12 h-12 rounded-full border-2 border-slate-100 dark:border-slate-700" />
            <div className="flex-1 min-w-0">
                <h4 className="font-bold text-slate-900 dark:text-white truncate">{member.username}</h4>
                <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-slate-400">Joined {new Date(member.joined_at).toLocaleDateString()}</span>
                    {isMe && <span className="text-[10px] bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 px-1.5 py-0.5 rounded-full">You</span>}
                </div>
            </div>

            <div className="flex items-center gap-2">
                {canManage && member.role !== 'owner' ? (
                    <Select
                        value={member.role}
                        onChange={(val) => onUpdateRole(member.id, val)}
                        disabled={isMe}
                        options={[
                            { value: 'admin', label: 'Admin' },
                            { value: 'member', label: 'Member' }
                        ]}
                        size="sm"
                        className="min-w-[100px]"
                    />
                ) : (
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${member.role === 'owner'
                        ? 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800'
                        : 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600'
                        }`}>
                        {member.role}
                    </span>
                )}

                {showRemoveButton && (
                    <button
                        onClick={() => onRemove(member.id)}
                        className={`p-2 rounded-lg transition-colors ${isMe
                            ? 'text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                            : 'text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'
                            }`}
                        title={isMe ? "Leave Team" : "Remove Member"}
                    >
                        {isMe ? <ArrowLeft className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                )}
            </div>
        </Card>
    );
}

function RepoCard({ repo, teamMembers }) {
    const [showCollaborators, setShowCollaborators] = useState(false);
    const [collaborators, setCollaborators] = useState([]);
    const [loadingCollabs, setLoadingCollabs] = useState(false);
    const [inviting, setInviting] = useState(null); // username being invited
    const { toast } = useToast();

    // 1. Fetch Collaborators when expanded
    const fetchCollaborators = async () => {
        if (collaborators.length > 0) return; // cache
        setLoadingCollabs(true);
        try {
            const [owner, repoName] = repo.repo_full_name.split('/');
            const res = await fetch(`/api/repos/${owner}/${repoName}/collaborators`);
            if (res.ok) {
                const data = await res.json();
                setCollaborators(data);
            }
        } catch {
            // Collaborator fetch failed
        } finally {
            setLoadingCollabs(false);
        }
    };

    useEffect(() => {
        if (showCollaborators) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- on-toggle data fetch
            fetchCollaborators();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showCollaborators]);

    // 2. Identify missing team members
    const collaboratorLogins = collaborators.map(c => c.login);
    const missingMembers = teamMembers.filter(m => !collaboratorLogins.includes(m.username));

    // 3. Invite Handler
    const handleInvite = async (username) => {
        setInviting(username);
        try {
            const [owner, repoName] = repo.repo_full_name.split('/');
            const res = await fetch(`/api/repos/${owner}/${repoName}/collaborators/${username}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ permission: 'push' }) // Default to Write access
            });

            if (res.ok) {
                toast.success(`Invited ${username} to ${repoName}`);
                // Optimistically add to collaborators list to update UI
                const newCollab = teamMembers.find(m => m.username === username);
                setCollaborators(prev => [...prev, { login: username, avatar_url: newCollab?.avatar_url, role_name: 'pending' }]);
            } else {
                toast.error('Failed to invite collaborator');
            }
        } catch (error) {
            toast.error('Error inviting collaborator');
        } finally {
            setInviting(null);
        }
    };

    return (
        <Card glass={false} className="flex flex-col p-5 hover:shadow-md transition-shadow group">
            <div className="flex items-start justify-between mb-2">
                <div className="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg">
                    <Github className="w-5 h-5 text-slate-700 dark:text-slate-300" />
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => setShowCollaborators(!showCollaborators)}
                        className={`text-xs px-2 py-1 rounded-lg border transition-colors flex items-center gap-1 ${showCollaborators
                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-400'
                            : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700'
                            }`}
                    >
                        <Users className="w-3 h-3" />
                        {showCollaborators ? 'Hide' : 'Access'}
                    </button>
                    <a
                        href={`https://github.com/${repo.repo_full_name}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="opacity-0 group-hover:opacity-100 text-indigo-500 hover:text-indigo-600 text-xs font-medium bg-indigo-50 dark:bg-indigo-900/30 px-2 py-1 rounded-md transition-all"
                    >
                        GitHub &rarr;
                    </a>
                </div>
            </div>

            <h4 className="font-bold text-slate-900 dark:text-white truncate mb-1" title={repo.repo_full_name}>
                {repo.repo_full_name}
            </h4>

            <div className="mt-auto pt-4 border-t border-slate-100 dark:border-slate-700 text-xs text-slate-500">
                <span>Assigned {new Date(repo.created_at).toLocaleDateString()}</span>
            </div>

            {/* Collaborators Panel */}
            <AnimatePresence>
                {showCollaborators && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="pt-4 mt-2 border-t border-slate-100 dark:border-slate-700 space-y-4">

                            {/* Existing Collaborators */}
                            <div>
                                <h5 className="text-[10px] uppercase font-bold text-slate-400 mb-2">Collaborators</h5>
                                {loadingCollabs ? (
                                    <Loader2 className="w-4 h-4 animate-spin text-indigo-500 mx-auto" />
                                ) : (
                                    <div className="flex flex-wrap gap-1">
                                        {collaborators.map(c => (
                                            <img
                                                key={c.login}
                                                src={c.avatar_url}
                                                alt={c.login}
                                                title={`${c.login} (${c.role_name || 'member'})`}
                                                className="w-6 h-6 rounded-full border border-slate-200 dark:border-slate-600"
                                            />
                                        ))}
                                        {collaborators.length === 0 && <span className="text-xs text-slate-400">No collaborators found.</span>}
                                    </div>
                                )}
                            </div>

                            {/* Missing Team Members */}
                            {missingMembers.length > 0 && (
                                <div>
                                    <h5 className="text-[10px] uppercase font-bold text-slate-400 mb-2">Not in Repo</h5>
                                    <div className="space-y-1">
                                        {missingMembers.map(m => (
                                            <div key={m.username} className="flex items-center justify-between text-xs bg-slate-50 dark:bg-slate-700/30 p-1.5 rounded-lg border border-slate-100 dark:border-slate-700">
                                                <div className="flex items-center gap-2">
                                                    <img src={m.avatar_url} alt={m.username} className="w-5 h-5 rounded-full" />
                                                    <span className="truncate max-w-[80px]">{m.username}</span>
                                                </div>
                                                <button
                                                    onClick={() => handleInvite(m.username)}
                                                    disabled={inviting === m.username}
                                                    className="px-2 py-0.5 bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-400 rounded hover:bg-indigo-200 dark:hover:bg-indigo-900 transition-colors disabled:opacity-50"
                                                >
                                                    {inviting === m.username ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Add'}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </Card>
    );
}

function ActionsTab({ assignedRepos, onShowStats }) {
    const [selectedRepo, setSelectedRepo] = useState(null);
    const [workflows, setWorkflows] = useState([]);
    const [runs, setRuns] = useState([]);
    const [loading, setLoading] = useState(false);
    const { toast } = useToast();

    useEffect(() => {
        if (selectedRepo) {
            // eslint-disable-next-line react-hooks/immutability -- fetchWorkflows is stable for the component's lifetime
            fetchWorkflows(selectedRepo);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedRepo]);

    const fetchWorkflows = async (repoFullName) => {
        setLoading(true);
        try {
            const [owner, repo] = repoFullName.split('/');
            const [wfRes, runRes] = await Promise.all([
                fetch(`/api/repos/${owner}/${repo}/actions/workflows`),
                fetch(`/api/repos/${owner}/${repo}/actions/runs`)
            ]);

            if (wfRes.ok) setWorkflows(await wfRes.json());
            if (runRes.ok) setRuns(await runRes.json());
        } catch (error) {
            toast.error('Failed to load actions');
        } finally {
            setLoading(false);
        }
    };

    const handleRunWorkflow = async (workflowId, repoFullName) => {
        try {
            const [owner, repo] = repoFullName.split('/');
            const res = await fetch(`/api/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ref: 'main' })
            });

            if (res.ok) {
                toast.success('Workflow triggered!');
                // Wait a bit then refresh runs
                setTimeout(() => fetchWorkflows(repoFullName), 2000);
            } else {
                toast.error('Failed to trigger workflow');
            }
        } catch (error) {
            toast.error('Error triggering workflow');
        }
    };

    return (
        <motion.div
            key="actions"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
        >
            {/* Statistics Button */}
            {onShowStats && (
                <div className="flex justify-end">
                    <button
                        onClick={onShowStats}
                        className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all shadow-lg shadow-indigo-500/20"
                    >
                        <Activity className="w-5 h-5" />
                        <span className="font-semibold">View Actions Statistics</span>
                    </button>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                {/* Repo List Sidebar */}
                <div className="lg:col-span-1 space-y-2">
                    <h3 className="font-semibold text-slate-900 dark:text-white mb-4 px-2">Select Repository</h3>
                {assignedRepos.map(repo => (
                    <button
                        key={repo.id}
                        onClick={() => setSelectedRepo(repo.repo_full_name)}
                        className={`w-full text-left p-3 rounded-xl transition-all ${selectedRepo === repo.repo_full_name
                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                            }`}
                    >
                        <div className="font-medium truncate">{repo.repo_full_name}</div>
                    </button>
                ))}
            </div>

            {/* Actions Content */}
            <div className="lg:col-span-3">
                {!selectedRepo ? (
                    <div className="flex flex-col items-center justify-center p-12 bg-white dark:bg-slate-800 rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-slate-400">
                        <Zap className="w-12 h-12 mb-4 opacity-50" />
                        <p>Select a repository to manage its actions</p>
                    </div>
                ) : loading ? (
                    <div className="flex justify-center p-12">
                        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                    </div>
                ) : (
                    <div className="space-y-8">
                        {/* Workflows List */}
                        <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                                <Play className="w-5 h-5 text-indigo-500" />
                                Available Workflows
                            </h3>
                            <div className="grid gap-4">
                                {workflows.length === 0 ? (
                                    <p className="text-slate-500 italic">No workflows found.</p>
                                ) : (
                                    workflows.map(wf => (
                                        <div key={wf.id} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-xl border border-slate-100 dark:border-slate-700">
                                            <div>
                                                <div className="font-semibold text-slate-900 dark:text-white">{wf.name}</div>
                                                <div className="text-sm text-slate-500">{wf.path}</div>
                                            </div>
                                            <button
                                                onClick={() => handleRunWorkflow(wf.id, selectedRepo)}
                                                className="px-4 py-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-medium rounded-lg hover:bg-indigo-200 dark:hover:bg-indigo-900/50 transition-colors"
                                            >
                                                Run Workflow
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Recent Runs */}
                        <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                                <Clock className="w-5 h-5 text-slate-500" />
                                Recent Runs
                            </h3>
                            <div className="space-y-3">
                                {runs.map(run => (
                                    <div key={run.id} className="flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg transition-colors">
                                        <div className="flex items-center gap-3">
                                            {run.conclusion === 'success' ? (
                                                <CheckCircle className="w-5 h-5 text-green-500" />
                                            ) : run.conclusion === 'failure' ? (
                                                <XCircle className="w-5 h-5 text-red-500" />
                                            ) : (
                                                <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />
                                            )}
                                            <div>
                                                <div className="font-medium text-slate-900 dark:text-white">{run.name}</div>
                                                <div className="text-xs text-slate-500">
                                                    {run.event} • {run.head_branch} • {new Date(run.created_at).toLocaleString()}
                                                </div>
                                            </div>
                                        </div>
                                        <a href={run.html_url} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-500 hover:underline">
                                            View Logs
                                        </a>
                                    </div>
                                ))}
                                {runs.length === 0 && <p className="text-slate-500 italic">No recent runs.</p>}
                            </div>
                        </div>
                    </div>
                )}
            </div>
            </div>
        </motion.div>
    );
}
