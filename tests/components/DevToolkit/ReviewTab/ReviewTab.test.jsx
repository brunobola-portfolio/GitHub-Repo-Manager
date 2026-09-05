/*
 * Regression coverage for FE-14: ReviewTab used to derive `selectedPR` from
 * `pulls` via two near-identical effects (one for `prContext`, one for
 * `generatedPR`). Consolidated into one render-time check — these tests
 * exercise the auto-select behaviour directly rather than the internal
 * mechanics: applies once per distinct external target, doesn't fight a
 * manual "Change PR" click, and still catches a target that arrives before
 * `pulls` has finished loading.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ReviewTab } from '@/components/DevToolkit/ReviewTab/ReviewTab'

vi.mock('@/hooks/useStreaming', () => ({
    useStreaming: () => ({
        streamingText: '', isStreaming: false, error: null, startStream: vi.fn(),
    }),
}))

const PULLS = [
    { number: 142, title: 'Add rate limiting', user: { login: 'octocat' } },
    { number: 98, title: 'Add OAuth refresh-token flow', user: { login: 'octocat' } },
]

function mockPullsResponse(pulls = PULLS) {
    return { ok: true, headers: { get: () => 'application/json' }, json: () => Promise.resolve(pulls) }
}

const baseToolkit = (overrides = {}) => ({
    selectedRepo: { name: 'backend' },
    repoOwner: 'acme',
    prContext: null,
    generatedPR: null,
    ...overrides,
})

let fetchMock

beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(mockPullsResponse()))
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('ReviewTab — external auto-select (prContext / generatedPR)', () => {
    it('auto-selects the PR named by prContext once the pulls list loads', async () => {
        render(<ReviewTab toolkit={baseToolkit({ prContext: { number: 142 } })} />)
        expect(await screen.findByText('Add rate limiting')).toBeInTheDocument()
        expect(screen.getByText(/#142/)).toBeInTheDocument()
    })

    it('auto-selects the PR named by generatedPR', async () => {
        render(<ReviewTab toolkit={baseToolkit({ generatedPR: { number: 98 } })} />)
        expect(await screen.findByText('Add OAuth refresh-token flow')).toBeInTheDocument()
    })

    it('generatedPR takes precedence when both are present (matches prior effect order)', async () => {
        render(<ReviewTab toolkit={baseToolkit({ prContext: { number: 142 }, generatedPR: { number: 98 } })} />)
        expect(await screen.findByText('Add OAuth refresh-token flow')).toBeInTheDocument()
        expect(screen.queryByText('Add rate limiting')).not.toBeInTheDocument()
    })

    it('a manual "Change PR" click is not immediately re-overridden by the still-present external target', async () => {
        const user = (await import('@testing-library/user-event')).default.setup()
        render(<ReviewTab toolkit={baseToolkit({ prContext: { number: 142 } })} />)
        await screen.findByText('Add rate limiting')

        await user.click(screen.getByRole('button', { name: /change pr/i }))
        // Back on the PR list — the same prContext.number is still around,
        // but it was already applied once and must not be re-applied.
        expect(await screen.findByText('Add OAuth refresh-token flow')).toBeInTheDocument() // PRSelector list item
        expect(screen.queryByRole('button', { name: /change pr/i })).not.toBeInTheDocument()
    })

    it('does not throw when neither prContext nor generatedPR is set', async () => {
        render(<ReviewTab toolkit={baseToolkit()} />)
        await waitFor(() => expect(fetchMock).toHaveBeenCalled())
        expect(await screen.findByText('Add rate limiting')).toBeInTheDocument() // PRSelector list, nothing auto-selected
    })
})
