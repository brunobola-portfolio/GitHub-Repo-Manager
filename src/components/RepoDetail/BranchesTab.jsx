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
import { useDebounce } from '../../hooks/useDebounce'
import { useTabData } from '../../hooks/useTabData'
import { useToast } from '../../hooks/useToast'
import { BranchHygieneCard } from './BranchHygieneCard'
import { branchActions } from '../../actions/branchActions'
import { BranchProtectionPanel } from './BranchProtectionPanel'
import { formatRelativeTime } from '../../utils/format'
import { emitAppEvent, APP_EVENTS } from '../../utils/appEvents'
import { TabLoadError } from './TabLoadError'

// Computed once at module load — avoids calling Date.now() during render.
const STALE_MS = 90 * 24 * 60 * 60 * 1000
const STALE_CUTOFF = Date.now() - STALE_MS

// Local (no network) filter — short enough to feel instant, long enough that
// a fast typist doesn't pay for a re-sort on every character.
const SEARCH_DEBOUNCE_MS = 150

export function BranchesTab({ api, repoData }) {
    const { toast } = useToast()
    const { data, loading, error, reload: loadBranches } = useTabData(
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
        emitAppEvent(APP_EVENTS.REPO_DETAIL_BRANCHES_LOADED, branches)
    }, [branches])

    const [showCreate, setShowCreate] = useState(false)
    const [newBranch, setNewBranch] = useState('')
    const [baseBranch, setBaseBranch] = useState('')
    const [creating, setCreating] = useState(false)
    const [message, setMessage] = useState(null)
    const [confirmAction, setConfirmAction] = useState(null)
    const [search, setSearch] = useState('')
    const [chip, setChip] = useState('all') // 'all' | 'active' | 'stale' | 'protected'
    const [sort, setSort] = useState('recent') // 'recent' | 'name'
    // The input stays instant (controlled by `search`); only the filter+sort
    // pass below waits for the user to pause. On a repo with hundreds of
    // branches every keystroke otherwise re-ran the whole comparator.
    const debouncedSearch = useDebounce(search, SEARCH_DEBOUNCE_MS)

    // Derive the comparison keys ONCE per branch list, same trick as
    // STALE_CUTOFF above: the sort comparator ran two `new Date(...)` per
    // comparison, i.e. ~15k Date allocations per keystroke at 800 branches.
    // `activityAt` falls back to the committer date (the stale/active chips'
    // rule); `authoredAt` is author-date only (the recency sort's rule) —
    // keeping them separate preserves both behaviours exactly.
    const indexed = useMemo(() => branches.map(b => ({
        branch: b,
        nameLower: b.name.toLowerCase(),
        activityAt: new Date(b.commit?.author?.date || b.commit?.committer?.date || 0).getTime(),
        authoredAt: new Date(b.commit?.author?.date || 0).getTime(),
    })), [branches])

    const filtered = useMemo(() => {
        const term = debouncedSearch.trim().toLowerCase()
        const cutoff = STALE_CUTOFF
        const defaultBranch = repoData?.default_branch
        let out = indexed.filter(e => !term || e.nameLower.includes(term))
        if (chip === 'protected') out = out.filter(e => e.branch.protected)
        else if (chip === 'stale') out = out.filter(e => e.activityAt && e.activityAt < cutoff)
        else if (chip === 'active') out = out.filter(e => e.activityAt && e.activityAt >= cutoff)

        out = [...out].sort((a, b) => {
            // Default branch always first
            if (a.branch.name === defaultBranch) return -1
            if (b.branch.name === defaultBranch) return 1
            if (sort === 'name') return a.branch.name.localeCompare(b.branch.name)
            return b.authoredAt - a.authoredAt
        })
        return out.map(e => e.branch)
    }, [indexed, debouncedSearch, chip, sort, repoData?.default_branch])

    const handleCreate = async () => {
        if (!newBranch) return
        setCreating(true)
        setMessage(null)
        try {
            // The route resolves the base commit itself from a BRANCH NAME
            // (GET /git/refs/heads/{from}); it has no SHA input, which is why
            // the old free-text "Base SHA" field could never have worked.
            // Empty means "the repository default branch", which the route
            // already falls back to.
            await api.createBranch(newBranch, baseBranch || undefined)
            setMessage({ type: 'success', text: `Branch "${newBranch}" created` })
            toast.success('Branch created')
            setNewBranch('')
            setBaseBranch('')
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

    if (error) {
        return <TabLoadError error={error} onRetry={loadBranches} resourceLabel="branches" />
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
                    <Field label="Branch from" htmlFor="new-branch-base">
                        <Select
                            id="new-branch-base"
                            value={baseBranch}
                            onChange={setBaseBranch}
                            options={[
                                { value: '', label: repoData?.default_branch ? `${repoData.default_branch} (default)` : 'Default branch' },
                                ...branches
                                    .filter(b => b.name !== repoData?.default_branch)
                                    .map(b => ({ value: b.name, label: b.name })),
                            ]}
                        />
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
                                    ? 'ds-brand-solid'
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
                                    <span className="ml-1.5 px-1.5 py-0.5 rounded ds-text-micro uppercase tracking-wide ds-brand-solid">default</span>
                                )}
                                {b.commit?.sha && (
                                    <span className="text-xs text-slate-500 dark:text-slate-400 ml-2 font-mono">{b.commit.sha.substring(0, 7)}</span>
                                )}
                                {b.commit?.author?.date && (
                                    <span className="text-xs text-slate-500 dark:text-slate-400 ml-2">{formatRelativeTime(b.commit.author.date)}</span>
                                )}
                            </div>
                            {b.name === repoData?.default_branch ? (
                                <BranchProtectionPanel api={api} branch={b.name} archived={!!repoData.archived} variant="inline" />
                            ) : b.protected && (
                                <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                                    <Shield className="w-3 h-3" /> Protected
                                </span>
                            )}
                            <Button variant="ghost" size="sm" onClick={() => handleDelete(b)}
                                className="text-red-500 hover:text-red-700 dark:hover:text-red-400 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
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
                onConfirm={async () => { await confirmAction?.onConfirm(); setConfirmAction(null) }}
                title={confirmAction?.title}
                message={confirmAction?.message}
                requiresInput={confirmAction?.requiresInput}
                confirmText={confirmAction?.confirmText}
                variant="danger"
            />
        </div>
        </SectionPanel>
    )
}
