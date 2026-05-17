import { useMemo, useState } from 'react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { ConfirmModal } from '../ui/ConfirmModal'
import { EmptyState } from '../ui/EmptyState'
import { CodeownersSuggestModal } from '../CodeownersSuggestModal'
import { CollaboratorsSection } from './CollaboratorsSection'
import { useToast } from '../../hooks/useToast'
import { useAIStatus } from '../../hooks/useAIStatus'
import { useModal } from '../../hooks/useModal'
import { aiApi } from '../../api/ai'
import { reposApi } from '../../api/repos'
import { Settings, Save, AlertTriangle, Lock, Globe, Webhook, Trash2, Plus, RefreshCw, Users, Tag, Sparkles, Undo2, X, GitMerge, Archive, ArchiveRestore } from 'lucide-react'
import { Spinner } from '../ui/Spinner'
import { Field, Input } from '../ui/form'

export function SettingsTab({ owner, repo, api, repoData, onUpdate }) {
    const { toast } = useToast()
    const aiStatus = useAIStatus()
    const aiOff = !aiStatus.loading && !aiStatus.configured
    const { openModalWithData } = useModal()
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

    const initialForm = useMemo(() => ({
        description: repoData.description || '',
        homepage: repoData.homepage || '',
        has_issues: repoData.has_issues !== false,
        has_projects: repoData.has_projects !== false,
        has_wiki: repoData.has_wiki !== false,
        allow_forking: repoData.allow_forking !== false,
        default_branch: repoData.default_branch || 'main',
        allow_squash_merge: repoData.allow_squash_merge !== false,
        allow_merge_commit: repoData.allow_merge_commit !== false,
        allow_rebase_merge: repoData.allow_rebase_merge !== false,
        delete_branch_on_merge: !!repoData.delete_branch_on_merge,
    }), [
        repoData.description, repoData.homepage, repoData.has_issues, repoData.has_projects,
        repoData.has_wiki, repoData.allow_forking, repoData.default_branch,
        repoData.allow_squash_merge, repoData.allow_merge_commit, repoData.allow_rebase_merge,
        repoData.delete_branch_on_merge,
    ])
    const [form, setForm] = useState(initialForm)
    const isDirty = useMemo(
        () => Object.keys(initialForm).some(k => initialForm[k] !== form[k]),
        [initialForm, form],
    )
    const handleDiscard = () => setForm(initialForm)

    const [confirmAction, setConfirmAction] = useState(null)

    // Manual topics editor — coexists with the AI suggestions section.
    const [newTopicInput, setNewTopicInput] = useState('')
    const [topicsSaving, setTopicsSaving] = useState(false)
    const TOPIC_PATTERN = /^[a-z0-9-]{1,50}$/

    const persistTopics = async (next) => {
        setTopicsSaving(true)
        try {
            await reposApi.setTopics(owner, repo, next)
            onUpdate?.((prev) => ({ ...prev, topics: next }))
            return true
        } catch (err) {
            toast.errorFromException(err, { fallbackTitle: 'Failed to update topics' })
            return false
        } finally {
            setTopicsSaving(false)
        }
    }

    const handleAddTopic = async () => {
        const candidate = newTopicInput.trim().toLowerCase()
        if (!candidate) return
        if (!TOPIC_PATTERN.test(candidate)) {
            toast.error('Topics must be lowercase letters, digits, or hyphens (max 50 chars).')
            return
        }
        const current = repoData.topics || []
        if (current.includes(candidate)) {
            toast.error('Topic already added.')
            return
        }
        if (current.length >= 20) {
            toast.error('GitHub allows up to 20 topics per repository.')
            return
        }
        const ok = await persistTopics([...current, candidate])
        if (ok) {
            setNewTopicInput('')
            toast.success(`Added topic "${candidate}"`)
        }
    }

    const handleRemoveTopic = async (topic) => {
        const next = (repoData.topics || []).filter((t) => t !== topic)
        const ok = await persistTopics(next)
        if (ok) toast.success(`Removed topic "${topic}"`)
    }

    const handleArchiveToggle = () => {
        const willArchive = !repoData.archived
        setConfirmAction({
            title: willArchive ? 'Archive Repository' : 'Unarchive Repository',
            message: willArchive
                ? 'Archived repositories become read-only — you can read them but not push, open issues, or run actions. You can unarchive at any time.'
                : 'Unarchiving will allow pushes, issues, and actions on this repository again.',
            confirmText: willArchive ? 'Archive' : 'Unarchive',
            variant: 'warning',
            onConfirm: async () => {
                try {
                    const result = await api.updateRepo({ archived: willArchive })
                    onUpdate?.((prev) => ({ ...prev, ...(result.data || result) }))
                    toast.success(willArchive ? 'Repository archived' : 'Repository unarchived')
                } catch (e) {
                    toast.errorFromException(e, { fallbackTitle: 'Failed to update archive state' })
                }
            },
        })
    }

    // Webhooks state
    const [webhooks, setWebhooks] = useState([])
    const [loadingHooks, setLoadingHooks] = useState(false)
    const [hooksLoaded, setHooksLoaded] = useState(false)
    const [showNewHook, setShowNewHook] = useState(false)
    const [hookForm, setHookForm] = useState({ url: '', content_type: 'json', events: ['push'] })

    const handleSave = async () => {
        if (!isDirty) return
        setSaving(true)
        try {
            const result = await api.updateRepo(form)
            const updated = result.data || result
            onUpdate(prev => ({ ...prev, ...updated }))
            toast.success('Repository settings saved')
        } catch (e) {
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
            toast.success('Webhook created')
            setShowNewHook(false)
            setHookForm({ url: '', content_type: 'json', events: ['push'] })
            loadWebhooks()
        } catch (e) {
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
                    toast.success('Webhook deleted')
                    loadWebhooks()
                } catch (e) {
                    toast.errorFromException(e, { fallbackTitle: 'Failed to delete webhook' })
                }
            }
        })
    }

    const pingHook = async (hookId) => {
        try {
            await api.pingWebhook(hookId)
            toast.success('Webhook ping sent')
        } catch (e) {
            toast.errorFromException(e, { fallbackTitle: 'Failed to ping webhook' })
        }
    }

    return (
        // mx-auto centers the form column on wide viewports — without it the
        // content was stuck to the left at 1440px+ leaving the right half of
        // the page empty. max-w-3xl is slightly roomier than the previous 2xl
        // so the Danger Zone + AI-suggest panels breathe — closer to the
        // Branches / PRs / Issues tab feel.
        <div className="space-y-6 max-w-3xl mx-auto">
            {/* General Settings */}
            <Card className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                        <Settings className="w-5 h-5 text-indigo-500" /> General
                    </h3>
                    <button
                        type="button"
                        onClick={() => openModalWithData('suggestNameDescription', {
                            repo: { ...repoData, owner: repoData.owner || { login: owner } },
                            onApplied: (updated) => onUpdate?.((prev) => ({ ...prev, ...updated })),
                        })}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 transition-colors"
                    >
                        <Sparkles className="w-3.5 h-3.5" /> Suggest with AI
                    </button>
                </div>
                <Field label="Description" htmlFor="repo-settings-description">
                    <Input id="repo-settings-description" type="text" value={form.description}
                        onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                        placeholder="A short description of this repository"
                        disabled={saving} />
                </Field>
                <Field label="Website" htmlFor="repo-settings-homepage">
                    <Input id="repo-settings-homepage" type="url" value={form.homepage}
                        onChange={e => setForm(f => ({ ...f, homepage: e.target.value }))}
                        placeholder="https://example.com"
                        disabled={saving} />
                </Field>
                <Field label="Default Branch" htmlFor="repo-settings-default-branch">
                    <Input id="repo-settings-default-branch" type="text" value={form.default_branch}
                        onChange={e => setForm(f => ({ ...f, default_branch: e.target.value }))}
                        placeholder="main"
                        disabled={saving} />
                </Field>

                {/* Feature toggles */}
                <div className="space-y-2">
                    {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-0.5">Features</label>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                        {[
                            { key: 'has_issues', label: 'Issues' },
                            { key: 'has_projects', label: 'Projects' },
                            { key: 'has_wiki', label: 'Wiki' },
                            { key: 'allow_forking', label: 'Allow Forking' }
                        ].map(feat => (
                            <label key={feat.key} className="flex items-center gap-2 cursor-pointer select-none py-1 rounded hover:bg-slate-50 dark:hover:bg-slate-800/50 px-1 -mx-1 transition-colors">
                                <input type="checkbox" checked={form[feat.key]}
                                    onChange={e => setForm(f => ({ ...f, [feat.key]: e.target.checked }))}
                                    disabled={saving}
                                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500/40" />
                                <span className="text-sm text-slate-700 dark:text-slate-300">{feat.label}</span>
                            </label>
                        ))}
                    </div>
                </div>

                {/* Pull request merge settings */}
                <div className="space-y-2 pt-2 border-t border-slate-200/60 dark:border-slate-700/50">
                    {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-0.5 flex items-center gap-1.5">
                        <GitMerge className="w-3.5 h-3.5 text-indigo-500" /> Pull request merging
                    </label>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                        {[
                            { key: 'allow_merge_commit', label: 'Allow merge commits' },
                            { key: 'allow_squash_merge', label: 'Allow squash merging' },
                            { key: 'allow_rebase_merge', label: 'Allow rebase merging' },
                            { key: 'delete_branch_on_merge', label: 'Auto-delete head branches' },
                        ].map(feat => (
                            <label key={feat.key} className="flex items-center gap-2 cursor-pointer select-none py-1 rounded hover:bg-slate-50 dark:hover:bg-slate-800/50 px-1 -mx-1 transition-colors">
                                <input type="checkbox" checked={form[feat.key]}
                                    onChange={e => setForm(f => ({ ...f, [feat.key]: e.target.checked }))}
                                    disabled={saving}
                                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500/40" />
                                <span className="text-sm text-slate-700 dark:text-slate-300">{feat.label}</span>
                            </label>
                        ))}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">At least one merge style must remain enabled — GitHub blocks the save otherwise.</p>
                </div>

                {/* Save row — desktop inline; mobile sticky version is a TODO follow-up
                    (slice 5 docs cover the pattern: md:hidden fixed bottom-0 inset-x-0 +
                    md:flex inline). */}
                <div className="flex items-center justify-between gap-2 pt-1">
                    <span className={`text-xs transition-opacity ${isDirty ? 'opacity-100 text-amber-600 dark:text-amber-400' : 'opacity-0'}`} aria-live="polite">
                        {isDirty ? 'Unsaved changes' : ''}
                    </span>
                    <div className="flex items-center gap-2">
                        {isDirty && (
                            <Button variant="ghost" onClick={handleDiscard} disabled={saving}>
                                <Undo2 className="w-4 h-4 mr-1" /> Discard
                            </Button>
                        )}
                        <Button onClick={handleSave} disabled={saving || !isDirty}>
                            {saving ? <Spinner size="sm" className="mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                            Save Changes
                        </Button>
                    </div>
                </div>
            </Card>

            {/* Webhooks */}
            <Card className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
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
                        <Field label="Payload URL" required htmlFor="webhook-payload-url">
                            <Input id="webhook-payload-url" type="url" value={hookForm.url}
                                onChange={e => setHookForm(f => ({ ...f, url: e.target.value }))}
                                placeholder="https://example.com/webhook" />
                        </Field>
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

            {/* Collaborators — direct access list (read/write/admin) for this repo */}
            <CollaboratorsSection owner={owner} repo={repo} archived={!!repoData.archived} />

            {/* Danger Zone */}
            <Card className="p-5 border-red-200 dark:border-red-900/50">
                <h3 className="font-semibold text-red-600 dark:text-red-400 flex items-center gap-2 mb-3">
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
                                        toast.success(`Repository is now ${newVisibility ? 'private' : 'public'}`)
                                    } catch (e) {
                                        toast.errorFromException(e, { fallbackTitle: 'Failed to change visibility' })
                                    }
                                }
                            })
                        }}>
                            {repoData.private ? <><Globe className="w-3.5 h-3.5 mr-1" /> Make Public</> : <><Lock className="w-3.5 h-3.5 mr-1" /> Make Private</>}
                        </Button>
                    </div>

                    <div className="flex items-center justify-between p-3 border border-red-200 dark:border-red-900/50 rounded-lg">
                        <div>
                            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{repoData.archived ? 'Unarchive Repository' : 'Archive Repository'}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                {repoData.archived
                                    ? 'Currently archived (read-only). Unarchiving restores write access.'
                                    : 'Archived repos become read-only — no pushes, issues, or actions. Reversible.'}
                            </p>
                        </div>
                        {/* danger-button-allowed: handleArchiveToggle (line ~153) opens setConfirmAction modal — indirect confirm pattern */}
                        <Button variant="danger" size="sm" onClick={handleArchiveToggle}>
                            {repoData.archived
                                ? <><ArchiveRestore className="w-3.5 h-3.5 mr-1" /> Unarchive</>
                                : <><Archive className="w-3.5 h-3.5 mr-1" /> Archive</>}
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

            {/* Topics — manual editor (chips + add input). AI suggestions live in the section below. */}
            <Card className="p-5 space-y-3">
                <h3 className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <Tag className="w-5 h-5 text-indigo-500" /> Topics
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    Lowercase letters, digits, or hyphens. Up to 20 per repository. Saved instantly.
                </p>
                <div className="flex flex-wrap gap-1.5">
                    {(repoData.topics || []).length === 0 && (
                        <span className="text-sm text-slate-400 dark:text-slate-500 italic">No topics yet — add the first one below.</span>
                    )}
                    {(repoData.topics || []).map((topic) => (
                        <span key={topic} className="group inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full text-xs font-medium bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-700/40">
                            {topic}
                            <button
                                type="button"
                                onClick={() => handleRemoveTopic(topic)}
                                disabled={topicsSaving || repoData.archived}
                                className="rounded-full p-0.5 text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200 hover:bg-indigo-100 dark:hover:bg-indigo-800/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                title={`Remove "${topic}"`}
                                aria-label={`Remove topic ${topic}`}
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex-1">
                        <Input
                            type="text"
                            value={newTopicInput}
                            onChange={(e) => setNewTopicInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault()
                                    handleAddTopic()
                                }
                            }}
                            placeholder="add-a-topic"
                            disabled={topicsSaving || repoData.archived}
                            aria-label="Add a topic"
                        />
                    </div>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleAddTopic}
                        disabled={topicsSaving || !newTopicInput.trim() || repoData.archived}
                    >
                        {topicsSaving ? <Spinner size="xs" className="mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
                        Add
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
