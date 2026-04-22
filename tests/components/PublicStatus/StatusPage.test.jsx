import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

// Force MOCK_MODE=false so the page performs real fetches. Must mock before import.
vi.mock('@/config', () => ({
    MOCK_MODE: false,
    API_BASE_URL: '',
}))

const { StatusPage } = await import('@/components/PublicStatus/StatusPage.jsx')

describe('StatusPage', () => {
    beforeEach(() => {
        global.fetch = vi.fn()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('renders the checking/unknown state on mount before fetch resolves', async () => {
        // Never-resolving promise so the first render captures the pre-fetch state.
        global.fetch.mockImplementation(() => new Promise(() => {}))

        render(<StatusPage />)

        const pill = screen.getByTestId('status-pill')
        expect(pill.textContent).toMatch(/Checking/i)
    })

    it('shows "All systems operational" when /api/health/ready returns 200', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ status: 'ready', checks: { db: 'ok', session: 'ok' } }),
        })

        render(<StatusPage />)

        await waitFor(() => {
            expect(screen.getByTestId('status-pill').textContent).toMatch(/All systems operational/i)
        })
        expect(screen.getByTestId('check-db').textContent).toMatch(/Operational/i)
        expect(screen.getByTestId('check-session').textContent).toMatch(/Operational/i)
        expect(global.fetch).toHaveBeenCalledWith('/api/health/ready', expect.objectContaining({
            credentials: 'omit',
        }))
    })

    it('shows "Partial outage" when /api/health/ready returns 503', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: false,
            status: 503,
            json: async () => ({
                status: 'degraded',
                checks: { db: 'error: connection timeout', session: 'ok' },
            }),
        })

        render(<StatusPage />)

        await waitFor(() => {
            expect(screen.getByTestId('status-pill').textContent).toMatch(/Partial outage/i)
        })
        expect(screen.getByTestId('check-db').textContent).toMatch(/connection timeout/i)
        expect(screen.getByTestId('check-session').textContent).toMatch(/Operational/i)
    })

    it('refresh button triggers a re-fetch', async () => {
        global.fetch
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ status: 'ready', checks: { db: 'ok', session: 'ok' } }),
            })
            .mockResolvedValueOnce({
                ok: false,
                status: 503,
                json: async () => ({ status: 'degraded', checks: { db: 'error: down', session: 'ok' } }),
            })

        render(<StatusPage />)

        await waitFor(() => {
            expect(screen.getByTestId('status-pill').textContent).toMatch(/All systems operational/i)
        })
        expect(global.fetch).toHaveBeenCalledTimes(1)

        const refreshBtn = screen.getByRole('button', { name: /refresh status/i })
        await act(async () => {
            fireEvent.click(refreshBtn)
        })

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledTimes(2)
        })
        await waitFor(() => {
            expect(screen.getByTestId('status-pill').textContent).toMatch(/Partial outage/i)
        })
    })
})
