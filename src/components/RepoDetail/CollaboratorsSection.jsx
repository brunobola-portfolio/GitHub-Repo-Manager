import { useEffect, useState } from 'react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'
import { ConfirmModal } from '../ui/ConfirmModal'
import { reposApi } from '../../api/repos'
import { useToast } from '../../hooks/useToast'
import { Users, Trash2, Plus, ShieldCheck } from 'lucide-react'

const PERMISSION_OPTIONS = [
    { value: 'pull', label: 'Read', description: 'Clone and read code' },
    { value: 'triage', label: 'Triage', description: 'Manage issues and PRs without write access' },
    { value: 'push', label: 'Write', description: 'Push to non-protected branches' },
    { value: 'maintain', label: 'Maintain', description: 'Manage repo without admin access' },
    { value: 'admin', label: 'Admin', description: 'Full administrative access' },
]

const FIELD_CLASSES = 'w-full px-3 py-2.5 rounded-lg bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-colors focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50 disabled:cursor-not-allowed'

function permissionLabel(c) {
    // GitHub returns either a `permissions` object (legacy boolean shape) OR a
    // `role_name` string (newer). Normalize to a single short label.
    if (c.role_name) return c.role_name
    if (c.permissions?.admin) return 'admin'
    if (c.permissions?.maintain) return 'maintain'
    if (c.permissions?.push) return 'push'
    if (c.permissions?.triage) return 'triage'
    if (c.permissions?.pull) return 'pull'
    return 'pull'
}

export function CollaboratorsSection({ owner, repo, archived }) {
    const { toast } = useToast()
    const [loaded, setLoaded] = useState(false)
    const [loading, setLoading] = useState(false)
    const [collaborators, setCollaborators] = useState([])
    const [showAdd, setShowAdd] = useState(false)
    const [newUsername, setNewUsername] = useState('')
    const [newPermission, setNewPermission] = useState('push')
    const [adding, setAdding] = useState(false)
    const [removingId, setRemovingId] = useState(null)
    const [confirmRemove, setConfirmRemove] = useState(null)

    const load = async () => {
        setLoading(true)
        try {
            const list = await reposApi.listCollaborators(owner, repo)
            setCollaborators(Array.isArray(list) ? list : [])
            setLoaded(true)
        } catch (err) {
            toast.errorFromException(err, { fallbackTitle: 'Failed to load collaborators' })
        } finally {
            setLoading(false)
        }
    }

    // Lazy load on first render — listing collaborators makes a GitHub API
    // call we don't want to issue for every visit to the Settings tab.
    useEffect(() => {
        if (!loaded && !loading) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time fetch
            load()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [owner, repo])

    const handleAdd = async () => {
        const username = newUsername.trim()
        if (!username) return
        setAdding(true)
        try {
            await reposApi.addCollaborator(owner, repo, username, newPermission)
            toast.success(`Invited ${username} as ${newPermission}. They must accept the invitation.`)
            setNewUsername('')
            setShowAdd(false)
            load()
        } catch (err) {
            toast.errorFromException(err, { fallbackTitle: 'Failed to add collaborator' })
        } finally {
            setAdding(false)
        }
    }

    const handleRemove = (collaborator) => {
        setConfirmRemove({
            collaborator,
            title: 'Remove collaborator',
            message: `Revoke ${collaborator.login}'s access to ${owner}/${repo}? They will lose access immediately.`,
            confirmText: 'Remove access',
        })
    }

    const performRemove = async () => {
        const collaborator = confirmRemove?.collaborator
        if (!collaborator) return
        setRemovingId(collaborator.id)
        try {
            await reposApi.removeCollaborator(owner, repo, collaborator.login)
            toast.success(`Removed ${collaborator.login}`)
            setCollaborators(prev => prev.filter(c => c.id !== collaborator.id))
        } catch (err) {
            toast.errorFromException(err, { fallbackTitle: 'Failed to remove collaborator' })
        } finally {
            setRemovingId(null)
            setConfirmRemove(null)
        }
    }

    return (
        <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <Users className="w-5 h-5 text-indigo-500" /> Collaborators
                </h3>
                <Button size="sm" onClick={() => setShowAdd(s => !s)} disabled={archived}>
                    <Plus className="w-4 h-4 mr-1" /> Add
                </Button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 -mt-2">
                Direct collaborators on this repo. Adding sends a GitHub invitation; removing revokes access immediately.
            </p>

            {showAdd && (
                <div className="space-y-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                    <div>
                        <label htmlFor="collab-username" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">GitHub username</label>
                        <input id="collab-username" type="text" value={newUsername}
                            onChange={(e) => setNewUsername(e.target.value)}
                            placeholder="octocat"
                            disabled={adding}
                            className={FIELD_CLASSES} />
                    </div>
                    <div>
                        <label htmlFor="collab-permission" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Permission</label>
                        <select id="collab-permission" value={newPermission}
                            onChange={(e) => setNewPermission(e.target.value)}
                            disabled={adding}
                            className={FIELD_CLASSES}>
                            {PERMISSION_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label} — {opt.description}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setShowAdd(false)} disabled={adding}>Cancel</Button>
                        <Button size="sm" onClick={handleAdd} disabled={adding || !newUsername.trim()}>
                            {adding ? <Spinner size="sm" className="mr-1" /> : null}
                            Send invitation
                        </Button>
                    </div>
                </div>
            )}

            {loading && !loaded ? (
                <div className="py-6 flex justify-center"><Spinner /></div>
            ) : collaborators.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400 italic py-2">No direct collaborators. Org/team members may still have access via team assignments.</p>
            ) : (
                <ul className="space-y-1.5">
                    {collaborators.map(c => (
                        <li key={c.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                            {c.avatar_url
                                ? <img src={c.avatar_url} alt="" className="w-7 h-7 rounded-full" />
                                : <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700" />}
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{c.login}</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                                    <ShieldCheck className="w-3 h-3" />
                                    {permissionLabel(c)}
                                </p>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemove(c)}
                                disabled={removingId === c.id || archived}
                                className="text-red-500 hover:text-red-600"
                                title={archived ? 'Archived repos cannot be modified' : `Remove ${c.login}`}
                            >
                                {removingId === c.id ? <Spinner size="sm" /> : <Trash2 className="w-3.5 h-3.5" />}
                            </Button>
                        </li>
                    ))}
                </ul>
            )}

            <ConfirmModal
                isOpen={!!confirmRemove}
                onClose={() => setConfirmRemove(null)}
                onConfirm={performRemove}
                title={confirmRemove?.title}
                message={confirmRemove?.message}
                confirmText={confirmRemove?.confirmText}
                variant="danger"
            />
        </Card>
    )
}
