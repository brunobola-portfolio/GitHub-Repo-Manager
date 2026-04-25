import { useState, useEffect } from 'react'
import { Moon, Sun, Monitor, Zap, Trash2, GitBranch, Key, Shield, BadgeCheck, Sparkles, Kanban } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'
import { useToast } from '../hooks/useToast'
import { API_BASE_URL } from '../config'
import { ApiKeysSection } from './Settings/ApiKeysSection'
import { AuditLogSection } from './Settings/AuditLogSection'
import { LicensePlanSection } from './Settings/LicensePlanSection'
import { AIConfigSection } from './Settings/AIConfigSection'
import { WorkBoardSettingsSection } from './Settings/WorkBoard/WorkBoardSettingsSection'
import { DangerZoneSection } from './Settings/DangerZoneSection'
import { Modal, ModalFooter } from './ui/Modal'
import { InsightCard } from './ui/InsightCard'
import { Button } from './ui/Button'

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
    { id: 'ai', label: 'AI Configuration', icon: Sparkles },
    { id: 'work-board', label: 'Work Board', icon: Kanban },
    { id: 'license', label: 'License & Plan', icon: BadgeCheck },
    { id: 'audit', label: 'Audit Log', icon: Shield },
]

export function SettingsModal({ isOpen, onClose, initialTab }) {
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
            const response = await fetch(`${API_BASE_URL}/api/stats/clear-cache`, {
                method: 'POST',
                credentials: 'include'
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
            iconGradient="primary"
            size="xl"
            tabs={TABS}
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
            {activeTab === 'api-keys' && <div><ApiKeysSection /></div>}
            {activeTab === 'ai' && <div><AIConfigSection /></div>}
            {activeTab === 'work-board' && <div><WorkBoardSettingsSection /></div>}
            {activeTab === 'license' && <div><LicensePlanSection /></div>}
            {activeTab === 'audit' && <div><AuditLogSection /></div>}
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
    return (
        <div className="space-y-4">
            {/* Appearance */}
            <InsightCard tone="default" hover={false}>
                <div className="space-y-3">
                    {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- visual grouping label, not a form input label */}
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Appearance
                    </label>
                    <div className="grid grid-cols-3 gap-3">
                        <ThemeOption value="light" icon={Sun} label="Light" currentTheme={theme} setTheme={setTheme} />
                        <ThemeOption value="dark" icon={Moon} label="Dark" currentTheme={theme} setTheme={setTheme} />
                        <ThemeOption value="system" icon={Monitor} label="System" currentTheme={theme} setTheme={setTheme} />
                    </div>
                </div>
            </InsightCard>

            {/* Performance Cache */}
            <InsightCard tone="default" hover={false}>
                <div className="space-y-3">
                    {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- visual grouping label, not a form input label */}
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                        <Zap size={16} className="text-amber-500" />
                        Performance Cache
                    </label>

                    {/* Enable/Disable Toggle */}
                    <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                        <span className="text-sm text-slate-600 dark:text-slate-400">Enable stats caching</span>
                        <button
                            role="switch"
                            aria-checked={cacheSettings.enabled}
                            aria-label="Enable stats caching"
                            onClick={() => setCacheSettings({ ...cacheSettings, enabled: !cacheSettings.enabled })}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${cacheSettings.enabled ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${cacheSettings.enabled ? 'translate-x-6' : 'translate-x-1'}`}
                            />
                        </button>
                    </div>

                    {/* TTL Slider */}
                    {cacheSettings.enabled && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-600 dark:text-slate-400">Cache duration</span>
                                <span className="text-sm font-medium text-indigo-600 dark:text-indigo-400">{cacheSettings.ttl} min</span>
                            </div>
                            <input
                                type="range"
                                min="1"
                                max="60"
                                value={cacheSettings.ttl}
                                onChange={(e) => setCacheSettings({ ...cacheSettings, ttl: parseInt(e.target.value) })}
                                aria-label="Cache duration in minutes"
                                className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                            />
                            <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                                <span>1 min</span>
                                <span>60 min</span>
                            </div>
                        </div>
                    )}

                    {/* Clear Cache Button */}
                    <button
                        onClick={onClearCache}
                        disabled={clearing}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Trash2 size={16} />
                        {clearing ? 'Clearing...' : 'Clear Cache Now'}
                    </button>
                    {cacheMessage && (
                        <p role="status" className={`text-xs font-medium ${cacheMessage.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {cacheMessage.text}
                        </p>
                    )}
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        Cached stats improve loading times. Clear if you see stale data.
                    </p>
                </div>
            </InsightCard>

            {/* Migration Settings */}
            <InsightCard tone="default" hover={false}>
                <div className="space-y-3">
                    {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- visual grouping label, not a form input label */}
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                        <GitBranch size={16} className="text-indigo-500" />
                        Migration
                    </label>

                    {/* Default Visibility */}
                    <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                        <span className="text-sm text-slate-600 dark:text-slate-400">Default visibility for imports</span>
                        <div className="flex gap-1 p-0.5 bg-slate-200 dark:bg-slate-700 rounded-lg">
                            <button
                                onClick={() => setMigrationSettings({ ...migrationSettings, defaultVisibility: 'public' })}
                                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                                    migrationSettings.defaultVisibility === 'public'
                                        ? 'bg-white dark:bg-slate-600 text-indigo-600 dark:text-indigo-400 shadow-sm'
                                        : 'text-slate-500 dark:text-slate-400'
                                }`}
                            >
                                Public
                            </button>
                            <button
                                onClick={() => setMigrationSettings({ ...migrationSettings, defaultVisibility: 'private' })}
                                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                                    migrationSettings.defaultVisibility === 'private'
                                        ? 'bg-white dark:bg-slate-600 text-indigo-600 dark:text-indigo-400 shadow-sm'
                                        : 'text-slate-500 dark:text-slate-400'
                                }`}
                            >
                                Private
                            </button>
                        </div>
                    </div>

                    {/* Retry Policy */}
                    <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                        <span className="text-sm text-slate-600 dark:text-slate-400">Max retries for failed tasks</span>
                        <input
                            type="number"
                            min="1"
                            max="5"
                            value={migrationSettings.maxRetries}
                            onChange={(e) => {
                                const val = Math.min(5, Math.max(1, parseInt(e.target.value) || 1))
                                setMigrationSettings({ ...migrationSettings, maxRetries: val })
                            }}
                            aria-label="Max retries for failed tasks"
                            className="w-16 px-2 py-1 text-sm text-center border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                </div>
            </InsightCard>

            {/* Danger Zone — GDPR Art. 17 + 20 self-service */}
            <DangerZoneSection />
        </div>
    )
}

// ---- Theme Option Button ----

const ThemeOption = ({ value, icon: IconComp, label, currentTheme, setTheme }) => (
    <button
        onClick={() => setTheme(value)}
        className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all ${currentTheme === value
            ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500 text-indigo-600 dark:text-indigo-400'
            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:border-indigo-200'
            }`}
    >
        <IconComp size={20} />
        <span className="text-sm font-medium">{label}</span>
    </button>
)
