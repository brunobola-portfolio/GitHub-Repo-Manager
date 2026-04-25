import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockFetch = vi.fn()
vi.mock('../../../src/api/attentionFeed', () => ({
    fetchAttentionFeed: (...args) => mockFetch(...args),
}))

const { AttentionFeed } = await import('../../../src/components/Dashboard/AttentionFeed')

beforeEach(() => {
    mockFetch.mockReset()
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
})
