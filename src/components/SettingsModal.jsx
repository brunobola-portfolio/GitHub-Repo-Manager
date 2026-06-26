import { useState, useEffect, lazy, Suspense } from 'react'
import { Moon, Sun, Monitor, Zap, Trash2, GitBranch, Key, Shield, BadgeCheck, Sparkles, Kanban, Wand2, Palette, Cloud, ShieldCheck, Wrench } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'
import { useToast } from '../hooks/useToast'
import { API_BASE_URL } from '../config'
// Settings tabs lazy-loaded — opening Settings most often means "General" or
// "API Keys"; the rest (AI Config, Audit Log, License, Work Board) are each
// hefty enough to split into their own chunks.
const ApiKeysSection = lazy(() => import('./Settings/ApiKeysSection').then(m => ({ default: m.ApiKeysSection })))
const AzureCredentialsSection = lazy(() => import('./Settings/AzureCredentialsSection'))
const AzureHostsAllowlistSection = lazy(() => import('./Settings/AzureHostsAllowlistSection'))
const AuditLogSection = lazy(() => import('./Settings/AuditLogSection').then(m => ({ default: m.AuditLogSection })))
const LicensePlanSection = lazy(() => import('./Settings/LicensePlanSection').then(m => ({ default: m.LicensePlanSection })))
const AIConfigSection = lazy(() => import('./Settings/AIConfigSection').then(m => ({ default: m.AIConfigSection })))
const AIInstructionsSection = lazy(() => import('./Settings/AIInstructionsSection').then(m => ({ default: m.AIInstructionsSection })))
const WorkBoardSettingsSection = lazy(() => import('./Settings/WorkBoard/WorkBoardSettingsSection').then(m => ({ default: m.WorkBoardSettingsSection })))
import { DangerZoneSection } from './Settings/DangerZoneSection'
import { Modal, ModalFooter } from './ui/Modal'
import { InsightCard } from './ui/InsightCard'
import { Button } from './ui/Button'
import { Input, Switch } from './ui/form'
import { SectionSpinner } from './ui/Spinner'
const ProbeStatsSection = lazy(() => import('./Settings/ProbeStatsSection').then(m => ({ default: m.ProbeStatsSection })))
const EnvironmentToolingSection = lazy(() => import('./Settings/EnvironmentToolingSection').then(m => ({ default: m.EnvironmentToolingSection })))
import { getCsrfToken } from '../utils/api'

// SettingsIcon defined before TABS so it can be referenced in the array
function SettingsIcon({ className }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    )
}

const TABS = [
    { id: 'general', label: 'General', icon: SettingsIcon },
    { id: 'api-keys', label: 'API Keys', icon: Key },
    { id: 'azure-credentials', label: 'Azure Credentials', icon: Cloud },
    { id: 'ai', label: 'AI Configuration', icon: Sparkles },
    { id: 'ai-instructions', label: 'AI Instructions', icon: Wand2 },
    { id: 'work-board', label: 'Work Board', icon: Kanban },
    { id: 'license', label: 'License & Plan', icon: BadgeCheck },
    { id: 'audit', label: 'Audit Log', icon: Shield },
]

// Admin-only tabs appended when the user has admin powers. Built at render
// time so non-admins never see them in navigation.
const ADMIN_TABS = [
    { id: 'azure-hosts', label: 'Azure Hosts Allowlist', icon: ShieldCheck },
    { id: 'probe-stats', label: 'AI Probes', icon: BadgeCheck },
    { id: 'env-tooling', label: 'Migration Tooling', icon: Wrench },
]

export function SettingsModal({ isOpen, onClose, initialTab, isAdmin = false }) {
    const { theme, setTheme } = useTheme()
    const { toast } = useToast()
    const [activeTab, setActiveTab] = useState('general')

    // Load cache settings from localStorage
    const [cacheSettings, setCacheSettings] = useState(() => {
        try { return JSON.parse(localStorage.getItem('cache-settings')) || { enabled: true, ttl: 5 } } catch { return { enabled: true, ttl: 5 } }
    })

    // Load migration settings from localStorage
    const [migrationSettings, setMigrationSettings] = useState(() => {
        try { return JSON.parse(localStorage.getItem('migration-settings')) || { defaultVisibility: 'private', maxRetries: 3 } } catch { return { defaultVisibility: 'private', maxRetries: 3 } }
    })

    const [clearing, setClearing] = useState(false)
    const [cacheMessage, setCacheMessage] = useState(null)

    // Reset tab when modal opens — honour initialTab if provided
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot tab reset on open, not a cascading render concern
        if (isOpen) setActiveTab(initialTab ?? 'general')
    }, [isOpen, initialTab])

    const handleSave = () => {
        localStorage.setItem('cache-settings', JSON.stringify(cacheSettings))
        localStorage.setItem('migration-settings', JSON.stringify(migrationSettings))
        toast.success('Settings saved')
        onClose()
    }

    const handleClearCache = async () => {
        setClearing(true)
        setCacheMessage(null)
        try {
            const headers = {}
            try { headers['X-CSRF-Token'] = await getCsrfToken() } catch { /* server will 403 */ }
            const response = await fetch(`${API_BASE_URL}/api/stats/clear-cache`, {
                method: 'POST',
                credentials: 'include',
                headers,
            })
            if (response.ok) {
                const data = await response.json()
                setCacheMessage({ type: 'success', text: `Cache cleared! (${data.cleared} entries removed)` })
                toast.success(`Cache cleared — ${data.cleared} entries removed`)
            } else {
                setCacheMessage({ type: 'error', text: 'Failed to clear cache. Please try again.' })
                toast.error('Failed to clear cache')
            }
        } catch {
            setCacheMessage({ type: 'error', text: 'Failed to clear cache. Please try again.' })
            toast.error('Failed to clear cache')
        } finally {
            setClearing(false)
        }
    }

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Settings"
            icon={SettingsIcon}
            size="3xl"
            closeOnBackdrop={false}
            tabs={isAdmin ? [...TABS, ...ADMIN_TABS] : TABS}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            tabsLayoutId="settings-tabs"
            staggerChildren
            mobileVariant="sheet"
            footer={activeTab === 'general' ? (
                <ModalFooter align="right">
                    <Button variant="ghost" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={handleSave}>
                        Save Changes
                    </Button>
                </ModalFooter>
            ) : null}
        >
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
            {activeTab !== 'general' && (
                <Suspense fallback={<SectionSpinner />}>
                    {activeTab === 'api-keys' && <div><ApiKeysSection /></div>}
                    {activeTab === 'azure-credentials' && <div><AzureCredentialsSection /></div>}
                    {activeTab === 'azure-hosts' && <div><AzureHostsAllowlistSection /></div>}
                    {activeTab === 'ai' && (
                        <div>
                            <a
                                href="#/ai/prompts"
                                onClick={(e) => {
                                    e.preventDefault()
                                    onClose()
                                    window.location.hash = '#/ai/prompts'
                                }}
                                className="block rounded-md border border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-600 p-3 mb-3 transition-colors"
                            >
                                <div className="flex items-start gap-2">
                                    <div className="flex-1">
                                        <div className="font-medium text-sm">Prompt Studio</div>
                                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                            Customize how the AI reviewer thinks. Built-in presets (Security, Performance, Accessibility…) plus your own custom prompts at user or repo scope.
                                        </div>
                                    </div>
                                    <span className="text-slate-400">→</span>
                                </div>
                            </a>
                            <AIConfigSection />
                        </div>
                    )}
                    {activeTab === 'ai-instructions' && <div><AIInstructionsSection /></div>}
                    {activeTab === 'work-board' && <div><WorkBoardSettingsSection /></div>}
                    {activeTab === 'license' && <div><LicensePlanSection /></div>}
                    {activeTab === 'audit' && <div><AuditLogSection /></div>}
                    {activeTab === 'probe-stats' && <div><ProbeStatsSection isAdmin={isAdmin} /></div>}
                    {activeTab === 'env-tooling' && <div><EnvironmentToolingSection isAdmin={isAdmin} /></div>}
                </Suspense>
            )}
        </Modal>
    )
}

// ---- General Tab ----

function GeneralTabContent({
    theme, setTheme,
    cacheSettings, setCacheSettings,
    migrationSettings, setMigrationSettings,
    clearing, cacheMessage, onClearCache,
}) {
    // Premium two-column layout: Appearance spans full width because the three
    // theme tiles benefit from the breathing room; the dense config cards
    // (cache + migration) pack side-by-side on md+ so the General tab fits
    // above the fold without scrolling. Danger Zone stays full-width because
    // its CTAs and copy deserve the prominence.
    return (
        <div className="space-y-3">
            <InsightCard tone="default" hover={false}>
                <SectionHeader icon={Palette} iconClassName="text-indigo-500" label="Appearance" />
                <div className="grid grid-cols-3 gap-2.5 mt-3">
                    <ThemeOption value="light" icon={Sun} label="Light" currentTheme={theme} setTheme={setTheme} />
                    <ThemeOption value="dark" icon={Moon} label="Dark" currentTheme={theme} setTheme={setTheme} />
                    <ThemeOption value="system" icon={Monitor} label="System" currentTheme={theme} setTheme={setTheme} />
                </div>
            </InsightCard>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Performance Cache */}
                <InsightCard tone="default" hover={false} className="flex flex-col">
                    <SectionHeader icon={Zap} iconClassName="text-amber-500" label="Performance Cache" />
                    <div className="mt-3 space-y-2.5 flex-1">
                        <div className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                            <span className="text-sm text-slate-600 dark:text-slate-400">Enable stats caching</span>
                            <Switch
                                checked={cacheSettings.enabled}
                                onChange={(v) => setCacheSettings({ ...cacheSettings, enabled: v })}
                                label="Enable stats caching"
                            />
                        </div>

                        {cacheSettings.enabled && (
                            <div className="space-y-1.5 px-0.5">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-slate-600 dark:text-slate-400">Cache duration</span>
                                    <span className="text-sm font-medium text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] tabular-nums">{cacheSettings.ttl} min</span>
                                </div>
                                <input
                                    type="range"
                                    min="1"
                                    max="60"
                                    value={cacheSettings.ttl}
                                    onChange={(e) => setCacheSettings({ ...cacheSettings, ttl: parseInt(e.target.value) })}
                                    aria-label="Cache duration in minutes"
                                    className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                                />
                                <div className="flex justify-between ds-text-meta text-slate-500 dark:text-slate-400">
                                    <span>1 min</span>
                                    <span>60 min</span>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="mt-2.5 space-y-1.5">
                        <Button variant="soft-danger" size="sm" onClick={onClearCache} disabled={clearing} className="w-full">
                            <Trash2 size={14} />
                            {clearing ? 'Clearing…' : 'Clear cache now'}
                        </Button>
                        {cacheMessage ? (
                            <p role="status" className={`ds-text-meta font-medium ${cacheMessage.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                {cacheMessage.text}
                            </p>
                        ) : (
                            <p className="ds-text-meta text-slate-500 dark:text-slate-400">
                                Cached stats improve loading times. Clear if you see stale data.
                            </p>
                        )}
                    </div>
                </InsightCard>

                {/* Migration */}
                <InsightCard tone="default" hover={false} className="flex flex-col">
                    <SectionHeader icon={GitBranch} iconClassName="text-indigo-500" label="Migration" />
                    <div className="mt-3 space-y-2.5">
                        <div className="flex items-center justify-between gap-3 p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                            <span className="text-sm text-slate-600 dark:text-slate-400 min-w-0">Default visibility for imports</span>
                            <div className="flex gap-1 p-0.5 bg-slate-200 dark:bg-slate-700 rounded-lg flex-shrink-0">
                                <VisibilityToggleButton
                                    active={migrationSettings.defaultVisibility === 'public'}
                                    onClick={() => setMigrationSettings({ ...migrationSettings, defaultVisibility: 'public' })}
                                >Public</VisibilityToggleButton>
                                <VisibilityToggleButton
                                    active={migrationSettings.defaultVisibility === 'private'}
                                    onClick={() => setMigrationSettings({ ...migrationSettings, defaultVisibility: 'private' })}
                                >Private</VisibilityToggleButton>
                            </div>
                        </div>

                        <div className="flex items-center justify-between gap-3 p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                            <span className="text-sm text-slate-600 dark:text-slate-400 min-w-0">Max retries for failed tasks</span>
                            <div className="w-16 flex-shrink-0">
                                <Input
                                    type="number"
                                    size="sm"
                                    min="1"
                                    max="5"
                                    value={migrationSettings.maxRetries}
                                    onChange={(e) => {
                                        const val = Math.min(5, Math.max(1, parseInt(e.target.value) || 1))
                                        setMigrationSettings({ ...migrationSettings, maxRetries: val })
                                    }}
                                    aria-label="Max retries for failed tasks"
                                    className="text-center tabular-nums"
                                />
                            </div>
                        </div>
                    </div>
                </InsightCard>
            </div>

            {/* Danger Zone — GDPR Art. 17 + 20 self-service */}
            <DangerZoneSection />
        </div>
    )
}

// Consistent section header used inside General tab cards. Keeps icon size /
// label weight aligned across cards so the eye doesn't have to re-anchor.
function SectionHeader({ icon: Icon, iconClassName = '', label }) {
    return (
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            {Icon && <Icon size={15} className={iconClassName} />}
            <span>{label}</span>
        </div>
    )
}

function VisibilityToggleButton({ active, onClick, children }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                active
                    ? 'bg-white dark:bg-slate-600 text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] shadow-sm'
                    : 'text-slate-500 dark:text-slate-400'
            }`}
        >
            {children}
        </button>
    )
}

// ---- Theme Option Button ----

const ThemeOption = ({ value, icon: IconComp, label, currentTheme, setTheme }) => {
    const active = currentTheme === value
    return (
        <button
            onClick={() => setTheme(value)}
            aria-pressed={active}
            className={`flex flex-col items-center gap-1.5 py-2.5 rounded-lg border transition-all ${active
                ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500 text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] ring-2 ring-indigo-500/20'
                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:border-indigo-300 dark:hover:border-indigo-700 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
        >
            <IconComp size={18} />
            <span className="text-xs font-medium">{label}</span>
        </button>
    )
}
