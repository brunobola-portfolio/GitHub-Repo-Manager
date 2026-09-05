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
    global.fetch.mockResolvedValue({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) })
}

function mockCounts(reviews, stale, issues) {
    global.fetch
        .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: new Array(reviews) }) })
        .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: new Array(stale) }) })
        .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: new Array(issues) }) })
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
        await waitFor(() => expect(screen.getByText(/all caught up/i)).toBeInTheDocument())
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

describe('WhatNeedsYouGrid — when the sources could not be read', () => {
    const boom = { ok: false, status: 500, json: async () => ({}) }

    it('does not claim the user is all caught up when every source failed', async () => {
        // The old behaviour: each failure became a silent 0, the three summed
        // to 0, and the grid announced the all-clear — a conclusion a user
        // acts on by closing the tab.
        global.fetch.mockResolvedValue(boom)
        renderPro(<WhatNeedsYouGrid onOpenWorkBoard={() => {}} />)
        await waitFor(() => expect(screen.getByText(/couldn.t check your work/i)).toBeInTheDocument())
        expect(screen.queryByText(/all caught up/i)).not.toBeInTheDocument()
    })

    it('does not claim it when only one source failed', async () => {
        global.fetch
            .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) })
            .mockResolvedValueOnce(boom)
            .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ data: [] }) })
        renderPro(<WhatNeedsYouGrid onOpenWorkBoard={() => {}} />)
        await waitFor(() => expect(screen.getByText(/couldn.t check your work/i)).toBeInTheDocument())
        expect(screen.queryByText(/all caught up/i)).not.toBeInTheDocument()
    })

    it('offers a retry that refetches', async () => {
        global.fetch.mockResolvedValue(boom)
        renderPro(<WhatNeedsYouGrid onOpenWorkBoard={() => {}} />)
        await waitFor(() => screen.getByRole('button', { name: /try again/i }))
        const before = global.fetch.mock.calls.length
        fireEvent.click(screen.getByRole('button', { name: /try again/i }))
        await waitFor(() => expect(global.fetch.mock.calls.length).toBeGreaterThan(before))
    })

    it('still shows the all-clear when the sources genuinely returned nothing', async () => {
        mockAllZero()
        renderPro(<WhatNeedsYouGrid onOpenWorkBoard={() => {}} />)
        await waitFor(() => expect(screen.getByText(/all caught up/i)).toBeInTheDocument())
    })
})
