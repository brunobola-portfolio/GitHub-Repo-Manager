import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) })
    sessionStorage.clear()
})

const { DashboardHero } = await import('../../../src/components/Dashboard/DashboardHero')

describe('DashboardHero', () => {
    const baseProps = {
        user: { login: 'bruno', name: 'Bruno' },
        orgs: [],
        selectedOrg: '',
        onSelectOrg: () => {},
        loading: false,
        timeRange: '7d',
        onTimeRangeChange: () => {},
        onSync: () => Promise.resolve(),
        lastSyncedAt: null,
        onOpenWorkBoard: () => {},
    }

    it('renders greeting with user name', () => {
        render(<DashboardHero {...baseProps} />)
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/bruno/i)
    })

    it('renders the org filter chip', () => {
        render(<DashboardHero {...baseProps} />)
        expect(screen.getByLabelText(/filter by organization/i)).toBeInTheDocument()
    })

    it('renders the time range chip', () => {
        render(<DashboardHero {...baseProps} />)
        expect(screen.getByLabelText(/time range/i)).toBeInTheDocument()
    })

    it('shows fallback greeting when user is null', () => {
        render(<DashboardHero {...baseProps} user={null} />)
        expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    })
})
