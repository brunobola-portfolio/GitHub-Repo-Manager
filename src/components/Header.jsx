
import { useState, useRef, useEffect } from 'react'
import {
    Github, LogOut, RefreshCw, FlaskConical, LayoutDashboard, FolderGit2, Plus,
    Bell, Settings, User, ChevronDown, Building2, Shield, Users,
    CheckCircle2, AlertCircle, Sparkles, Moon, Sun, Wand2, Download, History, Menu, CreditCard
} from 'lucide-react'
import { AppLogoIcon } from './AppLogo'
import { useTheme } from '../hooks/useTheme.jsx'

export function Header({
    user,
    isMockMode,
    onLogin,
    onLogout,
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
            <div className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 h-14 sm:h-16 flex items-center gap-3">
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
                    <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-950 p-[4px] pr-3 rounded-[13px] border border-slate-200/50 dark:border-slate-700/50 flex-shrink-0">
                        <div className="bg-gradient-to-br from-indigo-600 to-purple-600 w-[34px] h-[34px] rounded-[9px] flex items-center justify-center shadow-md shadow-indigo-500/20 dark:shadow-indigo-500/25 ds-btn-shimmer flex-shrink-0 text-white">
                            <AppLogoIcon className="w-[18px] h-[18px]" />
                        </div>
                        <div className="min-w-0 hidden sm:block">
                            <h1 className="text-[13px] font-bold text-slate-900 dark:text-slate-100 leading-none ds-font-display truncate">
                                Repo Manager
                                {isMockMode && (
                                    <span className="inline-flex items-center gap-0.5 bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full text-[9px] font-semibold ml-1.5 flex-shrink-0 uppercase tracking-wider">
                                        <FlaskConical className="w-2.5 h-2.5" />
                                        Demo
                                    </span>
                                )}
                            </h1>
                            <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-none mt-0.5">Organize & migrate</p>
                        </div>
                    </div>
                </div>

                {/* Center: Navigation (desktop) */}
                <div className="flex-1 flex justify-center min-w-0">
                    {user && (
                        <nav className="hidden md:flex items-center gap-1 bg-slate-100 dark:bg-slate-950 p-[4px] rounded-[13px] border border-slate-200/50 dark:border-slate-700/50 flex-shrink-0">
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
                            <NavButton
                                active={activeView === 'pricing'}
                                onClick={() => onViewChange?.('pricing')}
                                icon={CreditCard}
                                label="Pricing"
                            />
                        </nav>
                    )}
                </div>

                {/* Right: Actions & User */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                    {user ? (
                        <>
                            {/* Quick Actions Container */}
                            <div className="hidden sm:flex items-center gap-1 bg-slate-100 dark:bg-slate-950 p-[4px] rounded-[13px] border border-slate-200/50 dark:border-slate-700/50">
                                <HeaderIconButton onClick={onCreateRepo} label="Create new repository" title="New repo">
                                    <Plus className="w-[15px] h-[15px]" />
                                </HeaderIconButton>
                                <HeaderIconButton onClick={onImport} label="Import Repository" title="Import">
                                    <Download className="w-[15px] h-[15px]" />
                                </HeaderIconButton>
                                <HeaderIconButton onClick={onOpenCommitGen} label="AI Commit Generator" title="AI Commit">
                                    <Wand2 className="w-[15px] h-[15px]" />
                                </HeaderIconButton>
                            </div>

                            {/* Utility Container */}
                            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-950 p-[4px] rounded-[13px] border border-slate-200/50 dark:border-slate-700/50">
                                {/* Theme Toggle */}
                                <ThemeToggleButton isDark={isDark} toggleTheme={toggleTheme} />

                                {/* Sync */}
                                <HeaderIconButton onClick={handleSync} label="Sync organizations" disabled={syncing}>
                                    <RefreshCw className={`w-[15px] h-[15px] ${syncing ? 'animate-spin' : ''}`} />
                                </HeaderIconButton>

                                {/* Notifications */}
                                <div className="relative" ref={notifRef}>
                                    <HeaderIconButton
                                        onClick={() => setShowNotifications(!showNotifications)}
                                        label={showNotifications ? 'Hide notifications' : 'Show notifications'}
                                        aria-expanded={showNotifications}
                                        aria-haspopup="true"
                                        active={showNotifications}
                                    >
                                        <Bell className="w-[15px] h-[15px]" />
                                        {syncStatus?.hasUpdates && (
                                            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-indigo-500 rounded-full ring-2 ring-slate-100 dark:ring-slate-950" />
                                        )}
                                    </HeaderIconButton>

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
                                        className={`flex items-center gap-1 h-[34px] px-1.5 rounded-[9px] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                                            showUserMenu
                                                ? 'bg-white dark:bg-slate-600 shadow-sm'
                                                : 'hover:bg-white/80 dark:hover:bg-slate-700'
                                        }`}
                                        aria-label={showUserMenu ? 'Close user menu' : 'Open user menu'}
                                        aria-haspopup="true"
                                        aria-expanded={showUserMenu}
                                    >
                                        <img
                                            src={user.avatar_url || 'https://github.com/ghost.png'}
                                            alt={user.login}
                                            className="w-[26px] h-[26px] rounded-full ring-2 ring-slate-200/80 dark:ring-slate-500/50"
                                        />
                                        <ChevronDown className={`w-3 h-3 text-slate-400 dark:text-slate-500 transition-transform duration-200 ${showUserMenu ? 'rotate-180' : ''}`} />
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
                            </div>
                        </>
                    ) : (
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                            {/* Theme + Login unified container */}
                            <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-950 p-[4px] rounded-[13px] border border-slate-200/50 dark:border-slate-700/50">
                                <ThemeToggleButton isDark={isDark} toggleTheme={toggleTheme} />
                                <button
                                    type="button"
                                    onClick={onLogin}
                                    className="flex items-center gap-1.5 h-[34px] px-3 sm:px-3.5 rounded-[9px]
                                        bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500
                                        text-white text-[13px] font-semibold
                                        shadow-sm shadow-indigo-500/25
                                        hover:shadow-md hover:shadow-indigo-500/30
                                        active:scale-[0.97] transition-all duration-200
                                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
                                        ds-btn-shimmer"
                                >
                                    <Github className="w-[15px] h-[15px]" />
                                    <span className="hidden sm:inline">Login with GitHub</span>
                                    <span className="sm:hidden">Login</span>
                                </button>
                            </div>
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
                { id: 'pricing', icon: CreditCard, label: 'Pricing' },
              ].map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  onClick={() => onViewChange?.(id)}
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
    return (
        <button
            type="button"
            onClick={toggleTheme}
            aria-pressed={isDark}
            className={`relative flex items-center gap-1.5 rounded-[9px] transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 h-[34px] px-2.5 ${
                isDark
                    ? 'bg-slate-600/80 text-amber-300 hover:bg-slate-500/80 hover:text-amber-200'
                    : 'bg-white text-indigo-600 shadow-sm hover:bg-indigo-50 hover:text-indigo-700'
            }`}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
            <span className="relative w-[15px] h-[15px]" aria-hidden="true">
                <Sun className={`w-[15px] h-[15px] absolute inset-0 transition-all duration-300 ${isDark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 rotate-90 scale-50'}`} />
                <Moon className={`w-[15px] h-[15px] absolute inset-0 transition-all duration-300 ${isDark ? 'opacity-0 -rotate-90 scale-50' : 'opacity-100 rotate-0 scale-100'}`} />
            </span>
            <span className="hidden sm:inline text-[12px] font-semibold tracking-wide">
                {isDark ? 'Dark' : 'Light'}
            </span>
        </button>
    )
}

// Shared icon button for header actions
function HeaderIconButton({ onClick, label, title, children, disabled, active, ...rest }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`relative w-[34px] h-[34px] rounded-[9px] flex items-center justify-center transition-all duration-200
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
                disabled:opacity-40 disabled:cursor-not-allowed
                ${active
                    ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-white/80 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
            title={title}
            aria-label={label}
            {...rest}
        >
            {children}
        </button>
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
            className={`flex items-center gap-1.5 px-3.5 h-[34px] rounded-[9px] text-[13px] font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ds-font-display ${active
                ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-white/50 dark:hover:bg-slate-600/40'
                }`}
        >
            {IconComponent && <IconComponent className="w-[15px] h-[15px]" />}
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
                </MenuButton>
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
            </div>
        </div>
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

