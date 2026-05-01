import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

vi.mock('framer-motion', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, motion: new Proxy(actual.motion, { get: (t, k) => t[k] ?? t.div }), AnimatePresence: ({ children }) => children }
})

// AISummaryCard now goes through fetchWithRetry, which transparently
// injects CSRF and routes session-expiry detection. The test mocks the
// helper directly: a 2xx response is a plain {ok:true, json} stub; non-2xx
// is delivered by throwing an ApiError-shaped object that the component's
// catch path inspects (status + data fields), matching the real helper.
class MockApiError extends Error {
    constructor({ status, data }) {
        super(`HTTP ${status}`)
        this.name = 'ApiError'
        this.status = status
        this.data = data ?? null
    }
}

const fetchWithRetryMock = vi.fn()
vi.mock('@/utils/api', () => ({
    fetchWithRetry: (...args) => fetchWithRetryMock(...args),
}))

const { AISummaryCard } = await import('@/components/WorkBoard/AISummaryCard')

beforeEach(() => { fetchWithRetryMock.mockReset() })

const mock2xx = (data) => fetchWithRetryMock.mockResolvedValue({ ok: true, json: async () => data })
const mockNon2xx = ({ status, data }) => fetchWithRetryMock.mockRejectedValue(new MockApiError({ status, data }))

describe('AISummaryCard', () => {
    it('renders nothing when endpoint returns 404 ai_not_configured', async () => {
        mockNon2xx({ status: 404, data: { code: 'ai_not_configured' } })
        const { container } = render(<AISummaryCard />)
        await waitFor(() => expect(container.firstChild).toBeNull())
    })

    it('renders headline and bullets on success', async () => {
        mock2xx({
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
        })
        render(<AISummaryCard />)
        await waitFor(() => expect(screen.getByText(/All quiet/)).toBeInTheDocument())
        expect(screen.getByText(/Refactor X in acme\/backend/)).toBeInTheDocument()
        // Link for the medium bullet
        const link = screen.getByRole('link', { name: /refactor x/i })
        expect(link).toHaveAttribute('href', 'https://github.com/acme/backend/issues/99')
        expect(link).toHaveAttribute('target', '_blank')
    })

    it('regenerate button refetches', async () => {
        mock2xx({
            data: { headline: 'h', bullets: [{ text: 'b', severity: 'info' }], urgencyScore: 0.1 },
            meta: {},
        })
        render(<AISummaryCard />)
        await waitFor(() => expect(screen.getByText('h')).toBeInTheDocument())
        fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))
        await waitFor(() => expect(fetchWithRetryMock).toHaveBeenCalledTimes(2))
    })

    it('dismiss button hides the card', async () => {
        mock2xx({
            data: { headline: 'h', bullets: [{ text: 'b', severity: 'info' }], urgencyScore: 0.1 },
            meta: {},
        })
        const { container } = render(<AISummaryCard />)
        await waitFor(() => expect(screen.getByText('h')).toBeInTheDocument())
        fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
        await waitFor(() => expect(container.firstChild).toBeNull())
    })

    it('non-404 error shows a retry inline', async () => {
        mockNon2xx({ status: 500, data: { error: 'boom' } })
        render(<AISummaryCard />)
        await waitFor(() => expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument())
    })

    it('retry after a failure fetches again and succeeds', async () => {
        fetchWithRetryMock
            .mockRejectedValueOnce(new MockApiError({ status: 500, data: { error: 'boom' } }))
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: { headline: 'after retry', bullets: [{ text: 'b', severity: 'info' }], urgencyScore: 0.1 },
                    meta: {},
                }),
            })
        render(<AISummaryCard />)
        const retry = await screen.findByRole('button', { name: /retry/i })
        fireEvent.click(retry)
        await waitFor(() => expect(screen.getByText('after retry')).toBeInTheDocument())
    })

    it('quota error renders a clean headline (no raw provider RPC dump)', async () => {
        const longRawError = '[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/... [429 Too Many Requests] You exceeded your current quota, please check your plan and billing details.'
        mockNon2xx({ status: 429, data: { error: longRawError, code: 'ai_quota_exceeded' } })
        render(<AISummaryCard />)
        await waitFor(() => expect(screen.getByText(/quota exceeded/i)).toBeInTheDocument())
        // The raw provider URL must not appear in the rendered DOM
        expect(screen.queryByText(/generativelanguage\.googleapis\.com/)).toBeNull()
    })

    it('rate-limited error shows retry-in-Ns when retryAfterSec present', async () => {
        mockNon2xx({ status: 429, data: { error: 'rate limited', code: 'ai_rate_limited', retryAfterSec: 14 } })
        render(<AISummaryCard />)
        await waitFor(() => expect(screen.getByText(/rate-limited/i)).toBeInTheDocument())
        expect(screen.getByText(/retry in 14s/i)).toBeInTheDocument()
    })

    it('legacy raw quota text without code still gets cleaned up', async () => {
        // Older server responses may not include `code`. The client still detects
        // /quota/i and renders the friendly headline.
        mockNon2xx({ status: 500, data: { error: 'You exceeded your current quota — long unfriendly Google RPC dump goes here…' } })
        render(<AISummaryCard />)
        await waitFor(() => expect(screen.getByText(/quota exceeded/i)).toBeInTheDocument())
    })
})
