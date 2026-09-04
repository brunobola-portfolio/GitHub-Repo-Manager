
import { useState, useRef, useEffect, useCallback } from 'react'
import {
    LogOut, RefreshCw, LayoutDashboard, FolderGit2, Plus,
    Bell, Settings, User, ChevronDown, Building2, Shield, Users,
    AlertCircle, Sparkles, Moon, Sun, Wand2, Download, History, Menu, CreditCard,
    Kanban, ShieldAlert, GitPullRequest, CircleDot, AlertTriangle, Pin, ExternalLink, Check
} from 'lucide-react'
import { motion } from 'framer-motion'
import { SPRING } from './ui/motion'
import { Github } from './icons/GithubIcon'
import { AppLogo } from './AppLogo'
import LicenseBadge from './LicenseBadge'
import { useTheme } from '../hooks/useTheme.jsx'
import { useSystemHealth } from '../hooks/useSystemHealth.js'
import { useRelativeTime } from '../hooks/useRelativeTime.js'
import { formatRelativeTime } from '../utils/format'
import { getOrgRepoCount } from '../utils/orgRepoCount'
import { useWorkBoardBadgeCounts } from '../hooks/useWorkBoardBadgeCounts'
import { useNotificationsDigest } from '../hooks/useNotificationsDigest'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useBlockingDialogPresence } from '../hooks/useBlockingDialogPresence'
import { Drawer } from './ui/Drawer'
import { MobileQuickActionsFab } from './MobileQuickActionsFab'
import { Tooltip } from './ui/Tooltip'
import { Spinner } from './ui/Spinner'
import { Kbd } from './ui/Kbd'
import { emitAppEvent, APP_EVENTS } from '../utils/appEvents'

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
    // Hide the fixed mobile bottom nav while a modal is open — a bottom-sheet
    // modal's action bar occupies the same bottom strip, and the nav would
    // otherwise overlap (and steal taps from) the modal's primary button.
    const modalOpen = useBlockingDialogPresence()

    // Stable close handlers so the focus-trap effect inside each dropdown
    // doesn't re-run (and re-grab focus) on every Header re-render.
    const closeUserMenu = useCallback(() => setShowUserMenu(false), [])
    const closeNotifications = useCallback(() => setShowNotifications(false), [])

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
        <header className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md border-b border-slate-200/60 dark:border-slate-700/50 sticky top-0 z-20 transition-all duration-[var(--ds-duration-slow)] shadow-sm dark:shadow-black/20 safe-area-top">
            <div className="max-w-[var(--layout-max-w)] mx-auto px-[var(--layout-px)] h-14 sm:h-16 flex items-center gap-3">
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
                    <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-950 p-[4px] sm:pr-3 rounded-[13px] border border-slate-200/50 dark:border-slate-700/50 flex-shrink-0">
                        {/* The generated mark on its own ground — not the app
                            accent with a glyph dropped on top. The tile IS the
                            icon; it is the same artwork a user sees pinned to a
                            taskbar. */}
                        <AppLogo size={34} className="shadow-md" title="" />
                        <div className="min-w-0 hidden sm:block">
                            {/* Brand label demoted from <h1> to <h2>: the page-level h1 lives in
                                each route's PageHeader (e.g. the dashboard greeting). Two
                                <h1>s on the same page broke Playwright's strict-mode locator
                                in dashboard-hero.spec; <h2> keeps the heading role for
                                consumers like findByRole('heading', { name: /repo manager/i }). */}
                            <h2 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 leading-none ds-font-display truncate">
                                Repo Manager
                                <LicenseBadge />
                            </h2>
                            <p className="ds-text-meta text-slate-600 dark:text-slate-400 leading-none mt-0.5">Organize & migrate</p>
                        </div>
                    </div>
                </div>

                {/* OS-aware command palette chip — ⌘K on Mac, Ctrl+K elsewhere */}
                <Tooltip label="Open command palette">
                    <button
                        type="button"
                        onClick={onOpenCommandPalette}
                        aria-label="Open command palette"
                        className="hidden nav:inline-flex items-center gap-1.5 px-2 h-[28px] rounded-lg ds-text-meta font-medium text-slate-500 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700/50 bg-white/40 dark:bg-slate-800/40 hover:bg-white/70 dark:hover:bg-slate-800/70 transition-colors"
                    >
                        <Kbd modifier="mod">K</Kbd>
                    </button>
                </Tooltip>

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
                                active={activeView === 'repos' || activeView === 'repo-detail'}
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
                            <div className="hidden nav:flex items-center gap-1 bg-slate-100 dark:bg-slate-950 p-[4px] rounded-[13px] border border-slate-200/50 dark:border-slate-700/50">
                                <HeaderIconButton onClick={onCreateRepo} label="Create new repository" title="New repo">
                                    <Plus className="w-4 h-4" />
                                </HeaderIconButton>
                                <HeaderIconButton onClick={onImport} label="Import Repository" title="Import">
                                    <Download className="w-4 h-4" />
                                </HeaderIconButton>
                                <HeaderIconButton onClick={onOpenDevToolkit} label="Dev Toolkit" title="Dev Toolkit">
                                    <Wand2 className="w-4 h-4" />
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
                                    <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
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
                                        aria-haspopup="dialog"
                                        aria-controls="header-notifications-popover"
                                        active={showNotifications}
                                    >
                                        <Bell className="w-4 h-4" />
                                        {notif.totalCount > 0 && (
                                            <span
                                                aria-hidden="true"
                                                className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-brand-500 text-white ds-text-micro font-bold leading-[16px] text-center ring-2 ring-slate-100 dark:ring-slate-950"
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
                                            onClose={closeNotifications}
                                        />
                                    )}
                                </div>

                                {/* User Menu */}
                                <div className="relative" ref={menuRef}>
                                    <button
                                        type="button"
                                        onClick={() => setShowUserMenu(!showUserMenu)}
                                        className={`flex items-center gap-1 h-[34px] px-1.5 rounded-[9px] transition-all duration-200 ds-focus-ring ${
                                            showUserMenu
                                                ? 'bg-white dark:bg-slate-600 shadow-sm'
                                                : 'hover:bg-white/80 dark:hover:bg-slate-700'
                                        }`}
                                        aria-label={showUserMenu ? 'Close user menu' : 'Open user menu'}
                                        aria-haspopup="menu"
                                        aria-expanded={showUserMenu}
                                        aria-controls="header-user-menu"
                                    >
                                        <img
                                            src={user.avatar_url || 'https://github.com/ghost.png'}
                                            alt={user.login}
                                            width={26}
                                            height={26}
                                            loading="lazy"
                                            decoding="async"
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
                                            onClose={closeUserMenu}
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
                                        bg-[color:var(--ds-accent-brand)] dark:bg-[color:var(--ds-accent-brand-fill-dark)] hover:bg-[color:var(--ds-accent-brand-hover)] dark:hover:bg-[color:var(--ds-accent-brand)]
                                        text-white text-[13px] font-semibold
                                        shadow-sm
                                        hover:shadow-md
                                        transition-colors duration-200
                                        ds-focus-ring"
                                >
                                    <Github className="w-4 h-4" />
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
          {!modalOpen && (
          <nav
            className="fixed bottom-0 left-0 right-0 z-[var(--ds-z-composer)] md:hidden backdrop-blur-md bg-white/80 dark:bg-slate-900/80 border-t border-slate-200/60 dark:border-slate-700/50"
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
              ].map(({ id, icon: Icon, label, showDot }) => {
                const isActive = activeView === id && id !== 'more'
                return (
                <button
                  key={id}
                  onClick={id === 'more' ? () => setMoreOpen(true) : () => onViewChange?.(id)}
                  className={`relative flex flex-col items-center justify-center gap-0.5 min-w-[44px] min-h-[44px] rounded-xl transition-colors ${
                    isActive
                      ? 'text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {/* Animated active-tab pill — slides between tabs via
                      shared layoutId, giving the bottom-nav a premium
                      micro-feedback at every change. */}
                  {isActive && (
                    <motion.span
                      layoutId="mobile-nav-active-pill"
                      aria-hidden="true"
                      transition={SPRING.panel}
                      className="absolute inset-x-2 top-1 h-7 rounded-lg bg-brand-500/10 dark:bg-brand-400/15"
                    />
                  )}
                  <span className="relative">
                    <Icon className="w-5 h-5" />
                    {showDot && (
                      <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white/80 dark:ring-slate-900/80" />
                    )}
                  </span>
                  <span className="relative ds-text-micro font-medium leading-none">{label}</span>
                </button>
                )
              })}
            </div>
          </nav>
          )}
          <Drawer side="bottom" isOpen={moreOpen} onClose={() => setMoreOpen(false)} title="More">
            <div className="space-y-1 px-4 py-3">
              <button
                type="button"
                onClick={() => { onViewChange?.('pricing'); setMoreOpen(false) }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left ds-focus-ring"
              >
                <CreditCard className="w-4 h-4" />
                Pricing
              </button>
              <button
                type="button"
                onClick={() => { onMigrationHistory?.(); setMoreOpen(false) }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left ds-focus-ring"
              >
                <History className="w-4 h-4" />
                Migration History
              </button>
              <button
                type="button"
                onClick={() => { onOpenSettings?.(); setMoreOpen(false) }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left ds-focus-ring"
              >
                <Settings className="w-4 h-4" />
                Settings
              </button>
              <button
                type="button"
                onClick={() => { onReauthorize?.(); setMoreOpen(false) }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left ds-focus-ring"
              >
                <Shield className="w-4 h-4" />
                Re-authorize Permissions
              </button>
              <div className="border-t border-slate-100 dark:border-slate-700 my-1" />
              <button
                type="button"
                onClick={() => { onLogout?.(); setMoreOpen(false) }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/30 transition-colors text-left ds-focus-ring"
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
            onOpenCommandPalette={onOpenCommandPalette}
            onOpenAIAssistant={() => emitAppEvent(APP_EVENTS.AI_ASSISTANT_OPEN)}
          />
          </>
        )}
        </>
    )
}

function ThemeToggleButton({ isDark, toggleTheme }) {
    const label = isDark ? 'Switch to light mode' : 'Switch to dark mode'
    return (
        <Tooltip label={label}>
            <button
                type="button"
                onClick={toggleTheme}
                aria-pressed={isDark}
                className={`relative flex items-center justify-center rounded-[9px] transition-all duration-[var(--ds-duration-slow)] ds-focus-ring w-[34px] h-[34px] ${
                    isDark
                        ? 'bg-slate-600/80 text-amber-300 hover:bg-slate-500/80 hover:text-amber-200'
                        : 'bg-white text-[color:var(--ds-accent-brand)] shadow-sm hover:bg-brand-50 hover:text-brand-700'
                }`}
                aria-label={label}
            >
                <span className="relative w-4 h-4" aria-hidden="true">
                    <Sun className={`w-4 h-4 absolute inset-0 transition-[opacity,transform] duration-[var(--ds-duration-slow)] ${isDark ? 'opacity-100 rotate-0' : 'opacity-0 rotate-90'}`} />
                    <Moon className={`w-4 h-4 absolute inset-0 transition-[opacity,transform] duration-[var(--ds-duration-slow)] ${isDark ? 'opacity-0 -rotate-90' : 'opacity-100 rotate-0'}`} />
                </span>
            </button>
        </Tooltip>
    )
}

// Shared icon button for header actions
function HeaderIconButton({ onClick, label, title, children, disabled, active, ...rest }) {
    return (
        <Tooltip label={title}>
            <button
                type="button"
                onClick={onClick}
                disabled={disabled}
                className={`relative w-[34px] h-[34px] rounded-[9px] flex items-center justify-center transition-all duration-200
                    ds-focus-ring
                    disabled:opacity-40 disabled:cursor-not-allowed
                    ${active
                        ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-slate-100 shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:bg-white/80 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                aria-label={label}
                {...rest}
            >
                {children}
            </button>
        </Tooltip>
    )
}

// Navigation Button Component
function NavButton({ active, onClick, icon, label, badge }) {
    const IconComponent = icon
    return (
        <Tooltip label={label}>
            <button
                type="button"
                onClick={onClick}
                aria-current={active ? 'page' : undefined}
                aria-label={label}
                className={`relative flex items-center gap-1.5 px-2.5 lg:px-3.5 h-[34px] rounded-[9px] text-[13px] font-semibold transition-all duration-200 ds-focus-ring ds-font-display ${active
                    ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-white/50 dark:hover:bg-slate-600/40'
                    }`}
            >
                {IconComponent && <IconComponent className="w-4 h-4" />}
                <span className="hidden nav:inline">{label}</span>
                {badge > 0 && (
                    <span
                        aria-label={`${badge} items need attention`}
                        className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 ds-text-micro font-bold rounded-full bg-brand-500 text-white"
                    >
                        {badge > 9 ? '9+' : badge}
                    </span>
                )}
            </button>
        </Tooltip>
    )
}

// Closes a popover the instant focus lands outside it. useFocusTrap's Tab
// handling already stops keyboard focus from escaping, but that leaves every
// other way focus can move on — a click that lands on a non-focusable
// ancestor (no 'mousedown' bubble to the outside-click listener below it),
// a link opening in a new tab, programmatic focus from elsewhere — with no
// listener at all, so the popover would sit open, unfocused, and orphaned.
function useCloseOnFocusLeave(ref, onClose) {
    useEffect(() => {
        const el = ref.current
        if (!el) return undefined
        const handleFocusOut = (e) => {
            if (!el.contains(e.relatedTarget)) onClose()
        }
        el.addEventListener('focusout', handleFocusOut)
        return () => el.removeEventListener('focusout', handleFocusOut)
    }, [ref, onClose])
}

// User Dropdown Menu
function UserDropdown({ user, orgs, onLogout, onReauthorize, onOpenOrgManager, onOpenSettings, onMigrationHistory, onClose, isAdmin = false, onOpenAdminDLQ }) {
    // Escape-to-close + focus into the menu on open + focus return to the
    // trigger on close (the menu only mounts while open).
    const trapRef = useFocusTrap(true, onClose)
    useCloseOnFocusLeave(trapRef, onClose)
    return (
        <div
            ref={trapRef}
            id="header-user-menu"
            role="menu"
            aria-label="User menu"
            className="absolute right-0 top-full mt-2 w-72 ds-surface-card rounded-2xl shadow-[var(--ds-shadow-overlay)] border border-slate-200/60 dark:border-slate-700/50 overflow-hidden z-[var(--ds-z-composer)] ds-animate-scale-in"
        >
            {/* User Info */}
            <div className="p-4 bg-slate-50/70 dark:bg-slate-700/50 border-b border-slate-200/60 dark:border-slate-700/50">
                <div className="flex items-center gap-3">
                    <img
                        src={user.avatar_url || 'https://github.com/ghost.png'}
                        alt={user.login}
                        width={48}
                        height={48}
                        loading="lazy"
                        decoding="async"
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
                <div className="px-2 py-1 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Organizations ({orgs.length})
                </div>
                <div className="max-h-64 overflow-y-auto ds-scrollbar">
                    {orgs.length === 0 ? (
                        <div className="px-2 py-2 text-sm text-slate-500 dark:text-slate-400">No organizations</div>
                    ) : (
                        orgs.map(org => (
                            <button
                                type="button"
                                role="menuitem"
                                key={org.login}
                                onClick={() => { onOpenOrgManager?.(org); onClose() }}
                                aria-label={`Open ${org.login} organization`}
                                className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-left ds-focus-ring"
                            >
                                <img src={org.avatar_url} alt={org.login} className="w-6 h-6 rounded-md" />
                                <span className="text-sm text-slate-700 dark:text-slate-300 flex-1 truncate">{org.login}</span>
                                <span className="text-xs text-slate-500 dark:text-slate-400">{getOrgRepoCount(org)}</span>
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
                        <div className="px-3 pb-1 ds-text-micro font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
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
            role="menuitem"
            onClick={onClick}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ds-focus-ring ${danger
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
    // Escape-to-close + focus management (panel only mounts while open).
    const trapRef = useFocusTrap(true, onClose)
    useCloseOnFocusLeave(trapRef, onClose)

    return (
        <div
            ref={trapRef}
            id="header-notifications-popover"
            role="dialog"
            aria-modal="false"
            aria-label="Notifications"
            className="absolute right-0 top-full mt-2 w-96 max-w-[calc(100vw-1rem)] ds-surface-card rounded-2xl shadow-[var(--ds-shadow-overlay)] border border-slate-200/60 dark:border-slate-700/50 overflow-hidden z-[var(--ds-z-composer)] ds-animate-scale-in"
        >
            <div className="px-4 pt-3.5 pb-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div className="min-w-0">
                    <p className="ds-text-micro font-semibold uppercase tracking-[0.22em] text-[color:var(--ds-accent-brand)] dark:text-brand-300">
                        {sinceLabel ? `Since ${sinceLabel}` : 'Activity digest'}
                    </p>
                    <h3 className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100 ds-font-display">
                        {totalCount > 0 ? `${totalCount} new` : 'You\'re all caught up'}
                    </h3>
                </div>
                {totalCount > 0 && (
                    <button
                        type="button"
                        onClick={() => onMarkSeen?.()}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded ds-text-meta font-medium text-slate-500 hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-300 transition-colors ds-focus-ring"
                    >
                        <Check className="w-3 h-3" aria-hidden="true" /> Mark as read
                    </button>
                )}
            </div>

            <div className="max-h-[420px] overflow-y-auto">
                {loading && totalCount === 0 ? (
                    <div className="px-4 py-8 flex justify-center">
                        <Spinner size="sm" tone="muted" label="Loading digest" />
                    </div>
                ) : totalCount === 0 ? (
                    <div className="px-4 py-10 text-center">
                        <Sparkles className="w-6 h-6 text-brand-400/70 mx-auto mb-2" aria-hidden="true" />
                        <p className="text-sm text-slate-600 dark:text-slate-400">Nothing pending right now.</p>
                        <p className="ds-text-meta text-slate-500 dark:text-slate-400 mt-1">We'll let you know when something needs you.</p>
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
                    <p className="px-4 pb-3 ds-text-meta text-amber-700 dark:text-amber-400">
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
                <span className="ds-text-meta font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {meta.label}
                </span>
                <span className={`ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full ds-text-micro font-bold text-white ${meta.dot}`}>
                    {count}
                </span>
            </div>
            <ul className="px-1 pb-1">
                {items.map((item) => (
                    <DigestItemRow key={`${kind}-${item.repo}-${item.prNumber ?? item.issueNumber ?? item.jobId ?? item.since}`} kind={kind} item={item} onClick={onItemClick} />
                ))}
                {count > items.length && (
                    <li className="px-3 py-1 ds-text-meta text-slate-500 dark:text-slate-400">
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
                className="group flex items-start gap-2 px-3 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors ds-focus-ring"
            >
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                        {item.title || item.reason || 'Update'}
                    </p>
                    <p className="ds-text-micro text-slate-500 dark:text-slate-400 truncate">
                        {item.repo}
                    </p>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-0.5">
                    {ago && <span className="ds-text-micro text-slate-500 dark:text-slate-400">{ago}</span>}
                    {url && (
                        <ExternalLink className="w-3 h-3 text-slate-300 dark:text-slate-600 group-hover:text-brand-500 transition-colors" aria-hidden="true" />
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
    // Stable close + focus management for the popover dialog: Escape closes,
    // focus moves into the panel on open and returns to the trigger on close.
    const closePopover = useCallback(() => setOpen(false), [])
    const trapRef = useFocusTrap(open, closePopover)

    useEffect(() => {
        if (!open) return undefined
        const onClick = (e) => {
            if (popRef.current && !popRef.current.contains(e.target)) setOpen(false)
        }
        document.addEventListener('mousedown', onClick)
        return () => document.removeEventListener('mousedown', onClick)
    }, [open])

    // 'pending' = first probe still in flight — showing the grey "unknown"
    // dot during every app load would be noise, not signal.
    if (status === 'ready' || status === 'pending') return null

    const isDegraded = status === 'degraded'
    const dotClass = isDegraded
        ? 'bg-amber-500 ring-amber-500/30'
        : 'bg-slate-400 ring-slate-400/30'
    const tooltip = isDegraded ? 'System degraded' : 'Status unknown'

    return (
        <div className="relative" ref={popRef}>
            <Tooltip label={tooltip}>
                <button
                    type="button"
                    onClick={() => setOpen(v => !v)}
                    aria-label={tooltip}
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    data-testid="system-health-indicator"
                    data-status={status}
                    className="relative w-[34px] h-[34px] rounded-[9px] flex items-center justify-center transition-all duration-200 ds-focus-ring hover:bg-white/80 dark:hover:bg-slate-700"
                >
                    <span
                        className={`w-2.5 h-2.5 rounded-full ring-4 ${dotClass}`}
                        aria-hidden="true"
                    />
                </button>
            </Tooltip>

            {open && (
                <div
                    ref={trapRef}
                    role="dialog"
                    aria-modal="false"
                    aria-label={tooltip}
                    className="absolute right-0 top-full mt-2 w-72 bg-white/95 dark:bg-slate-800/95 backdrop-blur-md rounded-2xl shadow-[var(--ds-shadow-overlay)] border border-slate-200/60 dark:border-slate-700/50 overflow-hidden z-[var(--ds-z-composer)] ds-animate-scale-in"
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
                            <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-700 ds-text-meta text-slate-500 dark:text-slate-400">
                                Last checked: {relative || 'just now'}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

