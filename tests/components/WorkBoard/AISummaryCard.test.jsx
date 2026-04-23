import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

vi.mock('framer-motion', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, motion: new Proxy(actual.motion, { get: (t, k) => t[k] ?? t.div }), AnimatePresence: ({ children }) => children }
})

// getCsrfToken is injected into every mutation by AISummaryCard. Stub it so
// the component's fetch mock only needs to handle the ai-summary POST.
vi.mock('@/utils/api', () => ({
    getCsrfToken: vi.fn(async () => 'test-csrf-token'),
}))

const { AISummaryCard } = await import('@/components/WorkBoard/AISummaryCard')

beforeEach(() => { global.fetch = vi.fn() })

describe('AISummaryCard', () => {
    it('renders nothing when endpoint returns 404 ai_not_configured', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({ code: 'ai_not_configured' }) })
        const { container } = render(<AISummaryCard />)
        await waitFor(() => expect(container.firstChild).toBeNull())
    })

    it('renders headline and bullets on success', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({
            data: {
                headline: 'All quiet on the western front',
                bullets: [
                    { text: 'Nothing urgent', severity: 'info' },
                    { text: 'Refactor X in acme/backend', severity: 'medium', link: { type: 'issue', repo: 'acme/backend', number: 99 } },
                ],
                urgencyScore: 0.4,
                provider: 'anthropic',
                model: 'claude',
            },
            meta: { cached: false },
        })})
        render(<AISummaryCard />)
        await waitFor(() => expect(screen.getByText(/All quiet/)).toBeInTheDocument())
        expect(screen.getByText(/Refactor X in acme\/backend/)).toBeInTheDocument()
        // Link for the medium bullet
        const link = screen.getByRole('link', { name: /refactor x/i })
        expect(link).toHaveAttribute('href', 'https://github.com/acme/backend/issues/99')
        expect(link).toHaveAttribute('target', '_blank')
    })

    it('regenerate button refetches', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({
            data: { headline: 'h', bullets: [{ text: 'b', severity: 'info' }], urgencyScore: 0.1 },
            meta: {},
        })})
        render(<AISummaryCard />)
        await waitFor(() => expect(screen.getByText('h')).toBeInTheDocument())
        fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))
    })

    it('dismiss button hides the card', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({
            data: { headline: 'h', bullets: [{ text: 'b', severity: 'info' }], urgencyScore: 0.1 },
            meta: {},
        })})
        const { container } = render(<AISummaryCard />)
        await waitFor(() => expect(screen.getByText('h')).toBeInTheDocument())
        fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
        await waitFor(() => expect(container.firstChild).toBeNull())
    })

    it('non-404 error shows a retry inline', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })
        render(<AISummaryCard />)
        await waitFor(() => expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument())
    })

    it('retry after a failure fetches again and succeeds', async () => {
        global.fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })
        global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({
            data: { headline: 'after retry', bullets: [{ text: 'b', severity: 'info' }], urgencyScore: 0.1 },
            meta: {},
        })})
        render(<AISummaryCard />)
        const retry = await screen.findByRole('button', { name: /retry/i })
        fireEvent.click(retry)
        await waitFor(() => expect(screen.getByText('after retry')).toBeInTheDocument())
    })
})
