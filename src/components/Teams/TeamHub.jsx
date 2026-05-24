import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Plus, ChevronRight, MoreVertical, Trash2, Edit2, Lock, Sparkles } from 'lucide-react';
import { Github } from '../icons/GithubIcon';
import { useToast } from '../../hooks/useToast';
import { ConfirmModal } from '../ui/ConfirmModal';
import { PageHeader } from '../ui/PageHeader';
import { PageShell } from '../ui/PageShell';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import { Field, Input } from '../ui/form';
import { EmptyState } from '../ui/EmptyState';
import { listTeams } from '../../api/teams';
import { getCsrfToken } from '../../utils/api';

export function TeamHub({ onTeamSelect, onNavigatePricing }) {
    const [teams, setTeams] = useState([]);
    const [loading, setLoading] = useState(true);
    const [upgradeRequired, setUpgradeRequired] = useState(false);
    const [showCreate, setShowCreate] = useState(false);

    // Create/Edit State
    const [isEditing, setIsEditing] = useState(false);
    const [activeTeamId, setActiveTeamId] = useState(null);
    const [formData, setFormData] = useState({ name: '', description: '' });

    const [confirmAction, setConfirmAction] = useState(null);

    const { toast } = useToast();

    const fetchTeams = async () => {
        setLoading(true);
        // listTeams() already handles MOCK_MODE + free-tier 403 silently
        // and returns a normalized { teams, upgradeRequired, error } shape.
        const result = await listTeams();
        setTeams(result.teams);
        setUpgradeRequired(result.upgradeRequired);
        if (result.error) {
            toast.error('Could not load teams');
        }
        setLoading(false);
    };

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount fetch
        fetchTeams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.name.trim()) return;

        try {
            const url = isEditing ? `/api/teams/${activeTeamId}` : '/api/teams';
            const method = isEditing ? 'PUT' : 'POST';

            const headers = { 'Content-Type': 'application/json' };
            try { headers['X-CSRF-Token'] = await getCsrfToken(); } catch { /* server will 403 */ }
            const res = await fetch(url, {
                method,
                credentials: 'include',
                headers,
                body: JSON.stringify(formData)
            });
            const data = await res.json();

            if (res.ok) {
                toast.success(isEditing ? 'Team updated!' : 'Team created!');
                setFormData({ name: '', description: '' });
                setShowCreate(false);
                setIsEditing(false);
                setActiveTeamId(null);
                fetchTeams();
            } else {
                toast.error(data.error || 'Operation failed');
            }
        } catch (error) {
            toast.error('Operation failed');
        }
    };

    const handleDelete = (teamId, e) => {
        e.stopPropagation(); // Prevent card click
        setConfirmAction({
            title: 'Delete Team',
            message: 'Are you sure you want to delete this team? This cannot be undone.',
            confirmText: 'Delete',
            onConfirm: async () => {
                try {
                    const headers = {};
                    try { headers['X-CSRF-Token'] = await getCsrfToken(); } catch { /* server will 403 */ }
                    const res = await fetch(`/api/teams/${teamId}`, {
                        method: 'DELETE',
                        credentials: 'include',
                        headers,
                    });
                    if (res.ok) {
                        toast.success('Team deleted');
                        fetchTeams();
                    } else {
                        const data = await res.json();
                        toast.error(data.error || 'Failed to delete team');
                    }
                } catch (error) {
                    toast.error('Failed to delete team');
                }
            }
        });
    };

    const openEdit = (team, e) => {
        e.stopPropagation();
        setFormData({ name: team.name, description: team.description || '' });
        setIsEditing(true);
        setActiveTeamId(team.id);
        setShowCreate(true);
    };

    return (
        <PageShell maxWidth="3xl">
            <PageHeader
                eyebrow="Workspace"
                title="Team Hub"
                description="Collaborate and manage repositories together."
                icon={Users}
                actions={
                    <button
                        onClick={() => {
                            setFormData({ name: '', description: '' });
                            setIsEditing(false);
                            setShowCreate(true);
                        }}
                        disabled={upgradeRequired}
                        title={upgradeRequired ? 'Teams require the Pro plan' : undefined}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-indigo-600"
                    >
                        {upgradeRequired ? <Lock className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
                        <span>Create Team</span>
                    </button>
                }
            />

            {/* Create/Edit Team Modal */}
            <AnimatePresence>
                {showCreate && (
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="mb-8"
                    >
                        <Card className="p-6">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-4">
                            {isEditing ? 'Edit Team' : 'Create New Team'}
                        </h3>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <Field label="Team Name" htmlFor="team-form-name">
                                <Input
                                    id="team-form-name"
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="e.g. Frontend Squad"
                                    autoFocus
                                />
                            </Field>
                            <Field label="Description" htmlFor="team-form-description">
                                <Input
                                    id="team-form-description"
                                    type="text"
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    placeholder="Short description of the team's purpose"
                                />
                            </Field>
                            <div className="flex justify-end gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowCreate(false)}
                                    className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="px-6 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 font-medium"
                                >
                                    {isEditing ? 'Save Changes' : 'Create Team'}
                                </button>
                            </div>
                        </form>
                        </Card>
                    </motion.div>
                )}
            </AnimatePresence>

            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3].map(i => (
                        <Skeleton key={i} variant="card" className="h-48 rounded-2xl" />
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {teams.map(team => (
                        <TeamCard
                            key={team.id}
                            team={team}
                            onClick={() => onTeamSelect(team)}
                            onEdit={(e) => openEdit(team, e)}
                            onDelete={(e) => handleDelete(team.id, e)}
                        />
                    ))}

                    {teams.length === 0 && !upgradeRequired && (
                        <div className="col-span-full">
                            <EmptyState
                                icon={Users}
                                title="No teams yet"
                                description="Create your first team to start collaborating."
                                action={{ label: 'Create team', onClick: () => setShowCreate(true) }}
                            />
                        </div>
                    )}

                    {teams.length === 0 && upgradeRequired && (
                        <div className="col-span-full py-14 px-6 text-center bg-indigo-500/8 dark:bg-indigo-500/12 rounded-3xl ring-1 ring-indigo-500/20">
                            <div className="inline-flex items-center justify-center w-14 h-14 mb-4 rounded-2xl bg-indigo-600 dark:bg-indigo-500 shadow-md">
                                <Sparkles className="w-7 h-7 text-white" strokeWidth={2.5} />
                            </div>
                            <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">
                                Teams are a Pro feature
                            </h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-6">
                                Collaborate with teammates, assign repositories, and track team activity. Upgrade to unlock shared workspaces and member management.
                            </p>
                            <Button variant="primary" onClick={() => onNavigatePricing?.()}>
                                <Sparkles className="w-4 h-4" />
                                View Pricing
                            </Button>
                        </div>
                    )}
                </div>
            )}

            <ConfirmModal
                isOpen={!!confirmAction}
                onClose={() => setConfirmAction(null)}
                onConfirm={() => { confirmAction?.onConfirm(); setConfirmAction(null); }}
                title={confirmAction?.title}
                message={confirmAction?.message}
                confirmText={confirmAction?.confirmText}
                variant="danger"
            />
        </PageShell>
    );
}

function TeamCard({ team, onClick, onEdit, onDelete }) {
    const [showMenu, setShowMenu] = useState(false);

    return (
        <motion.div layoutId={`team-${team.id}`} onClick={onClick} className="group">
        <Card hover className="relative p-6 hover:shadow-2xl hover:border-indigo-500/50">
            <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-2xl bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                    <Users className="w-6 h-6" />
                </div>

                {/* Actions Menu */}
                {team.role === 'owner' ? (
                    <div className="relative">
                        <button
                            onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
                            className="p-2 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg transition-colors"
                            aria-label="Team actions menu"
                            aria-expanded={showMenu}
                            aria-haspopup="menu"
                        >
                            <MoreVertical className="w-5 h-5" />
                        </button>

                        {showMenu && (
                            <div className="absolute right-0 top-full mt-2 w-32 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-100 dark:border-slate-700 z-10 overflow-hidden animate-in fade-in zoom-in-95">
                                <button
                                    onClick={onEdit}
                                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-left"
                                >
                                    <Edit2 className="w-3 h-3" /> Edit
                                </button>
                                <button
                                    onClick={onDelete}
                                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 text-left"
                                >
                                    <Trash2 className="w-3 h-3" /> Delete
                                </button>
                            </div>
                        )}
                        {/* Overlay to close menu — purely a click-catcher */}
                        {showMenu && (
                            <div
                                role="presentation"
                                className="fixed inset-0 z-0"
                                onClick={(e) => { e.stopPropagation(); setShowMenu(false); }}
                            />
                        )}
                    </div>
                ) : (
                    <div className="h-9"></div> // Spacer
                )}
            </div>

            <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-1 group-hover:text-indigo-500 transition-colors truncate">
                {team.name}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 line-clamp-2 min-h-[2.5rem]">
                {team.description || "No description provided."}
            </p>

            <div className="flex items-center gap-4 text-xs font-medium text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-700 pt-4">
                <div className="flex items-center gap-1.5">
                    <Github className="w-4 h-4" />
                    <span>{team.repo_count || 0} Repos</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <Users className="w-4 h-4" />
                    <span>{team.member_count || 0} Members</span>
                </div>
                {team.role === 'owner' && (
                    <span className="ml-auto px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-bold uppercase rounded-full border border-amber-200 dark:border-amber-800">
                        Owner
                    </span>
                )}
            </div>
        </Card>
        </motion.div>
    );
}
