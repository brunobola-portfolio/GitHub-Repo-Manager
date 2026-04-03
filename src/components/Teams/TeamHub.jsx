import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Plus, ChevronRight, Github, MoreVertical, Trash2, Edit2 } from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import { ConfirmModal } from '../ui/ConfirmModal';

export function TeamHub({ onTeamSelect }) {
    const [teams, setTeams] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);

    // Create/Edit State
    const [isEditing, setIsEditing] = useState(false);
    const [activeTeamId, setActiveTeamId] = useState(null);
    const [formData, setFormData] = useState({ name: '', description: '' });

    const [confirmAction, setConfirmAction] = useState(null);

    const { toast } = useToast();

    const fetchTeams = async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/teams');
            if (!res.ok) throw new Error('Failed to fetch teams');
            const data = await res.json();
            setTeams(data);
        } catch {
            toast.error('Could not load teams');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTeams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.name.trim()) return;

        try {
            const url = isEditing ? `/api/teams/${activeTeamId}` : '/api/teams';
            const method = isEditing ? 'PUT' : 'POST';

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
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
                    const res = await fetch(`/api/teams/${teamId}`, { method: 'DELETE' });
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
        <div className="max-w-7xl mx-auto p-6">
            <header className="mb-8 flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Team Hub</h1>
                    <p className="text-slate-500 dark:text-slate-400">Collaborate and manage repositories together.</p>
                </div>
                <button
                    onClick={() => {
                        setFormData({ name: '', description: '' });
                        setIsEditing(false);
                        setShowCreate(true);
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-lg hover:shadow-indigo-500/20 transition-all active:scale-95"
                >
                    <Plus className="w-5 h-5" />
                    <span>Create Team</span>
                </button>
            </header>

            {/* Create/Edit Team Modal */}
            <AnimatePresence>
                {showCreate && (
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="mb-8 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl"
                    >
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">
                            {isEditing ? 'Edit Team' : 'Create New Team'}
                        </h3>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Team Name</label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                    placeholder="e.g. Frontend Squad"
                                    autoFocus
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Description</label>
                                <input
                                    type="text"
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    className="w-full px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                    placeholder="Short description of the team's purpose"
                                />
                            </div>
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
                    </motion.div>
                )}
            </AnimatePresence>

            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="h-48 bg-slate-200 dark:bg-slate-800 rounded-2xl animate-pulse" />
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

                    {teams.length === 0 && (
                        <div className="col-span-full py-12 text-center text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-700">
                            <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p className="text-lg font-medium">No teams yet</p>
                            <p className="text-sm">Create your first team to start collaborating.</p>
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
        </div>
    );
}

function TeamCard({ team, onClick, onEdit, onDelete }) {
    const [showMenu, setShowMenu] = useState(false);

    return (
        <motion.div
            layoutId={`team-${team.id}`}
            onClick={onClick}
            className="group relative bg-white/50 dark:bg-slate-800/50 backdrop-blur-xl border border-slate-200 dark:border-slate-700 rounded-3xl p-6 cursor-pointer hover:shadow-2xl hover:shadow-indigo-500/10 transition-all duration-300 hover:border-indigo-500/50"
        >
            <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-2xl bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                    <Users className="w-6 h-6" />
                </div>

                {/* Actions Menu */}
                {team.role === 'owner' ? (
                    <div className="relative">
                        <button
                            onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
                            className="p-2 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors"
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
                        {/* Overlay to close menu */}
                        {showMenu && (
                            <div
                                className="fixed inset-0 z-0"
                                onClick={(e) => { e.stopPropagation(); setShowMenu(false); }}
                            />
                        )}
                    </div>
                ) : (
                    <div className="h-9"></div> // Spacer
                )}
            </div>

            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1 group-hover:text-indigo-500 transition-colors truncate">
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
        </motion.div>
    );
}
