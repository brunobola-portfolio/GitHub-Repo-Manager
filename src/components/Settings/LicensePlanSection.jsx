import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { CreditCard, Zap, Building2, Star, AlertTriangle, ExternalLink, RefreshCw, ArrowRight, Shield, Key } from 'lucide-react'
import { API_BASE_URL } from '../../config'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'
import { useModal } from '../../hooks/useModal'
import { UsageDashboard } from './UsageDashboard'

const TIER_CONFIG = {
    free: {
        label: 'Free',
        icon: Star,
        iconColor: 'text-slate-500',
        iconBg: 'bg-slate-100 dark:bg-slate-700',
        badgeVariant: 'default',
        gradient: 'from-slate-400 to-slate-600',
    },
    pro: {
        label: 'Pro',
        icon: Zap,
        iconColor: 'text-indigo-500',
        iconBg: 'bg-indigo-500/10',
        badgeVariant: 'info',
        gradient: 'from-indigo-500 to-purple-600',
    },
    enterprise: {
        label: 'Enterprise',
        icon: Building2,
        iconColor: 'text-amber-500',
        iconBg: 'bg-amber-500/10',
        badgeVariant: 'warning',
        gradient: 'from-amber-500 to-orange-600',
    },
}

const STATUS_VARIANT = {
    active: 'success',
    past_due: 'warning',
    cancelled: 'danger',
    trialing: 'info',
}

function formatDate(dateStr) {
    if (!dateStr) return 'N/A'
    return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

function PlanCard({ tier, status, renewalDate, onManage, onChangePlan, portalLoading }) {
    const config = TIER_CONFIG[tier] || TIER_CONFIG.free
    const IconComp = config.icon

    return (
        <Card className="p-6 bg-white/80 dark:bg-slate-800/80">
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-2xl ${config.iconBg} flex items-center justify-center shrink-0`}>
                        <IconComp className={`w-6 h-6 ${config.iconColor}`} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{config.label} Plan</h3>
                            <Badge variant={config.badgeVariant}>{config.label}</Badge>
                            {status && (
                                <Badge variant={STATUS_VARIANT[status] || 'default'}>
                                    {status.replace('_', ' ')}
                                </Badge>
                            )}
                        </div>
                        {renewalDate && (
                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                {status === 'cancelled' ? 'Expires' : 'Renews'} {formatDate(renewalDate)}
                            </p>
                        )}
                    </div>
                </div>

                <div className="flex gap-2 shrink-0">
                    {tier !== 'free' && (
                        <button
                            onClick={onManage}
                            disabled={portalLoading}
                            className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors"
                        >
                            {portalLoading ? (
                                <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                                <ExternalLink className="w-4 h-4" />
                            )}
                            {portalLoading ? 'Opening...' : 'Manage'}
                        </button>
                    )}
                    <button
                        onClick={onChangePlan}
                        className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm shadow-indigo-500/20 transition-all"
                    >
                        <ArrowRight className="w-4 h-4" />
                        Change Plan
                    </button>
                </div>
            </div>

            {status === 'past_due' && (
                <div className="mt-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    Your payment is past due. Please update your billing information to avoid interruption.
                </div>
            )}
        </Card>
    )
}

function UpgradePrompt({ onUpgradePro, onUpgradeEnterprise }) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <motion.div whileHover={{ y: -3 }}>
                <Card className="p-5 hover:border-indigo-300 dark:hover:border-indigo-700 transition-all cursor-pointer h-full" onClick={onUpgradePro}>
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-9 h-9 rounded-xl bg-indigo-500/10 flex items-center justify-center">
                            <Zap className="w-5 h-5 text-indigo-500" />
                        </div>
                        <div>
                            <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Pro</h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400">For teams</p>
                        </div>
                    </div>
                    <ul className="space-y-1.5 mb-4">
                        {['Unlimited repositories', '10,000 AI queries/month', 'Priority support', 'Advanced analytics'].map((feat) => (
                            <li key={feat} className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                                {feat}
                            </li>
                        ))}
                    </ul>
                    <button className="w-full py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors">
                        Upgrade to Pro
                    </button>
                </Card>
            </motion.div>

            <motion.div whileHover={{ y: -3 }}>
                <Card className="p-5 hover:border-amber-300 dark:hover:border-amber-700 transition-all cursor-pointer h-full" onClick={onUpgradeEnterprise}>
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center">
                            <Building2 className="w-5 h-5 text-amber-500" />
                        </div>
                        <div>
                            <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Enterprise</h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400">For organizations</p>
                        </div>
                    </div>
                    <ul className="space-y-1.5 mb-4">
                        {['Everything in Pro', 'Unlimited AI queries', 'SSO / SAML', 'SLA & dedicated support'].map((feat) => (
                            <li key={feat} className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                                {feat}
                            </li>
                        ))}
                    </ul>
                    <button className="w-full py-2 text-sm font-medium text-white bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 rounded-xl transition-all">
                        Contact Sales
                    </button>
                </Card>
            </motion.div>
        </div>
    )
}

function LicenseCard({ license }) {
    const tierConfig = TIER_CONFIG[license.tier] || TIER_CONFIG.free
    const IconComp = tierConfig.icon
    const seatPct = license.seats > 0 ? Math.min(100, Math.round((license.seatsUsed / license.seats) * 100)) : 0

    return (
        <Card className="p-6 bg-white/80 dark:bg-slate-800/80">
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-2xl ${tierConfig.iconBg} flex items-center justify-center shrink-0`}>
                        <IconComp className={`w-6 h-6 ${tierConfig.iconColor}`} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{tierConfig.label} Plan</h3>
                            <Badge variant={tierConfig.badgeVariant}>Licensed</Badge>
                        </div>
                        {license.org && (
                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{license.org}</p>
                        )}
                    </div>
                </div>
                <a
                    href="https://bolalabs.pt/license"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-xl transition-colors shrink-0"
                >
                    <ExternalLink className="w-4 h-4" />
                    Manage License
                </a>
            </div>

            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Seats</p>
                    <p className="text-sm font-semibold text-slate-800 dark:text-white">
                        {license.seatsUsed} of {license.seats} used
                    </p>
                    <div className="mt-2 h-1.5 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all duration-500 ${
                                seatPct > 90 ? 'bg-red-500' : seatPct > 70 ? 'bg-amber-500' : 'bg-emerald-500'
                            }`}
                            style={{ width: `${seatPct}%` }}
                        />
                    </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Expires</p>
                    <p className="text-sm font-semibold text-slate-800 dark:text-white">
                        {formatDate(license.expiresAt)}
                    </p>
                </div>
            </div>
        </Card>
    )
}

export function LicensePlanSection() {
    const [subscription, setSubscription] = useState(null)
    const [license, setLicense] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [billingUnavailable, setBillingUnavailable] = useState(false)
    const [portalLoading, setPortalLoading] = useState(false)
    const [portalError, setPortalError] = useState(null)
    const { openModal } = useModal()

    useEffect(() => {
        const fetchSubscription = async () => {
            setLoading(true)
            setError(null)
            setBillingUnavailable(false)

            // Check license first
            try {
                const licRes = await fetch(`${API_BASE_URL}/api/v1/license`, { credentials: 'include' })
                if (licRes.ok) {
                    const licData = await licRes.json()
                    if (licData.active && licData.source === 'license_key') {
                        setLicense(licData)
                        setLoading(false)
                        return
                    }
                }
            } catch {
                // License endpoint not available, continue with Stripe
            }

            try {
                const res = await fetch(`${API_BASE_URL}/api/v1/billing/subscription`, { credentials: 'include' })
                if (res.status === 503 || res.status === 501) {
                    setBillingUnavailable(true)
                    return
                }
                if (!res.ok) throw new Error('Failed to load subscription')
                const data = await res.json()
                setSubscription(data)
            } catch (err) {
                if (err.message?.toLowerCase().includes('stripe') || err.message?.toLowerCase().includes('not configured')) {
                    setBillingUnavailable(true)
                } else {
                    setError(err.message)
                }
            } finally {
                setLoading(false)
            }
        }
        fetchSubscription()
    }, [])

    const handleManageSubscription = useCallback(async () => {
        setPortalLoading(true)
        setPortalError(null)
        try {
            const res = await fetch(`${API_BASE_URL}/api/v1/billing/portal`, {
                method: 'POST',
                credentials: 'include',
            })
            if (!res.ok) throw new Error('Failed to open billing portal')
            const data = await res.json()
            if (data.url) {
                window.open(data.url, '_blank', 'noopener,noreferrer')
            }
        } catch (err) {
            setPortalError(err.message)
        } finally {
            setPortalLoading(false)
        }
    }, [])

    const handleChangePlan = useCallback(() => {
        window.open('/pricing', '_self')
    }, [])

    const handleUpgradePro = useCallback(() => {
        window.open('/pricing?plan=pro', '_self')
    }, [])

    const handleUpgradeEnterprise = useCallback(() => {
        window.open('/pricing?plan=enterprise', '_self')
    }, [])

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
                    <Shield className="w-5 h-5 text-purple-500" />
                </div>
                <div>
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white">License & Plan</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Manage your license, plan and usage</p>
                </div>
            </div>

            {loading ? (
                <div className="space-y-3">
                    <div className="h-28 bg-slate-100 dark:bg-slate-800 rounded-2xl animate-pulse" />
                    <div className="h-48 bg-slate-100 dark:bg-slate-800 rounded-2xl animate-pulse" />
                </div>
            ) : billingUnavailable ? (
                <Card className="p-8 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4">
                        <CreditCard className="w-6 h-6 text-slate-400" />
                    </div>
                    <h3 className="text-base font-semibold text-slate-700 dark:text-slate-300 mb-1">Billing not available</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
                        Billing features are not configured for this deployment. Contact your administrator for more information.
                    </p>
                </Card>
            ) : error ? (
                <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {error}
                </div>
            ) : license ? (
                <LicenseCard license={license} />
            ) : subscription ? (
                <div className="space-y-5">
                    <PlanCard
                        tier={subscription.tier || subscription.plan || 'free'}
                        status={subscription.status}
                        renewalDate={subscription.renewalDate || subscription.currentPeriodEnd}
                        onManage={handleManageSubscription}
                        onChangePlan={handleChangePlan}
                        portalLoading={portalLoading}
                    />

                    {portalError && (
                        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            {portalError}
                        </div>
                    )}

                    {(subscription.tier === 'free' || subscription.plan === 'free' || !subscription.tier) && (
                        <div className="space-y-3">
                            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Upgrade your plan</h3>
                            <UpgradePrompt onUpgradePro={handleUpgradePro} onUpgradeEnterprise={handleUpgradeEnterprise} />
                        </div>
                    )}
                </div>
            ) : (
                <div className="space-y-4">
                    <Card className="p-5 border-dashed">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                                <Star className="w-5 h-5 text-slate-400" />
                            </div>
                            <div>
                                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Free Plan</h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400">You are currently on the free tier</p>
                            </div>
                        </div>
                    </Card>
                    <UpgradePrompt onUpgradePro={handleUpgradePro} onUpgradeEnterprise={handleUpgradeEnterprise} />
                </div>
            )}

            {/* Activate License Key */}
            <button
                onClick={() => openModal('showLicenseActivation')}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 rounded-xl transition-colors"
            >
                <Key className="w-4 h-4" />
                Activate License Key
            </button>

            {/* Usage Dashboard */}
            <UsageDashboard />
        </div>
    )
}
