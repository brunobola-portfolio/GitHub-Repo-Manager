import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

const mockApiCall = vi.fn()
vi.mock('../../../src/utils/api', () => ({
    apiCall: (...args) => mockApiCall(...args),
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('../../../src/hooks/useToast', () => ({
    useToast: () => ({ toast: { success: toastSuccess, error: toastError } }),
}))

vi.mock('../../../src/hooks/useRelativeTime.js', () => ({
    useRelativeTime: (iso) => (iso ? '5 min ago' : null),
}))

const { ProbeStatsSection } = await import('../../../src/components/Settings/ProbeStatsSection')

beforeEach(() => {
    mockApiCall.mockReset()
    toastSuccess.mockReset()
    toastError.mockReset()
})

describe('ProbeStatsSection', () => {
    it('renders an admin-only EmptyState when isAdmin=false', () => {
        render(<ProbeStatsSection isAdmin={false} />)
        expect(screen.getByText('Admin only')).toBeInTheDocument()
        expect(mockApiCall).not.toHaveBeenCalled()
    })

    it('fetches stats on mount when isAdmin=true and renders a card per state', async () => {
        mockApiCall.mockResolvedValue({
            ok: 8, invalid: 1, unreachable: 0, unknown: 1, total: 10,
            lastOutcomeAt: '2026-04-26T18:00:00Z',
        })
        render(<ProbeStatsSection isAdmin />)
        expect(await screen.findByText(/10 probes since restart/)).toBeInTheDocument()
        expect(screen.getByText('Healthy')).toBeInTheDocument()
        expect(screen.getByText('Invalid key')).toBeInTheDocument()
        expect(screen.getByText('Unreachable')).toBeInTheDocument()
        expect(screen.getByText('Unknown')).toBeInTheDocument()
        expect(mockApiCall).toHaveBeenCalledWith('/api/admin/ai/probe-stats')
    })

    it('renders the no-probes-yet copy when total is 0', async () => {
        mockApiCall.mockResolvedValue({
            ok: 0, invalid: 0, unreachable: 0, unknown: 0, total: 0, lastOutcomeAt: null,
        })
        render(<ProbeStatsSection isAdmin />)
        expect(await screen.findByText(/No probes yet this process/)).toBeInTheDocument()
    })

    it('shows an error EmptyState when the fetch throws + retry triggers a refetch', async () => {
        mockApiCall.mockRejectedValueOnce(new Error('network down'))
        render(<ProbeStatsSection isAdmin />)
        expect(await screen.findByText(/Couldn't load probe stats/)).toBeInTheDocument()

        mockApiCall.mockResolvedValueOnce({
            ok: 1, invalid: 0, unreachable: 0, unknown: 0, total: 1, lastOutcomeAt: '2026-04-26T18:00:00Z',
        })
        fireEvent.click(screen.getByRole('button', { name: /retry/i }))
        await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(2))
    })

    it('reset button calls /reset and refreshes', async () => {
        mockApiCall.mockResolvedValueOnce({
            ok: 5, invalid: 1, unreachable: 0, unknown: 0, total: 6, lastOutcomeAt: '2026-04-26T18:00:00Z',
        })
        render(<ProbeStatsSection isAdmin />)
        await screen.findByText(/6 probes since restart/)

        // Reset call + a follow-up fetchStats call.
        mockApiCall.mockResolvedValueOnce(undefined)
        mockApiCall.mockResolvedValueOnce({
            ok: 0, invalid: 0, unreachable: 0, unknown: 0, total: 0, lastOutcomeAt: null,
        })

        fireEvent.click(screen.getByRole('button', { name: /reset/i }))
        await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Probe counters reset'))
        await waitFor(() => expect(screen.getByText(/No probes yet this process/)).toBeInTheDocument())
    })
})
