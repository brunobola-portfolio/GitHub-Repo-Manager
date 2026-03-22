import { useState, useEffect } from 'react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { ConfirmModal } from '../ui/ConfirmModal'
import { GitBranch, Shield, Trash2, Plus, Loader2, CheckCircle2, XCircle } from 'lucide-react'

export function BranchesTab({ owner, repo, api }) {
    const [branches, setBranches] = useState([])
    const [loading, setLoading] = useState(true)
    const [showCreate, setShowCreate] = useState(false)
    const [newBranch, setNewBranch] = useState('')
    const [baseSha, setBaseSha] = useState('')
    const [creating, setCreating] = useState(false)
    const [message, setMessage] = useState(null)
    const [confirmAction, setConfirmAction] = useState(null)

    const loadBranches = async () => {
        setLoading(true)
        try {
            const data = await api.fetchBranches()
            setBranches(data.data || data || [])
        } catch { /* ignore */ } finally {
            setLoading(false)
        }
    }

    useEffect(() => { loadBranches() }, [owner, repo]) // eslint-disable-line react-hooks/exhaustive-deps

    const handleCreate = async () => {
        if (!newBranch) return
        setCreating(true)
        setMessage(null)
        try {
            // If no sha provided, use first branch's sha
            const sha = baseSha || branches[0]?.commit?.sha
            if (!sha) {
                setMessage({ type: 'error', text: 'No base SHA available. Enter a commit SHA.' })
                setCreating(false)
                return
            }
            await api.createBranch(newBranch, sha)
            setMessage({ type: 'success', text: `Branch "${newBranch}" created` })
            setNewBranch('')
            setBaseSha('')
            setShowCreate(false)
            loadBranches()
        } catch (e) {
            setMessage({ type: 'error', text: e.message })
        } finally {
            setCreating(false)
        }
    }

    const handleDelete = (branch) => {
        setConfirmAction({
            title: 'Delete Branch',
            message: `Delete branch "${branch}"? This cannot be undone.`,
            confirmText: 'Delete',
            onConfirm: async () => {
                try {
                    await api.deleteBranch(branch)
                    setMessage({ type: 'success', text: `Branch "${branch}" deleted` })
                    loadBranches()
                } catch (e) {
                    setMessage({ type: 'error', text: e.message })
                }
            }
        })
    }

    if (loading) {
        return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-indigo-500 animate-spin" /></div>
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <GitBranch className="w-5 h-5 text-indigo-500" />
                    {branches.length} Branch{branches.length !== 1 ? 'es' : ''}
                </h3>
                <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
                    <Plus className="w-4 h-4 mr-1" /> New Branch
                </Button>
            </div>

            {message && (
                <div className={`flex items-center gap-2 p-2 rounded-lg text-sm ${
                    message.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                }`}>
                    {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                    {message.text}
                </div>
            )}

            {showCreate && (
                <Card className="p-4 space-y-3">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Branch Name *</label>
                        <input type="text" value={newBranch} onChange={e => setNewBranch(e.target.value)}
                            placeholder="feature/my-branch"
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Base SHA (optional, defaults to default branch)</label>
                        <input type="text" value={baseSha} onChange={e => setBaseSha(e.target.value)}
                            placeholder="abc123..."
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm font-mono" />
                    </div>
                    <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
                        <Button size="sm" onClick={handleCreate} disabled={!newBranch || creating}>
                            {creating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
                            Create
                        </Button>
                    </div>
                </Card>
            )}

            <div className="space-y-2">
                {branches.map(b => (
                    <Card key={b.name} className="p-3 flex items-center gap-3 group">
                        <GitBranch className="w-4 h-4 text-slate-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <span className="font-medium text-sm text-slate-900 dark:text-slate-100">{b.name}</span>
                            {b.commit?.sha && (
                                <span className="text-xs text-slate-500 dark:text-slate-400 ml-2 font-mono">{b.commit.sha.substring(0, 7)}</span>
                            )}
                        </div>
                        {b.protected && (
                            <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                                <Shield className="w-3 h-3" /> Protected
                            </span>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(b.name)}
                            className="text-red-500 hover:text-red-700 dark:hover:text-red-400 opacity-0 group-hover:opacity-100"
                            title="Delete branch">
                            <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                    </Card>
                ))}
                {branches.length === 0 && (
                    <p className="text-center text-sm text-slate-500 dark:text-slate-400 py-8">No branches found</p>
                )}
            </div>

            <ConfirmModal
                isOpen={!!confirmAction}
                onClose={() => setConfirmAction(null)}
                onConfirm={() => { confirmAction?.onConfirm(); setConfirmAction(null) }}
                title={confirmAction?.title}
                message={confirmAction?.message}
                confirmText={confirmAction?.confirmText}
                variant="danger"
            />
        </div>
    )
}
