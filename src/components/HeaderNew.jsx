import { useState, useRef, useEffect } from 'react'
import {
	    Github, LogOut, RefreshCw, FlaskConical, LayoutDashboard, FolderGit2, Plus, Cloud,
	    Bell, Settings, User, ChevronDown, Building2, Shield, ExternalLink, Loader2,
	    CheckCircle2, AlertCircle, Sparkles, Moon, Sun
	} from 'lucide-react'
import { Button } from './ui/Button'
import { useTheme } from '../hooks/useTheme.jsx'

export function HeaderNew({
    user,
    isMockMode,
    onLogin,
    onLogout,
    onCheck,
    onAzureImport,
    onCreateRepo,
    activeView,
    onViewChange,
    onRefreshOrgs,
    orgs = [],
    syncStatus,
    onReauthorize,
    onOpenOrgManager
}) {
    const [showUserMenu, setShowUserMenu] = useState(false)
    const [showNotifications, setShowNotifications] = useState(false)
    const [syncing, setSyncing] = useState(false)
    const menuRef = useRef(null)
    const notifRef = useRef(null)
    const { isDark, toggleTheme } = useTheme()

    // Close menus on outside click
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) setShowUserMenu(false)
            if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifications(false)
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const handleSync = async () => {
        setSyncing(true)
        await onRefreshOrgs?.()
        setSyncing(false)
    }

    return (
        <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-20 transition-colors duration-200">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
                {/* Left: Logo & Title */}
                <div className="flex items-center gap-3">
                    <div className="bg-gradient-to-br from-indigo-600 to-purple-600 p-2 rounded-xl shadow-lg shadow-indigo-200 dark:shadow-indigo-900/50">
                        <Github className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 leading-none flex items-center gap-2">
                            GitHub Repo Manager
                            {isMockMode && (
                                <span className="inline-flex items-center gap-1 bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full text-xs font-medium">
                                    <FlaskConical className="w-3 h-3" />
                                    Demo
                                </span>
                            )}
                        </h1>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Organize & migrate your repositories</p>
                    </div>
                </div>

                {/* Center: Navigation */}
                {user && (
                    <nav className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 bg-slate-100 dark:bg-slate-700 p-1 rounded-xl">
                        <NavButton
                            active={activeView === 'dashboard'}
                            onClick={() => onViewChange?.('dashboard')}
                            icon={LayoutDashboard}
                            label="Dashboard"
                        />
                        <NavButton
                            active={activeView === 'repos'}
                            onClick={() => onViewChange?.('repos')}
                            icon={FolderGit2}
                            label="Repositories"
                        />
                    </nav>
                )}

	                {/* Right: Actions & User */}
	                <div className="flex items-center gap-2">
	                    {user ? (
	                        <>
                            {/* Quick Actions */}
                            <div className="flex items-center gap-1 mr-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={onCreateRepo}
                                    className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
                                >
                                    <Plus className="w-4 h-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={onAzureImport}
                                    className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
                                    title="Import from Azure DevOps"
                                >
                                    <Cloud className="w-4 h-4" />
                                </Button>
                            </div>

	                            {/* Theme Toggle */}
	                            <ThemeToggleButton isDark={isDark} toggleTheme={toggleTheme} />

                            {/* Sync Button */}
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleSync}
                                disabled={syncing}
                                className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
                                title="Sync organizations"
                            >
                                <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                            </Button>

	                            {/* Notifications */}
	                            <div className="relative" ref={notifRef}>
	                                <Button
	                                    variant="ghost"
	                                    size="sm"
	                                    onClick={() => setShowNotifications(!showNotifications)}
	                                    className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 relative"
	                                    aria-label={showNotifications ? 'Hide notifications' : 'Show notifications'}
	                                    aria-expanded={showNotifications}
	                                    aria-haspopup="true"
	                                >
	                                    <Bell className="w-4 h-4" />
	                                    {syncStatus?.hasUpdates && (
	                                        <span className="absolute -top-1 -right-1 w-2 h-2 bg-indigo-500 rounded-full" />
	                                    )}
	                                </Button>

                                {showNotifications && (
                                    <NotificationsDropdown
                                        syncStatus={syncStatus}
                                        orgs={orgs}
                                        onClose={() => setShowNotifications(false)}
                                    />
                                )}
                            </div>

	                            {/* User Menu */}
	                            <div className="relative" ref={menuRef}>
	                                <button
	                                    type="button"
	                                    onClick={() => setShowUserMenu(!showUserMenu)}
	                                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-800"
	                                    aria-label={showUserMenu ? 'Close user menu' : 'Open user menu'}
	                                    aria-haspopup="true"
	                                    aria-expanded={showUserMenu}
	                                >
                                    <img
                                        src={user.avatar_url || 'https://github.com/ghost.png'}
                                        alt={user.login}
                                        className="w-8 h-8 rounded-full ring-2 ring-slate-200 dark:ring-slate-600"
                                    />
                                    <ChevronDown className={`w-4 h-4 text-slate-400 dark:text-slate-500 transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
                                </button>

                                {showUserMenu && (
                                    <UserDropdown
                                        user={user}
                                        orgs={orgs}
                                        onLogout={onLogout}
                                        onReauthorize={onReauthorize}
                                        onOpenOrgManager={onOpenOrgManager}
                                        onClose={() => setShowUserMenu(false)}
                                        isMockMode={isMockMode}
                                    />
                                )}
                            </div>
                        </>
	                    ) : (
	                        <div className="flex gap-2">
	                            {/* Theme Toggle for non-logged in users */}
	                            <ThemeToggleButton isDark={isDark} toggleTheme={toggleTheme} />
	                            <Button
	                                variant="ghost"
	                                size="sm"
	                                onClick={onCheck}
	                                disabled
	                                className="text-slate-400 dark:text-slate-500 cursor-not-allowed"
	                                title="Login with GitHub to check connection status"
	                                aria-disabled="true"
	                            >
	                                <RefreshCw className="w-4 h-4 mr-1" />
	                                Status
	                            </Button>
	                            <Button variant="primary" size="sm" onClick={onLogin}>
	                                <Github className="w-4 h-4 mr-1" />
	                                Login with GitHub
	                            </Button>
	                        </div>
	                    )}
                </div>
            </div>
        </header>
    )
}

function ThemeToggleButton({ isDark, toggleTheme }) {
    const label = isDark ? 'Dark mode' : 'Light mode'

    return (
        <Button
            variant="ghost"
            size="sm"
            onClick={toggleTheme}
            aria-pressed={isDark}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors
                ${isDark
                    ? 'bg-slate-900 text-slate-100 border-slate-600 shadow-inner'
                    : 'bg-slate-100 text-slate-800 border-slate-200'
                }
            `}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
            {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{label}</span>
        </Button>
    )
}

// Navigation Button Component
function NavButton({ active, onClick, icon: Icon, label }) {
    return (
        <button
            onClick={onClick}
	            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-100 dark:focus-visible:ring-offset-slate-700 ${
                active
                    ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
        >
            <Icon className="w-4 h-4" />
            {label}
        </button>
    )
}

// User Dropdown Menu
function UserDropdown({ user, orgs, onLogout, onReauthorize, onOpenOrgManager, onClose, isMockMode }) {
    return (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-slate-800 rounded-xl shadow-xl dark:shadow-slate-900/50 border border-slate-200 dark:border-slate-700 overflow-hidden z-50">
            {/* User Info */}
            <div className="p-4 bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-700 dark:to-slate-800 border-b border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-3">
                    <img
                        src={user.avatar_url || 'https://github.com/ghost.png'}
                        alt={user.login}
                        className="w-12 h-12 rounded-full ring-2 ring-white dark:ring-slate-600 shadow"
                    />
                    <div className="flex-1 min-w-0">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">{user.name || user.login}</div>
                        <div className="text-sm text-slate-500 dark:text-slate-400 truncate">@{user.login}</div>
                    </div>
                </div>
            </div>

            {/* Organizations */}
            <div className="p-2 border-b border-slate-100 dark:border-slate-700">
                <div className="px-2 py-1 text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    Organizations ({orgs.length})
                </div>
                <div className="max-h-32 overflow-y-auto">
                    {orgs.length === 0 ? (
                        <div className="px-2 py-2 text-sm text-slate-500 dark:text-slate-400">No organizations</div>
                    ) : (
                        orgs.map(org => (
                            <button
                                key={org.login}
                                onClick={() => { onOpenOrgManager?.(org); onClose() }}
                                className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-left"
                            >
                                <img src={org.avatar_url} alt={org.login} className="w-6 h-6 rounded-md" />
                                <span className="text-sm text-slate-700 dark:text-slate-300 flex-1 truncate">{org.login}</span>
                                <span className="text-xs text-slate-400 dark:text-slate-500">{org.public_repos || 0}</span>
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* Actions */}
            <div className="p-2">
                <MenuButton icon={User} onClick={() => window.open(`https://github.com/${user.login}`, '_blank')}>
                    View Profile
                </MenuButton>
                <MenuButton icon={Building2} onClick={() => window.open('https://github.com/organizations/plan', '_blank')}>
                    Create Organization
                </MenuButton>
                <MenuButton icon={Shield} onClick={onReauthorize}>
                    Re-authorize Permissions
                </MenuButton>
                <MenuButton icon={Settings} onClick={() => window.open('https://github.com/settings/applications', '_blank')}>
                    OAuth Settings
                </MenuButton>
                <div className="border-t border-slate-100 dark:border-slate-700 mt-2 pt-2">
                    <MenuButton icon={LogOut} onClick={onLogout} danger>
                        Logout
                    </MenuButton>
                </div>
            </div>
        </div>
    )
}

// Menu Button Component
function MenuButton({ icon: Icon, onClick, children, danger }) {
    return (
        <button
            onClick={onClick}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                danger
                    ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
        >
            <Icon className="w-4 h-4" />
            {children}
        </button>
    )
}

// Notifications Dropdown
function NotificationsDropdown({ syncStatus, orgs, onClose }) {
    return (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-slate-800 rounded-xl shadow-xl dark:shadow-slate-900/50 border border-slate-200 dark:border-slate-700 overflow-hidden z-50">
            <div className="p-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">Notifications</h3>
                <span className="text-xs text-slate-400 dark:text-slate-500">Sync Status</span>
            </div>

            <div className="p-3 space-y-2 max-h-64 overflow-y-auto">
                {syncStatus?.lastSync ? (
                    <NotificationItem
                        icon={CheckCircle2}
                        iconColor="text-green-500 dark:text-green-400"
                        title="Organizations synced"
                        desc={`Last sync: ${new Date(syncStatus.lastSync).toLocaleTimeString()}`}
                    />
                ) : (
                    <NotificationItem
                        icon={AlertCircle}
                        iconColor="text-amber-500 dark:text-amber-400"
                        title="Not synced yet"
                        desc="Click refresh to sync organizations"
                    />
                )}

                {orgs.length > 0 && (
                    <NotificationItem
                        icon={Building2}
                        iconColor="text-indigo-500 dark:text-indigo-400"
                        title={`${orgs.length} organization${orgs.length > 1 ? 's' : ''} connected`}
                        desc={orgs.map(o => o.login).join(', ')}
                    />
                )}

                <NotificationItem
                    icon={Sparkles}
                    iconColor="text-purple-500 dark:text-purple-400"
                    title="Tip"
                    desc="Use Re-authorize to grant access to new organizations"
                />
            </div>
        </div>
    )
}

// Notification Item Component
function NotificationItem({ icon: Icon, iconColor, title, desc }) {
    return (
        <div className="flex items-start gap-3 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700">
            <Icon className={`w-5 h-5 ${iconColor} mt-0.5`} />
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{title}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{desc}</div>
            </div>
        </div>
    )
}

