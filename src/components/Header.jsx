
import { useState, useRef, useEffect } from 'react'
import {
    LogOut, RefreshCw, LayoutDashboard, FolderGit2, Plus,
    Bell, Settings, User, ChevronDown, Building2, Shield, Users,
    AlertCircle, Sparkles, Moon, Sun, Wand2, Download, History, Menu, CreditCard,
    Kanban, ShieldAlert, GitPullRequest, CircleDot, AlertTriangle, Pin, ExternalLink, Check
} from 'lucide-react'
import { Github } from './icons/GithubIcon'
import { AppLogoIcon } from './AppLogo'
import LicenseBadge from './LicenseBadge'
import { useTheme } from '../hooks/useTheme.jsx'
import { useSystemHealth } from '../hooks/useSystemHealth.js'
import { useRelativeTime } from '../hooks/useRelativeTime.js'
import { formatRelativeTime } from '../utils/format'
import { useWorkBoardBadgeCounts } from '../hooks/useWorkBoardBadgeCounts'
import { useNotificationsDigest } from '../hooks/useNotificationsDigest'
import { Drawer } from './ui/Drawer'
import { MobileQuickActionsFab } from './MobileQuickActionsFab'

export function Header({
    user,
    // isMockMode: the inline Demo pill was replaced by the <LicenseBadge />
    // component which reads MOCK_MODE from config directly. The prop is still
    // accepted for backward compat but consumed inside the badge.
    onLogin,
    onLogout,
    onCreateRepo,
    activeView,
    onViewChange,
    onRefreshOrgs,
    orgs = [],
    syncStatus: _syncStatus,
    onReauthorize,
    onOpenOrgManager,
    onOpenDevToolkit,
    onOpenSettings,
    onImport,
    onMigrationHistory,
    onToggleOrgDrawer,
    isAdmin = false,
    onOpenAdminDLQ,
    onOpenCommandPalette = () => {},
}) {
    const [showUserMenu, setShowUserMenu] = useState(false)
    const [showNotifications, setShowNotifications] = useState(false)
    const [syncing, setSyncing] = useState(false)
    const [moreOpen, setMoreOpen] = useState(false)
    const menuRef = useRef(null)
    const notifRef = useRef(null)
    const { isDark, toggleTheme } = useTheme()
    const { count: workBoardCount } = useWorkBoardBadgeCounts()
    const notif = useNotificationsDigest({ enabled: !!user })

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
                            {/* Brand label demoted from <h1> to <h2>: the page-level h1 lives in
                                each route's PageHeader (e.g. the dashboard greeting). Two
                                <h1>s on the same page broke Playwright's strict-mode locator
                                in dashboard-hero.spec; <h2> keeps the heading role for
                                consumers like findByRole('heading', { name: /repo manager/i }). */}
                            <h2 className="text-[13px] font-bold text-slate-900 dark:text-slate-100 leading-none ds-font-display truncate">
                                Repo Manager
                                <LicenseBadge />
                            </h2>
                            <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-none mt-0.5">Organize & migrate</p>
                        </div>
                    </div>
                </div>

                {/* ⌘K command palette chip */}
                <button
                    type="button"
                    onClick={onOpenCommandPalette}
                    aria-label="Open command palette (Ctrl+K)"
                    title="Open command palette (Ctrl+K)"
                    className="hidden min-[1340px]:inline-flex items-center gap-1.5 px-2 h-[28px] rounded-lg text-[11px] font-medium text-slate-500 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700/50 bg-white/40 dark:bg-slate-800/40 hover:bg-white/70 dark:hover:bg-slate-800/70 transition-colors"
                >
                    <kbd className="font-mono">⌘K</kbd>
                </button>

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
                                active={activeView === 'work-board'}
                                onClick={() => onViewChange?.('work-board')}
                                icon={Kanban}
                                label="Work Board"
                                badge={workBoardCount}
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
                            <div className="hidden min-[1340px]:flex items-center gap-1 bg-slate-100 dark:bg-slate-950 p-[4px] rounded-[13px] border border-slate-200/50 dark:border-slate-700/50">
                                <HeaderIconButton onClick={onCreateRepo} label="Create new repository" title="New repo">
                                    <Plus className="w-[15px] h-[15px]" />
                                </HeaderIconButton>
                                <HeaderIconButton onClick={onImport} label="Import Repository" title="Import">
                                    <Download className="w-[15px] h-[15px]" />
                                </HeaderIconButton>
                                <HeaderIconButton onClick={onOpenDevToolkit} label="Dev Toolkit" title="Dev Toolkit">
                                    <Wand2 className="w-[15px] h-[15px]" />
                                </HeaderIconButton>
                            </div>

                            {/* Utility Container */}
                            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-950 p-[4px] rounded-[13px] border border-slate-200/50 dark:border-slate-700/50">
                                {/* System Health Indicator (hidden when ready) */}
                                <SystemHealthIndicator />

                                {/* Theme Toggle */}
                                <ThemeToggleButton isDark={isDark} toggleTheme={toggleTheme} />

                                {/* Sync */}
                                <HeaderIconButton onClick={handleSync} label="Sync organizations" disabled={syncing}>
                                    <RefreshCw className={`w-[15px] h-[15px] ${syncing ? 'animate-spin' : ''}`} />
                                </HeaderIconButton>

                                {/* Notifications */}
                                <div className="relative" ref={notifRef}>
                                    <HeaderIconButton
                                        onClick={() => {
                                            const next = !showNotifications
                                            setShowNotifications(next)
                                            if (next) notif.refresh()
                                        }}
                                        label={showNotifications
                                            ? 'Hide notifications'
                                            : notif.totalCount > 0
                                                ? `${notif.totalCount} notifications`
                                                : 'Show notifications'}
                                        aria-expanded={showNotifications}
                                        aria-haspopup="true"
                                        active={showNotifications}
                                    >
                                        <Bell className="w-[15px] h-[15px]" />
                                        {notif.totalCount > 0 && (
                                            <span
                                                aria-hidden="true"
                                                className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-indigo-500 text-white text-[10px] font-bold leading-[16px] text-center ring-2 ring-slate-100 dark:ring-slate-950"
                                            >
                                                {notif.totalCount > 99 ? '99+' : notif.totalCount}
                                            </span>
                                        )}
                                    </HeaderIconButton>

                                    {showNotifications && (
                                        <NotificationsDropdown
                                            digest={notif.digest}
                                            loading={notif.loading}
                                            error={notif.error}
                                            totalCount={notif.totalCount}
                                            onMarkSeen={notif.markSeen}
                                            onClose={() => setShowNotifications(false)}
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
                                            isAdmin={isAdmin}
                                            onOpenAdminDLQ={onOpenAdminDLQ}
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
          <>
          <nav
            className="fixed bottom-0 left-0 right-0 z-[var(--ds-z-composer)] md:hidden backdrop-blur-xl bg-white/80 dark:bg-slate-900/80 border-t border-slate-200/60 dark:border-slate-700/50"
            role="navigation"
            aria-label="Main navigation"
            style={{ paddingBottom: 'var(--safe-area-inset-bottom, 0px)' }}
          >
            <div className="flex items-center justify-around h-14 px-4">
              {[
                { id: 'dashboard',  icon: LayoutDashboard, label: 'Home',  showDot: false },
                { id: 'repos',      icon: FolderGit2,      label: 'Repos', showDot: false },
                { id: 'work-board', icon: Kanban,          label: 'Work',  showDot: workBoardCount > 0 },
                { id: 'teams',      icon: Users,           label: 'Teams', showDot: false },
                { id: 'more',       icon: Menu,            label: 'More',  showDot: false },
              ].map(({ id, icon: Icon, label, showDot }) => (
                <button
                  key={id}
                  onClick={id === 'more' ? () => setMoreOpen(true) : () => onViewChange?.(id)}
                  className={`relative flex flex-col items-center justify-center gap-0.5 min-w-[44px] min-h-[44px] rounded-xl transition-colors ${
                    activeView === id && id !== 'more'
                      ? 'text-indigo-600 dark:text-indigo-400'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                  aria-current={activeView === id && id !== 'more' ? 'page' : undefined}
                >
                  <span className="relative">
                    <Icon className="w-5 h-5" />
                    {showDot && (
                      <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white/80 dark:ring-slate-900/80" />
                    )}
                  </span>
                  <span className="text-[10px] font-medium leading-none">{label}</span>
                </button>
              ))}
            </div>
          </nav>
          <Drawer side="bottom" isOpen={moreOpen} onClose={() => setMoreOpen(false)} title="More">
            <div className="space-y-1 px-4 py-3">
              <button
                type="button"
                onClick={() => { onViewChange?.('pricing'); setMoreOpen(false) }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left"
              >
                <CreditCard className="w-4 h-4" />
                Pricing
              </button>
              <button
                type="button"
                onClick={() => { onMigrationHistory?.(); setMoreOpen(false) }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left"
              >
                <History className="w-4 h-4" />
                Migration History
              </button>
              <button
                type="button"
                onClick={() => { onOpenSettings?.(); setMoreOpen(false) }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left"
              >
                <Settings className="w-4 h-4" />
                Settings
              </button>
              <button
                type="button"
                onClick={() => { onReauthorize?.(); setMoreOpen(false) }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left"
              >
                <Shield className="w-4 h-4" />
                Re-authorize Permissions
              </button>
              <div className="border-t border-slate-100 dark:border-slate-700 my-1" />
              <button
                type="button"
                onClick={() => { onLogout?.(); setMoreOpen(false) }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-colors text-left"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </button>
            </div>
          </Drawer>
          <MobileQuickActionsFab
            onCreate={onCreateRepo}
            onImport={onImport}
            onOpenDevToolkit={onOpenDevToolkit}
          />
          </>
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
function NavButton({ active, onClick, icon, label, badge }) {
    const IconComponent = icon
    return (
        <button
            type="button"
            onClick={onClick}
            aria-current={active ? 'page' : undefined}
            aria-label={label}
            title={label}
            className={`relative flex items-center gap-1.5 px-2.5 lg:px-3.5 h-[34px] rounded-[9px] text-[13px] font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ds-font-display ${active
                ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-white/50 dark:hover:bg-slate-600/40'
                }`}
        >
            {IconComponent && <IconComponent className="w-[15px] h-[15px]" />}
            <span className="hidden min-[1340px]:inline">{label}</span>
            {badge > 0 && (
                <span
                    aria-label={`${badge} items need attention`}
                    className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 text-[10px] font-bold rounded-full bg-indigo-500 text-white"
                >
                    {badge > 9 ? '9+' : badge}
                </span>
            )}
        </button>
    )
}

// User Dropdown Menu
function UserDropdown({ user, orgs, onLogout, onReauthorize, onOpenOrgManager, onOpenSettings, onMigrationHistory, onClose, isAdmin = false, onOpenAdminDLQ }) {
    return (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white/95 dark:bg-slate-800/95 backdrop-blur-xl rounded-2xl shadow-2xl dark:shadow-black/50 border border-slate-200/60 dark:border-slate-700/50 overflow-hidden z-[var(--ds-z-composer)] ds-animate-scale-in">
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
                <div className="max-h-64 overflow-y-auto ds-scrollbar">
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
                {isAdmin && onOpenAdminDLQ && (
                    <div className="border-t border-slate-100 dark:border-slate-700 mt-2 pt-2">
                        <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                            Admin
                        </div>
                        <MenuButton icon={ShieldAlert} onClick={() => { onOpenAdminDLQ?.(); onClose() }}>
                            DLQ Admin
                        </MenuButton>
                    </div>
                )}
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

// Notifications Dropdown — categorised digest of activity since the user
// last opened the bell. Reads from useNotificationsDigest in the Header
// shell and renders four colour-coded categories with top-3 items each.
const CATEGORY_ORDER = ['reviews', 'issues', 'failed_migrations', 'stale_pinned']
const CATEGORY_META = {
    reviews:           { label: 'Reviews waiting',  Icon: GitPullRequest, accent: 'text-emerald-500 dark:text-emerald-400', dot: 'bg-emerald-500' },
    issues:            { label: 'Issues for you',   Icon: CircleDot,      accent: 'text-amber-500 dark:text-amber-400',     dot: 'bg-amber-500' },
    failed_migrations: { label: 'Failed migrations',Icon: AlertTriangle,  accent: 'text-red-500 dark:text-red-400',         dot: 'bg-red-500' },
    stale_pinned:      { label: 'Stale pinned',     Icon: Pin,            accent: 'text-slate-500 dark:text-slate-400',     dot: 'bg-slate-400' },
}

function NotificationsDropdown({ digest, loading, error, totalCount, onMarkSeen, onClose }) {
    const sinceLabel = formatRelativeTime(digest.since)

    return (
        <div className="absolute right-0 top-full mt-2 w-96 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl rounded-2xl shadow-2xl dark:shadow-black/50 border border-slate-200/60 dark:border-slate-700/50 overflow-hidden z-[var(--ds-z-composer)] ds-animate-scale-in">
            <div className="px-4 pt-3.5 pb-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-indigo-600 dark:text-indigo-300">
                        {sinceLabel ? `Since ${sinceLabel}` : 'Activity digest'}
                    </p>
                    <h3 className="mt-0.5 text-sm font-bold text-slate-900 dark:text-slate-100 ds-font-display">
                        {totalCount > 0 ? `${totalCount} new` : 'You\'re all caught up'}
                    </h3>
                </div>
                {totalCount > 0 && (
                    <button
                        type="button"
                        onClick={() => onMarkSeen?.()}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-300 transition-colors"
                    >
                        <Check className="w-3 h-3" aria-hidden="true" /> Mark as read
                    </button>
                )}
            </div>

            <div className="max-h-[420px] overflow-y-auto">
                {loading && totalCount === 0 ? (
                    <div className="px-4 py-8 flex justify-center">
                        <RefreshCw className="w-4 h-4 text-slate-400 animate-spin" />
                    </div>
                ) : totalCount === 0 ? (
                    <div className="px-4 py-10 text-center">
                        <Sparkles className="w-6 h-6 text-indigo-400/70 mx-auto mb-2" aria-hidden="true" />
                        <p className="text-sm text-slate-600 dark:text-slate-400">Nothing pending right now.</p>
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">We'll let you know when something needs you.</p>
                    </div>
                ) : (
                    <ul className="py-1">
                        {CATEGORY_ORDER.map((key) => (
                            <DigestCategory
                                key={key}
                                kind={key}
                                count={digest.totals[key]}
                                items={digest.items[key]}
                                onItemClick={onClose}
                            />
                        ))}
                    </ul>
                )}
                {error && totalCount === 0 && (
                    <p className="px-4 pb-3 text-[11px] text-amber-600 dark:text-amber-400">
                        Couldn't load digest — we'll try again on next focus.
                    </p>
                )}
            </div>
        </div>
    )
}

function DigestCategory({ kind, count, items, onItemClick }) {
    if (!count) return null
    const meta = CATEGORY_META[kind]
    if (!meta) return null
    const Icon = meta.Icon

    return (
        <li>
            <div className="px-4 pt-3 pb-1.5 flex items-center gap-2">
                <Icon className={`w-3.5 h-3.5 ${meta.accent}`} aria-hidden="true" />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {meta.label}
                </span>
                <span className={`ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold text-white ${meta.dot}`}>
                    {count}
                </span>
            </div>
            <ul className="px-1 pb-1">
                {items.map((item) => (
                    <DigestItemRow key={`${kind}-${item.repo}-${item.prNumber ?? item.issueNumber ?? item.jobId ?? item.since}`} kind={kind} item={item} onClick={onItemClick} />
                ))}
                {count > items.length && (
                    <li className="px-3 py-1 text-[11px] text-slate-400 dark:text-slate-500">
                        +{count - items.length} more…
                    </li>
                )}
            </ul>
        </li>
    )
}

function DigestItemRow({ kind, item, onClick }) {
    const ago = formatRelativeTime(item.since)
    const url = item.url
        ?? (kind === 'failed_migrations' ? null : `https://github.com/${item.repo}`)

    return (
        <li>
            <a
                href={url ?? '#'}
                target={url ? '_blank' : undefined}
                rel={url ? 'noopener noreferrer' : undefined}
                onClick={() => onClick?.()}
                className="group flex items-start gap-2 px-3 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
            >
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                        {item.title || item.reason || 'Update'}
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                        {item.repo}
                    </p>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-0.5">
                    {ago && <span className="text-[10px] text-slate-400 dark:text-slate-500">{ago}</span>}
                    {url && (
                        <ExternalLink className="w-3 h-3 text-slate-300 dark:text-slate-600 group-hover:text-indigo-500 transition-colors" aria-hidden="true" />
                    )}
                </div>
            </a>
        </li>
    )
}

// System Health Indicator — small dot next to the theme toggle that reveals
// itself only when the server readiness probe reports degradation or the
// status is unknown (e.g. network blip). Clicking the dot opens a popover
// listing which checks failed.
function SystemHealthIndicator() {
    const { status, checks, lastCheckedAt } = useSystemHealth()
    const [open, setOpen] = useState(false)
    const popRef = useRef(null)
    const relative = useRelativeTime(lastCheckedAt)

    useEffect(() => {
        if (!open) return undefined
        const onClick = (e) => {
            if (popRef.current && !popRef.current.contains(e.target)) setOpen(false)
        }
        document.addEventListener('mousedown', onClick)
        return () => document.removeEventListener('mousedown', onClick)
    }, [open])

    if (status === 'ready') return null

    const isDegraded = status === 'degraded'
    const dotClass = isDegraded
        ? 'bg-amber-500 ring-amber-500/30'
        : 'bg-slate-400 ring-slate-400/30'
    const tooltip = isDegraded ? 'System degraded' : 'Status unknown'

    return (
        <div className="relative" ref={popRef}>
            <button
                type="button"
                onClick={() => setOpen(v => !v)}
                aria-label={tooltip}
                aria-haspopup="dialog"
                aria-expanded={open}
                title={tooltip}
                data-testid="system-health-indicator"
                data-status={status}
                className="relative w-[34px] h-[34px] rounded-[9px] flex items-center justify-center transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 hover:bg-white/80 dark:hover:bg-slate-700"
            >
                <span
                    className={`w-2.5 h-2.5 rounded-full ring-4 ${dotClass}`}
                    aria-hidden="true"
                />
            </button>

            {open && (
                <div
                    role="dialog"
                    aria-label={tooltip}
                    className="absolute right-0 top-full mt-2 w-72 bg-white/95 dark:bg-slate-800/95 backdrop-blur-xl rounded-2xl shadow-2xl dark:shadow-black/50 border border-slate-200/60 dark:border-slate-700/50 overflow-hidden z-[var(--ds-z-composer)] ds-animate-scale-in"
                >
                    <div className="p-3 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2">
                        <AlertCircle className={`w-4 h-4 ${isDegraded ? 'text-amber-500 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'}`} />
                        <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
                            {isDegraded ? 'System degraded' : 'Status unknown'}
                        </h3>
                    </div>
                    <div className="p-3 space-y-1.5">
                        {isDegraded && Object.keys(checks).length > 0 ? (
                            Object.entries(checks).map(([name, result]) => {
                                const ok = result === 'ok'
                                return (
                                    <div key={name} className="flex items-start gap-2 text-xs">
                                        <span
                                            className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`}
                                            aria-hidden="true"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <span className="font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
                                                {name}
                                            </span>
                                            <span className="text-slate-500 dark:text-slate-400">: {result}</span>
                                        </div>
                                    </div>
                                )
                            })
                        ) : (
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                                {isDegraded
                                    ? 'One or more dependencies reported an error.'
                                    : 'Unable to reach the readiness probe. The server may be unreachable or the network is offline.'}
                            </div>
                        )}
                        {lastCheckedAt && (
                            <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-700 text-[11px] text-slate-400 dark:text-slate-500">
                                Last checked: {relative || 'just now'}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

