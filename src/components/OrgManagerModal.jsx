import { useState, useEffect } from 'react'
import {
    Building2, X, Settings, Globe, Lock, Users, GitFork,
    ExternalLink, RefreshCw, Camera, Edit3, Check, AlertTriangle,
    Shield, Mail, MapPin, Link as LinkIcon
} from 'lucide-react'
import { Button } from './ui/Button'
import { useFocusTrap } from '../hooks/useFocusTrap'

export function OrgManagerModal({
    isOpen,
    onClose,
    org,
    onUpdateOrg
}) {
    const modalRef = useFocusTrap(isOpen, onClose)
    const [loading, setLoading] = useState(false)
    const [orgDetails, setOrgDetails] = useState(null)
    const [members, setMembers] = useState([])
    const [editing, setEditing] = useState(false)
    const [editForm, setEditForm] = useState({})
    const [activeTab, setActiveTab] = useState('overview')
    const [error, setError] = useState(null)

    useEffect(() => {
        if (isOpen && org) {
            fetchOrgDetails()
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, org])

    const fetchOrgDetails = async () => {
        setLoading(true)
        setError(null)
        try {
            const [orgRes, membersRes] = await Promise.all([
                fetch(`/api/orgs/${org.login}`, { credentials: 'include' }),
                fetch(`/api/orgs/${org.login}/members`, { credentials: 'include' })
            ])

            if (orgRes.ok) {
                const data = await orgRes.json()
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
                setMembers(Array.isArray(data) ? data : [])
            }
        } catch (e) {
            setError(e?.message || 'Failed to load organization details')
        } finally {
            setLoading(false)
        }
    }

    const handleSave = async () => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch(`/api/orgs/${org.login}`, {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editForm)
            })

            if (res.ok) {
                const updated = await res.json()
                setOrgDetails(updated)
                setEditing(false)
                onUpdateOrg?.(updated)
            }
        } catch (e) {
            setError(e?.message || 'Failed to update organization')
        } finally {
            setLoading(false)
        }
    }

    if (!isOpen) return null

    const displayOrg = orgDetails || org

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="org-manager-title" className="bg-white dark:bg-slate-900 dark:text-slate-100 rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-200 bg-gradient-to-r from-indigo-500 to-purple-600">
                    <div className="flex items-center gap-4">
                        <img
                            src={displayOrg.avatar_url}
                            alt={displayOrg.login}
                            className="w-16 h-16 rounded-xl ring-4 ring-white/30 shadow-lg"
                        />
                        <div className="text-white">
                            <h2 id="org-manager-title" className="text-xl font-bold">{displayOrg.name || displayOrg.login}</h2>
                            <p className="text-white/80 text-sm flex items-center gap-2">
                                <Building2 className="w-4 h-4" />
                                @{displayOrg.login}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={fetchOrgDetails}
                            className="text-white hover:bg-white/20"
                            disabled={loading}
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        </Button>
                        <button
                            onClick={onClose}
                            className="text-white/80 hover:text-white hover:bg-white/20 p-2 rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-slate-200 dark:border-slate-700 px-6 bg-white/80 dark:bg-slate-900/60">
                    {['overview', 'members', 'settings'].map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors capitalize ${activeTab === tab
                                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-300'
                                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                }`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>

                {/* Error Banner */}
                {error && (
                    <div className="mx-6 mt-4 px-4 py-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-xl text-sm text-red-600 dark:text-red-400">
                        {error}
                    </div>
                )}

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {loading && !orgDetails ? (
                        <div className="flex items-center justify-center py-12">
                            <RefreshCw className="w-8 h-8 text-slate-400 animate-spin" />
                        </div>
                    ) : activeTab === 'overview' ? (
                        <OverviewTab
                            org={displayOrg}
                            editing={editing}
                            editForm={editForm}
                            setEditForm={setEditForm}
                            onEdit={() => setEditing(true)}
                            onSave={handleSave}
                            onCancel={() => setEditing(false)}
                            loading={loading}
                        />
                    ) : activeTab === 'members' ? (
                        <MembersTab members={members} orgLogin={displayOrg.login} />
                    ) : (
                        <SettingsTab org={displayOrg} />
                    )}
                </div>
            </div>
        </div>
    )
}

// Overview Tab Component
function OverviewTab({ org, editing, editForm, setEditForm, onEdit, onSave, onCancel, loading }) {
    return (
        <div className="space-y-6">
            {/* Stats Grid */}
            <div className="grid grid-cols-4 gap-4">
                <StatCard icon={Globe} label="Public Repos" value={org.public_repos || 0} color="blue" />
                <StatCard icon={Lock} label="Private Repos" value={org.total_private_repos || 0} color="purple" />
                <StatCard icon={GitFork} label="Forks" value={org.public_repos_forks || org.public_gists || 0} color="green" />
                <StatCard icon={Users} label="Members" value={org.members_count || '—'} color="orange" />
            </div>

            {/* Details */}
            <div className="bg-slate-50 dark:bg-slate-900/40 rounded-lg p-4 space-y-4 border border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100">Organization Details</h3>
                    {!editing ? (
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
                    )}
                </div>

                {editing ? (
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
            </div>

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
                    href={`https://github.com/organizations/${org.login}/settings/profile`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                    <Settings className="w-4 h-4" />
                    GitHub Settings
                </a>
            </div>
        </div>
    )
}

// Members Tab Component
function MembersTab({ members, orgLogin }) {
    if (members.length === 0) {
        return (
            <div className="text-center py-12">
                <Users className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                <p className="text-slate-500 dark:text-slate-400">No members found or not authorized to view</p>
                <a
                    href={`https://github.com/orgs/${orgLogin}/people`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 dark:text-indigo-300 hover:underline text-sm mt-2 inline-block"
                >
                    View members on GitHub
                </a>
            </div>
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
            <div className="p-4 bg-amber-50 dark:bg-amber-900/40 border border-amber-200 dark:border-amber-700 rounded-lg">
                <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
                    <div>
                        <h4 className="font-medium text-amber-800 dark:text-amber-200">Advanced Settings</h4>
                        <p className="text-sm text-amber-700 dark:text-amber-100/80 mt-1">
                            Para configurações avançadas como billing, webhooks, ou danger zone, use as configurações no GitHub.
                        </p>
                    </div>
                </div>
            </div>

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
            <div className="text-2xl font-bold">{value}</div>
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
                <a href={value} target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-300 hover:underline truncate">{value}</a>
            ) : (
                <span className="text-slate-900 dark:text-slate-100 truncate">{value}</span>
            )}
        </div>
    )
}

 
function EditField({ label, value, onChange, icon: IconComp, multiline }) {
    return (
        <div>
            <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{label}</label>
            <div className="relative">
                {IconComp && <IconComp className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />}
                {multiline ? (
                    <textarea
                        value={value}
                        onChange={e => onChange(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        rows={3}
                    />
                ) : (
                    <input
                        type="text"
                        value={value}
                        onChange={e => onChange(e.target.value)}
                        className={`w-full px-3 py-2 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 ${IconComp ? 'pl-10' : ''}`}
                    />
                )}
            </div>
        </div>
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
