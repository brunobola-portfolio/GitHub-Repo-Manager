// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react'
import { API_BASE_URL } from '../../config'
import { Tag, Users, Milestone, Check } from 'lucide-react'
import { Card } from '../ui/Card'
import { Spinner } from '../ui/Spinner'
import { useToast } from '../../hooks/useToast'
import { issueLabelChipStyle } from '../../utils/issueLabelColors'
import { formatDate, formatDateTime } from '../../utils/format'
import { apiCall } from '../../utils/api'

/**
 * IssueSidebar — labels, assignees, milestone editor for the right rail of
 * the issue detail panel. Mirrors github.com's "Labels / Assignees / Milestone"
 * sidebar so the in-app flow no longer needs a tab-switch to github.com to
 * organise issues.
 *
 * All mutations route through the cached/invalidating server endpoints so
 * the issue detail re-render reflects the change in <60s without a refresh.
 */
export function IssueSidebar({ owner, repo, issue, api, onMutate }) {
    return (
        <Card className="p-4 space-y-5">
            <LabelEditor owner={owner} repo={repo} issue={issue} api={api} onMutate={onMutate} />
            <AssigneePicker owner={owner} repo={repo} issue={issue} api={api} onMutate={onMutate} />
            <MilestoneInfo issue={issue} />
        </Card>
    )
}

// ──────────────────────────────────────────────────────────────────────────
// Labels
// ──────────────────────────────────────────────────────────────────────────

function LabelEditor({ owner, repo, issue, api, onMutate }) {
    const { toast } = useToast()
    const [open, setOpen] = useState(false)
    const [available, setAvailable] = useState(null) // null = not loaded yet
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const selected = new Set((issue.labels || []).map(l => l.name))

    const loadAvailable = async () => {
        if (available !== null) return
        setLoading(true)
        try {
            // Use existing labels endpoint via direct apiCall since useRepoDetail
            // doesn't expose a fetchLabels method.
            const data = await apiCall(`${API_BASE_URL}/api/v1/repos/${owner}/${repo}/labels`)
            setAvailable(Array.isArray(data) ? data : [])
        } catch {
            setAvailable([])
        } finally {
            setLoading(false)
        }
    }

    const toggle = async (name) => {
        const next = new Set(selected)
        if (next.has(name)) next.delete(name); else next.add(name)
        setSaving(true)
        try {
            await api.setIssueLabels(issue.number, Array.from(next))
            toast.success('Labels updated')
            onMutate?.()
        } catch (e) {
            toast.errorFromException(e, { fallbackTitle: 'Failed to update labels' })
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <h4 className="ds-eyebrow text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <Tag className="w-3 h-3" /> Labels
                </h4>
                <button
                    type="button"
                    onClick={() => { setOpen(v => !v); if (!open) loadAvailable() }}
                    className="text-xs text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] hover:underline"
                >
                    {open ? 'Done' : 'Edit'}
                </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 min-h-[24px]">
                {(issue.labels || []).length === 0 ? (
                    <span className="text-xs text-slate-500 dark:text-slate-400">No labels</span>
                ) : (
                    issue.labels.map(l => (
                        <span
                            key={l.name}
                            className="text-xs px-2 py-0.5 rounded-full font-medium border text-[color:var(--lbl-fg)] dark:text-[color:var(--lbl-fg-dark)]"
                            style={issueLabelChipStyle(l.color)}
                        >
                            {l.name}
                        </span>
                    ))
                )}
            </div>

            {open && (
                <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-2 space-y-1 max-h-[260px] overflow-y-auto">
                    {loading && <div className="flex justify-center py-3"><Spinner size="sm" /></div>}
                    {!loading && available?.length === 0 && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-2">No labels in this repo</p>
                    )}
                    {!loading && available?.map(l => (
                        <button
                            key={l.name}
                            type="button"
                            onClick={() => toggle(l.name)}
                            disabled={saving}
                            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40 text-left transition-colors disabled:opacity-60 ds-focus-ring"
                        >
                            <span
                                className="w-3 h-3 rounded-full flex-shrink-0"
                                style={{ backgroundColor: `#${l.color}` }}
                            />
                            <span className="flex-1 truncate text-slate-700 dark:text-slate-300">{l.name}</span>
                            {selected.has(l.name) && <Check className="w-3 h-3 text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]" />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

// ──────────────────────────────────────────────────────────────────────────
// Assignees
// ──────────────────────────────────────────────────────────────────────────

function AssigneePicker({ owner: _owner, repo: _repo, issue, api, onMutate }) {
    const { toast } = useToast()
    const [open, setOpen] = useState(false)
    const [available, setAvailable] = useState(null)
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const assigned = new Set((issue.assignees || []).map(a => a.login))

    const loadAvailable = async () => {
        if (available !== null) return
        setLoading(true)
        try {
            const data = await api.fetchAssignees()
            setAvailable(Array.isArray(data) ? data : [])
        } catch {
            setAvailable([])
        } finally {
            setLoading(false)
        }
    }

    const toggle = async (login) => {
        setSaving(true)
        try {
            if (assigned.has(login)) {
                await api.removeIssueAssignees(issue.number, [login])
                toast.success(`Unassigned ${login}`)
            } else {
                await api.addIssueAssignees(issue.number, [login])
                toast.success(`Assigned ${login}`)
            }
            onMutate?.()
        } catch (e) {
            toast.errorFromException(e, { fallbackTitle: 'Failed to update assignees' })
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <h4 className="ds-eyebrow text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <Users className="w-3 h-3" /> Assignees
                </h4>
                <button
                    type="button"
                    onClick={() => { setOpen(v => !v); if (!open) loadAvailable() }}
                    className="text-xs text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] hover:underline"
                >
                    {open ? 'Done' : 'Edit'}
                </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 min-h-[24px]">
                {(issue.assignees || []).length === 0 ? (
                    <span className="text-xs text-slate-500 dark:text-slate-400">No assignees</span>
                ) : (
                    issue.assignees.map(a => (
                        <span key={a.login} className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                            {a.avatar_url && (
                                <img src={a.avatar_url} alt="" className="w-3.5 h-3.5 rounded-full" />
                            )}
                            {a.login}
                        </span>
                    ))
                )}
            </div>

            {open && (
                <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-2 space-y-1 max-h-[260px] overflow-y-auto">
                    {loading && <div className="flex justify-center py-3"><Spinner size="sm" /></div>}
                    {!loading && available?.length === 0 && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-2">No collaborators with assign access</p>
                    )}
                    {!loading && available?.map(u => (
                        <button
                            key={u.login}
                            type="button"
                            onClick={() => toggle(u.login)}
                            disabled={saving}
                            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40 text-left transition-colors disabled:opacity-60 ds-focus-ring"
                        >
                            {u.avatar_url && (
                                <img src={u.avatar_url} alt="" className="w-5 h-5 rounded-full flex-shrink-0" />
                            )}
                            <span className="flex-1 truncate text-slate-700 dark:text-slate-300">{u.login}</span>
                            {assigned.has(u.login) && <Check className="w-3 h-3 text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]" />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

// ──────────────────────────────────────────────────────────────────────────
// Milestone (read-only summary — full picker is Phase 4)
// ──────────────────────────────────────────────────────────────────────────

function MilestoneInfo({ issue }) {
    const ms = issue.milestone
    return (
        <div className="space-y-2">
            <h4 className="ds-eyebrow text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Milestone className="w-3 h-3" /> Milestone
            </h4>
            {ms ? (
                <div className="text-xs">
                    <div className="font-medium text-slate-700 dark:text-slate-300">{ms.title}</div>
                    {ms.due_on && (
                        <div className="text-slate-500 mt-0.5">
                            due {formatDate(ms.due_on)}
                        </div>
                    )}
                </div>
            ) : (
                <span className="text-xs text-slate-500 dark:text-slate-400">No milestone</span>
            )}
        </div>
    )
}

// ──────────────────────────────────────────────────────────────────────────
// Timeline (re-exported for IssueDetailPanel)
// ──────────────────────────────────────────────────────────────────────────

const EVENT_LABELS = {
    closed: 'closed',
    reopened: 'reopened',
    labeled: 'added label',
    unlabeled: 'removed label',
    assigned: 'assigned',
    unassigned: 'unassigned',
    milestoned: 'added to milestone',
    demilestoned: 'removed from milestone',
    renamed: 'renamed',
    locked: 'locked',
    unlocked: 'unlocked',
    referenced: 'referenced this',
    cross_referenced: 'mentioned this',
    review_requested: 'requested review',
    merged: 'merged',
}

export function IssueTimeline({ owner: _owner, repo: _repo, number, api }) {
    const [events, setEvents] = useState(null)
    const [loading, setLoading] = useState(false)
    const [open, setOpen] = useState(false)

    const load = async () => {
        if (events !== null) return
        setLoading(true)
        try {
            const data = await api.fetchIssueTimeline(number)
            setEvents(Array.isArray(data) ? data.filter(e => e.event in EVENT_LABELS) : [])
        } catch {
            setEvents([])
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="border-t border-slate-200/60 dark:border-slate-700/40 pt-3 mt-3">
            <button
                type="button"
                onClick={() => { setOpen(v => !v); if (!open) load() }}
                className="text-xs text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] hover:underline"
            >
                {open ? 'Hide' : 'Show'} full history
            </button>

            {open && (
                <div className="mt-3 space-y-2">
                    {loading && <div className="flex justify-center py-3"><Spinner size="sm" tone="muted" /></div>}
                    {!loading && (events?.length === 0
                        ? <p className="text-xs text-slate-500 dark:text-slate-400">No timeline events</p>
                        : events?.map((ev, idx) => (
                            <div key={ev.id || idx} className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
                                <span className="text-slate-400 mt-0.5">·</span>
                                <div className="flex-1">
                                    <span className="font-medium text-slate-600 dark:text-slate-300">{ev.actor?.login || 'someone'}</span>{' '}
                                    {EVENT_LABELS[ev.event]}
                                    {ev.label?.name && <span className="ml-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">{ev.label.name}</span>}
                                    {ev.assignee?.login && <span className="ml-1 font-medium">{ev.assignee.login}</span>}
                                    {ev.created_at && (
                                        <span className="ml-2 text-slate-400">
                                            {formatDateTime(ev.created_at)}
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    )
}
