import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Plus, ChevronRight, MoreVertical, Trash2, Edit2, AlertTriangle } from 'lucide-react';
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
    const [loadError, setLoadError] = useState(false);
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
        // Distinguish a real load failure from an empty account so the grid
        // can offer Retry instead of the misleading "No teams yet — create
        // your first team" CTA.
        setLoadError(!!result.error);
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
            toast.errorFromException(error, { fallbackTitle: isEditing ? 'Failed to update team' : 'Failed to create team' });
        }
    };

    const handleDelete = (teamId, e) => {
        e.stopPropagation(); // Prevent card click
        setConfirmAction({
            title: 'Delete team',
            message: 'Members lose access and the team\'s repository assignments are removed. The repositories themselves are not affected. This cannot be undone.',
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
                    toast.errorFromException(error, { fallbackTitle: 'Failed to delete team' });
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
        <PageShell maxWidth="full">
            <PageHeader
                eyebrow="Teams"
                title="Team Hub"
                description="Collaborate and manage repositories together."
                icon={Users}
                actions={
                    <Button
                        variant="primary"
                        size="md"
                        onClick={() => {
                            setFormData({ name: '', description: '' });
                            setIsEditing(false);
                            setShowCreate(true);
                        }}
                        disabled={upgradeRequired}
                        className="gap-2"
                    >
                        <Plus className="w-5 h-5" />
                        <span>Create team</span>
                    </Button>
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
                                <Button
                                    variant="ghost"
                                    size="md"
                                    type="button"
                                    onClick={() => setShowCreate(false)}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    variant="primary"
                                    size="md"
                                    type="submit"
                                >
                                    {isEditing ? 'Save Changes' : 'Create Team'}
                                </Button>
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

                    {teams.length === 0 && loadError && (
                        <div className="col-span-full">
                            <EmptyState
                                icon={AlertTriangle}
                                title="Couldn't load teams"
                                description="We couldn't reach the team service. Check your connection and try again."
                                action={{ label: 'Retry', onClick: fetchTeams }}
                            />
                        </div>
                    )}

                    {teams.length === 0 && !upgradeRequired && !loadError && (
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
                        // Every tier ships teams unlimited (feature-flags.js), so
                        // this only renders if a deployment adds a cap later. It
                        // must never name a plan the flags do not implement.
                        <div className="col-span-full">
                            <EmptyState
                                icon={Users}
                                title="Teams aren't available on this plan"
                                description="This deployment limits how many teams you can own. See what each plan includes."
                                action={{ label: 'View plans', onClick: () => onNavigatePricing?.() }}
                            />
                        </div>
                    )}
                </div>
            )}

            <ConfirmModal
                isOpen={!!confirmAction}
                onClose={() => setConfirmAction(null)}
                onConfirm={async () => { await confirmAction?.onConfirm(); setConfirmAction(null); }}
                title={confirmAction?.title}
                message={confirmAction?.message}
                requiresInput={confirmAction?.requiresInput}
                confirmText={confirmAction?.confirmText}
                variant="danger"
            />
        </PageShell>
    );
}

function TeamCard({ team, onClick, onEdit, onDelete }) {
    const [showMenu, setShowMenu] = useState(false);

    return (
        <motion.div layoutId={`team-${team.id}`} className="group">
        <Card hover className="relative p-6 hover:shadow-2xl hover:border-brand-500/50">
            {/* The card used to be a <div onClick>: team detail was unreachable
                by keyboard or screen reader. Same fix as RepoCard — a real,
                stretched <button> as the background layer, with the actions
                menu a sibling ABOVE it (z-10), so nothing interactive is
                nested inside a button. */}
            <button
                type="button"
                onClick={onClick}
                aria-label={`Open team ${team.name}`}
                className="absolute inset-0 z-0 rounded-[inherit] ds-focus-ring"
            />
            <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-2xl bg-brand-100 dark:bg-brand-900/50 flex items-center justify-center text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]">
                    <Users className="w-6 h-6" />
                </div>

                {/* Actions Menu */}
                {team.role === 'owner' ? (
                    <div className="relative z-10">
                        <button
                            onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
                            className="p-2 text-slate-400 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/30 rounded-lg transition-colors"
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

            <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-1 group-hover:text-brand-500 transition-colors truncate">
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
                    <span className="ml-auto px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 ds-text-micro font-bold uppercase rounded-full border border-amber-200 dark:border-amber-800">
                        Owner
                    </span>
                )}
            </div>
        </Card>
        </motion.div>
    );
}
