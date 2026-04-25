import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const mockUseWorkBoardAI = vi.fn(() => ({ enabled: false }))
vi.mock('../../../../src/hooks/useWorkBoardAI', () => ({
    useWorkBoardAI: () => mockUseWorkBoardAI(),
}))

const { WorkBoardSummary } = await import('../../../../src/components/Settings/WorkBoard/WorkBoardSummary')

beforeEach(() => {
    mockUseWorkBoardAI.mockReturnValue({ enabled: false })
})

describe('WorkBoardSummary', () => {
    it('renders the count tiles', () => {
        render(<WorkBoardSummary prefs={{}} totalCount={12} mutedCount={3} pinnedCount={4} tier="pro" />)
        expect(screen.getByText('12')).toBeInTheDocument()
        expect(screen.getByText('4')).toBeInTheDocument()
        expect(screen.getByText('3')).toBeInTheDocument()
    })

    it('shows "never" when last_discovery_at is missing', () => {
        render(<WorkBoardSummary prefs={{}} totalCount={0} mutedCount={0} pinnedCount={0} tier="free" />)
        expect(screen.getByText('never')).toBeInTheDocument()
    })

    it('formats relative time for last_discovery_at', () => {
        const oneHourAgo = new Date(Date.now() - 90 * 60 * 1000).toISOString()
        render(<WorkBoardSummary prefs={{ last_discovery_at: oneHourAgo }} totalCount={0} mutedCount={0} pinnedCount={0} tier="free" />)
        expect(screen.getByText(/1h ago|2h ago/)).toBeInTheDocument()
    })

    it('renders the plan tier badge', () => {
        render(<WorkBoardSummary prefs={{}} totalCount={0} mutedCount={0} pinnedCount={0} tier="enterprise" />)
        expect(screen.getByText('Enterprise')).toBeInTheDocument()
    })

    it('shows AI Off when the assistant is disabled', () => {
        mockUseWorkBoardAI.mockReturnValue({ enabled: false })
        render(<WorkBoardSummary prefs={{}} totalCount={0} mutedCount={0} pinnedCount={0} tier="free" />)
        expect(screen.getByText('Off')).toBeInTheDocument()
    })

    it('shows AI On when the assistant is enabled', () => {
        mockUseWorkBoardAI.mockReturnValue({ enabled: true })
        render(<WorkBoardSummary prefs={{}} totalCount={0} mutedCount={0} pinnedCount={0} tier="free" />)
        expect(screen.getByText('On')).toBeInTheDocument()
    })
})
