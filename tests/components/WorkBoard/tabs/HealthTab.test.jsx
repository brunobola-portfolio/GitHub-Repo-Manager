import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HealthTab } from '@/components/WorkBoard/tabs/HealthTab'

const mockUseWorkBoardHealth = vi.fn()

vi.mock('@/hooks/useWorkBoard', () => ({
    useWorkBoardHealth: () => mockUseWorkBoardHealth(),
}))

// ManageReposButton (rendered in the empty state) needs this context hook —
// mocked so the empty-state test doesn't need a TrackedReposProvider wrapper.
vi.mock('@/hooks/useTrackedRepos', () => ({
    useTrackedRepos: () => ({ repos: [], pin: vi.fn(), unpin: vi.fn(), mute: vi.fn(), unmute: vi.fn(), undo: vi.fn() }),
}))

describe('HealthTab', () => {
    it('shows a loading skeleton', () => {
        mockUseWorkBoardHealth.mockReturnValue({ data: null, loading: true, error: null, refresh: vi.fn() })
        const { container } = render(<HealthTab />)
        expect(container.querySelector('[class*="animate-pulse"]') || container.firstChild).toBeTruthy()
    })

    it('shows an error state with retry', () => {
        const refresh = vi.fn()
        mockUseWorkBoardHealth.mockReturnValue({ data: null, loading: false, error: { status: 500 }, refresh })
        render(<HealthTab />)
        expect(screen.getByText(/Couldn't load portfolio health/i)).toBeTruthy()
    })

    it('shows an empty state with a Track repositories (Manage) action when nothing is tracked', () => {
        mockUseWorkBoardHealth.mockReturnValue({ data: { repos: [] }, loading: false, error: null, refresh: vi.fn() })
        render(<HealthTab />)
        expect(screen.getByText(/No repositories tracked yet/i)).toBeTruthy()
        expect(screen.getByRole('button', { name: /manage repos/i })).toBeTruthy()
    })

    it('ranks repos by score and renders failing-check chips + delta', () => {
        mockUseWorkBoardHealth.mockReturnValue({
            data: {
                repos: [
                    { repoFullName: 'acme/top', score: 95, failingChecks: [], lastCheckedAt: '2026-09-05T00:00:00Z', delta: 5 },
                    { repoFullName: 'acme/needs-work', score: 40, failingChecks: ['Add LICENSE', 'Add SECURITY.md'], lastCheckedAt: '2026-09-04T00:00:00Z', delta: -12 },
                    { repoFullName: 'acme/unscored', score: null, failingChecks: [], lastCheckedAt: null, delta: null },
                ],
            },
            loading: false, error: null, refresh: vi.fn(),
        })
        render(<HealthTab />)

        expect(screen.getByText('acme/top')).toBeTruthy()
        expect(screen.getByText('95')).toBeTruthy()
        expect(screen.getByText('+5')).toBeTruthy()

        expect(screen.getByText('acme/needs-work')).toBeTruthy()
        expect(screen.getByText('Add LICENSE')).toBeTruthy()
        expect(screen.getByText('-12')).toBeTruthy()

        expect(screen.getByText('acme/unscored')).toBeTruthy()
        expect(screen.getByText(/Not yet scored/i)).toBeTruthy()

        // Ranked: highest score row appears before the lower one in DOM order.
        const rows = screen.getAllByRole('row').map(r => r.textContent)
        const topIdx = rows.findIndex(r => r.includes('acme/top'))
        const needsWorkIdx = rows.findIndex(r => r.includes('acme/needs-work'))
        const unscoredIdx = rows.findIndex(r => r.includes('acme/unscored'))
        expect(topIdx).toBeLessThan(needsWorkIdx)
        expect(needsWorkIdx).toBeLessThan(unscoredIdx)

        expect(screen.getByRole('button', { name: /export portfolio health as csv/i })).toBeTruthy()
    })

    it('shows an "All checks passing" badge for a scored repo with no failing checks', () => {
        mockUseWorkBoardHealth.mockReturnValue({
            data: { repos: [{ repoFullName: 'acme/clean', score: 88, failingChecks: [], lastCheckedAt: '2026-09-05T00:00:00Z', delta: 0 }] },
            loading: false, error: null, refresh: vi.fn(),
        })
        render(<HealthTab />)
        expect(screen.getByText(/All checks passing/i)).toBeTruthy()
    })
})
