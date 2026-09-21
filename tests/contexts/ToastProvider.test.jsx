import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ToastProvider } from '@/contexts/ToastProvider'
import { useToast } from '@/hooks/useToast'
import { onAppEvent, APP_EVENTS } from '@/utils/appEvents'

// Renders the toast content produced by toast.errorFromException so the
// action button (ErrorToastContent) is actually in the DOM and clickable —
// exercising the same path ToastContainer/<Toast> uses in the real app.
function Harness() {
    const { toast, toasts } = useToast()
    return (
        <div>
            <button onClick={() => toast.errorFromException({ code: 'TIER_REQUIRED_PRO' })}>
                fire
            </button>
            {toasts.map((t) => <div key={t.id}>{t.content}</div>)}
        </div>
    )
}

/*
 * Regression coverage: the 'open-pricing' toast action (fired by the
 * TIER_REQUIRED_PRO / TIER_REQUIRED_ENTERPRISE / UPGRADE_REQUIRED /
 * GITHUB_PRO_REQUIRED error codes in src/utils/errors.js) used to mutate
 * `window.location.hash` directly to the bare '#pricing', which the router
 * (src/hooks/useAppRouter.js) silently ignores — a dead CTA on every
 * tier-required toast. It must instead navigate through the app event bus
 * (navigateToPricing / APP_EVENTS.NAVIGATE_PRICING), same as
 * QuotaUpgradeButton, so React state (and the URL) actually update.
 */
describe('ToastProvider — open-pricing toast action', () => {
    beforeEach(() => {
        window.location.hash = ''
    })

    it('routes the "See plans" action through the app event bus instead of mutating the hash directly', () => {
        const fn = vi.fn()
        const off = onAppEvent(APP_EVENTS.NAVIGATE_PRICING, fn)

        render(<ToastProvider><Harness /></ToastProvider>)
        fireEvent.click(screen.getByText('fire'))
        fireEvent.click(screen.getByRole('button', { name: 'See plans' }))

        expect(fn).toHaveBeenCalledTimes(1)
        expect(window.location.hash).not.toBe('#pricing')

        off()
    })
})

/*
 * Regression: toast.info(message, { description }) passed an OBJECT where the
 * adder expected a duration in ms. `record.duration > 0` was false for an
 * object, so the toast never scheduled its dismiss timer and stayed on screen
 * across every view until the user closed it by hand (seen on mobile with
 * "Pull request #16 is not in this list").
 */
describe('ToastProvider — options object as the second argument', () => {
    function OptsHarness() {
        const { toast, toasts } = useToast()
        return (
            <div>
                <button onClick={() => toast.info('Not in this list', { description: 'It may be closed.' })}>
                    fire-opts
                </button>
                {toasts.map((t) => <div key={t.id} data-testid="toast">{t.message}</div>)}
            </div>
        )
    }

    it('still auto-dismisses and folds the description into the message', () => {
        vi.useFakeTimers()
        try {
            render(<ToastProvider><OptsHarness /></ToastProvider>)
            fireEvent.click(screen.getByText('fire-opts'))
            const card = screen.getByTestId('toast')
            expect(card.textContent).toContain('Not in this list')
            expect(card.textContent).toContain('It may be closed.')
            act(() => { vi.advanceTimersByTime(5001) })
            expect(screen.queryByTestId('toast')).toBeNull()
        } finally {
            vi.useRealTimers()
        }
    })

    it('honours an explicit duration inside the options object', () => {
        vi.useFakeTimers()
        try {
            function Short() {
                const { toast, toasts } = useToast()
                return (
                    <div>
                        <button onClick={() => toast.warning('Quick', { duration: 1000 })}>fire-short</button>
                        {toasts.map((t) => <div key={t.id} data-testid="toast">{t.message}</div>)}
                    </div>
                )
            }
            render(<ToastProvider><Short /></ToastProvider>)
            fireEvent.click(screen.getByText('fire-short'))
            expect(screen.getByTestId('toast')).toBeInTheDocument()
            act(() => { vi.advanceTimersByTime(1001) })
            expect(screen.queryByTestId('toast')).toBeNull()
        } finally {
            vi.useRealTimers()
        }
    })
})
