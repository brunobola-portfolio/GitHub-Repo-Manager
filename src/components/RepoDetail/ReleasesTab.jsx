import { useState, useEffect } from 'react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { ConfirmModal } from '../ui/ConfirmModal'
import { EmptyState } from '../ui/EmptyState'
import { Tag, Plus, Trash2, Loader2, ExternalLink, CheckCircle2, XCircle, Package } from 'lucide-react'

export function ReleasesTab({ owner, repo, api }) {
    const [releases, setReleases] = useState([])
    const [loading, setLoading] = useState(true)
    const [showCreate, setShowCreate] = useState(false)
    const [creating, setCreating] = useState(false)
    const [message, setMessage] = useState(null)
    const [form, setForm] = useState({ tag_name: '', name: '', body: '', draft: false, prerelease: false })
    const [confirmAction, setConfirmAction] = useState(null)

    const loadReleases = async () => {
        setLoading(true)
        try {
            const data = await api.fetchReleases()
            setReleases(data.data || data || [])
        } catch { /* ignore */ } finally {
            setLoading(false)
        }
    }

    useEffect(() => { loadReleases() }, [owner, repo]) // eslint-disable-line react-hooks/exhaustive-deps

    const handleCreate = async () => {
        if (!form.tag_name) return
        setCreating(true)
        setMessage(null)
        try {
            await api.createRelease(form)
            setMessage({ type: 'success', text: `Release "${form.tag_name}" created` })
            setForm({ tag_name: '', name: '', body: '', draft: false, prerelease: false })
            setShowCreate(false)
            loadReleases()
        } catch (e) {
            setMessage({ type: 'error', text: e.message })
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
                    loadReleases()
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
                    <Tag className="w-5 h-5 text-indigo-500" />
                    {releases.length} Release{releases.length !== 1 ? 's' : ''}
                </h3>
                <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
                    <Plus className="w-4 h-4 mr-1" /> New Release
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
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tag *</label>
                            <input type="text" value={form.tag_name} onChange={e => setForm(f => ({ ...f, tag_name: e.target.value }))}
                                placeholder="v1.0.0"
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Title</label>
                            <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                placeholder="Release title"
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Release Notes</label>
                        <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                            rows={4} placeholder="Describe this release..."
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm resize-none" />
                    </div>
                    <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={form.draft} onChange={e => setForm(f => ({ ...f, draft: e.target.checked }))}
                                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600" />
                            <span className="text-sm text-slate-700 dark:text-slate-300">Draft</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={form.prerelease} onChange={e => setForm(f => ({ ...f, prerelease: e.target.checked }))}
                                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600" />
                            <span className="text-sm text-slate-700 dark:text-slate-300">Pre-release</span>
                        </label>
                    </div>
                    <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
                        <Button size="sm" onClick={handleCreate} disabled={!form.tag_name || creating}>
                            {creating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
                            Publish
                        </Button>
                    </div>
                </Card>
            )}

            <div className="space-y-3">
                {releases.map(r => (
                    <Card key={r.id} className="p-4">
                        <div className="flex items-start gap-3">
                            <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 mt-0.5">
                                <Package className="w-4 h-4" />
                            </div>
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
                                    <span>{new Date(r.published_at || r.created_at).toLocaleDateString()}</span>
                                    {r.html_url && (
                                        <a href={r.html_url} target="_blank" rel="noopener noreferrer"
                                            className="text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1">
                                            View <ExternalLink className="w-3 h-3" />
                                        </a>
                                    )}
                                </div>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => handleDelete(r)} className="text-red-500 hover:text-red-700">
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
                onConfirm={() => { confirmAction?.onConfirm(); setConfirmAction(null) }}
                title={confirmAction?.title}
                message={confirmAction?.message}
                confirmText={confirmAction?.confirmText}
                variant="danger"
            />
        </div>
    )
}
