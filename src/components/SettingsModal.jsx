import { useState, useEffect } from 'react'
import { X, Moon, Sun, Monitor, Zap, Trash2, GitBranch } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTheme } from '../hooks/useTheme'
import { API_BASE_URL } from '../config'
import { useFocusTrap } from '../hooks/useFocusTrap'

export function SettingsModal({ isOpen, onClose }) {
    const { theme, setTheme } = useTheme()
    const modalRef = useFocusTrap(isOpen, onClose)

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

    const handleSave = () => {
        localStorage.setItem('cache-settings', JSON.stringify(cacheSettings))
        localStorage.setItem('migration-settings', JSON.stringify(migrationSettings))
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
            }
        } catch {
            setCacheMessage({ type: 'error', text: 'Failed to clear cache. Please try again.' })
        } finally {
            setClearing(false)
        }
    }

    // Scroll input into view when keyboard appears (mobile fix)
    useEffect(() => {
        if (!isOpen) return

        const handleFocus = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                setTimeout(() => {
                    e.target.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }, 300) // Delay for keyboard animation
            }
        }

        const modal = modalRef.current
        modal?.addEventListener('focusin', handleFocus)
        return () => modal?.removeEventListener('focusin', handleFocus)
    }, [isOpen, modalRef])

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                    className="fixed inset-0 bg-black/60 dark:bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-4"
                >
                    <motion.div
                        ref={modalRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="settings-modal-title"
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full max-w-md max-h-[85vh] md:max-h-[90vh] bg-white dark:bg-slate-950 rounded-2xl shadow-[0_25px_60px_-12px_rgba(0,0,0,0.35)] dark:shadow-[0_25px_60px_-12px_rgba(0,0,0,0.7)] ring-1 ring-slate-200/50 dark:ring-slate-700/50 overflow-hidden flex flex-col"
                    >
                        <div className="px-4 py-3.5 border-b border-slate-200/50 dark:border-slate-800/40 flex items-center justify-between bg-white/80 dark:bg-slate-900/70 flex-shrink-0">
                            <h2 id="settings-modal-title" className="font-semibold text-base text-slate-900 dark:text-white flex items-center gap-2">
                                <SettingsIcon className="w-5 h-5 text-indigo-500" />
                                Settings
                            </h2>
                            <button
                                onClick={onClose}
                                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                aria-label="Close modal"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-6 space-y-6 flex-1 overflow-y-auto">
                            {/* Theme Selection */}
                            <div className="space-y-3">
                                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                    Appearance
                                </label>
                                <div className="grid grid-cols-3 gap-3">
                                    <ThemeOption value="light" icon={Sun} label="Light" currentTheme={theme} setTheme={setTheme} />
                                    <ThemeOption value="dark" icon={Moon} label="Dark" currentTheme={theme} setTheme={setTheme} />
                                    <ThemeOption value="system" icon={Monitor} label="System" currentTheme={theme} setTheme={setTheme} />
                                </div>
                            </div>

                            {/* Cache Settings */}
                            <div className="space-y-3">
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
                                    onClick={handleClearCache}
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

                            {/* Migration Settings */}
                            <div className="space-y-3">
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
                                        className="w-16 px-2 py-1 text-sm text-center border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-3 min-h-[68px] px-6 bg-white/80 dark:bg-slate-900/70 border-t border-slate-200/50 dark:border-slate-800/40 flex-shrink-0">
                            <button
                                onClick={onClose}
                                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm shadow-indigo-500/20 transition-all"
                            >
                                Save Changes
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}

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
