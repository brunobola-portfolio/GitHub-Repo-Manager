import { useEffect, useState } from 'react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'
import { ConfirmModal } from '../ui/ConfirmModal'
import { Shield, ShieldOff, Save, Undo2, Sparkles, ExternalLink } from 'lucide-react'
import { useToast } from '../../hooks/useToast'

const FIELD_CLASSES = 'w-24 px-3 py-2 rounded-lg bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50'

// Reasonable defaults applied when the user enables protection from scratch.
// Mirrors what GitHub.com offers as "recommended" toggles when you click
// "Add classic branch protection rule" with no prior config.
const DEFAULT_RULES = {
    requirePR: true,
    requiredApprovingReviewCount: 1,
    dismissStaleReviews: false,
    requireCodeOwnerReviews: false,
    requireConversationResolution: true,
    allowForcePushes: false,
    allowDeletions: false,
}

function rulesFromProtection(p) {
    if (!p || p.protected === false) return null
    return {
        requirePR: !!p.required_pull_request_reviews,
        requiredApprovingReviewCount: p.required_pull_request_reviews?.required_approving_review_count ?? 1,
        dismissStaleReviews: !!p.required_pull_request_reviews?.dismiss_stale_reviews,
        requireCodeOwnerReviews: !!p.required_pull_request_reviews?.require_code_owner_reviews,
        requireConversationResolution: !!p.required_conversation_resolution?.enabled
            // Some shapes return the bool directly; tolerate both.
            || p.required_conversation_resolution === true,
        allowForcePushes: !!p.allow_force_pushes?.enabled || p.allow_force_pushes === true,
        allowDeletions: !!p.allow_deletions?.enabled || p.allow_deletions === true,
    }
}

function rulesToPayload(r) {
    return {
        required_status_checks: null,
        enforce_admins: null,
        required_pull_request_reviews: r.requirePR ? {
            required_approving_review_count: r.requiredApprovingReviewCount,
            dismiss_stale_reviews: r.dismissStaleReviews,
            require_code_owner_reviews: r.requireCodeOwnerReviews,
        } : null,
        restrictions: null,
        required_conversation_resolution: r.requireConversationResolution,
        allow_force_pushes: r.allowForcePushes,
        allow_deletions: r.allowDeletions,
    }
}

function rulesEqual(a, b) {
    if (!a || !b) return a === b
    return Object.keys(a).every((k) => a[k] === b[k])
}

export function BranchProtectionPanel({ api, branch, archived, variant = 'card' }) {
    const { toast } = useToast()
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [removing, setRemoving] = useState(false)
    const [rules, setRules] = useState(null) // editable rules; null = unprotected
    const [savedRules, setSavedRules] = useState(null) // last persisted snapshot
    const [confirmRemove, setConfirmRemove] = useState(false)
    // Set when the server signals the repo is on a free plan + private
    // (branch protection is gated behind GitHub Pro). Renders an inline
    // upgrade affordance instead of a generic error toast — the previous
    // UX flagged this expected limitation as a transient failure.
    const [upgradeRequired, setUpgradeRequired] = useState(false)
    // Set when the user is a collaborator without admin on the repo.
    // GitHub returns 403 and the backend forwards { code: 'INSUFFICIENT_PERMISSIONS' }.
    // Renders a quiet "admin access required" affordance instead of a
    // generic error toast for what is an expected, structural state.
    const [permissionDenied, setPermissionDenied] = useState(false)

    const load = async () => {
        if (!branch) return
        setLoading(true)
        setUpgradeRequired(false)
        setPermissionDenied(false)
        try {
            const data = await api.fetchBranchProtection(branch)
            const initial = rulesFromProtection(data)
            setRules(initial)
            setSavedRules(initial)
        } catch (err) {
            if (err?.code === 'GITHUB_PRO_REQUIRED') {
                setUpgradeRequired(true)
                return
            }
            // Quiet branch for non-admin collaborators. Heuristic
            // (status === 403 && !code) protects us if a stale backend
            // serves the 403 without the structured code yet.
            if (err?.code === 'INSUFFICIENT_PERMISSIONS' || (err?.status === 403 && !err?.code)) {
                setPermissionDenied(true)
                return
            }
            toast.errorFromException(err, { fallbackTitle: 'Failed to load branch protection' })
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- branch-change fetch
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branch])

    const isProtected = !!savedRules
    const isDirty = !rulesEqual(rules, savedRules)

    const handleEnable = () => {
        setRules({ ...DEFAULT_RULES })
    }

    const handleSave = async () => {
        if (!rules) return
        setSaving(true)
        try {
            await api.updateBranchProtection(branch, rulesToPayload(rules))
            setSavedRules(rules)
            toast.success(`Protection updated for "${branch}"`)
            // Refresh raw protection so the form reflects whatever shape GitHub
            // canonicalized the rules into.
            load()
        } catch (err) {
            toast.errorFromException(err, { fallbackTitle: 'Failed to update protection' })
        } finally {
            setSaving(false)
        }
    }

    const handleRemove = async () => {
        setRemoving(true)
        try {
            await api.deleteBranchProtection(branch)
            setRules(null)
            setSavedRules(null)
            toast.success(`Protection removed from "${branch}"`)
        } catch (err) {
            toast.errorFromException(err, { fallbackTitle: 'Failed to remove protection' })
        } finally {
            setRemoving(false)
            setConfirmRemove(false)
        }
    }

    if (!branch) return null

    // Inline variant: compact status chip for per-branch rows
    if (variant === 'inline') {
        if (loading) return <span className="text-xs text-slate-400">Checking protection…</span>
        if (upgradeRequired) {
            return (
                <a href="https://github.com/pricing" target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/50 hover:underline">
                    ⚠ Pro to protect
                </a>
            )
        }
        if (permissionDenied) {
            return (
                <span
                    title="You need admin access on this repository to view or change branch protection rules."
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700/40">
                    🔒 admin only
                </span>
            )
        }
        if (!savedRules) {
            return <span className="inline-flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500">unprotected</span>
        }
        return <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">protected</span>
    }

    return (
        <Card className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                        <Shield className="w-5 h-5 text-indigo-500" /> Protection — <span className="font-mono text-sm">{branch}</span>
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Classic branch protection on the default branch. Requires admin access on the repo.
                    </p>
                </div>
                {isProtected && !loading && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmRemove(true)}
                        disabled={archived || removing}
                        className="text-red-500 hover:text-red-600"
                    >
                        <ShieldOff className="w-4 h-4 mr-1" /> Remove
                    </Button>
                )}
            </div>

            {loading ? (
                <div className="py-6 flex justify-center"><Spinner /></div>
            ) : upgradeRequired ? (
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-5 text-center">
                    <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 shadow-sm mb-3">
                        <Sparkles className="w-5 h-5 text-white" />
                    </div>
                    <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                        Branch protection requires GitHub Pro
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 max-w-md mx-auto">
                        On the free plan, branch protection rules are only available on public repositories. Upgrade to GitHub Pro, or make this repo public, to enable protection.
                    </p>
                    <a
                        href="https://github.com/pricing"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 mt-4 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                        See GitHub plans <ExternalLink className="w-3 h-3" />
                    </a>
                </div>
            ) : permissionDenied ? (
                <div className="rounded-lg border border-slate-200 dark:border-slate-700/60 bg-slate-50/60 dark:bg-slate-800/30 p-5 text-center">
                    <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 mb-3">
                        <Shield className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                    </div>
                    <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                        Admin access required
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 max-w-md mx-auto">
                        You&apos;re a collaborator on this repository but don&apos;t have admin access. Branch protection rules can only be viewed and edited by admins.
                    </p>
                </div>
            ) : !rules ? (
                <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-4 text-center">
                    <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
                        This branch is not protected. Anyone with push access can force-push or delete it.
                    </p>
                    <Button onClick={handleEnable} disabled={archived}>
                        <Shield className="w-4 h-4 mr-1" /> Enable protection
                    </Button>
                </div>
            ) : (
                <>
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={rules.requirePR}
                            onChange={(e) => setRules(r => ({ ...r, requirePR: e.target.checked }))}
                            disabled={archived || saving}
                            className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500/40" />
                        <span className="text-sm text-slate-700 dark:text-slate-300">Require pull request reviews before merging</span>
                    </label>

                    {rules.requirePR && (
                        <div className="ml-6 space-y-2 pl-3 border-l-2 border-slate-200 dark:border-slate-700">
                            <div className="flex items-center gap-3">
                                <label htmlFor="bp-min-reviews" className="text-sm text-slate-600 dark:text-slate-400">Required approvals</label>
                                <input
                                    id="bp-min-reviews"
                                    type="number"
                                    min={0}
                                    max={6}
                                    value={rules.requiredApprovingReviewCount}
                                    onChange={(e) => setRules(r => ({ ...r, requiredApprovingReviewCount: Math.max(0, Math.min(6, Number(e.target.value) || 0)) }))}
                                    disabled={archived || saving}
                                    className={FIELD_CLASSES} />
                            </div>
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={rules.dismissStaleReviews}
                                    onChange={(e) => setRules(r => ({ ...r, dismissStaleReviews: e.target.checked }))}
                                    disabled={archived || saving}
                                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500/40" />
                                <span className="text-sm text-slate-600 dark:text-slate-400">Dismiss stale reviews when new commits are pushed</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={rules.requireCodeOwnerReviews}
                                    onChange={(e) => setRules(r => ({ ...r, requireCodeOwnerReviews: e.target.checked }))}
                                    disabled={archived || saving}
                                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500/40" />
                                <span className="text-sm text-slate-600 dark:text-slate-400">Require review from CODEOWNERS</span>
                            </label>
                        </div>
                    )}

                    <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={rules.requireConversationResolution}
                            onChange={(e) => setRules(r => ({ ...r, requireConversationResolution: e.target.checked }))}
                            disabled={archived || saving}
                            className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500/40" />
                        <span className="text-sm text-slate-700 dark:text-slate-300">Require conversation resolution before merging</span>
                    </label>

                    <div className="pt-2 border-t border-slate-200/60 dark:border-slate-700/50 space-y-2">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={rules.allowForcePushes}
                                onChange={(e) => setRules(r => ({ ...r, allowForcePushes: e.target.checked }))}
                                disabled={archived || saving}
                                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-amber-600 focus:ring-amber-500/40" />
                            <span className="text-sm text-amber-700 dark:text-amber-400">Allow force pushes</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={rules.allowDeletions}
                                onChange={(e) => setRules(r => ({ ...r, allowDeletions: e.target.checked }))}
                                disabled={archived || saving}
                                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-amber-600 focus:ring-amber-500/40" />
                            <span className="text-sm text-amber-700 dark:text-amber-400">Allow branch deletion</span>
                        </label>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                        <span className={`text-xs transition-opacity ${isDirty ? 'opacity-100 text-amber-600 dark:text-amber-400' : 'opacity-0'}`} aria-live="polite">
                            {isDirty ? 'Unsaved changes' : ''}
                        </span>
                        <div className="flex items-center gap-2">
                            {isDirty && (
                                <Button variant="ghost" onClick={() => setRules(savedRules)} disabled={saving}>
                                    <Undo2 className="w-4 h-4 mr-1" /> Discard
                                </Button>
                            )}
                            <Button onClick={handleSave} disabled={saving || !isDirty || archived}>
                                {saving ? <Spinner size="sm" className="mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                                Save protection
                            </Button>
                        </div>
                    </div>
                </>
            )}

            <ConfirmModal
                isOpen={confirmRemove}
                onClose={() => setConfirmRemove(false)}
                onConfirm={handleRemove}
                title="Remove branch protection"
                message={`Remove all protection rules from "${branch}"? Anyone with push access will be able to force-push or delete the branch.`}
                confirmText="Remove protection"
                variant="danger"
            />
        </Card>
    )
}
