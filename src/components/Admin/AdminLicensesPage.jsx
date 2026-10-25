// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 BolaLabs Licensed under the Apache License 2.0.
/**
 * AdminLicensesPage — which machines run each licence, and what to do when a
 * key is shared. Backend: /api/v1/admin/licenses/* (admin only), fed by the
 * daily licence check-in of every self-hosted installation.
 *
 * Two measured answers to a shared key, in increasing weight:
 *   Block    one installation (and the rest of its machine) from renewals.
 *            Its key works until its end date and is never replaced.
 *   Rotate   the key: the customer is emailed a replacement, every other key
 *            of the subscription is revoked, and only the installations kept
 *            here receive the replacement automatically.
 */
import { useState, useEffect, useCallback, useId } from 'react'
import { motion } from 'framer-motion'
import { KeyRound, RefreshCw, ShieldAlert, ChevronDown, Ban, RotateCcw, Undo2 } from 'lucide-react'
import { SectionSpinner } from '../ui/Spinner'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { Modal } from '../ui/Modal'
import { PageHeader } from '../ui/PageHeader'
import { EmptyState } from '../ui/EmptyState'
import { Checkbox, Textarea } from '../ui/form'
import { useToast } from '../../hooks/useToast'
import { listLicenses, listInstalls, blockInstall, unblockInstall, rotateLicense } from '../../api/admin-licenses'
import { DURATION } from '../ui/motion'

const LEVEL = {
    ok: { tone: 'success', label: 'Within plan' },
    over: { tone: 'warning', label: 'Over plan' },
    suspected: { tone: 'danger', label: 'Suspected sharing' },
}

const muted = 'text-slate-500 dark:text-slate-400'

function when(iso) {
    if (!iso) return 'never'
    const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function AdminLicensesPage() {
    const [licenses, setLicenses] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            setLicenses(await listLicenses())
        } catch (err) {
            setError(err)
        } finally {
            setLoading(false)
        }
    }, [])

    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    useEffect(() => { load() }, [load])

    if (error?.status === 403) {
        return (
            <EmptyState
                icon={ShieldAlert}
                title="Admin access required"
                description="Licence installations are visible to instance admins only."
            />
        )
    }

    const suspected = licenses.filter((l) => l.level === 'suspected').length
    const over = licenses.filter((l) => l.level === 'over').length

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: DURATION.standard }}
            className="max-w-6xl mx-auto space-y-6"
        >
            <PageHeader
                eyebrow="Admin"
                icon={KeyRound}
                title="Licences"
                description="Which machines run each licence, from the daily check-in of every self-hosted installation. Over the plan is shown, never refused."
                actions={
                    <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                }
            />

            {!loading && !error && licenses.length > 0 && (
                <p className={`text-sm ${muted}`}>
                    {licenses.length} {licenses.length === 1 ? 'licence' : 'licences'}
                    {suspected > 0 && <> · <span className="font-semibold text-rose-700 dark:text-rose-300">{suspected} suspected sharing</span></>}
                    {over > 0 && <> · <span className="font-semibold text-amber-800 dark:text-amber-300">{over} over plan</span></>}
                </p>
            )}

            {loading && <SectionSpinner padding="py-16" tone="muted" />}

            {!loading && error && (
                <div className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 p-4 text-sm text-rose-700 dark:text-rose-300">
                    Couldn&apos;t load licences: {error.message}
                </div>
            )}

            {!loading && !error && licenses.length === 0 && (
                <EmptyState
                    icon={KeyRound}
                    title="No licences issued yet"
                    description="Keys appear here once Stripe issues one, and installations once they check in."
                />
            )}

            {!loading && !error && licenses.length > 0 && (
                <ul className="space-y-3">
                    {licenses.map((l) => (
                        <LicenseRow key={l.subRef} license={l} onChanged={load} />
                    ))}
                </ul>
            )}
        </motion.div>
    )
}

function LicenseRow({ license, onChanged }) {
    const [open, setOpen] = useState(false)
    const [installs, setInstalls] = useState(null)
    const [action, setAction] = useState(null)
    const { toast } = useToast()
    const level = LEVEL[license.level] ?? LEVEL.ok

    const loadInstalls = useCallback(async () => {
        try {
            setInstalls(await listInstalls(license.subRef))
        } catch (err) {
            toast.errorFromException(err, { fallbackTitle: "Couldn't load installations" })
            setInstalls([])
        }
    }, [license.subRef, toast])

    const toggle = () => {
        const next = !open
        setOpen(next)
        if (next && installs === null) loadInstalls()
    }

    const afterAction = async (message) => {
        toast.success(message)
        setAction(null)
        await loadInstalls()
        onChanged()
    }

    return (
        <li className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <button
                type="button"
                onClick={toggle}
                aria-expanded={open}
                className="w-full text-left p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 rounded-2xl ds-focus-ring"
            >
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900 dark:text-slate-100 break-words">{license.org || license.holder || 'Unnamed licence'}</span>
                        <Badge tone="brand" size="xs">{license.tier ?? 'unknown'}</Badge>
                    </div>
                    <p className={`mt-0.5 text-xs ${muted} break-all`}>
                        {license.holder && license.org ? `${license.holder} · ` : ''}<span className="font-mono">{license.subRef}</span>
                    </p>
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                    <div className="text-sm">
                        <span className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{license.machines} / {license.limit}</span>
                        <span className={`ml-1 ${muted}`}>machines</span>
                    </div>
                    <span className={`text-sm ${muted} tabular-nums`}>{license.networks} {license.networks === 1 ? 'network' : 'networks'}</span>
                    <Badge tone={level.tone} size="sm" dot>{level.label}</Badge>
                    <ChevronDown aria-hidden="true" className={`w-4 h-4 ${muted} transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
                </div>
            </button>

            {open && (
                <div className="border-t border-slate-200 dark:border-slate-700 p-4 sm:p-5 space-y-4">
                    {installs === null ? (
                        <SectionSpinner padding="py-6" tone="muted" />
                    ) : installs.length === 0 ? (
                        <p className={`text-sm ${muted}`}>No installation has checked in with this licence. The hosted app does not check in; only self-hosted installations do.</p>
                    ) : (
                        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                            {installs.map((i) => (
                                <InstallItem key={i.seq} install={i} onBlock={() => setAction({ kind: 'block', install: i })} onUnblock={() => setAction({ kind: 'unblock', install: i })} />
                            ))}
                        </ul>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                        <p className={`text-xs ${muted}`}>Key valid until {when(license.expiresAt)} · last check-in {when(license.lastSeen)}</p>
                        {!license.subRef.startsWith('lid:') && (
                            <Button variant="outline-danger" size="sm" onClick={() => setAction({ kind: 'rotate' })} disabled={installs === null}>
                                <RotateCcw className="w-4 h-4" />
                                Rotate key
                            </Button>
                        )}
                    </div>
                </div>
            )}

            {action?.kind === 'block' || action?.kind === 'unblock' ? (
                <BlockDialog
                    license={license}
                    install={action.install}
                    unblock={action.kind === 'unblock'}
                    onClose={() => setAction(null)}
                    onDone={afterAction}
                />
            ) : null}
            {action?.kind === 'rotate' && (
                <RotateDialog license={license} installs={installs ?? []} onClose={() => setAction(null)} onDone={afterAction} />
            )}
        </li>
    )
}

function InstallItem({ install, onBlock, onUnblock }) {
    const blocked = Boolean(install.blocked_at)
    return (
        <li className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-slate-500 dark:text-slate-400">#{install.seq}</span>
                    <span className="font-medium text-slate-900 dark:text-slate-100 break-all">{install.name || 'Unnamed installation'}</span>
                    {blocked ? (
                        <Badge tone="danger" size="xs">Blocked</Badge>
                    ) : install.active ? (
                        <Badge tone="success" size="xs">Active</Badge>
                    ) : (
                        <Badge tone="neutral" size="xs">Silent 30+ days</Badge>
                    )}
                </div>
                <p className={`mt-0.5 text-xs ${muted} break-words`}>
                    {[install.platform, install.network, install.version && `v${install.version}`, install.machine ? `machine ${install.machine}` : 'no machine id'].filter(Boolean).join(' · ')}
                    {' · '}first seen {when(install.first_seen)}, last {when(install.last_seen)}
                </p>
                {blocked && install.blocked_reason && (
                    <p className="mt-1 text-xs text-rose-700 dark:text-rose-300 break-words">Blocked {when(install.blocked_at)}: {install.blocked_reason}</p>
                )}
            </div>
            {blocked ? (
                <Button variant="ghost" size="sm" onClick={onUnblock}>
                    <Undo2 className="w-4 h-4" />
                    Unblock
                </Button>
            ) : (
                <Button variant="soft-danger" size="sm" onClick={onBlock}>
                    <Ban className="w-4 h-4" />
                    Block renewals
                </Button>
            )}
        </li>
    )
}

function ReasonField({ value, onChange, placeholder }) {
    const id = useId()
    return (
        <div>
            <label htmlFor={id} className="text-sm font-medium text-slate-700 dark:text-slate-200">Reason (kept in the audit log)</label>
            <Textarea id={id} className="mt-1.5" rows={3} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={500} />
        </div>
    )
}

function BlockDialog({ license, install, unblock, onClose, onDone }) {
    const [reason, setReason] = useState('')
    const [busy, setBusy] = useState(false)
    const { toast } = useToast()
    const submit = async () => {
        setBusy(true)
        try {
            const res = unblock
                ? await unblockInstall(license.subRef, install.seq, reason.trim())
                : await blockInstall(license.subRef, install.seq, reason.trim())
            const n = res.blocked ?? res.unblocked ?? 1
            await onDone(unblock
                ? `Installation #${install.seq} can renew again${n > 1 ? ` (with ${n - 1} more on its machine)` : ''}.`
                : `Installation #${install.seq} gets no more renewals${n > 1 ? ` (nor ${n - 1} more on its machine)` : ''}.`)
        } catch (err) {
            toast.errorFromException(err, { fallbackTitle: unblock ? "Couldn't unblock" : "Couldn't block" })
        } finally {
            setBusy(false)
        }
    }
    return (
        <Modal
            isOpen
            onClose={onClose}
            size="md"
            variant={unblock ? 'default' : 'danger'}
            icon={unblock ? Undo2 : Ban}
            title={unblock ? `Unblock installation #${install.seq}` : `Block renewals for installation #${install.seq}`}
            subtitle={install.name || undefined}
            footer={
                <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button variant={unblock ? 'primary' : 'danger'} onClick={submit} disabled={busy || !reason.trim()}>
                        {unblock ? 'Unblock' : 'Block renewals'}
                    </Button>
                </div>
            }
        >
            <div className="space-y-4">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                    {unblock
                        ? 'It receives the newest key again at its next daily check-in.'
                        : 'Its current key keeps working until its end date and is never replaced. Other installations on the same machine are blocked with it, and so is a reinstall there.'}
                </p>
                <ReasonField value={reason} onChange={setReason} placeholder={unblock ? 'Customer confirmed this is their staging server' : 'Key posted on a public forum'} />
            </div>
        </Modal>
    )
}

function RotateDialog({ license, installs, onClose, onDone }) {
    const candidates = installs.filter((i) => i.active && !i.blocked_at)
    const [keep, setKeep] = useState(() => new Set(candidates.map((i) => i.seq)))
    const [reason, setReason] = useState('')
    const [busy, setBusy] = useState(false)
    const { toast } = useToast()
    const flip = (seq, on) => setKeep((prev) => {
        const next = new Set(prev)
        if (on) next.add(seq)
        else next.delete(seq)
        return next
    })
    const submit = async () => {
        setBusy(true)
        try {
            const res = await rotateLicense(license.subRef, [...keep], reason.trim())
            await onDone(`Key rotated: ${res.revoked} revoked, ${res.blocked} installation${res.blocked === 1 ? '' : 's'} blocked. ${res.emailDelivered ? 'The customer was emailed the new key.' : 'The email was not sent; send the key from the issued licences record.'}`)
        } catch (err) {
            toast.errorFromException(err, { fallbackTitle: "Couldn't rotate the key" })
        } finally {
            setBusy(false)
        }
    }
    return (
        <Modal
            isOpen
            onClose={onClose}
            size="lg"
            variant="danger"
            icon={RotateCcw}
            title="Rotate this licence key"
            subtitle={license.org || license.holder || license.subRef}
            footer={
                <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button variant="danger" onClick={submit} disabled={busy || !reason.trim()}>Rotate key</Button>
                </div>
            }
        >
            <div className="space-y-4">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                    A new key with the same holder, plan and end date is emailed to the customer, and every other key of this subscription is revoked. The installations you keep pick the new key up at their next check-in; the rest are blocked from renewals.
                </p>
                {candidates.length > 0 ? (
                    <fieldset className="space-y-2">
                        <legend className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Keep these installations</legend>
                        {candidates.map((i) => (
                            <Checkbox
                                key={i.seq}
                                checked={keep.has(i.seq)}
                                onChange={(e) => flip(i.seq, e.target.checked)}
                                label={`#${i.seq} ${i.name || 'Unnamed installation'}`}
                                description={[i.platform, i.network, i.machine && `machine ${i.machine}`].filter(Boolean).join(' · ')}
                            />
                        ))}
                    </fieldset>
                ) : (
                    <p className={`text-sm ${muted}`}>No active installation to keep; the customer pastes the new key where they need it.</p>
                )}
                <ReasonField value={reason} onChange={setReason} placeholder="Key seen on a paste site" />
            </div>
        </Modal>
    )
}

export default AdminLicensesPage
