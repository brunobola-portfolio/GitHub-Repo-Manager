import { useState, useEffect } from 'react'
import {
    Building2, Settings, Globe, Lock, Users, GitFork,
    ExternalLink, RefreshCw, Edit3, Check, AlertTriangle,
    Shield, Mail, MapPin, Link as LinkIcon, User, Info
} from 'lucide-react'
import { Button } from './ui/Button'
import { Modal, ModalFooter } from './ui/Modal'
import { InsightCard } from './ui/InsightCard'
import { EmptyState } from './ui/EmptyState'
import { isAbort } from '../utils/errorClassification'
import { Spinner } from './ui/Spinner'
import { Field, Input, Textarea } from './ui/form'
import { useToast } from '../hooks/useToast'
import { getCsrfToken } from '../utils/api'

const ORG_TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'members', label: 'Members' },
    { id: 'settings', label: 'Settings' },
]

const PERSONAL_TABS = [
    { id: 'overview', label: 'Overview' },
]

export function OrgManagerModal({
    isOpen,
    onClose,
    org,
    onUpdateOrg
}) {
    const { toast } = useToast()
    const [loading, setLoading] = useState(false)
    const [orgDetails, setOrgDetails] = useState(null)
    const [members, setMembers] = useState([])
    const [editing, setEditing] = useState(false)
    const [editForm, setEditForm] = useState({})
    const [activeTab, setActiveTab] = useState('overview')
    const [error, setError] = useState(null)

    const isPersonal = !!org?.isPersonal
    const tabs = isPersonal ? PERSONAL_TABS : ORG_TABS

    useEffect(() => {
        if (!isOpen || !org) return
        // eslint-disable-next-line react-hooks/set-state-in-effect -- normalise activeTab to a valid tab for personal accounts
        if (activeTab !== 'overview' && isPersonal) setActiveTab('overview')
        if (isPersonal) return
        const ctrl = new AbortController()
        // eslint-disable-next-line react-hooks/immutability -- function reference is stable across renders
        fetchOrgDetails(ctrl.signal)
        return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, org?.login, isPersonal])

    const fetchOrgDetails = async (signal) => {
        if (isPersonal) return
        setLoading(true)
        setError(null)
        try {
            const [orgRes, membersRes] = await Promise.all([
                fetch(`/api/orgs/${org.login}`, { credentials: 'include', signal }),
                fetch(`/api/orgs/${org.login}/members`, { credentials: 'include', signal })
            ])
            if (signal?.aborted) return

            if (orgRes.ok) {
                const data = await orgRes.json()
                if (signal?.aborted) return
                setOrgDetails(data)
                setEditForm({
                    name: data.name || '',
                    description: data.description || '',
                    email: data.email || '',
                    location: data.location || '',
                    blog: data.blog || ''
                })
            }

            if (membersRes.ok) {
                const data = await membersRes.json()
                if (signal?.aborted) return
                setMembers(Array.isArray(data) ? data : [])
            }
        } catch (e) {
            if (isAbort(e, signal)) return
            setError(e?.message || 'Failed to load organization details')
        } finally {
            if (!signal?.aborted) setLoading(false)
        }
    }

    const handleSave = async () => {
        setLoading(true)
        setError(null)
        try {
            const headers = { 'Content-Type': 'application/json' }
            try { headers['X-CSRF-Token'] = await getCsrfToken() } catch { /* server will 403 */ }
            const res = await fetch(`/api/orgs/${org.login}`, {
                method: 'PATCH',
                credentials: 'include',
                headers,
                body: JSON.stringify(editForm)
            })

            if (res.ok) {
                const updated = await res.json()
                setOrgDetails(updated)
                setEditing(false)
                onUpdateOrg?.(updated)
                toast.success('Organization settings saved')
            } else {
                const body = await res.json().catch(() => ({}))
                const msg = body?.error || body?.message || 'Failed to update organization'
                setError(msg)
                toast.error(msg)
            }
        } catch (e) {
            setError(e?.message || 'Failed to update organization')
            toast.error(`Failed to update organization — ${e?.message || 'try again'}`)
        } finally {
            setLoading(false)
        }
    }

    const displayOrg = orgDetails || org

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={isPersonal ? 'Personal Account' : 'Organization Manager'}
            subtitle={org?.login ? `@${org.login}` : undefined}
            icon={isPersonal ? User : Building2}
            size="3xl"
            closeOnBackdrop={false}
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            tabsLayoutId="org-manager-tabs"
            staggerChildren
            mobileVariant="sheet"
            footer={
                <ModalFooter align="right">
                    <Button variant="ghost" onClick={onClose}>
                        Close
                    </Button>
                </ModalFooter>
            }
        >
            {/* Error Banner */}
            {error && (
                <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl text-sm text-red-600 dark:text-red-400">
                    {error}
                </div>
            )}

            {loading && !orgDetails ? (
                <div className="flex items-center justify-center py-12">
                    <Spinner size="xl" tone="muted" label="Loading organization" />
                </div>
            ) : activeTab === 'overview' ? (
                <OverviewTab
                    org={displayOrg}
                    isPersonal={isPersonal}
                    editing={editing}
                    editForm={editForm}
                    setEditForm={setEditForm}
                    onEdit={() => setEditing(true)}
                    onSave={handleSave}
                    onCancel={() => setEditing(false)}
                    loading={loading}
                    onRefresh={() => fetchOrgDetails()}
                />
            ) : activeTab === 'members' ? (
                <MembersTab members={members} orgLogin={displayOrg.login} />
            ) : (
                <SettingsTab org={displayOrg} />
            )}
        </Modal>
    )
}

// Overview Tab Component
function OverviewTab({ org, isPersonal, editing, editForm, setEditForm, onEdit, onSave, onCancel, loading, onRefresh }) {
    const githubSettingsUrl = isPersonal
        ? 'https://github.com/settings/profile'
        : `https://github.com/organizations/${org.login}/settings/profile`

    return (
        <div className="space-y-6">
            {/* Header: avatar, name, type badge, refresh */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <img
                        src={org.avatar_url}
                        alt={org.login}
                        className="w-12 h-12 rounded-xl ring-2 ring-slate-200 dark:ring-slate-700 shadow"
                    />
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">{org.name || org.login}</span>
                            <AccountTypeBadge isPersonal={isPersonal} />
                        </div>
                        <div className="text-sm text-slate-500 dark:text-slate-400">@{org.login}</div>
                    </div>
                </div>
                {!isPersonal && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onRefresh}
                        disabled={loading}
                        aria-label="Refresh organization details"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </Button>
                )}
            </div>

            {/* Capabilities info panel — explicit about what's possible */}
            <CapabilitiesCard isPersonal={isPersonal} />

            {/* Stats Grid — Members stat is org-only */}
            <div className={`grid gap-4 ${isPersonal ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2 md:grid-cols-4'}`}>
                <StatCard icon={Globe} label="Public Repos" value={org.public_repos || 0} color="blue" />
                <StatCard icon={Lock} label="Private Repos" value={org.total_private_repos || 0} color="purple" />
                <StatCard icon={GitFork} label="Forks" value={org.public_repos_forks || org.public_gists || 0} color="green" />
                {!isPersonal && (
                    <StatCard icon={Users} label="Members" value={org.members_count || '—'} color="orange" />
                )}
            </div>

            {/* Details */}
            <InsightCard tone="default">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                        {isPersonal ? 'Account Details' : 'Organization Details'}
                    </h3>
                    {!isPersonal && (!editing ? (
                        <Button variant="ghost" size="sm" onClick={onEdit}>
                            <Edit3 className="w-4 h-4 mr-1" /> Edit
                        </Button>
                    ) : (
                        <div className="flex gap-2">
                            <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
                            <Button variant="primary" size="sm" onClick={onSave} disabled={loading}>
                                <Check className="w-4 h-4 mr-1" /> Save
                            </Button>
                        </div>
                    ))}
                </div>

                {!isPersonal && editing ? (
                    <div className="grid gap-4">
                        <EditField label="Name" value={editForm.name} onChange={v => setEditForm(f => ({ ...f, name: v }))} />
                        <EditField label="Description" value={editForm.description} onChange={v => setEditForm(f => ({ ...f, description: v }))} multiline />
                        <EditField label="Email" value={editForm.email} onChange={v => setEditForm(f => ({ ...f, email: v }))} icon={Mail} />
                        <EditField label="Location" value={editForm.location} onChange={v => setEditForm(f => ({ ...f, location: v }))} icon={MapPin} />
                        <EditField label="Website" value={editForm.blog} onChange={v => setEditForm(f => ({ ...f, blog: v }))} icon={LinkIcon} />
                    </div>
                ) : (
                    <div className="grid gap-3 text-sm">
                        <DetailRow label="Description" value={org.description} />
                        <DetailRow label="Email" value={org.email} icon={Mail} />
                        <DetailRow label="Location" value={org.location} icon={MapPin} />
                        <DetailRow label="Website" value={org.blog} icon={LinkIcon} isLink />
                        <DetailRow label="Created" value={org.created_at ? new Date(org.created_at).toLocaleDateString() : null} />
                    </div>
                )}
            </InsightCard>

            {/* Quick Actions */}
            <div className="flex gap-2">
                <a
                    href={org.html_url || `https://github.com/${org.login}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors"
                >
                    <ExternalLink className="w-4 h-4" />
                    View on GitHub
                </a>
                <a
                    href={githubSettingsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                    <Settings className="w-4 h-4" />
                    {isPersonal ? 'Profile Settings' : 'GitHub Settings'}
                </a>
            </div>
        </div>
    )
}

function AccountTypeBadge({ isPersonal }) {
    if (isPersonal) {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 ds-text-meta font-medium rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200 ring-1 ring-inset ring-indigo-200/60 dark:ring-indigo-800/60">
                <User className="w-3 h-3" /> Personal
            </span>
        )
    }
    return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 ds-text-meta font-medium rounded-full bg-purple-50 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200 ring-1 ring-inset ring-purple-200/60 dark:ring-purple-800/60">
            <Building2 className="w-3 h-3" /> Organization
        </span>
    )
}

function CapabilitiesCard({ isPersonal }) {
    const available = isPersonal
        ? ['Browse public & private repos', 'Create new repositories', 'View on GitHub']
        : ['Browse org repos', 'View members', 'Edit org profile (name, description, email, location, website)', 'Open org Settings / Security on GitHub']
    const unavailable = isPersonal
        ? ['Members list (only for organizations)', 'Org Settings / Member Privileges', 'Edit profile in-app — use GitHub profile settings']
        : []
    return (
        <InsightCard tone={isPersonal ? 'info' : 'default'} hover={false}>
            <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-[color:var(--ds-accent-brand)] dark:text-indigo-300 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-slate-900 dark:text-slate-100">
                        {isPersonal ? 'This is your personal account' : 'Organization workspace'}
                    </h4>
                    <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                        {isPersonal
                            ? 'Personal accounts don\'t expose the GitHub organization APIs, so members and org settings are not available here.'
                            : 'You can manage org profile, members, and open GitHub for advanced settings.'}
                    </p>
                    <div className="mt-3 grid sm:grid-cols-2 gap-3 text-sm">
                        <div>
                            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Available</div>
                            <ul className="space-y-1">
                                {available.map(item => (
                                    <li key={item} className="flex items-start gap-1.5 text-slate-700 dark:text-slate-200">
                                        <Check className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                                        <span>{item}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        {unavailable.length > 0 && (
                            <div>
                                <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">Not available</div>
                                <ul className="space-y-1">
                                    {unavailable.map(item => (
                                        <li key={item} className="flex items-start gap-1.5 text-slate-500 dark:text-slate-400">
                                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                                            <span>{item}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </InsightCard>
    )
}

// Members Tab Component
function MembersTab({ members, orgLogin }) {
    if (members.length === 0) {
        return (
            <EmptyState
                icon={Users}
                title="No members visible"
                description="Either this org has no members or your token isn't authorized to read the member list."
                action={{
                    label: 'View members on GitHub',
                    href: `https://github.com/orgs/${orgLogin}/people`,
                }}
            />
        )
    }

    return (
        <div className="space-y-3">
            {members.map(member => (
                <div key={member.id} className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-900/40 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                    <img src={member.avatar_url} alt={member.login} className="w-10 h-10 rounded-full" />
                    <div className="flex-1">
                        <div className="font-medium text-slate-900 dark:text-slate-100">{member.login}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 capitalize">{member.role || 'member'}</div>
                    </div>
                    <a
                        href={member.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open ${member.login}'s GitHub profile in new tab`}
                        title={`Open ${member.login}'s GitHub profile`}
                        className="text-slate-400 dark:text-slate-300 hover:text-slate-600 dark:hover:text-slate-100"
                    >
                        <ExternalLink className="w-4 h-4" />
                    </a>
                </div>
            ))}
        </div>
    )
}

// Settings Tab Component
function SettingsTab({ org }) {
    return (
        <div className="space-y-4">
            <InsightCard tone="warning" hover={false}>
                <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                    <div>
                        <h4 className="font-medium text-amber-800 dark:text-amber-200">Advanced Settings</h4>
                        <p className="text-sm text-amber-700 dark:text-amber-100/80 mt-1">
                            For advanced settings like billing, webhooks, or danger zone, use the settings on GitHub.
                        </p>
                    </div>
                </div>
            </InsightCard>

            <div className="grid gap-3">
                <SettingsLink
                    href={`https://github.com/organizations/${org.login}/settings/profile`}
                    icon={Building2}
                    title="Profile Settings"
                    desc="Logo, name, description"
                />
                <SettingsLink
                    href={`https://github.com/organizations/${org.login}/settings/member_privileges`}
                    icon={Users}
                    title="Member Privileges"
                    desc="Repository permissions"
                />
                <SettingsLink
                    href={`https://github.com/organizations/${org.login}/settings/security`}
                    icon={Shield}
                    title="Security"
                    desc="2FA, SSO settings"
                />
            </div>
        </div>
    )
}

// Helper Components
function StatCard({ icon: IconComp, label, value, color }) {
    const colors = {
        blue: 'bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-200',
        purple: 'bg-purple-50 text-purple-600 dark:bg-purple-900/40 dark:text-purple-200',
        green: 'bg-green-50 text-green-600 dark:bg-green-900/40 dark:text-green-200',
        orange: 'bg-orange-50 text-orange-600 dark:bg-orange-900/40 dark:text-orange-200'
    }
    return (
        <div className={`p-4 rounded-lg ${colors[color]} text-center`}>
            <IconComp className="w-5 h-5 mx-auto mb-1 opacity-70" />
            <div className="text-lg font-semibold tabular-nums">{value}</div>
            <div className="text-xs opacity-70">{label}</div>
        </div>
    )
}

function DetailRow({ label, value, icon: IconComp, isLink }) {
    if (!value) return null
    return (
        <div className="flex items-center gap-2">
            {IconComp && <IconComp className="w-4 h-4 text-slate-400 dark:text-slate-500" />}
            <span className="text-slate-500 dark:text-slate-400 w-24">{label}:</span>
            {isLink ? (
                <a href={value} target="_blank" rel="noopener noreferrer" className="text-[color:var(--ds-accent-brand)] dark:text-indigo-300 hover:underline truncate">{value}</a>
            ) : (
                <span className="text-slate-900 dark:text-slate-100 truncate">{value}</span>
            )}
        </div>
    )
}

function EditField({ label, value, onChange, icon: IconComp, multiline }) {
    const fieldId = `orgmgr-field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    return (
        <Field label={label} htmlFor={fieldId}>
            {multiline ? (
                <Textarea
                    id={fieldId}
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    rows={3}
                />
            ) : (
                <Input
                    id={fieldId}
                    type="text"
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    leadingIcon={IconComp}
                />
            )}
        </Field>
    )
}

function SettingsLink({ href, icon: IconComp, title, desc }) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-4 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
        >
            <IconComp className="w-5 h-5 text-slate-400 dark:text-slate-500" />
            <div className="flex-1">
                <div className="font-medium text-slate-900 dark:text-slate-100">{title}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{desc}</div>
            </div>
            <ExternalLink className="w-4 h-4 text-slate-400 dark:text-slate-500" />
        </a>
    )
}
