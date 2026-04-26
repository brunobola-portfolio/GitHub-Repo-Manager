import { useState } from 'react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { ConfirmModal } from '../ui/ConfirmModal'
import { EmptyState } from '../ui/EmptyState'
import { CodeownersSuggestModal } from '../CodeownersSuggestModal'
import { useToast } from '../../hooks/useToast'
import { useAIStatus } from '../../hooks/useAIStatus'
import { aiApi } from '../../api/ai'
import { reposApi } from '../../api/repos'
import { Settings, Save, Loader2, CheckCircle2, XCircle, AlertTriangle, Lock, Globe, Webhook, Trash2, Plus, RefreshCw, Users, Tag, Sparkles } from 'lucide-react'
import { Spinner } from '../ui/Spinner'

export function SettingsTab({ owner, repo, api, repoData, onUpdate }) {
    const { toast } = useToast()
    const aiStatus = useAIStatus()
    const aiOff = !aiStatus.loading && !aiStatus.configured
    const [codeownersOpen, setCodeownersOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    // AI-suggested topics state.
    // kind: 'idle' | 'loading' | 'suggestions' | 'empty' | 'not-indexed' | 'applying'
    const [topicsState, setTopicsState] = useState({ kind: 'idle' })
    const [selectedTopics, setSelectedTopics] = useState(new Set())

    const loadTopicSuggestions = async () => {
        setTopicsState({ kind: 'loading' })
        try {
            const meta = await aiApi.getMetadata(repoData.id)
            const aiTopics = Array.isArray(meta?.topics) ? meta.topics : []
            const existing = new Set(repoData.topics || [])
            const newOnes = aiTopics.filter((t) => !existing.has(t))
            if (newOnes.length === 0) {
                setTopicsState({ kind: 'empty' })
                return
            }
            setSelectedTopics(new Set())
            setTopicsState({ kind: 'suggestions', items: newOnes })
        } catch (err) {
            if (err?.status === 404) {
                setTopicsState({ kind: 'not-indexed' })
                return
            }
            toast.errorFromException(err, { fallbackTitle: 'Failed to load topic suggestions' })
            setTopicsState({ kind: 'idle' })
        }
    }

    const toggleTopic = (t) => {
        setSelectedTopics((prev) => {
            const next = new Set(prev)
            if (next.has(t)) next.delete(t)
            else next.add(t)
            return next
        })
    }

    const applyTopics = async () => {
        if (selectedTopics.size === 0) return
        setTopicsState((s) => ({ ...s, kind: 'applying' }))
        try {
            const union = Array.from(new Set([...(repoData.topics || []), ...selectedTopics]))
            await reposApi.setTopics(owner, repo, union)
            toast.success(`Added ${selectedTopics.size} topic${selectedTopics.size === 1 ? '' : 's'}`)
            setTopicsState({ kind: 'idle' })
            setSelectedTopics(new Set())
            onUpdate?.()
        } catch (err) {
            toast.errorFromException(err, { fallbackTitle: 'Failed to update topics' })
            setTopicsState((s) => ({ ...s, kind: 'suggestions' }))
        }
    }

    const [message, setMessage] = useState(null)
    const [form, setForm] = useState({
        description: repoData.description || '',
        homepage: repoData.homepage || '',
        has_issues: repoData.has_issues !== false,
        has_projects: repoData.has_projects !== false,
        has_wiki: repoData.has_wiki !== false,
        allow_forking: repoData.allow_forking !== false,
        default_branch: repoData.default_branch || 'main'
    })

    const [confirmAction, setConfirmAction] = useState(null)

    // Webhooks state
    const [webhooks, setWebhooks] = useState([])
    const [loadingHooks, setLoadingHooks] = useState(false)
    const [hooksLoaded, setHooksLoaded] = useState(false)
    const [showNewHook, setShowNewHook] = useState(false)
    const [hookForm, setHookForm] = useState({ url: '', content_type: 'json', events: ['push'] })

    const handleSave = async () => {
        setSaving(true)
        setMessage(null)
        try {
            const result = await api.updateRepo(form)
            const updated = result.data || result
            onUpdate(prev => ({ ...prev, ...updated }))
            setMessage({ type: 'success', text: 'Settings saved' })
            toast.success('Repository settings saved')
        } catch (e) {
            setMessage({ type: 'error', text: e.message })
            toast.errorFromException(e, { fallbackTitle: 'Failed to save settings' })
        } finally {
            setSaving(false)
        }
    }

    const loadWebhooks = async () => {
        setLoadingHooks(true)
        try {
            const data = await api.fetchWebhooks()
            setWebhooks(data.data || data || [])
            setHooksLoaded(true)
        } catch { /* ignore */ } finally {
            setLoadingHooks(false)
        }
    }

    const createHook = async () => {
        try {
            await api.createWebhook({
                config: { url: hookForm.url, content_type: hookForm.content_type },
                events: hookForm.events,
                active: true
            })
            setMessage({ type: 'success', text: 'Webhook created' })
            toast.success('Webhook created')
            setShowNewHook(false)
            setHookForm({ url: '', content_type: 'json', events: ['push'] })
            loadWebhooks()
        } catch (e) {
            setMessage({ type: 'error', text: e.message })
            toast.errorFromException(e, { fallbackTitle: 'Failed to create webhook' })
        }
    }

    const deleteHook = (hookId) => {
        setConfirmAction({
            title: 'Delete Webhook',
            message: 'Delete this webhook?',
            confirmText: 'Delete',
            onConfirm: async () => {
                try {
                    await api.deleteWebhook(hookId)
                    setMessage({ type: 'success', text: 'Webhook deleted' })
                    toast.success('Webhook deleted')
                    loadWebhooks()
                } catch (e) {
                    setMessage({ type: 'error', text: e.message })
                    toast.errorFromException(e, { fallbackTitle: 'Failed to delete webhook' })
                }
            }
        })
    }

    const pingHook = async (hookId) => {
        try {
            await api.pingWebhook(hookId)
            setMessage({ type: 'success', text: 'Ping sent' })
            toast.success('Webhook ping sent')
        } catch (e) {
            setMessage({ type: 'error', text: e.message })
            toast.errorFromException(e, { fallbackTitle: 'Failed to ping webhook' })
        }
    }

    return (
        <div className="space-y-6 max-w-2xl">
            {message && (
                <div className={`flex items-center gap-2 p-2 rounded-lg text-sm ${
                    message.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                }`}>
                    {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                    {message.text}
                </div>
            )}

            {/* General Settings */}
            <Card className="p-5 space-y-4">
                <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <Settings className="w-5 h-5 text-indigo-500" /> General
                </h3>
                <div>
                    <label htmlFor="repo-settings-description" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Description</label>
                    <input id="repo-settings-description" type="text" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm" />
                </div>
                <div>
                    <label htmlFor="repo-settings-homepage" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Website</label>
                    <input id="repo-settings-homepage" type="url" value={form.homepage} onChange={e => setForm(f => ({ ...f, homepage: e.target.value }))}
                        placeholder="https://example.com"
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm" />
                </div>
                <div>
                    <label htmlFor="repo-settings-default-branch" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Default Branch</label>
                    <input id="repo-settings-default-branch" type="text" value={form.default_branch} onChange={e => setForm(f => ({ ...f, default_branch: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm" />
                </div>

                {/* Feature toggles */}
                <div className="space-y-2">
                    {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Features</label>
                    {[
                        { key: 'has_issues', label: 'Issues' },
                        { key: 'has_projects', label: 'Projects' },
                        { key: 'has_wiki', label: 'Wiki' },
                        { key: 'allow_forking', label: 'Allow Forking' }
                    ].map(feat => (
                        <label key={feat.key} className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={form[feat.key]}
                                onChange={e => setForm(f => ({ ...f, [feat.key]: e.target.checked }))}
                                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600" />
                            <span className="text-sm text-slate-700 dark:text-slate-300">{feat.label}</span>
                        </label>
                    ))}
                </div>

                <Button onClick={handleSave} disabled={saving}>
                    {saving ? <Spinner size="sm" className="mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                    Save Changes
                </Button>
            </Card>

            {/* Webhooks */}
            <Card className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                        <Webhook className="w-5 h-5 text-indigo-500" /> Webhooks
                    </h3>
                    <div className="flex gap-2">
                        {!hooksLoaded ? (
                            <Button size="sm" variant="secondary" onClick={loadWebhooks} disabled={loadingHooks}>
                                {loadingHooks ? <Spinner size="sm" /> : 'Load Webhooks'}
                            </Button>
                        ) : (
                            <Button size="sm" onClick={() => setShowNewHook(!showNewHook)}>
                                <Plus className="w-4 h-4 mr-1" /> Add
                            </Button>
                        )}
                    </div>
                </div>

                {showNewHook && (
                    <div className="space-y-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                        <div>
                            <label htmlFor="webhook-payload-url" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Payload URL *</label>
                            <input id="webhook-payload-url" type="url" value={hookForm.url} onChange={e => setHookForm(f => ({ ...f, url: e.target.value }))}
                                placeholder="https://example.com/webhook"
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm" />
                        </div>
                        <div className="flex gap-2">
                            <Button size="sm" variant="secondary" onClick={() => setShowNewHook(false)}>Cancel</Button>
                            <Button size="sm" onClick={createHook} disabled={!hookForm.url}>Create</Button>
                        </div>
                    </div>
                )}

                {hooksLoaded && (
                    <div className="space-y-2">
                        {webhooks.map(hook => (
                            <div key={hook.id} className="flex items-center gap-3 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                                <div className={`w-2 h-2 rounded-full ${hook.active ? 'bg-green-500' : 'bg-slate-400'}`} />
                                <span className="text-sm text-slate-700 dark:text-slate-300 flex-1 truncate font-mono">
                                    {hook.config?.url || 'N/A'}
                                </span>
                                <Button variant="ghost" size="sm" onClick={() => pingHook(hook.id)} title="Ping">
                                    <RefreshCw className="w-3.5 h-3.5" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => deleteHook(hook.id)} className="text-red-500">
                                    <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                            </div>
                        ))}
                        {webhooks.length === 0 && (
                            <p className="text-sm text-slate-500 dark:text-slate-400">No webhooks configured</p>
                        )}
                    </div>
                )}
            </Card>

            {/* Danger Zone */}
            <Card className="p-5 border-red-200 dark:border-red-900/50">
                <h3 className="font-bold text-red-600 dark:text-red-400 flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-5 h-5" /> Danger Zone
                </h3>
                <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 border border-red-200 dark:border-red-900/50 rounded-lg">
                        <div>
                            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Change Visibility</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Currently {repoData.private ? 'private' : 'public'}
                            </p>
                        </div>
                        <Button variant="danger" size="sm" onClick={() => {
                            const newVisibility = !repoData.private
                            setConfirmAction({
                                title: 'Change Visibility',
                                message: `Make this repository ${newVisibility ? 'private' : 'public'}?`,
                                confirmText: newVisibility ? 'Make Private' : 'Make Public',
                                variant: 'warning',
                                onConfirm: async () => {
                                    try {
                                        const result = await api.updateRepo({ private: newVisibility })
                                        onUpdate(prev => ({ ...prev, ...(result.data || result) }))
                                        setMessage({ type: 'success', text: `Repository is now ${newVisibility ? 'private' : 'public'}` })
                                    } catch (e) {
                                        setMessage({ type: 'error', text: e.message })
                                    }
                                }
                            })
                        }}>
                            {repoData.private ? <><Globe className="w-3.5 h-3.5 mr-1" /> Make Public</> : <><Lock className="w-3.5 h-3.5 mr-1" /> Make Private</>}
                        </Button>
                    </div>
                </div>
            </Card>

            {/* Governance — CODEOWNERS generator */}
            <Card className="p-6">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                            <Users className="w-4 h-4 text-indigo-500" />
                            CODEOWNERS
                        </h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-xl">
                            Auto-suggest ownership rules from recent commit authorship. Review the proposed owners per directory and paste the generated file into <code className="font-mono text-xs">.github/CODEOWNERS</code>.
                        </p>
                    </div>
                    <Button
                        variant="secondary"
                        onClick={() => setCodeownersOpen(true)}
                        disabled={!owner || !repo}
                    >
                        <Users className="w-4 h-4 mr-1.5" />
                        Suggest
                    </Button>
                </div>
            </Card>

            <section data-testid="ai-suggested-topics" className="mt-6 p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="w-4 h-4 text-indigo-500" />
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">AI-suggested topics</h3>
                </div>

                {topicsState.kind === 'idle' && (
                    <>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                            See what topics AI would add to this repo based on its README, language, and dependencies.
                        </p>
                        <Button
                            variant="secondary"
                            onClick={loadTopicSuggestions}
                            disabled={aiOff || repoData.archived}
                            title={aiOff ? 'Configure AI in Settings → AI to enable suggestions' : (repoData.archived ? 'Archived repos cannot be modified' : undefined)}
                        >
                            <Tag className="w-3.5 h-3.5" /> Suggest topics
                        </Button>
                    </>
                )}

                {topicsState.kind === 'loading' && (
                    <p className="text-sm text-slate-500 dark:text-slate-400 inline-flex items-center gap-2">
                        <Spinner size="xs" /> Loading suggestions…
                    </p>
                )}

                {topicsState.kind === 'empty' && (
                    <EmptyState
                        icon={Tag}
                        title="Looks good"
                        description="No new topics suggested. Try re-indexing this repo if it changed recently."
                    />
                )}

                {topicsState.kind === 'not-indexed' && (
                    <EmptyState
                        icon={Sparkles}
                        title="Not indexed yet"
                        description="Index this repo first to get AI-suggested topics."
                    />
                )}

                {(topicsState.kind === 'suggestions' || topicsState.kind === 'applying') && (
                    <>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                            {topicsState.items.length} suggestion{topicsState.items.length === 1 ? '' : 's'} not already on the repo. Pick which to add.
                        </p>
                        <ul className="space-y-1.5 mb-3">
                            {topicsState.items.map((t) => (
                                <li key={t}>
                                    <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={selectedTopics.has(t)}
                                            onChange={() => toggleTopic(t)}
                                            aria-label={t}
                                            disabled={topicsState.kind === 'applying'}
                                        />
                                        {t}
                                    </label>
                                </li>
                            ))}
                        </ul>
                        <Button
                            variant="primary"
                            onClick={applyTopics}
                            disabled={selectedTopics.size === 0 || topicsState.kind === 'applying' || repoData.archived}
                        >
                            {topicsState.kind === 'applying' && <Spinner size="xs" />}
                            Add {selectedTopics.size} topic{selectedTopics.size === 1 ? '' : 's'}
                        </Button>
                    </>
                )}
            </section>

            <CodeownersSuggestModal
                isOpen={codeownersOpen}
                onClose={() => setCodeownersOpen(false)}
                owner={owner}
                repo={repo}
            />

            <ConfirmModal
                isOpen={!!confirmAction}
                onClose={() => setConfirmAction(null)}
                onConfirm={() => { confirmAction?.onConfirm(); setConfirmAction(null) }}
                title={confirmAction?.title}
                message={confirmAction?.message}
                confirmText={confirmAction?.confirmText}
                variant={confirmAction?.variant || 'danger'}
            />
        </div>
    )
}
