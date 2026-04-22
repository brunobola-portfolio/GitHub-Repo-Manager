import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mock MOCK_MODE=true so LicenseBadge doesn't try to hit /api/v1/license
// ---------------------------------------------------------------------------
vi.mock('@/config', () => ({
    MOCK_MODE: true,
    API_BASE_URL: '',
}))

// Stub out LicenseBadge — it has its own unit tests and makes an async
// fetch on mount that we don't want to arrange per-test here.
vi.mock('@/components/LicenseBadge', () => ({
    default: () => null,
}))

// Mock useTheme so Header can render without a ThemeProvider. Each test
// receives the same stable `toggleTheme` spy so we can assert calls.
const toggleThemeMock = vi.fn()
vi.mock('@/hooks/useTheme', () => ({
    useTheme: () => ({
        theme: 'light',
        isDark: false,
        toggleTheme: toggleThemeMock,
        setTheme: vi.fn(),
    }),
    ThemeProvider: ({ children }) => children,
}))

// Mock useSystemHealth so tests control the reported status without
// triggering real fetches. Per-test overrides via systemHealthMock.mockReturnValue().
const systemHealthMock = vi.fn(() => ({
    status: 'ready',
    checks: { db: 'ok', session: 'ok' },
    lastCheckedAt: null,
}))
vi.mock('@/hooks/useSystemHealth', () => ({
    useSystemHealth: () => systemHealthMock(),
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
const { Header } = await import('@/components/Header')

const MOCK_USER = {
    login: 'octocat',
    name: 'The Octocat',
    avatar_url: 'https://github.com/octocat.png',
}

function renderHeader(props = {}) {
    return render(
        <Header
            user={MOCK_USER}
            isMockMode={true}
            onLogin={vi.fn()}
            onLogout={vi.fn()}
            onCreateRepo={vi.fn()}
            activeView="dashboard"
            onViewChange={vi.fn()}
            onRefreshOrgs={vi.fn()}
            orgs={[]}
            syncStatus={{ lastSync: null, hasUpdates: false }}
            onReauthorize={vi.fn()}
            onOpenOrgManager={vi.fn()}
            onOpenDevToolkit={vi.fn()}
            onOpenSettings={vi.fn()}
            onImport={vi.fn()}
            onMigrationHistory={vi.fn()}
            onToggleOrgDrawer={vi.fn()}
            {...props}
        />
    )
}

beforeEach(() => {
    vi.clearAllMocks()
    systemHealthMock.mockReturnValue({
        status: 'ready',
        checks: { db: 'ok', session: 'ok' },
        lastCheckedAt: null,
    })
})

describe('Header', () => {
    it('renders the Repo Manager heading', () => {
        renderHeader()
        // The heading is only visible on sm+ screens but happy-dom renders
        // it regardless — it is always in the DOM.
        const heading = screen.getByRole('heading', { level: 1 })
        expect(heading).toHaveTextContent(/Repo Manager/i)
    })

    it('shows all five nav buttons when authenticated', () => {
        renderHeader()
        // The desktop nav renders each label as visible text. We scope to the
        // <nav> to avoid matching the mobile bottom nav, which uses "Repos"
        // (short) rather than "Repositories".
        const nav = screen.getAllByRole('navigation').find((n) =>
            within(n).queryByText('Repositories')
        )
        expect(nav).toBeTruthy()
        expect(within(nav).getByText('Dashboard')).toBeInTheDocument()
        expect(within(nav).getByText('Repositories')).toBeInTheDocument()
        expect(within(nav).getByText('Teams')).toBeInTheDocument()
        expect(within(nav).getByText('Work Board')).toBeInTheDocument()
        expect(within(nav).getByText('Pricing')).toBeInTheDocument()
    })

    it('marks the active nav button with aria-current=page', () => {
        renderHeader({ activeView: 'work-board' })
        const nav = screen.getAllByRole('navigation').find((n) =>
            within(n).queryByText('Repositories')
        )
        const workBoard = within(nav).getByRole('button', { name: /work board/i })
        expect(workBoard).toHaveAttribute('aria-current', 'page')

        const dashboard = within(nav).getByRole('button', { name: /dashboard/i })
        expect(dashboard).not.toHaveAttribute('aria-current', 'page')
    })

    it('opens the user menu on click and exposes Logout + View Profile', () => {
        renderHeader()
        const trigger = screen.getByRole('button', { name: /open user menu/i })
        fireEvent.click(trigger)
        // After click, the menu content ("Logout" / "View Profile") should be
        // in the DOM.
        expect(screen.getByText('Logout')).toBeInTheDocument()
        expect(screen.getByText('View Profile')).toBeInTheDocument()
        expect(screen.getByText('Settings')).toBeInTheDocument()
    })

    it('hides the system-health indicator when status is ready', () => {
        renderHeader()
        expect(screen.queryByTestId('system-health-indicator')).not.toBeInTheDocument()
    })

    it('renders an amber dot when status is degraded', () => {
        systemHealthMock.mockReturnValue({
            status: 'degraded',
            checks: { db: 'error: connection timeout', session: 'ok' },
            lastCheckedAt: new Date(),
        })
        renderHeader()
        const indicator = screen.getByTestId('system-health-indicator')
        expect(indicator).toBeInTheDocument()
        expect(indicator).toHaveAttribute('data-status', 'degraded')
        expect(indicator).toHaveAttribute('aria-label', 'System degraded')
        // Amber dot — the inner span has bg-amber-500
        const dot = indicator.querySelector('span')
        expect(dot).toHaveClass('bg-amber-500')
    })

    it('theme toggle button has an aria-label', () => {
        renderHeader()
        // isDark=false from the mock, so the label is "Switch to dark mode".
        const toggle = screen.getByRole('button', { name: /switch to dark mode/i })
        expect(toggle).toBeInTheDocument()
        fireEvent.click(toggle)
        expect(toggleThemeMock).toHaveBeenCalledTimes(1)
    })
})
