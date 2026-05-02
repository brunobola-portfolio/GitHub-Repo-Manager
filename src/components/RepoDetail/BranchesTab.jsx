import { useState, useEffect, useMemo } from 'react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { ConfirmModal } from '../ui/ConfirmModal'
import { EmptyState } from '../ui/EmptyState'
import { GitBranch, Shield, Trash2, Plus, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { Spinner } from '../ui/Spinner'
import { useTabData } from '../../hooks/useTabData'
import { useToast } from '../../hooks/useToast'
import { BranchHygieneCard } from './BranchHygieneCard'
import { branchActions } from '../../actions/branchActions'
import { BranchProtectionPanel } from './BranchProtectionPanel'

export function BranchesTab({ api, repoData }) {
    const { toast } = useToast()
    const { data, loading, reload: loadBranches } = useTabData(
        async () => {
            const result = await api.fetchBranches()
            return result.data || result || []
        },
        [api],
    )
    const branches = useMemo(() => data || [], [data])

    // Hoist the branch list to App.jsx via a window CustomEvent so the
    // command palette's "Branch actions" group can enumerate them.
    useEffect(() => {
        if (!Array.isArray(branches)) return
        window.dispatchEvent(new CustomEvent('repo-detail:branches-loaded', { detail: branches }))
    }, [branches])

    const [showCreate, setShowCreate] = useState(false)
    const [newBranch, setNewBranch] = useState('')
    const [baseSha, setBaseSha] = useState('')
    const [creating, setCreating] = useState(false)
    const [message, setMessage] = useState(null)
    const [confirmAction, setConfirmAction] = useState(null)

    const handleCreate = async () => {
        if (!newBranch) return
        setCreating(true)
        setMessage(null)
        try {
            // If no sha provided, use first branch's sha
            const sha = baseSha || branches[0]?.commit?.sha
            if (!sha) {
                setMessage({ type: 'error', text: 'No base SHA available. Enter a commit SHA.' })
                toast.error('No base SHA available — enter a commit SHA')
                setCreating(false)
                return
            }
            await api.createBranch(newBranch, sha)
            setMessage({ type: 'success', text: `Branch "${newBranch}" created` })
            toast.success('Branch created')
            setNewBranch('')
            setBaseSha('')
            setShowCreate(false)
            loadBranches()
        } catch (e) {
            setMessage({ type: 'error', text: e.message })
            toast.errorFromException(e, { fallbackTitle: 'Failed to create branch' })
        } finally {
            setCreating(false)
        }
    }

    // Adopted from src/actions/branchActions.js (Phase 3 / item 16). The
    // registry's confirm shape adds type-name verification (`requiresInput`)
    // for an extra guard against accidental destructive clicks; the run()
    // calls api.deleteBranch + ctx.refresh in one step.
    const handleDelete = (branch) => {
        const action = branchActions.delete_branch
        if (action.isApplicable && !action.isApplicable(branch)) return
        const cfg = action.confirm(branch)
        setConfirmAction({
            ...cfg,
            onConfirm: async () => {
                try {
                    await action.run(branch, { api, toast, refresh: loadBranches })
                    setMessage({ type: 'success', text: `Branch "${branch.name}" deleted` })
                } catch (e) {
                    setMessage({ type: 'error', text: e.message })
                    toast.errorFromException(e, { fallbackTitle: 'Failed to delete branch' })
                }
            },
        })
    }

    if (loading) {
        return <div className="flex justify-center py-12"><Spinner size="lg" /></div>
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

            <BranchHygieneCard branches={branches} />

            {repoData?.default_branch && (
                <BranchProtectionPanel
                    api={api}
                    branch={repoData.default_branch}
                    archived={!!repoData.archived}
                />
            )}

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
                        <label htmlFor="new-branch-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Branch Name *</label>
                        <input id="new-branch-name" type="text" value={newBranch} onChange={e => setNewBranch(e.target.value)}
                            placeholder="feature/my-branch"
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm" />
                    </div>
                    <div>
                        <label htmlFor="new-branch-base-sha" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Base SHA (optional, defaults to default branch)</label>
                        <input id="new-branch-base-sha" type="text" value={baseSha} onChange={e => setBaseSha(e.target.value)}
                            placeholder="abc123..."
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm font-mono" />
                    </div>
                    <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
                        <Button size="sm" onClick={handleCreate} disabled={!newBranch || creating}>
                            {creating ? <Spinner size="sm" className="mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
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
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(b)}
                            className="text-red-500 hover:text-red-700 dark:hover:text-red-400 opacity-0 group-hover:opacity-100"
                            title="Delete branch">
                            <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                    </Card>
                ))}
                {branches.length === 0 && (
                    <EmptyState
                        icon={GitBranch}
                        title="No branches"
                        description="This repository has no branches to display."
                    />
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
