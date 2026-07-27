import { useState } from 'react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { ConfirmModal } from '../ui/ConfirmModal'
import { EmptyState } from '../ui/EmptyState'
import { RowIconBadge } from '../ui/RowIconBadge'
import { SectionPanel } from '../ui/SectionPanel'
import { Tag, Plus, Trash2, Loader2, ExternalLink, CheckCircle2, XCircle, Package, RefreshCw } from 'lucide-react'
import { Spinner } from '../ui/Spinner'
import { Field, Input, Textarea } from '../ui/form'
import { useTabData } from '../../hooks/useTabData'
import { useToast } from '../../hooks/useToast'
import { formatRelativeTime, formatDateTime } from '../../utils/format'
import { TabLoadError } from './TabLoadError'

export function ReleasesTab({ api }) {
    const { toast } = useToast()
    const { data, loading, error, reload: loadReleases } = useTabData(
        async () => {
            const result = await api.fetchReleases()
            return result.data || result || []
        },
        [api],
    )
    const releases = data || []

    const [showCreate, setShowCreate] = useState(false)
    const [creating, setCreating] = useState(false)
    const [message, setMessage] = useState(null)
    const [form, setForm] = useState({ tag_name: '', name: '', body: '', draft: false, prerelease: false })
    const [confirmAction, setConfirmAction] = useState(null)

    const handleCreate = async () => {
        if (!form.tag_name) return
        setCreating(true)
        setMessage(null)
        try {
            await api.createRelease(form)
            setMessage({ type: 'success', text: `Release "${form.tag_name}" created` })
            toast.success(form.draft ? 'Draft release saved' : 'Release published')
            setForm({ tag_name: '', name: '', body: '', draft: false, prerelease: false })
            setShowCreate(false)
            loadReleases()
        } catch (e) {
            setMessage({ type: 'error', text: e.message })
            toast.errorFromException(e, { fallbackTitle: 'Failed to publish release' })
        } finally {
            setCreating(false)
        }
    }

    const handleDelete = (release) => {
        setConfirmAction({
            title: 'Delete Release',
            message: `Delete release "${release.name || release.tag_name}"?`,
            confirmText: 'Delete',
            onConfirm: async () => {
                try {
                    await api.deleteRelease(release.id)
                    setMessage({ type: 'success', text: 'Release deleted' })
                    toast.success('Release deleted')
                    loadReleases()
                } catch (e) {
                    setMessage({ type: 'error', text: e.message })
                    toast.errorFromException(e, { fallbackTitle: 'Failed to delete release' })
                }
            }
        })
    }

    if (loading) {
        return <div className="flex justify-center py-12"><Spinner size="lg" /></div>
    }

    if (error) {
        return <TabLoadError error={error} onRetry={loadReleases} resourceLabel="releases" />
    }

    return (
        <SectionPanel
            icon={Tag}
            title={`${releases.length} Release${releases.length !== 1 ? 's' : ''}`}
            subtitle="Tag and publish versioned releases"
            actions={
                <>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={loadReleases}
                        disabled={loading}
                        aria-label="Refresh releases"
                        title="Refresh releases"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </Button>
                    <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
                        <Plus className="w-4 h-4 mr-1" /> New Release
                    </Button>
                </>
            }
        >
        <div className="space-y-4">
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
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Tag" required htmlFor="release-tag-name">
                            <Input id="release-tag-name" type="text" value={form.tag_name} onChange={e => setForm(f => ({ ...f, tag_name: e.target.value }))}
                                placeholder="v1.0.0" />
                        </Field>
                        <Field label="Title" htmlFor="release-name">
                            <Input id="release-name" type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                placeholder="Release title" />
                        </Field>
                    </div>
                    <Field label="Release Notes" htmlFor="release-body">
                        <Textarea id="release-body" value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                            rows={4} placeholder="Describe this release..." />
                    </Field>
                    <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={form.draft} onChange={e => setForm(f => ({ ...f, draft: e.target.checked }))}
                                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-[color:var(--ds-accent-brand)]" />
                            <span className="text-sm text-slate-700 dark:text-slate-300">Draft</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={form.prerelease} onChange={e => setForm(f => ({ ...f, prerelease: e.target.checked }))}
                                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-[color:var(--ds-accent-brand)]" />
                            <span className="text-sm text-slate-700 dark:text-slate-300">Pre-release</span>
                        </label>
                    </div>
                    <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
                        <Button size="sm" onClick={handleCreate} disabled={!form.tag_name || creating}>
                            {creating ? <Spinner size="sm" className="mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
                            Publish
                        </Button>
                    </div>
                </Card>
            )}

            <div className="space-y-3">
                {releases.map(r => (
                    <Card key={r.id} className="p-4">
                        <div className="flex items-start gap-3">
                            <RowIconBadge icon={Package} tone="emerald" size="md" className="mt-0.5" />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-bold text-slate-900 dark:text-slate-100">{r.name || r.tag_name}</span>
                                    <span className="text-xs font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-400">{r.tag_name}</span>
                                    {r.draft && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">Draft</span>}
                                    {r.prerelease && <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400">Pre-release</span>}
                                </div>
                                {r.body && (
                                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 line-clamp-2">{r.body}</p>
                                )}
                                <div className="flex items-center gap-3 mt-2 text-xs text-slate-500 dark:text-slate-400">
                                    <span>{r.author?.login}</span>
                                    <span title={formatDateTime(r.published_at || r.created_at)}>{formatRelativeTime(r.published_at || r.created_at)}</span>
                                    {r.html_url && (
                                        <a href={r.html_url} target="_blank" rel="noopener noreferrer"
                                            className="text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] hover:underline flex items-center gap-1">
                                            View <ExternalLink className="w-3 h-3" />
                                        </a>
                                    )}
                                </div>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => handleDelete(r)} className="text-red-500 hover:text-red-700"
                                aria-label={`Delete release ${r.name || r.tag_name}`}
                                title={`Delete release ${r.name || r.tag_name}`}>
                                <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                        </div>
                    </Card>
                ))}
                {releases.length === 0 && (
                    <EmptyState
                        icon={Tag}
                        title="No releases yet"
                        description="This repository hasn't published any releases."
                    />
                )}
            </div>

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
