# Settings Modal & User Dropdown Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Settings modal crashes, eliminate dropdown scrollbars, restructure tabs from 5 to 4 by merging Usage+Billing into a new "License & Plan" tab.

**Architecture:** The Settings modal (`SettingsModal.jsx`) uses the base `Modal` component with `staggerChildren`, which propagates framer-motion variant names to child tab components. Tabs that use explicit `initial`/`animate` animations crash because they conflict with the parent stagger context. The fix wraps non-General tabs in plain `<div>` elements to break variant propagation. The tab restructure replaces BillingSection and UsageSection with a single LicensePlanSection that combines license/plan info with usage metrics.

**Tech Stack:** React 19, Vite 7, Tailwind CSS v4, framer-motion, lucide-react

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/components/SettingsModal.jsx` | Modify | Tab definitions (5→4), tab routing, stagger fix wrappers |
| `src/components/Header.jsx` | Modify | Org list max-height + custom-scrollbar class |
| `src/components/Settings/LicensePlanSection.jsx` | Create | Combined license/plan/usage tab (moves sub-components from BillingSection) |
| `src/components/Settings/BillingSection.jsx` | Delete | Replaced by LicensePlanSection |
| `src/components/Settings/UsageSection.jsx` | Delete | Merged into LicensePlanSection |
| `src/components/Settings/UsageDashboard.jsx` | Keep | Reused by LicensePlanSection |

---

### Task 1: Fix animation crash — wrap non-General tabs in plain `<div>`

**Files:**
- Modify: `src/components/SettingsModal.jsx:117-133`

The Modal's `staggerChildren` prop wraps children in a `motion.div` with `initial="hidden" animate="visible"`. This propagates variant names to all descendant `motion.*` elements. Components like `ApiKeysSection` use explicit `initial={{ ... }}` / `animate={{ ... }}` instead of matching variant objects, which crashes framer-motion. A plain `<div>` wrapper breaks the variant propagation chain because framer-motion only propagates through `motion.*` elements.

- [ ] **Step 1: Wrap non-General tab content in plain `<div>` elements**

In `src/components/SettingsModal.jsx`, change the tab content rendering (lines 117-133) from:

```jsx
            {activeTab === 'general' && (
                <GeneralTabContent
                    theme={theme}
                    setTheme={setTheme}
                    cacheSettings={cacheSettings}
                    setCacheSettings={setCacheSettings}
                    migrationSettings={migrationSettings}
                    setMigrationSettings={setMigrationSettings}
                    clearing={clearing}
                    cacheMessage={cacheMessage}
                    onClearCache={handleClearCache}
                />
            )}
            {activeTab === 'api-keys' && <ApiKeysSection />}
            {activeTab === 'usage' && <UsageSection />}
            {activeTab === 'billing' && <BillingSection />}
            {activeTab === 'audit' && <AuditLogSection />}
```

To:

```jsx
            {activeTab === 'general' && (
                <GeneralTabContent
                    theme={theme}
                    setTheme={setTheme}
                    cacheSettings={cacheSettings}
                    setCacheSettings={setCacheSettings}
                    migrationSettings={migrationSettings}
                    setMigrationSettings={setMigrationSettings}
                    clearing={clearing}
                    cacheMessage={cacheMessage}
                    onClearCache={handleClearCache}
                />
            )}
            {activeTab === 'api-keys' && <div><ApiKeysSection /></div>}
            {activeTab === 'usage' && <div><UsageSection /></div>}
            {activeTab === 'billing' && <div><BillingSection /></div>}
            {activeTab === 'audit' && <div><AuditLogSection /></div>}
```

Note: General tab is NOT wrapped — `InsightCard` uses matching `hidden`/`visible` variants and benefits from the stagger effect.

- [ ] **Step 2: Verify fix in browser**

Run: `npm run dev`

Open Settings modal → click through all tabs (General → API Keys → Usage → Billing → Audit Log). Each tab must render without crashing. The General tab should still have a smooth stagger-in animation for each InsightCard section.

- [ ] **Step 3: Commit**

```bash
git add src/components/SettingsModal.jsx
git commit -m "fix(settings): wrap non-General tabs in div to prevent stagger animation crash"
```

---

### Task 2: Eliminate user dropdown scrollbar

**Files:**
- Modify: `src/components/Header.jsx:362`

The org list uses `max-h-48` (192px) which overflows with 5 orgs (~200px). Increase to `max-h-64` (256px) and add the project's `custom-scrollbar` class so that if a user has 7+ orgs, the scrollbar is subtle and only visible on hover.

- [ ] **Step 1: Update org list max-height and add custom-scrollbar**

In `src/components/Header.jsx`, change line 362 from:

```jsx
                <div className="max-h-48 overflow-y-auto">
```

To:

```jsx
                <div className="max-h-64 overflow-y-auto custom-scrollbar">
```

- [ ] **Step 2: Verify in browser**

Open the user dropdown menu. With 5 organizations, no scrollbar should appear. The full list should be visible without scrolling.

- [ ] **Step 3: Commit**

```bash
git add src/components/Header.jsx
git commit -m "fix(header): increase org list height and add custom scrollbar"
```

---

### Task 3: Create LicensePlanSection component

**Files:**
- Create: `src/components/Settings/LicensePlanSection.jsx`
- Reference: `src/components/Settings/BillingSection.jsx` (source for sub-components)
- Reference: `src/components/Settings/UsageDashboard.jsx` (imported as-is)

This new component combines the license/billing hero card, activate license button, and usage dashboard into one cohesive tab. The sub-components `LicenseCard`, `PlanCard`, and `UpgradePrompt` are moved from BillingSection.jsx with no changes. The main `LicensePlanSection` function replaces `BillingSection` with the same data flow but includes `UsageDashboard` inline.

- [ ] **Step 1: Create the LicensePlanSection file**

Create `src/components/Settings/LicensePlanSection.jsx` with the following content. This is the complete file — sub-components are moved verbatim from BillingSection.jsx (lines 10-167, 169-226), and the main section function is adapted from BillingSection (lines 228-409) with UsageDashboard integrated.

```jsx
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
```

- [ ] **Step 2: Verify the file was created correctly**

Run: `ls src/components/Settings/LicensePlanSection.jsx`

Expected: file exists.

- [ ] **Step 3: Commit**

```bash
git add src/components/Settings/LicensePlanSection.jsx
git commit -m "feat(settings): add LicensePlanSection combining license, billing, and usage"
```

---

### Task 4: Restructure SettingsModal tabs from 5 to 4

**Files:**
- Modify: `src/components/SettingsModal.jsx:1-134`

Update the TABS array (remove `usage`, rename `billing` to `license`), swap imports (remove BillingSection/UsageSection, add LicensePlanSection), and update tab routing. This task also applies the `<div>` wrappers from Task 1 to the new tab structure.

- [ ] **Step 1: Update imports**

In `src/components/SettingsModal.jsx`, change the imports (lines 1-10) from:

```jsx
import { useState, useEffect } from 'react'
import { Moon, Sun, Monitor, Zap, Trash2, GitBranch, Key, Shield, CreditCard, BarChart3 } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'
import { API_BASE_URL } from '../config'
import { ApiKeysSection } from './Settings/ApiKeysSection'
import { AuditLogSection } from './Settings/AuditLogSection'
import { BillingSection } from './Settings/BillingSection'
import { UsageSection } from './Settings/UsageSection'
import { Modal, ModalFooter } from './ui/Modal'
import { InsightCard } from './ui/InsightCard'
```

To:

```jsx
import { useState, useEffect } from 'react'
import { Moon, Sun, Monitor, Zap, Trash2, GitBranch, Key, Shield, BadgeCheck } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'
import { API_BASE_URL } from '../config'
import { ApiKeysSection } from './Settings/ApiKeysSection'
import { AuditLogSection } from './Settings/AuditLogSection'
import { LicensePlanSection } from './Settings/LicensePlanSection'
import { Modal, ModalFooter } from './ui/Modal'
import { InsightCard } from './ui/InsightCard'
```

Changes: removed `CreditCard` and `BarChart3` from lucide imports, removed `BillingSection` and `UsageSection` imports, added `LicensePlanSection` import.

- [ ] **Step 2: Update TABS array**

Change the TABS array (lines 31-37) from:

```jsx
const TABS = [
    { id: 'general', label: 'General', icon: SettingsIcon },
    { id: 'api-keys', label: 'API Keys', icon: Key },
    { id: 'usage', label: 'Usage', icon: BarChart3 },
    { id: 'billing', label: 'Billing', icon: CreditCard },
    { id: 'audit', label: 'Audit Log', icon: Shield },
]
```

To:

```jsx
const TABS = [
    { id: 'general', label: 'General', icon: SettingsIcon },
    { id: 'api-keys', label: 'API Keys', icon: Key },
    { id: 'license', label: 'License & Plan', icon: BadgeCheck },
    { id: 'audit', label: 'Audit Log', icon: Shield },
]
```

`BadgeCheck` conveys license verification; `Shield` stays on Audit Log (unchanged from current code). `BadgeCheck` must be added to the lucide-react import in Step 1.

- [ ] **Step 3: Update tab content routing**

Change the tab content rendering (lines 117-133, which now has the `<div>` wrappers from Task 1) from:

```jsx
            {activeTab === 'general' && (
                <GeneralTabContent
                    theme={theme}
                    setTheme={setTheme}
                    cacheSettings={cacheSettings}
                    setCacheSettings={setCacheSettings}
                    migrationSettings={migrationSettings}
                    setMigrationSettings={setMigrationSettings}
                    clearing={clearing}
                    cacheMessage={cacheMessage}
                    onClearCache={handleClearCache}
                />
            )}
            {activeTab === 'api-keys' && <div><ApiKeysSection /></div>}
            {activeTab === 'usage' && <div><UsageSection /></div>}
            {activeTab === 'billing' && <div><BillingSection /></div>}
            {activeTab === 'audit' && <div><AuditLogSection /></div>}
```

To:

```jsx
            {activeTab === 'general' && (
                <GeneralTabContent
                    theme={theme}
                    setTheme={setTheme}
                    cacheSettings={cacheSettings}
                    setCacheSettings={setCacheSettings}
                    migrationSettings={migrationSettings}
                    setMigrationSettings={setMigrationSettings}
                    clearing={clearing}
                    cacheMessage={cacheMessage}
                    onClearCache={handleClearCache}
                />
            )}
            {activeTab === 'api-keys' && <div><ApiKeysSection /></div>}
            {activeTab === 'license' && <div><LicensePlanSection /></div>}
            {activeTab === 'audit' && <div><AuditLogSection /></div>}
```

- [ ] **Step 4: Verify in browser**

Run: `npm run dev`

Open Settings modal. Verify:
1. Only 4 tabs show: General, API Keys, License & Plan, Audit Log
2. General tab still has stagger animation on InsightCards
3. API Keys tab renders without crashing
4. License & Plan tab shows the license hero card (or free plan), activate key button, and usage dashboard
5. Audit Log tab renders without crashing

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsModal.jsx
git commit -m "feat(settings): restructure tabs from 5 to 4, replace Billing+Usage with License & Plan"
```

---

### Task 5: Delete replaced files

**Files:**
- Delete: `src/components/Settings/BillingSection.jsx`
- Delete: `src/components/Settings/UsageSection.jsx`

These files are fully replaced by LicensePlanSection.jsx. No other file imports them.

- [ ] **Step 1: Verify no other imports exist**

Search for `BillingSection` and `UsageSection` across all `.jsx` and `.js` files in `src/`.

Expected: zero matches — we already removed those imports from SettingsModal.jsx in Task 4. If any other file imports them, update that file first before deleting.

- [ ] **Step 2: Delete the files**

```bash
rm -f src/components/Settings/BillingSection.jsx src/components/Settings/UsageSection.jsx
```

- [ ] **Step 3: Verify the app still builds**

Run: `npm run build`

Expected: build completes with no import errors.

- [ ] **Step 4: Commit**

```bash
git add -u src/components/Settings/BillingSection.jsx src/components/Settings/UsageSection.jsx
git commit -m "chore(settings): remove BillingSection and UsageSection replaced by LicensePlanSection"
```

---

### Task 6: Final browser verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Full walkthrough**

Open the app in a browser and verify each item:

1. **User dropdown:** Click the avatar in the header. All 5 organizations visible without scrollbar. Scrollbar only appears if window height is very small.
2. **Settings → General tab:** Opens by default. Three InsightCard sections (Appearance, Performance Cache, Migration) stagger in smoothly. Save/Cancel buttons in footer.
3. **Settings → API Keys tab:** Click tab. Renders without crash. Shows "Create New Key" button and empty state or key list.
4. **Settings → License & Plan tab:** Click tab. Renders without crash. Shows the license/plan hero card, "Activate License Key" button, and Usage Dashboard below.
5. **Settings → Audit Log tab:** Click tab. Renders without crash. Shows filter controls and table (or empty state).
6. **Tab switching:** Click rapidly between all 4 tabs. No crashes, no console errors. Animations are smooth.
7. **No scrollbar on modal:** With normal content, the modal body should not show a scrollbar. Only long content (e.g. many API keys) should trigger the subtle custom-scrollbar.

- [ ] **Step 3: Check console for errors**

Open browser DevTools → Console. Switch between all tabs. Expected: zero errors, zero warnings related to framer-motion or animation conflicts.
