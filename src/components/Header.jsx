
import { useState, useRef, useEffect } from 'react'
import {
    Github, LogOut, RefreshCw, FlaskConical, LayoutDashboard, FolderGit2, Plus, Cloud,
    Bell, Settings, User, ChevronDown, Building2, Shield, Users,
    CheckCircle2, AlertCircle, Sparkles, Moon, Sun, Wand2, Download, History, Menu
} from 'lucide-react'
import { Button } from './ui/Button'
import { useTheme } from '../hooks/useTheme.jsx'

export function Header({
    user,
    isMockMode,
    onLogin,
    onLogout,
    onCheck,
    onCreateRepo,
    activeView,
    onViewChange,
    onRefreshOrgs,
    orgs = [],
    syncStatus,
    onReauthorize,
    onOpenOrgManager,
    onOpenCommitGen,
    onOpenSettings,
    onImport,
    onMigrationHistory,
    onToggleOrgDrawer
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
        try {
            await onRefreshOrgs?.()
        } finally {
            setSyncing(false)
        }
    }

    return (
        <>
        <header className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl border-b border-slate-200/60 dark:border-slate-700/50 sticky top-0 z-20 transition-all duration-300 shadow-sm dark:shadow-black/20 safe-area-top">
            <div className="max-w-screen-2xl mx-auto px-5 sm:px-8 lg:px-12 xl:px-16 2xl:px-20 h-14 flex items-center gap-3 safe-area-left safe-area-right">
                {/* Left: Logo & Title */}
                <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-shrink-0">
                    {user && (
                      <button
                        onClick={onToggleOrgDrawer}
                        className="md:hidden p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
                        aria-label="Open organizations"
                      >
                        <Menu className="w-5 h-5 text-slate-600 dark:text-slate-300" />
                      </button>
                    )}
                    <div className="bg-gradient-to-br from-indigo-600 to-purple-600 p-2 sm:p-2.5 rounded-xl shadow-lg shadow-indigo-500/25 dark:shadow-indigo-500/30 ds-btn-shimmer flex-shrink-0">
                        <Github className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-base sm:text-xl font-bold text-slate-900 dark:text-slate-100 leading-none flex items-center gap-2 ds-font-display truncate">
                            <span className="hidden xs:inline">GitHub </span>Repo Manager
                            {isMockMode && (
                                <span className="inline-flex items-center gap-1 bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0">
                                    <FlaskConical className="w-3 h-3" />
                                    Demo
                                </span>
                            )}
                        </h1>
                        <p className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block">Organize & migrate your repositories</p>
                    </div>
                </div>

                {/* Center: Navigation (desktop) - flex-based centering */}
                <div className="flex-1 flex justify-center min-w-0">
                    {user && (
                        <nav className="hidden md:flex items-center gap-1 bg-slate-100/80 dark:bg-slate-700/60 p-1 rounded-xl backdrop-blur-sm border border-slate-200/50 dark:border-slate-600/30 flex-shrink-0">
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
                            <NavButton
                                active={activeView === 'teams'}
                                onClick={() => onViewChange?.('teams')}
                                icon={Users}
                                label="Teams"
                            />
                        </nav>
                    )}
                </div>

                {/* Right: Actions & User */}
                <div className="flex items-center gap-2 flex-shrink-0">
                    {user ? (
                        <>
                            {/* Quick Actions */}
                            <div className="hidden sm:flex items-center gap-1 mr-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={onCreateRepo}
                                    className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
                                    aria-label="Create new repository"
                                >
                                    <Plus className="w-4 h-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={onImport}
                                    className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
                                    title="Import Repository"
                                    aria-label="Import Repository"
                                >
                                    <Download className="w-4 h-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={onOpenCommitGen}
                                    className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
                                    title="AI Commit Generator"
                                    aria-label="AI Commit Generator"
                                >
                                    <Wand2 className="w-4 h-4" />
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
                                aria-label="Sync organizations"
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
                                        onOpenSettings={onOpenSettings}
                                        onMigrationHistory={onMigrationHistory}
                                        onClose={() => setShowUserMenu(false)}
                                    />
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                            {/* Theme Toggle for non-logged in users */}
                            <ThemeToggleButton isDark={isDark} toggleTheme={toggleTheme} />
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onCheck}
                                disabled
                                className="text-slate-400 dark:text-slate-500 cursor-not-allowed hidden sm:inline-flex"
                                title="Login with GitHub to check connection status"
                                aria-disabled="true"
                            >
                                <RefreshCw className="w-4 h-4 mr-1" />
                                Status
                            </Button>
                            <Button variant="primary" size="sm" onClick={onLogin}>
                                <Github className="w-4 h-4 sm:mr-1" />
                                <span className="hidden sm:inline">Login with GitHub</span>
                                <span className="sm:hidden">Login</span>
                            </Button>
                        </div>
                    )}
                </div>
            </div>

        </header>

        {user && (
          <nav
            className="fixed bottom-0 left-0 right-0 z-40 md:hidden backdrop-blur-xl bg-white/80 dark:bg-slate-900/80 border-t border-slate-200/60 dark:border-slate-700/50"
            role="navigation"
            aria-label="Main navigation"
            style={{ paddingBottom: 'var(--safe-area-inset-bottom, 0px)' }}
          >
            <div className="flex items-center justify-around h-14 px-4">
              {[
                { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
                { id: 'repos', icon: FolderGit2, label: 'Repos' },
                { id: 'teams', icon: Users, label: 'Teams' },
                { id: 'ai', icon: Sparkles, label: 'AI' },
              ].map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  onClick={() => onViewChange?.(id === 'ai' ? 'repos' : id)}
                  className={`flex flex-col items-center justify-center gap-0.5 min-w-[44px] min-h-[44px] rounded-xl transition-colors ${
                    activeView === id
                      ? 'text-indigo-600 dark:text-indigo-400'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                  aria-current={activeView === id ? 'page' : undefined}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-[10px] font-medium leading-none">{label}</span>
                </button>
              ))}
            </div>
          </nav>
        )}
        </>
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
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2.5 sm:px-2.5 sm:py-1 text-xs font-medium transition-colors min-h-[44px] min-w-[44px] justify-center
                ${isDark
                    ? 'bg-slate-900 text-slate-100 border-slate-600'
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
function NavButton({ active, onClick, icon, label }) {
    const IconComponent = icon
    return (
        <button
            type="button"
            onClick={onClick}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-100 dark:focus-visible:ring-offset-slate-700 ds-font-display ${active
                ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-slate-100 shadow-md shadow-slate-200/60 dark:shadow-black/30'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-white/50 dark:hover:bg-slate-600/40'
                } `}
        >
            {IconComponent && <IconComponent className="w-4 h-4" />}
            {label}
        </button>
    )
}

// User Dropdown Menu
function UserDropdown({ user, orgs, onLogout, onReauthorize, onOpenOrgManager, onOpenSettings, onMigrationHistory, onClose }) {
    return (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white/95 dark:bg-slate-800/95 backdrop-blur-xl rounded-2xl shadow-2xl dark:shadow-black/50 border border-slate-200/60 dark:border-slate-700/50 overflow-hidden z-40 ds-animate-scale-in">
            {/* User Info */}
            <div className="p-4 bg-gradient-to-r from-indigo-50/50 to-purple-50/50 dark:from-slate-700/50 dark:to-slate-800/50 border-b border-slate-200/60 dark:border-slate-700/50">
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
                <div className="max-h-48 overflow-y-auto">
                    {orgs.length === 0 ? (
                        <div className="px-2 py-2 text-sm text-slate-500 dark:text-slate-400">No organizations</div>
                    ) : (
                        orgs.map(org => (
                            <button
                                type="button"
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
                </MenuButton >
                <MenuButton icon={Building2} onClick={() => window.open('https://github.com/organizations/plan', '_blank')}>
                    Create Organization
                </MenuButton>
                <MenuButton icon={Shield} onClick={onReauthorize}>
                    Re-authorize Permissions
                </MenuButton>
                <MenuButton icon={Settings} onClick={() => { onOpenSettings?.(); onClose() }}>
                    Settings
                </MenuButton>
                <MenuButton icon={History} onClick={() => { onMigrationHistory?.(); onClose() }}>
                    Migration History
                </MenuButton>
                <div className="border-t border-slate-100 dark:border-slate-700 mt-2 pt-2">
                    <MenuButton icon={LogOut} onClick={onLogout} danger>
                        Logout
                    </MenuButton>
                </div>
            </div >
        </div >
    )
}

// Menu Button Component
function MenuButton({ icon, onClick, children, danger }) {
    const IconComponent = icon
    return (
        <button
            type="button"
            onClick={onClick}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${danger
                ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
        >
            {IconComponent && <IconComponent className="w-4 h-4" />}
            {children}
        </button>
    )
}

// Notifications Dropdown
function NotificationsDropdown({ syncStatus, orgs }) {
    return (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white/95 dark:bg-slate-800/95 backdrop-blur-xl rounded-2xl shadow-2xl dark:shadow-black/50 border border-slate-200/60 dark:border-slate-700/50 overflow-hidden z-40 ds-animate-scale-in">
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
function NotificationItem({ icon, iconColor, title, desc }) {
    const IconComponent = icon
    return (
        <div className="flex items-start gap-3 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700">
            {IconComponent && <IconComponent className={`w-5 h-5 ${iconColor} mt-0.5`} />}
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{title}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{desc}</div>
            </div>
        </div>
    )
}

