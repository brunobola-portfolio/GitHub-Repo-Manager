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

const mockQuotaState = vi.fn()
vi.mock('../../../src/hooks/useAIQuotaState', () => ({
    useAIQuotaState: () => mockQuotaState(),
}))

// Real AIQuotaExceededError so `instanceof` checks in the component work.
const { AIQuotaExceededError } = await import('../../../src/api/aiFetch')

const { AttentionFeed } = await import('../../../src/components/Dashboard/AttentionFeed')

beforeEach(() => {
    mockFetch.mockReset()
    mockNarrative.mockReset()
    mockAIStatus.mockReset()
    mockQuotaState.mockReset()
    // Default: AI not configured → narrative path stays silent.
    mockAIStatus.mockReturnValue({ configured: false, keyOk: false })
    // Default: quota gate is open.
    mockQuotaState.mockReturnValue(null)
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

    it('requests the AI narrative for each top-N item when configured + healthy', async () => {
        mockFetch.mockResolvedValue(SAMPLE)
        mockAIStatus.mockReturnValue({ configured: true, keyOk: true })
        // Different narrative per call so we can assert each rendered.
        mockNarrative.mockImplementation(({ repo }) => Promise.resolve({
            narrative: `Narrative for ${repo}.`,
            cached: false,
            model: 'gemini-test',
        }))
        render(<AttentionFeed />)
        // SAMPLE has 2 items — both fall inside NARRATIVE_TOP_N (3).
        expect(await screen.findByText(/Narrative for acme\/blocker\./)).toBeInTheDocument()
        expect(await screen.findByText(/Narrative for acme\/quiet\./)).toBeInTheDocument()
        expect(mockNarrative).toHaveBeenCalledTimes(2)
        const repos = mockNarrative.mock.calls.map((c) => c[0].repo).sort()
        expect(repos).toEqual(['acme/blocker', 'acme/quiet'])
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

    // ---------------------------------------------------------------------
    // Premium quota handling: gate closed → no fan-out, single inline notice
    // ---------------------------------------------------------------------

    it('does NOT fire narrative requests when the quota gate is already closed', async () => {
        mockFetch.mockResolvedValue(SAMPLE)
        mockAIStatus.mockReturnValue({ configured: true, keyOk: true })
        // Future reset so formatReset returns a sane string.
        mockQuotaState.mockReturnValue({
            feature: 'ai_queries',
            limit: 50,
            used: 50,
            resetAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
            upgradeTo: 'pro',
            until: Date.now() + 60_000,
            recordedAt: Date.now(),
        })
        render(<AttentionFeed />)
        await screen.findByText('acme/blocker')
        expect(mockNarrative).not.toHaveBeenCalled()
        // Premium notice is rendered above the list.
        expect(screen.getByText(/AI insights paused/i)).toBeInTheDocument()
        expect(screen.getByText(/50 \/ 50 requests used/)).toBeInTheDocument()
        expect(screen.getByText(/upgrade to pro/i)).toBeInTheDocument()
    })

    it('bails out the remaining narrative requests when one returns AIQuotaExceededError', async () => {
        // SAMPLE has 2 items. First call throws quota; second should be skipped.
        mockFetch.mockResolvedValue(SAMPLE)
        mockAIStatus.mockReturnValue({ configured: true, keyOk: true })
        mockQuotaState.mockReturnValue(null) // gate open at render-time
        const quotaErr = new AIQuotaExceededError({
            feature: 'ai_queries',
            limit: 100,
            used: 100,
            resetAt: new Date(Date.now() + 60_000).toISOString(),
        })
        mockNarrative
            .mockRejectedValueOnce(quotaErr)
            .mockResolvedValueOnce({ narrative: 'should never render', cached: false, model: 'x' })

        render(<AttentionFeed />)
        await screen.findByText('acme/blocker')

        // Only the first call goes out — the loop bails after seeing the error.
        await waitFor(() => expect(mockNarrative).toHaveBeenCalledTimes(1))
        expect(screen.queryByText(/should never render/)).not.toBeInTheDocument()
    })
})
