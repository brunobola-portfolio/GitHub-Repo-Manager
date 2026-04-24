import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

beforeEach(() => {
    global.fetch = vi.fn()
    localStorage.clear()
})

const { YourWorkCard } = await import('../../../src/components/Dashboard/YourWorkCard')

describe('YourWorkCard', () => {
    it('shows card header while loading', () => {
        global.fetch.mockReturnValue(new Promise(() => {}))
        render(<YourWorkCard onOpenBoard={() => {}} />)
        expect(screen.getByText(/your work/i)).toBeInTheDocument()
    })

    it('displays reviews/stale/issues counts after fetch', async () => {
        global.fetch
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: new Array(5) }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: new Array(3) }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: new Array(7) }) })

        render(<YourWorkCard onOpenBoard={() => {}} />)
        await waitFor(() => expect(screen.getByText(/5 reviews waiting/i)).toBeInTheDocument())
        expect(screen.getByText(/3 stale prs/i)).toBeInTheDocument()
        expect(screen.getByText(/7 issues/i)).toBeInTheDocument()
    })

    it('Open board button triggers onOpenBoard', async () => {
        global.fetch
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })

        const onOpenBoard = vi.fn()
        render(<YourWorkCard onOpenBoard={onOpenBoard} />)
        await waitFor(() => expect(screen.getByRole('button', { name: /open board/i })).toBeInTheDocument())
        fireEvent.click(screen.getByRole('button', { name: /open board/i }))
        expect(onOpenBoard).toHaveBeenCalled()
    })

    it('hides card silently on 401 (unauthenticated)', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
        const { container } = render(<YourWorkCard onOpenBoard={() => {}} />)
        await waitFor(() => expect(container.firstChild).toBeNull())
    })
})
