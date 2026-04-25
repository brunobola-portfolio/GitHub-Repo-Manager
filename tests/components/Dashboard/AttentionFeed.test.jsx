import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockFetch = vi.fn()
vi.mock('../../../src/api/attentionFeed', () => ({
    fetchAttentionFeed: (...args) => mockFetch(...args),
}))

const mockNarrative = vi.fn()
vi.mock('../../../src/api/attentionNarrative', () => ({
    fetchAttentionNarrative: (...args) => mockNarrative(...args),
}))

const mockAIStatus = vi.fn()
vi.mock('../../../src/hooks/useAIStatus', () => ({
    useAIStatus: () => mockAIStatus(),
}))

const { AttentionFeed } = await import('../../../src/components/Dashboard/AttentionFeed')

beforeEach(() => {
    mockFetch.mockReset()
    mockNarrative.mockReset()
    mockAIStatus.mockReset()
    // Default: AI not configured → narrative path stays silent.
    mockAIStatus.mockReturnValue({ configured: false, keyOk: false })
})

const SAMPLE = {
    items: [
        {
            id: 'failed-migration:job-1',
            kind: 'failed_migration',
            severity: 'high',
            repoFullName: 'acme/blocker',
            title: 'Migration failed',
            hint: 'auth failed at clone step',
            since: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        },
        {
            id: 'stale-pinned:acme/quiet',
            kind: 'stale_pinned',
            severity: 'medium',
            repoFullName: 'acme/quiet',
            title: 'Pinned but quiet for 14 days',
            hint: 'Pinned repos with no activity for a week may have drifted off your radar.',
            since: new Date(Date.now() - 14 * 86_400_000).toISOString(),
        },
    ],
    counts: { failed_migration: 1, stale_pinned: 1 },
    total: 2,
}

describe('AttentionFeed', () => {
    it('renders nothing when the feed is empty', async () => {
        mockFetch.mockResolvedValue({ items: [], counts: {}, total: 0 })
        const { container } = render(<AttentionFeed />)
        await waitFor(() => expect(container.firstChild).toBeNull())
    })

    it('renders rows for each item with the right title and badge', async () => {
        mockFetch.mockResolvedValue(SAMPLE)
        render(<AttentionFeed />)
        expect(await screen.findByText('acme/blocker')).toBeInTheDocument()
        expect(screen.getByText('acme/quiet')).toBeInTheDocument()
        // 'Migration failed' appears both as the badge label and the row
        // title — at least one occurrence is enough to prove rendering.
        expect(screen.getAllByText('Migration failed').length).toBeGreaterThan(0)
        expect(screen.getByText('Pinned but quiet')).toBeInTheDocument()
        expect(screen.getByText('Pinned but quiet for 14 days')).toBeInTheDocument()
    })

    it('clicking a row calls onSelectRepo with repoFullName + the item', async () => {
        mockFetch.mockResolvedValue(SAMPLE)
        const onSelectRepo = vi.fn()
        render(<AttentionFeed onSelectRepo={onSelectRepo} />)
        const row = await screen.findByText('acme/blocker')
        fireEvent.click(row.closest('button'))
        expect(onSelectRepo).toHaveBeenCalledWith('acme/blocker', SAMPLE.items[0])
    })

    it('refresh button re-runs the fetch', async () => {
        mockFetch.mockResolvedValue(SAMPLE)
        render(<AttentionFeed />)
        await screen.findByText('acme/blocker')
        expect(mockFetch).toHaveBeenCalledTimes(1)
        fireEvent.click(screen.getByRole('button', { name: /refresh attention feed/i }))
        await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
    })

    it('survives a malformed payload (no items array)', async () => {
        mockFetch.mockResolvedValue({ unexpected: 'shape' })
        const { container } = render(<AttentionFeed />)
        // After the fetch resolves the component should collapse to null,
        // not throw because of feed.items.length being undefined.
        await waitFor(() => expect(container.firstChild).toBeNull())
    })

    it('forwards the limit prop to the API', async () => {
        mockFetch.mockResolvedValue(SAMPLE)
        render(<AttentionFeed limit={3} />)
        await waitFor(() => expect(mockFetch).toHaveBeenCalled())
        const args = mockFetch.mock.calls[0][0]
        expect(args.limit).toBe(3)
    })

    it('does NOT request the AI narrative when AI is not configured', async () => {
        mockFetch.mockResolvedValue(SAMPLE)
        mockAIStatus.mockReturnValue({ configured: false, keyOk: false })
        render(<AttentionFeed />)
        await screen.findByText('acme/blocker')
        expect(mockNarrative).not.toHaveBeenCalled()
    })

    it('does NOT request the AI narrative when the key is unhealthy', async () => {
        mockFetch.mockResolvedValue(SAMPLE)
        mockAIStatus.mockReturnValue({ configured: true, keyOk: false })
        render(<AttentionFeed />)
        await screen.findByText('acme/blocker')
        expect(mockNarrative).not.toHaveBeenCalled()
    })

    it('renders the AI narrative for the top item when configured + healthy', async () => {
        mockFetch.mockResolvedValue(SAMPLE)
        mockAIStatus.mockReturnValue({ configured: true, keyOk: true })
        mockNarrative.mockResolvedValue({
            narrative: 'Failed clone for acme/blocker — auth rejected three hours ago.',
            cached: false,
            model: 'gemini-test',
        })
        render(<AttentionFeed />)
        expect(await screen.findByText(/Failed clone for acme\/blocker/)).toBeInTheDocument()
        // narrative should fire only for the top item, not the second one
        expect(mockNarrative).toHaveBeenCalledTimes(1)
        expect(mockNarrative.mock.calls[0][0].repo).toBe('acme/blocker')
    })

    it('stays silent when the narrative fetch returns null (AI failure)', async () => {
        mockFetch.mockResolvedValue(SAMPLE)
        mockAIStatus.mockReturnValue({ configured: true, keyOk: true })
        mockNarrative.mockResolvedValue(null)
        render(<AttentionFeed />)
        await screen.findByText('acme/blocker')
        // Sanity: no garnish text rendered, layout stays intact.
        expect(screen.queryByText(/Sparkles|narrative/i)).toBeNull()
    })
})
