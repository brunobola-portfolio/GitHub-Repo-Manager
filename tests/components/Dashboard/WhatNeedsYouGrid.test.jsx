import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { TierContext } from '../../../src/contexts/contexts'

beforeEach(() => {
    vi.stubEnv('VITE_MOCK_MODE', '')
    global.fetch = vi.fn()
    sessionStorage.clear()
})

afterEach(() => {
    vi.unstubAllEnvs()
})

const { WhatNeedsYouGrid } = await import('../../../src/components/Dashboard/WhatNeedsYouGrid')

// Stale PRs is Pro-gated; wrap with TierContext='pro' so the stale fetch
// fires and all three category cards render. Without this the hook
// short-circuits stale, breaking tests that assert a stale count.
const renderPro = (ui) =>
    render(createElement(TierContext.Provider, { value: 'pro' }, ui))

function mockAllZero() {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) })
}

function mockCounts(reviews, stale, issues) {
    global.fetch
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: new Array(reviews) }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: new Array(stale) }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: new Array(issues) }) })
}

describe('WhatNeedsYouGrid', () => {
    it('shows skeleton placeholders while loading', () => {
        global.fetch.mockReturnValue(new Promise(() => {}))
        renderPro(<WhatNeedsYouGrid onOpenWorkBoard={() => {}} />)
        expect(screen.getAllByTestId('skeleton-card').length).toBeGreaterThan(0)
    })

    it('renders three category cards with counts after fetch', async () => {
        mockCounts(5, 3, 7)
        renderPro(<WhatNeedsYouGrid onOpenWorkBoard={() => {}} />)
        await waitFor(() => expect(screen.getByLabelText(/5 reviews waiting/i)).toBeInTheDocument())
        expect(screen.getByLabelText(/3 stale prs/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/7 issues/i)).toBeInTheDocument()
    })

    it('shows empty state when all counts are zero', async () => {
        mockAllZero()
        renderPro(<WhatNeedsYouGrid onOpenWorkBoard={() => {}} />)
        await waitFor(() => expect(screen.getByText(/estás em dia/i)).toBeInTheDocument())
    })

    it('triggers onOpenWorkBoard with initialTab on card click', async () => {
        mockCounts(2, 0, 0)
        const onOpen = vi.fn()
        renderPro(<WhatNeedsYouGrid onOpenWorkBoard={onOpen} />)
        await waitFor(() => screen.getByLabelText(/2 reviews waiting/i))
        fireEvent.click(screen.getByLabelText(/2 reviews waiting/i))
        expect(onOpen).toHaveBeenCalledWith({ initialTab: 'reviews' })
    })

    it('hides itself when all endpoints return 401', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
        const { container } = renderPro(<WhatNeedsYouGrid onOpenWorkBoard={() => {}} />)
        await waitFor(() => expect(container.firstChild).toBeNull())
    })
})
