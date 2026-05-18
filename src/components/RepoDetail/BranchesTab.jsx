import { useState, useEffect, useMemo } from 'react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { ConfirmModal } from '../ui/ConfirmModal'
import { EmptyState } from '../ui/EmptyState'
import { SectionPanel } from '../ui/SectionPanel'
import { GitBranch, Shield, Trash2, Plus, CheckCircle2, XCircle, RefreshCw } from 'lucide-react'
import { Spinner } from '../ui/Spinner'
import { Field, Input } from '../ui/form'
import { Select } from '../ui/Select'
import { useTabData } from '../../hooks/useTabData'
import { useToast } from '../../hooks/useToast'
import { BranchHygieneCard } from './BranchHygieneCard'
import { branchActions } from '../../actions/branchActions'
import { BranchProtectionPanel } from './BranchProtectionPanel'
import { formatRelativeTime } from '../../utils/format'

// Computed once at module load — avoids calling Date.now() during render.
const STALE_MS = 90 * 24 * 60 * 60 * 1000
const STALE_CUTOFF = Date.now() - STALE_MS

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
    const [search, setSearch] = useState('')
    const [chip, setChip] = useState('all') // 'all' | 'active' | 'stale' | 'protected'
    const [sort, setSort] = useState('recent') // 'recent' | 'name'

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase()
        const cutoff = STALE_CUTOFF
        let out = branches.filter(b => !term || b.name.toLowerCase().includes(term))
        if (chip === 'protected') out = out.filter(b => b.protected)
        else if (chip === 'stale') out = out.filter(b => {
            const date = new Date(b.commit?.author?.date || b.commit?.committer?.date || 0).getTime()
            return date && date < cutoff
        })
        else if (chip === 'active') out = out.filter(b => {
            const date = new Date(b.commit?.author?.date || b.commit?.committer?.date || 0).getTime()
            return date && date >= cutoff
        })

        out = [...out].sort((a, b) => {
            // Default branch always first
            if (a.name === repoData?.default_branch) return -1
            if (b.name === repoData?.default_branch) return 1
            if (sort === 'name') return a.name.localeCompare(b.name)
            const da = new Date(a.commit?.author?.date || 0).getTime()
            const db = new Date(b.commit?.author?.date || 0).getTime()
            return db - da
        })
        return out
    }, [branches, search, chip, sort, repoData?.default_branch])

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
        <SectionPanel
            icon={GitBranch}
            title={`${filtered.length} Branch${filtered.length !== 1 ? 'es' : ''}`}
            subtitle="Manage branches, protection rules, and hygiene"
            actions={
                <>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={loadBranches}
                        disabled={loading}
                        aria-label="Refresh branches"
                        title="Refresh branches"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </Button>
                    <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
                        <Plus className="w-4 h-4 mr-1" /> New Branch
                    </Button>
                </>
            }
        >
        <div className="space-y-4">
            <BranchHygieneCard branches={branches} />

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
                    <Field label="Branch Name" required htmlFor="new-branch-name">
                        <Input id="new-branch-name" type="text" value={newBranch} onChange={e => setNewBranch(e.target.value)}
                            placeholder="feature/my-branch" />
                    </Field>
                    <Field label="Base SHA (optional, defaults to default branch)" htmlFor="new-branch-base-sha">
                        <Input id="new-branch-base-sha" type="text" value={baseSha} onChange={e => setBaseSha(e.target.value)}
                            placeholder="abc123..."
                            className="font-mono" />
                    </Field>
                    <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
                        <Button size="sm" onClick={handleCreate} disabled={!newBranch || creating}>
                            {creating ? <Spinner size="sm" className="mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
                            Create
                        </Button>
                    </div>
                </Card>
            )}

            <div className="flex flex-wrap gap-2 items-center pb-2">
                <div className="flex-1 min-w-[180px]">
                    <Input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search branches…"
                        aria-label="Search branches"
                        size="sm"
                    />
                </div>
                <div className="flex gap-1">
                    {['all', 'active', 'stale', 'protected'].map(k => (
                        <button key={k} type="button" onClick={() => setChip(k)}
                            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                                chip === k
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                            }`}>
                            {k.charAt(0).toUpperCase() + k.slice(1)}
                        </button>
                    ))}
                </div>
                <Select
                    size="sm"
                    label="Sort branches"
                    value={sort}
                    onChange={setSort}
                    className="min-w-[160px]"
                    options={[
                        { value: 'recent', label: 'Recently active' },
                        { value: 'name', label: 'Name A-Z' },
                    ]}
                />
            </div>

            <ul className="space-y-2">
                {filtered.map(b => (
                    <li key={b.name}>
                        <Card className={`p-3 flex items-center gap-3 group ${
                            b.name === repoData?.default_branch ? 'ring-1 ring-slate-300 dark:ring-slate-600 bg-slate-50 dark:bg-slate-800/50' : ''
                        }`}>
                            <GitBranch className="w-4 h-4 text-slate-400 shrink-0" />
                            <div className="flex-1 min-w-0">
                                <span className="font-medium text-sm text-slate-900 dark:text-slate-100">{b.name}</span>
                                {b.name === repoData?.default_branch && (
                                    <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide bg-indigo-600 text-white">default</span>
                                )}
                                {b.commit?.sha && (
                                    <span className="text-xs text-slate-500 dark:text-slate-400 ml-2 font-mono">{b.commit.sha.substring(0, 7)}</span>
                                )}
                                {b.commit?.author?.date && (
                                    <span className="text-xs text-slate-400 dark:text-slate-500 ml-2">{formatRelativeTime(b.commit.author.date)}</span>
                                )}
                            </div>
                            {b.name === repoData?.default_branch ? (
                                <BranchProtectionPanel api={api} branch={b.name} archived={!!repoData.archived} variant="inline" />
                            ) : b.protected && (
                                <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                                    <Shield className="w-3 h-3" /> Protected
                                </span>
                            )}
                            <Button variant="ghost" size="sm" onClick={() => handleDelete(b)}
                                className="text-red-500 hover:text-red-700 dark:hover:text-red-400 md:opacity-0 md:group-hover:opacity-100"
                                title="Delete branch" aria-label={`Delete branch ${b.name}`}>
                                <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                        </Card>
                    </li>
                ))}
                {filtered.length === 0 && (
                    <EmptyState
                        icon={GitBranch}
                        title={branches.length === 0 ? 'No branches' : 'No branches match'}
                        description={branches.length === 0 ? "This repository has no branches to display." : "Try a different search or filter."}
                    />
                )}
            </ul>

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
        </SectionPanel>
    )
}
